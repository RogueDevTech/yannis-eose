import { createHmac, timingSafeEqual } from 'crypto';

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
 */

export const BUNDLE_COOKIE_NAME = 'yannis_bundle';

const BUNDLE_VERSION = 1;

export interface SessionBundlePayload {
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

function verifyAndDecode(cookieValue: string, secret: string): SessionBundlePayload | null {
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
  const p = parsed as SessionBundlePayload;

  if (p.v !== BUNDLE_VERSION) return null;
  if (typeof p.exp !== 'number' || Date.now() > p.exp) return null;

  return p;
}

/**
 * Decode the bundle cookie from a Remix `Request`. Returns null if missing,
 * malformed, signed with a different secret, version-stale, or past `exp`.
 *
 * `null` is the universal "fall back to /auth/me" signal — every failure mode
 * is benign because the API endpoint will re-issue a fresh bundle on its
 * next response.
 */
export function decodeSessionBundleCookie(request: Request): SessionBundlePayload | null {
  const cookieHeader = request.headers.get('Cookie');
  const value = extractBundleCookieValue(cookieHeader);
  if (!value) return null;
  return verifyAndDecode(value, resolveBundleSecret());
}
