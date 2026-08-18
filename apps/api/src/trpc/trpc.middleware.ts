import { Injectable, Inject, Logger, type NestMiddleware } from '@nestjs/common';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { Request, Response, NextFunction } from 'express';
import { appRouter } from './routers';
import { createContext } from './context';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { canViewAllBranches } from '../common/authz';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { SessionStoreService } from '../auth/session-store.service';
import { UserBundleCacheService } from '../auth/user-bundle-cache.service';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { DRIZZLE } from '../database/database.module';
import {
  SlackService,
  SlackErrorBufferService,
  YANNIS_EOSE_CHANNEL,
  apiErrorTemplate,
} from '../common/slack';

@Injectable()
export class TrpcMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TrpcMiddleware.name);

  /**
   * Branch id → name cache for the Slack error alert. The error path is
   * fire-and-forget, so we never want it to add a live query per error; each
   * branch is looked up at most once for the process lifetime.
   */
  private readonly branchNameCache = new Map<string, string | null>();

  constructor(
    @Inject(SessionStoreService) private readonly sessionStore: SessionStoreService,
    private readonly userBundleCache: UserBundleCacheService,
    private readonly branchTeams: BranchTeamsService,
    private readonly slack: SlackService,
    private readonly slackErrorBuffer: SlackErrorBufferService,
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
          // Fire-and-forget: alerting must never affect the request/response path.
          void this.reportErrorToSlack(path, error, req).catch(() => {});
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
   * Records an internal API error into the daily digest buffer and fires a
   * fire-and-forget Slack alert. Never awaited and never throws into the tRPC
   * response path — alerting must not affect request handling.
   */
  private async reportErrorToSlack(
    path: string | undefined,
    error: { message: string; code: string; stack?: string },
    req: Request,
  ): Promise<void> {
    const procedure = path ?? 'unknown';
    this.slackErrorBuffer.record(procedure, error.message);

    const user = (req as Request & { user?: SessionUser }).user;
    const branchId = user?.currentBranchId ?? undefined;
    const alert = apiErrorTemplate({
      path: procedure,
      code: error.code,
      message: error.message,
      page: this.pageFromReferer(req),
      userId: user?.id,
      // Human name straight off the session — no lookup needed.
      userName: user?.name,
      userRole: user?.role,
      branchId,
      branchName: (await this.resolveBranchName(branchId)) ?? undefined,
      stack: error.stack,
    });
    this.slack
      .sendMessage(YANNIS_EOSE_CHANNEL, alert.message, alert.blocks, alert.attachments)
      .catch(() => {});
  }

  /**
   * Resolves a branch id to its human name for the Slack alert, memoised so a
   * given branch is queried at most once. Returns null on miss/error — the
   * alert then shows the id alone rather than failing the fire-and-forget path.
   */
  private async resolveBranchName(branchId: string | undefined): Promise<string | null> {
    if (!branchId) return null;
    const cached = this.branchNameCache.get(branchId);
    if (cached !== undefined) return cached;
    let name: string | null = null;
    try {
      const [row] = await this.db
        .select({ name: schema.branches.name })
        .from(schema.branches)
        .where(eq(schema.branches.id, branchId))
        .limit(1);
      name = row?.name ?? null;
    } catch {
      name = null;
    }
    this.branchNameCache.set(branchId, name);
    return name;
  }

  /**
   * Derives the originating app page from the request's Referer header (the URL
   * of the page that fired the tRPC call), reduced to path + query so the alert
   * reads like `/admin/marketing/cross-funnel`. Returns undefined when no usable
   * referer is present (e.g. server-side/edge calls without a browser origin).
   */
  private pageFromReferer(req: Request): string | undefined {
    const referer = req.headers.referer ?? req.headers.referrer;
    const value = Array.isArray(referer) ? referer[0] : referer;
    if (!value) return undefined;
    try {
      const parsed = new URL(value);
      return `${parsed.pathname}${parsed.search}` || undefined;
    } catch {
      return undefined;
    }
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

    // Read DB-derived user facts (role/template/scope flags + permissions) from
    // the per-user Redis bundle cache (60s TTL with explicit invalidation on writes).
    // This skips 4 Postgres queries per tRPC call. Session-scoped fields stay on
    // the session blob and are merged on top below.
    const bundle = await this.userBundleCache.getOrLoad(user.id);

    let merged: SessionUser = {
      ...user,
      role: bundle.role || user.role,
      roleTemplateId: bundle.roleTemplateId,
      scopeGlobal: bundle.scopeGlobal,
      scopeOrgWideHead: bundle.scopeOrgWideHead,
      scopeTeamSupervisor: bundle.scopeTeamSupervisor,
      permissions: bundle.permissions,
      appTheme: bundle.appTheme ?? user.appTheme,
      fontScale: bundle.fontScale ?? user.fontScale,
      isTeamSupervisor: bundle.isTeamSupervisor,
      ...(bundle.staffOnboardingStatus !== undefined
        ? { staffOnboardingStatus: bundle.staffOnboardingStatus }
        : {}),
    };

    merged = await this.branchTeams.attachTeamSupervisorSessionFlags(merged);

    (req as Request & { user: SessionUser }).user = merged;

    // Guard: branch-scoped users must always have a branch in their session.
    // EXCEPT a Media Buyer — `currentBranchId = null` is a valid, intended
    // state for them ("All Branches" = every order they own across every
    // branch, ownership-scoped). `switchBranch` explicitly lets an MB clear
    // their branch; without this exemption every request would 401 while the
    // MB is on "All Branches", zeroing dashboards and emptying lists.
    // Also EXCEPT users with an active multi-branch selection (selectedBranchIds)
    // — they have a valid branch context via effectiveBranchIds even though
    // currentBranchId is null (CEO directive 2026-06-10 multi-branch support).
    const branchId = merged.currentBranchId ?? null;
    const hasMultiBranchSelection = (merged.selectedBranchIds?.length ?? 0) > 0;
    const mayOperateWithoutBranch =
      canViewAllBranches(merged) || merged.role === 'MEDIA_BUYER' || hasMultiBranchSelection;
    if (!mayOperateWithoutBranch && !branchId) {
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
