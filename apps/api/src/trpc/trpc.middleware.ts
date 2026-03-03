import { Injectable, Inject, type NestMiddleware } from '@nestjs/common';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { Request, Response, NextFunction } from 'express';
import type Redis from 'ioredis';
import type postgres from 'postgres';
import { appRouter } from './routers';
import { createContext } from './context';
import { REDIS, PG_CLIENT } from '../database/database.module';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class TrpcMiddleware implements NestMiddleware {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PG_CLIENT) private readonly sql: ReturnType<typeof postgres>,
    private readonly permissionsService: PermissionsService,
  ) {}

  async use(req: Request, res: Response, _next: NextFunction) {
    // Resolve session from cookie (same logic as AuthGuard)
    await this.resolveSession(req);

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
   * Resolves the session from the cookie and attaches user to request.
   * Also sets Postgres session variables for RLS and audit trail.
   */
  private async resolveSession(req: Request): Promise<void> {
    const cookies = req.headers.cookie;
    if (!cookies) return;

    const match = cookies.split(';').find((c) => c.trim().startsWith('yannis_session='));
    if (!match) return;

    const token = match.split('=')[1]?.trim();
    if (!token) return;

    const sessionData = await this.redis.get(`session:${token}`);
    if (!sessionData) return;

    const user: SessionUser = JSON.parse(sessionData);
    if (user.role !== 'SUPER_ADMIN') {
      const perms = await this.permissionsService.getEffectivePermissions(user.id, user.role);
      user.permissions = Array.from(perms);
    } else {
      user.permissions = [];
    }
    (req as Request & { user: SessionUser }).user = user;

    // Set Postgres session variables for RLS policies and audit triggers
    await this.sql`
      SELECT
        set_config('yannis.current_user_id', ${user.id}, true),
        set_config('yannis.current_user_role', ${user.role}, true)
    `;

    // Refresh session TTL (sliding expiry)
    const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
    await this.redis.expire(`session:${token}`, ttl);
  }
}
