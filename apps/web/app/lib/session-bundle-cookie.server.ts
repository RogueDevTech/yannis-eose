import { createHmac, timingSafeEqual } from 'crypto';
import { decodePermissionsFromBitmask } from '@yannis/shared';

/**
 * Verify-only counterpart of `apps/api/src/auth/session-bundle-cookie.ts`.
 * Lets Remix loaders decode the API-signed bundle locally and skip the
 * `POST /auth/me` round-trip when the bundle is fresh.
 *
 * MUST stay in sync with the API's signer:
 * - Same HMAC algorithm (SHA-256)
 * - Same payload shape (additive only — readers ignore unknown fields)
 * - Same `BUNDLE_VERSION` constant
 * - Same env var resolution order so the secrets match
 *
 * The two files are intentionally NOT a shared package — keeping them as
 * mirrors avoids dragging the API's NestJS deps into the Remix server bundle,
 * and the surface is small enough that drift is easy to spot in code review.
 *
 * The permission bitmask encoder/decoder IS shared, in `@yannis/shared`, so
 * both processes use the same bit-position index without drift.
 */

export const BUNDLE_COOKIE_NAME = 'yannis_bundle';

const BUNDLE_VERSION = 2;

/** Wire shape of the bundle payload — `p` is the bitmask (decoded by the caller). */
interface RawSessionBundlePayload {
  v: number;
  iat: number;
  exp: number;
  id: string;
  email: string;
  name: string;
  role: string;
  roleTemplateId: string | null;
  scopeGlobal: boolean;
  scopeOrgWideHead: boolean;
  scopeTeamSupervisor: boolean;
  logisticsLocationId: string | null;
  /** Bitmask-encoded permissions — see `@yannis/shared/permission-bitmask.ts`. */
  p: string;
  currentBranchId: string | null;
  selectedBranchIds?: string[] | null;
  activeGroupId?: string | null;
  branchIds: string[];
  /** Multi-country VIEW switcher — the country the user is currently viewing. */
  currentCurrencyCode?: string | null;
  /**
   * Multi-country HARD scope — currency codes assigned in `user_countries`.
   * Distinct from `currentCurrencyCode` (view switcher). Gates offer-price
   * editing per currency; empty for a non-view_all user = base (NGN) only.
   */
  currencyCodes?: string[];
  appTheme: string | null;
  fontScale: string | null;
  mirroredBy: { id: string; name: string; role: string } | null;
  mirrorSessionId: string | null;
  staffOnboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
  isFinanceOfficer?: boolean;
  isMarketingTeamSupervisorOnActiveBranch?: boolean;
  /** CS branch-team supervisor on active branch — see SessionUser. */
  isCsTeamSupervisorOnActiveBranch?: boolean;
  /** "Is supervisor anywhere" — see API session-bundle-cookie.ts. */
  isTeamSupervisor?: boolean;
}

/** Decoded shape that callers consume — `permissions` expanded back to `string[]`. */
export interface SessionBundlePayload extends Omit<RawSessionBundlePayload, 'p'> {
  permissions: string[];
}

function resolveBundleSecret(): string {
  const fromEnv =
    process.env['SESSION_BUNDLE_SECRET']?.trim() || process.env['SESSION_SECRET']?.trim();
  if (fromEnv) return fromEnv;

  // Mirrors the API's dev fallback so unconfigured local environments still
  // verify cookies (the API and Remix both pick the same default value).
  return 'yannis-dev-bundle-secret-do-not-use-in-prod';
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

function extractBundleCookieValue(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${BUNDLE_COOKIE_NAME}=`)) {
      return trimmed.slice(BUNDLE_COOKIE_NAME.length + 1);
    }
  }
  return null;
}

function verifyAndDecode(
  cookieValue: string,
  secret: string,
  ignoreExpiry: boolean,
): SessionBundlePayload | null {
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;

  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  const payloadBuf = fromBase64url(payloadB64);
  const sigBuf = fromBase64url(sigB64);
  if (!payloadBuf || !sigBuf) return null;

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
  const raw = parsed as RawSessionBundlePayload;

  if (raw.v !== BUNDLE_VERSION) return null;
  // `exp` must always be a number (guards malformed payloads). Skip the actual
  // freshness comparison only when the caller explicitly asks for a stale read
  // (see `decodeSessionBundleCookie({ ignoreExpiry })`) — the HMAC above already
  // proved the API issued this identity, so an expired-but-signed bundle is a
  // trustworthy "last known good" fallback when `/auth/me` is momentarily down.
  if (typeof raw.exp !== 'number') return null;
  if (!ignoreExpiry && Date.now() > raw.exp) return null;
  if (typeof raw.p !== 'string') return null; // Required since v2 — old shape (`permissions: string[]`) was retired in BUNDLE_VERSION bump.

  // Expand the bitmask back to the canonical permission codes.
  const { p, ...rest } = raw;
  return {
    ...rest,
    permissions: decodePermissionsFromBitmask(p),
  };
}

export interface DecodeBundleOptions {
  /**
   * Skip the `exp` freshness check while still requiring a valid HMAC + version.
   * Use ONLY as a last-known-good fallback when `/auth/me` is momentarily
   * unreachable (see `getCurrentUser` transient-failure path) — never for the
   * normal fast-path, which must respect the short TTL so permission/branch
   * changes propagate promptly.
   *
   * Default `false` — the standard "is this bundle still fresh?" behaviour.
   */
  ignoreExpiry?: boolean;
}

/**
 * Decode the bundle cookie from a Remix `Request`. Returns null if missing,
 * malformed, signed with a different secret, version-stale, or past `exp`.
 *
 * `null` is the universal "fall back to /auth/me" signal — every failure mode
 * is benign because the API endpoint will re-issue a fresh bundle on its
 * next response.
 *
 * Pass `{ ignoreExpiry: true }` to accept an expired-but-signed bundle. The
 * signature check still runs, so the identity is guaranteed to be one the API
 * genuinely issued — it's just past its freshness window. This is the
 * "last known good" identity we serve when a live session check blips.
 */
export function decodeSessionBundleCookie(
  request: Request,
  options?: DecodeBundleOptions,
): SessionBundlePayload | null {
  const cookieHeader = request.headers.get('Cookie');
  const value = extractBundleCookieValue(cookieHeader);
  if (!value) return null;
  return verifyAndDecode(value, resolveBundleSecret(), options?.ignoreExpiry ?? false);
}
