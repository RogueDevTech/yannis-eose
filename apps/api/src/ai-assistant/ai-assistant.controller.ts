import { Controller, Post, Options, Req, Res, Body, ForbiddenException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AiAssistantService } from './ai-assistant.service';
import { canonicalPermissionCode } from '@yannis/shared';

const ADMIN_BYPASS_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);

@Controller('api/ai-chat')
export class AiAssistantController {
  private readonly logger = new Logger(AiAssistantController.name);

  constructor(private readonly aiAssistantService: AiAssistantService) {}

  /** CORS preflight for the streaming endpoint */
  @Public()
  @Options('stream')
  preflight(@Req() req: Request, @Res() res: Response) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
    }
    res.status(204).end();
  }

  @Post('stream')
  async stream(
    @CurrentUser() user: SessionUser,
    @Body() body: { sessionId?: string; message: string; model?: string; currentPage?: string; currentFilters?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Permission check
    if (!ADMIN_BYPASS_ROLES.has(user.role)) {
      const perms = (user.permissions ?? []).map(canonicalPermissionCode);
      if (!perms.includes('ai.assistant.access')) {
        throw new ForbiddenException('Missing ai.assistant.access permission');
      }
    }

    const message = body.message?.trim();
    if (!message || message.length > 4000) {
      res.status(400).json({ error: 'Message is required (max 4000 characters)' });
      return;
    }

    // CORS — allow browser to call API directly (bypassing Vite proxy which buffers SSE)
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // SSE headers — disable all buffering
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'identity');
    res.flushHeaders();

    const branchId = user.currentBranchId ?? null;
    const effectiveBranchIds = (user as any).effectiveBranchIds ?? null;
    const activeGroupId = user.activeGroupId ?? null;

    const sendSSE = (event: string, data: string) => {
      if (req.destroyed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${data}\n\n`);
      // Force flush — some Node.js setups buffer small writes
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    try {
      this.logger.log(`[stream] Starting for user=${user.id} model=${body.model}`);

      await this.aiAssistantService.sendMessageStreaming({
        sessionId: body.sessionId,
        userId: user.id,
        userName: user.name,
        userMessage: message,
        model: body.model,
        currentPage: body.currentPage,
        currentFilters: body.currentFilters,
        user: { id: user.id, role: user.role, permissions: user.permissions },
        branchId,
        effectiveBranchIds,
        activeGroupId,
        onEvent: sendSSE,
      });

      sendSSE('done', '{}');
      this.logger.log(`[stream] Completed for user=${user.id}`);
    } catch (err: any) {
      this.logger.error(`[stream] Error: ${err.message}`);
      sendSSE('error', JSON.stringify({ message: err.message || 'An error occurred' }));
    } finally {
      if (!res.writableEnded) res.end();
    }

    req.on('close', () => {
      if (!res.writableEnded) res.end();
    });
  }
}
