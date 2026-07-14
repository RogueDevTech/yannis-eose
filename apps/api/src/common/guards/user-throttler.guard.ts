import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Per-user rate limiter — falls back to per-IP when there's no session.
 *
 * Why we don't use the default `ThrottlerGuard` directly:
 *   It keys every bucket by client IP. That's fine for typical REST APIs but
 *   wrong for our SSR architecture: every authenticated request reaches the
 *   API from a SINGLE IP (the Remix server), so the global `100 req/60s`
 *   budget is shared across EVERY user going through Remix. A handful of
 *   users browsing simultaneously can exhaust the bucket because each page
 *   load fires 5–7 parallel tRPC calls (orders.list, orders.statusCounts,
 *   logistics.options, marketing.metrics, …) plus prefetches on hover.
 *
 * This guard:
 *   - Authenticated request (`yannis_session` cookie present) → tracker is
 *     the session token. Each user gets their own bucket regardless of how
 *     many users share the Remix server's IP.
 *   - Unauthenticated request (login, forgot-password, public endpoints)
 *     → tracker falls back to IP. Keeps the credential-stuffing protection
 *     that was the original design intent.
 *
 * Bucket-size note: the per-bucket limit (`limit` in `ThrottlerModule.forRoot`)
 * is now per-user, not per-IP. 100/60s was tight when shared; 400/60s per user
 * gives headroom for ERP power users (CEO dashboard alone fires 15+ parallel
 * queries) while still capping abuse / runaway loops.
 *
 * Tracker key prefix (`user:` vs `ip:`) keeps the two namespaces from colliding
 * if Redis ever gets used as the throttler store and we want to inspect or
 * clear them separately.
 */
const SESSION_COOKIE_NAME = 'yannis_session';

@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const cookieRaw = headers['cookie'] ?? headers['Cookie'];
    if (typeof cookieRaw === 'string' && cookieRaw.length > 0) {
      // Tiny inline parser — avoids dragging in `cookie-parser` middleware
      // just for one header lookup. Format: `name=value; name=value; ...`.
      for (const part of cookieRaw.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
          const value = trimmed.slice(SESSION_COOKIE_NAME.length + 1);
          if (value) return `user:${value}`;
        }
      }
    }

    // Fallback to IP. Express populates `req.ip` from the socket address (or
    // `X-Forwarded-For` when `trust proxy` is enabled in main.ts).
    const ip = (req as { ip?: unknown }).ip;
    return `ip:${typeof ip === 'string' && ip ? ip : 'unknown'}`;
  }
}
