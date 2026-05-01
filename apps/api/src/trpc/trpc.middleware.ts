import { Injectable, Inject, Logger, type NestMiddleware } from '@nestjs/common';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { Request, Response, NextFunction } from 'express';
import { appRouter } from './routers';
import { createContext } from './context';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { canViewAllBranches } from '../common/authz';
import { SessionStoreService } from '../auth/session-store.service';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';

@Injectable()
export class TrpcMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TrpcMiddleware.name);

  constructor(
    @Inject(SessionStoreService) private readonly sessionStore: SessionStoreService,
    private readonly permissionsService: PermissionsService,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async use(req: Request, res: Response, _next: NextFunction) {
    // Resolve session from cookie — attaches user to req and validates branch context.
    // Also captures the session vars (userId, role, branchId) needed for RLS.
    await this.resolveSession(req, res);

    // If resolveSession short-circuited (e.g. no-branch 401), the response was already sent.
    if (res.headersSent) return;

    // NestJS strips the mount prefix from req.url, but tRPC's fetchRequestHandler
    // expects the full path including the endpoint prefix so it can strip it itself.
    const rawUrl = req.originalUrl || req.url;
    const url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`);

    // Convert Express Request to a Fetch API Request for tRPC v11
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    // Use Express-parsed body (already consumed by body-parser middleware)
    let body: string | undefined;
    if (req.method === 'POST' && req.body) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const fetchRequest = new globalThis.Request(url.toString(), {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });

    const fetchResponse = await fetchRequestHandler({
      endpoint: '/trpc',
      req: fetchRequest,
      router: appRouter,
      createContext: () => createContext(req, res),
      onError: ({ path, error }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          this.logger.error(`trpc_error path=${path ?? 'unknown'} ${error.message}`, error.stack);
        }
      },
    });

    // Convert Fetch Response back to Express Response
    res.status(fetchResponse.status);
    fetchResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const responseBody = await fetchResponse.text();
    res.send(responseBody);
  }

  /**
   * Resolves the session from the cookie, attaches user to request.
   * Returns the session vars { userId, role, branchId } to be set on the
   * reserved connection — or null if no session (unauthenticated request).
   * Sends a 401 response directly and returns null if branch context is missing.
   */
  private async resolveSession(
    req: Request,
    res: Response,
  ): Promise<{ userId: string; role: string; branchId: string } | null> {
    const cookies = req.headers.cookie;
    if (!cookies) return null;

    const match = cookies.split(';').find((c) => c.trim().startsWith('yannis_session='));
    if (!match) return null;

    const token = match.split('=')[1]?.trim();
    if (!token) return null;

    const user = await this.sessionStore.getSession(token);
    if (!user) return null;

    const [dbUser] = await this.db
      .select({
        roleTemplateId: schema.users.roleTemplateId,
        scopeGlobal: schema.users.scopeGlobal,
        scopeOrgWideHead: schema.users.scopeOrgWideHead,
        scopeTeamSupervisor: schema.users.scopeTeamSupervisor,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);

    const merged: SessionUser = {
      ...user,
      roleTemplateId: dbUser?.roleTemplateId ?? user.roleTemplateId ?? null,
      scopeGlobal: dbUser?.scopeGlobal ?? user.scopeGlobal ?? false,
      scopeOrgWideHead: dbUser?.scopeOrgWideHead ?? user.scopeOrgWideHead ?? false,
      scopeTeamSupervisor: dbUser?.scopeTeamSupervisor ?? user.scopeTeamSupervisor ?? false,
      role: (dbUser?.role as string | undefined) ?? user.role,
    };

    const perms = await this.permissionsService.getEffectivePermissions(merged.id);
    merged.permissions = Array.from(perms);

    (req as Request & { user: SessionUser }).user = merged;

    // Guard: non-global users must always have a branch in their session.
    const branchId = merged.currentBranchId ?? null;
    if (!canViewAllBranches(merged) && !branchId) {
      res.status(401).json({
        error: { message: 'Session has no branch context. Please log in again.' },
      });
      return null;
    }

    // Store session token on request for tRPC procedures that mutate the session (e.g. switchBranch)
    (req as Request & { sessionToken: string }).sessionToken = token;

    // Refresh session TTL (sliding expiry)
    const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
    await this.sessionStore.touchSession(token, ttl);

    return {
      userId: merged.id,
      role: merged.role,
      branchId: branchId ?? '',
    };
  }
}
