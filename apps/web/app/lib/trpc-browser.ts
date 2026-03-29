import type { AppThemeId } from '~/lib/theme';

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
