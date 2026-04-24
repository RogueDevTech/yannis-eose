import type { AppThemeId } from '~/lib/theme';
import type { FontScaleId } from '~/lib/font-scale';

type TrpcEnvelope<T> = { result?: { data?: T } };

function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const raw = window.__ENV?.API_URL ?? '';
  if (raw) {
    if (window.location.protocol === 'https:' && raw.startsWith('http://')) {
      return raw.replace(/^http:\/\//, 'https://');
    }
    return raw;
  }
  return window.location.origin;
}

export type ClientConfigPayload = {
  defaultAppTheme: string;
  appThemePreference: string | null;
  effectiveAppTheme: string;
  fontScalePreference: string | null;
  effectiveFontScale: string;
};

export async function fetchClientConfig(): Promise<ClientConfigPayload | null> {
  const base = getApiBaseUrl();
  if (!base) return null;
  const url = `${base}/trpc/settings.getClientConfig?input=${encodeURIComponent(JSON.stringify({}))}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  const json = (await res.json()) as TrpcEnvelope<ClientConfigPayload>;
  return json?.result?.data ?? null;
}

/** Persists theme for the logged-in user; no-op on failure (e.g. logged out). */
export async function postUpdateMyAppTheme(appTheme: AppThemeId): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) return;
  await fetch(`${base}/trpc/users.updateMyAppTheme`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appTheme }),
  });
}

/** Persists font scale for the logged-in user; no-op on failure (e.g. logged out). */
export async function postUpdateMyFontScale(fontScale: FontScaleId): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) return;
  await fetch(`${base}/trpc/users.updateMyFontScale`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fontScale }),
  });
}

export type ShareToLogisticsResult = {
  success: boolean;
  renderedBody: string;
  groupLink: string;
  locationName: string;
};

/**
 * Calls messaging.shareToLogistics server-side (which logs the outbound message + timeline
 * event) and returns the rendered body + group link so the client can copy to clipboard and
 * open WhatsApp. WhatsApp group invites cannot be pre-filled, so the copy + open pattern is
 * the best one-click UX available.
 */
export async function shareOrderToLogistics(input: {
  orderId: string;
  locationId: string;
  templateId: string;
}): Promise<ShareToLogisticsResult> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base || ''}/trpc/messaging.shareToLogistics`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as TrpcEnvelope<ShareToLogisticsResult> & {
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? 'Share to 3PL failed');
  }
  const data = json.result?.data;
  if (!data) throw new Error('No data returned from share');
  return data;
}
