/**
 * Compact permission encoding for the session-bundle cookie.
 *
 * Why: storing permission CODE STRINGS in the bundle JWT pushes the cookie
 * past the browser's ~4 KB per-cookie soft limit (118 canonical codes serialize
 * to ~6 KB after JSON+base64). Browsers silently drop oversize Set-Cookie
 * headers, so the bundle never persists for admin-class users (or any user
 * granted enough permissions). Encoding the same set as a BITMASK against a
 * stable index brings the field down to 16 bytes binary (~22 chars base64url)
 * regardless of how many permissions are set — a 200× reduction.
 *
 * Stability:
 *   - `PERMISSION_INDEX` is alphabetically sorted so its order is deterministic
 *     across deploys regardless of how `permission-catalog.ts` is reorganised.
 *   - Adding a new permission code SHIFTS later bits — that's why the bundle
 *     embeds a `BUNDLE_VERSION`. When the catalog grows, bump the version so
 *     stale cookies decode to `null` and fall back to `/auth/me`, which then
 *     issues a fresh bundle against the new index.
 *   - Removing a permission code is similarly disruptive — same mitigation.
 *
 * Both API and Remix server import from `@yannis/shared`, so they share one
 * source of truth for the index. Adding a custom encoder per side would
 * inevitably drift; sharing avoids that class of bugs.
 */
import { ALL_PERMISSION_CODES } from './permission-catalog';

/**
 * Stable, alphabetically-sorted index of every canonical permission code.
 * Bit `i` in an encoded bitmask corresponds to `PERMISSION_INDEX[i]`.
 */
export const PERMISSION_INDEX: readonly string[] = [...ALL_PERMISSION_CODES].sort();

const CODE_TO_INDEX = new Map<string, number>(
  PERMISSION_INDEX.map((code, idx) => [code, idx]),
);

const TOTAL_BITS = PERMISSION_INDEX.length;
const TOTAL_BYTES = Math.ceil(TOTAL_BITS / 8);

/**
 * Cross-environment base64url helpers — `@yannis/shared` is consumed by BOTH
 * the API (Node) and the Remix web app (Node SSR + browser bundle). Importing
 * `Buffer` would pull a Node-only polyfill into the Vite build and break the
 * production frontend bundle. `btoa`/`atob` are globals in modern Node (≥16)
 * and every supported browser, so they work in all our targets.
 */
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(s: string): Uint8Array {
  // Restore standard base64 padding + alphabet before atob.
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Encode a permission set as a base64url bitmask.
 * Unknown codes (not in `PERMISSION_INDEX`) are silently skipped — they were
 * either retired or are aliases that don't appear in the canonical index.
 */
export function encodePermissionsToBitmask(permissions: readonly string[]): string {
  const bits = new Uint8Array(TOTAL_BYTES);
  for (const code of permissions) {
    const idx = CODE_TO_INDEX.get(code);
    if (idx === undefined) continue;
    const byteOffset = Math.floor(idx / 8);
    bits[byteOffset] = (bits[byteOffset] ?? 0) | (1 << (idx % 8));
  }
  return bytesToBase64url(bits);
}

/**
 * Decode a base64url bitmask back to the array of permission code strings.
 * Returns an empty array on malformed input — the caller treats that the same
 * as "no permissions" and (for non-admin users) the request fails the gate
 * downstream.
 */
export function decodePermissionsFromBitmask(encoded: string): string[] {
  let bits: Uint8Array;
  try {
    bits = base64urlToBytes(encoded);
  } catch {
    return [];
  }
  const result: string[] = [];
  for (let idx = 0; idx < TOTAL_BITS; idx++) {
    const byte = bits[Math.floor(idx / 8)];
    if (byte === undefined) break; // Truncated input — stop scanning.
    if (byte & (1 << (idx % 8))) {
      const code = PERMISSION_INDEX[idx];
      if (code !== undefined) result.push(code);
    }
  }
  return result;
}
