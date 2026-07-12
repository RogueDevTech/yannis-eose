import { Controller, Post, Req, Res, Body, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { AiAssistantService } from './ai-assistant.service';
import { canonicalPermissionCode } from '@yannis/shared';

const ADMIN_BYPASS_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);

@Controller('api/ai-chat')
export class AiAssistantController {
  constructor(private readonly aiAssistantService: AiAssistantService) {}

  /**
   * Streaming chat endpoint using Server-Sent Events.
   * Bypasses tRPC because tRPC mutations don't support SSE.
   */
  @Post('stream')
  async stream(
    @CurrentUser() user: SessionUser,
    @Body() body: { sessionId?: string; message: string; model?: string; currentPage?: string },
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

    // Validate input
    const message = body.message?.trim();
    if (!message || message.length > 4000) {
      res.status(400).json({ error: 'Message is required (max 4000 characters)' });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Resolve branch context from session
    const branchId = user.currentBranchId ?? null;
    const effectiveBranchIds = (user as any).effectiveBranchIds ?? null;
    const activeGroupId = user.activeGroupId ?? null;

    try {
      await this.aiAssistantService.sendMessageStreaming({
        sessionId: body.sessionId,
        userId: user.id,
        userMessage: message,
        model: body.model,
        currentPage: body.currentPage,
        user: { id: user.id, role: user.role, permissions: user.permissions },
        branchId,
        effectiveBranchIds,
        activeGroupId,
        onEvent: (event: string, data: string) => {
          if (req.destroyed) return;
          res.write(`event: ${event}\ndata: ${data}\n\n`);
        },
      });

      // Signal completion
      if (!req.destroyed) {
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    } catch (err: any) {
      if (!req.destroyed) {
        const errorMsg = err.message || 'An error occurred';
        res.write(`event: error\ndata: ${JSON.stringify({ message: errorMsg })}\n\n`);
        res.end();
      }
    }

    // Client disconnect cleanup
    req.on('close', () => {
      res.end();
    });
  }
}
