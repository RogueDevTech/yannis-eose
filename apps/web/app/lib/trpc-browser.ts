import type { AppThemeId } from '~/lib/theme';
import type { FontScaleId } from '~/lib/font-scale';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';

type TrpcEnvelope<T> = { result?: { data?: T } };

export type ClientConfigPayload = {
  defaultAppTheme: string;
  appThemePreference: string | null;
  effectiveAppTheme: string;
  fontScalePreference: string | null;
  effectiveFontScale: string;
};

/**
 * Module-level dedupe + 30s in-memory cache for `settings.getClientConfig`.
 *
 * `useServerAppThemeSync` and `useServerFontScaleSync` are mounted side by
 * side in `root.tsx` and BOTH call `fetchClientConfig()` once on login —
 * with no coordination, the same network request was firing twice (~2.4s
 * each). The in-flight singleton makes concurrent callers share one response;
 * the small TTL covers React StrictMode double-mount + back/forward
 * navigations within the same session without tying us to a longer cache that
 * would mask theme/font preference updates from another tab.
 *
 * Reset hook: callers that mutate the underlying preference (e.g. theme or
 * font scale) can call `invalidateClientConfigCache()` to drop the next
 * fetch, but in practice the per-page redirect/refresh covers it.
 */
const CLIENT_CONFIG_CACHE_TTL_MS = 30_000;
let cachedClientConfig: ClientConfigPayload | null = null;
let cachedClientConfigAt = 0;
let inFlightClientConfig: Promise<ClientConfigPayload | null> | null = null;

async function loadClientConfig(): Promise<ClientConfigPayload | null> {
  const base = getBrowserApiBaseUrl();
  if (!base) return null;
  const url = `${base}/trpc/settings.getClientConfig?input=${encodeURIComponent(JSON.stringify({}))}`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as TrpcEnvelope<ClientConfigPayload>;
    return json?.result?.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchClientConfig(): Promise<ClientConfigPayload | null> {
  if (cachedClientConfig && Date.now() - cachedClientConfigAt < CLIENT_CONFIG_CACHE_TTL_MS) {
    return cachedClientConfig;
  }
  if (inFlightClientConfig) return inFlightClientConfig;

  inFlightClientConfig = loadClientConfig().finally(() => {
    inFlightClientConfig = null;
  });
  const result = await inFlightClientConfig;
  if (result) {
    cachedClientConfig = result;
    cachedClientConfigAt = Date.now();
  }
  return result;
}

/** Drop the in-memory client-config cache so the next caller hits the network. */
export function invalidateClientConfigCache(): void {
  cachedClientConfig = null;
  cachedClientConfigAt = 0;
}

/** Persists theme for the logged-in user; no-op on failure (e.g. logged out). */
export async function postUpdateMyAppTheme(appTheme: AppThemeId): Promise<void> {
  const base = getBrowserApiBaseUrl();
  if (!base) return;
  try {
    await fetch(`${base}/trpc/users.updateMyAppTheme`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appTheme }),
    });
    // Drop the cached client config so a same-session re-read pulls the new
    // preference (matches the server-side `userBundleCache` invalidation).
    invalidateClientConfigCache();
  } catch {
    /* no-op */
  }
}

/** Persists font scale for the logged-in user; no-op on failure (e.g. logged out). */
export async function postUpdateMyFontScale(fontScale: FontScaleId): Promise<void> {
  const base = getBrowserApiBaseUrl();
  if (!base) return;
  try {
    await fetch(`${base}/trpc/users.updateMyFontScale`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontScale }),
    });
    invalidateClientConfigCache();
  } catch {
    /* no-op */
  }
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
  const base = getBrowserApiBaseUrl();
  if (!base) throw new Error('Share to logistics company failed');
  let res: Response;
  try {
    res = await fetch(`${base}/trpc/messaging.shareToLogistics`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Share to logistics company failed');
  }
  const rawText = await res.text();
  let json: (TrpcEnvelope<ShareToLogisticsResult> & { error?: { message?: string } }) | null = null;
  try {
    json = JSON.parse(rawText) as TrpcEnvelope<ShareToLogisticsResult> & { error?: { message?: string } };
  } catch {
    const trimmed = rawText.trimStart();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      throw new Error(
        'Share failed: the app received a web page instead of the API (HTML, not JSON). ' +
          'Usually the browser is posting to the web origin but /trpc is not proxied to Nest — ' +
          'set PUBLIC_API_URL / API_URL to the API host in deploy, or ensure your reverse proxy forwards /trpc. ' +
          `Request was ${base}/trpc/messaging.shareToLogistics`,
      );
    }
    throw new Error('Share to logistics company failed: response was not valid JSON');
  }
  if (!res.ok) {
    throw new Error(json.error?.message ?? 'Share to logistics company failed');
  }
  const data = json.result?.data;
  if (!data) throw new Error('No data returned from share');
  return data;
}

export type AdSpendIntervalPreviewInput = {
  campaignId: string;
  productId: string;
  spendDate: string;
  spendAmount?: number;
};

export type AdSpendIntervalPreviewResult = {
  orderCount: number;
  priorSpendDate: string | null;
  windowStartExclusive: string | null;
  indicativeCpa: number | null;
};

/** GET `marketing.previewAdSpendInterval` — used by Log Ad Spend form (session cookie). */
export async function fetchAdSpendIntervalPreview(
  input: AdSpendIntervalPreviewInput
): Promise<AdSpendIntervalPreviewResult | null> {
  const base = getBrowserApiBaseUrl();
  if (!base) return null;
  const payload: Record<string, unknown> = {
    campaignId: input.campaignId,
    productId: input.productId,
    spendDate: input.spendDate,
  };
  if (input.spendAmount !== undefined && input.spendAmount > 0) {
    payload.spendAmount = input.spendAmount;
  }
  const url = `${base}/trpc/marketing.previewAdSpendInterval?input=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as TrpcEnvelope<AdSpendIntervalPreviewResult>;
    return json?.result?.data ?? null;
  } catch {
    return null;
  }
}

export type CampaignOrderTotalForBatchInput = {
  campaignId: string;
  spendDate: string;
};
export type CampaignOrderTotalForBatchResult = {
  orderCount: number;
  priorSpendDate: string | null;
  windowStartExclusive: string | null;
};

/**
 * GET `marketing.campaignOrderTotalForBatch` — used by the Add Expense modal
 * (CEO directive 2026-05-08). Returns the form's order count the MB must
 * split across the lines they're logging.
 */
export async function fetchCampaignOrderTotalForBatch(
  input: CampaignOrderTotalForBatchInput,
): Promise<CampaignOrderTotalForBatchResult | null> {
  const base = getBrowserApiBaseUrl();
  if (!base) return null;
  const url = `${base}/trpc/marketing.campaignOrderTotalForBatch?input=${encodeURIComponent(
    JSON.stringify({ campaignId: input.campaignId, spendDate: input.spendDate }),
  )}`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as TrpcEnvelope<CampaignOrderTotalForBatchResult>;
    return json?.result?.data ?? null;
  } catch {
    return null;
  }
}

export type OrderClipboardSummaryPayload = { text: string };

/**
 * GET `orders.clipboardSummary` — full plain-text handoff including stored customer phone
 * when the order row has it (same visibility as order detail).
 */
export async function fetchOrderClipboardSummary(orderId: string): Promise<OrderClipboardSummaryPayload> {
  const base = getBrowserApiBaseUrl();
  if (!base) throw new Error('Copy order summary failed: API URL not configured');
  const url = `${base}/trpc/orders.clipboardSummary?input=${encodeURIComponent(JSON.stringify({ orderId }))}`;
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    throw new Error('Copy order summary failed: network error');
  }
  const rawText = await res.text();
  let json: (TrpcEnvelope<OrderClipboardSummaryPayload> & { error?: { message?: string } }) | null = null;
  try {
    json = JSON.parse(rawText) as TrpcEnvelope<OrderClipboardSummaryPayload> & { error?: { message?: string } };
  } catch {
    throw new Error('Copy order summary failed: invalid response');
  }
  if (!res.ok) {
    throw new Error(json.error?.message ?? 'Copy order summary failed');
  }
  const data = json.result?.data;
  if (!data?.text) throw new Error('Copy order summary failed: empty payload');
  return data;
}
