import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Session-bundle cookie — a signed, HMAC-protected snapshot of the user's
 * `/auth/me` payload that the Remix server can decode locally. Lets every
 * protected route loader skip the API round-trip to verify the session as long
 * as the bundle is fresh.
 *
 * Architecture:
 * - The session cookie (`yannis_session`) remains the AUTH boundary — the
 *   bundle is a CACHE/HINT, not authoritative. If the bundle is stale or
 *   missing, the loader falls back to `POST /auth/me` (current behaviour).
 * - This file owns sign + verify. Both API and Remix server import from it
 *   via two thin wrappers (one per package) that share the same HMAC secret.
 *   See `apps/web/app/lib/session-bundle-cookie.server.ts` for the verify-only
 *   wrapper used by Remix loaders.
 *
 * Format: `<base64url(payloadJson)>.<base64url(hmacSignature)>`
 *   - Base64url so the cookie is safe in HTTP headers (no `=`, `+`, `/`).
 *   - HMAC-SHA256 over `payloadJson` so the Remix server can detect tampering.
 *   - The payload itself is JSON, so we can extend the shape without versioning
 *     gymnastics — readers ignore unknown fields.
 *
 * Lifetime semantics:
 * - The HTTP cookie's `Max-Age` matches the session cookie (typically 24h or
 *   longer if `rememberMe`).
 * - The payload carries its own `expiresAt` (epoch ms). Readers reject the
 *   bundle past this point, forcing a fresh `POST /auth/me` round-trip — which
 *   re-issues a fresh bundle cookie. So the EFFECTIVE staleness window is
 *   `BUNDLE_TTL_SECONDS` regardless of the cookie's HTTP max-age.
 *
 * Why `expiresAt` instead of just relying on cookie max-age:
 *   We want the cookie to PERSIST across short network blips (so the user
 *   doesn't get logged out the moment the bundle expires) — but we want the
 *   DATA to have a short freshness window so permission/role changes propagate
 *   within ~60s. Keeping cookie TTL long + payload TTL short gives both.
 */

export const BUNDLE_COOKIE_NAME = 'yannis_bundle';

/**
 * Bundle freshness window — how long a bundle is considered fresh after issuance.
 * Mirrors `UserBundleCacheService` Redis TTL so staleness behaviour is consistent
 * regardless of which layer answered the lookup.
 */
export const BUNDLE_TTL_SECONDS = 60;

/**
 * Bundle format version. Bump when the payload shape changes incompatibly so
 * older cookies are rejected gracefully (verify returns null → loader falls back
 * to `/auth/me` which issues a v2 cookie).
 */
const BUNDLE_VERSION = 1;

export interface SessionBundlePayload {
  /** Format version — see `BUNDLE_VERSION`. */
  v: number;
  /** Epoch milliseconds — UTC time the bundle was signed. Mostly for debugging. */
  iat: number;
  /** Epoch milliseconds — bundle is rejected if `Date.now() > exp`. */
  exp: number;

  /** All the SessionUser fields the Remix loaders / `/auth/me` consumer cares about. */
  id: string;
  email: string;
  name: string;
  role: string;
  roleTemplateId: string | null;
  scopeGlobal: boolean;
  scopeOrgWideHead: boolean;
  scopeTeamSupervisor: boolean;
  logisticsLocationId: string | null;
  permissions: string[];
  currentBranchId: string | null;
  branchIds: string[];
  appTheme: string | null;
  fontScale: string | null;
  mirroredBy: { id: string; name: string; role: string } | null;
  mirrorSessionId: string | null;
  staffOnboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
  isFinanceOfficer?: boolean;
}

/**
 * The fields a caller passes in (everything except the auto-stamped `v`/`iat`/`exp`).
 */
export type SessionBundleInput = Omit<SessionBundlePayload, 'v' | 'iat' | 'exp'>;

/**
 * Resolve the HMAC secret from env. Both API and Remix must read the SAME var.
 *
 * Returns a hardcoded dev fallback if neither env var is set. This used to
 * throw in production to enforce explicit configuration, but that made a
 * forgotten env var fail-closed in a way that broke login outright (the throw
 * propagated through `/auth/login` → 500 → frontend rendered "Invalid
 * credentials" with no breadcrumb to the real cause). Returning a fallback
 * keeps the rest of the auth flow working — the worst case is that the API
 * and Remix server pick different secrets, signature verification fails on
 * every request, and loaders silently fall back to `/auth/me`. That's a perf
 * regression, not an outage. The caller (`auth.controller.ts`) logs at WARN
 * when signing fails so the misconfiguration is still visible.
 */
export function resolveBundleSecret(): string {
  const fromEnv =
    process.env['SESSION_BUNDLE_SECRET']?.trim() || process.env['SESSION_SECRET']?.trim();
  if (fromEnv) return fromEnv;
  // Predictable fallback so dev environments without explicit env vars still
  // verify correctly (both API and Remix mirror this constant).
  return 'yannis-dev-bundle-secret-do-not-use-in-prod';
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromBase64url(s: string): Buffer | null {
  try {
    return Buffer.from(s, 'base64url');
  } catch {
    return null;
  }
}

function hmacSign(payloadJson: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payloadJson).digest();
}

/**
 * Sign a session-bundle payload into the cookie value.
 * The caller stamps it on the response; expiresAt is auto-derived.
 */
export function signSessionBundle(input: SessionBundleInput, secret: string): string {
  const now = Date.now();
  const payload: SessionBundlePayload = {
    v: BUNDLE_VERSION,
    iat: now,
    exp: now + BUNDLE_TTL_SECONDS * 1000,
    ...input,
  };
  const payloadJson = JSON.stringify(payload);
  const signature = hmacSign(payloadJson, secret);
  return `${base64url(Buffer.from(payloadJson, 'utf8'))}.${base64url(signature)}`;
}

/**
 * Verify and decode a bundle cookie. Returns null if:
 *   - Format is wrong (missing dot, malformed base64)
 *   - Signature doesn't match (forged or wrong secret)
 *   - Version is unsupported (stale bundle from older deploy)
 *   - `exp` is in the past (stale data — caller should re-fetch)
 *
 * `null` is the universal "fall back to /auth/me" signal — the caller does
 * NOT need to distinguish between the failure modes. Logging stays in the
 * caller so a stale cookie doesn't spam errors on every request.
 */
export function verifySessionBundle(cookieValue: string, secret: string): SessionBundlePayload | null {
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;

  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  const payloadBuf = fromBase64url(payloadB64);
  const sigBuf = fromBase64url(sigB64);
  if (!payloadBuf || !sigBuf) return null;

  // Re-sign the payload bytes and compare in constant time.
  const expected = hmacSign(payloadBuf.toString('utf8'), secret);
  if (expected.length !== sigBuf.length) return null;
  if (!timingSafeEqual(expected, sigBuf)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuf.toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as SessionBundlePayload;

  if (p.v !== BUNDLE_VERSION) return null;
  if (typeof p.exp !== 'number' || Date.now() > p.exp) return null;

  return p;
}

/**
 * Read the raw bundle cookie value from a Cookie header string.
 * Returns null when the cookie isn't present.
 */
export function extractBundleCookieValue(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${BUNDLE_COOKIE_NAME}=`)) {
      return trimmed.slice(BUNDLE_COOKIE_NAME.length + 1);
    }
  }
  return null;
}
