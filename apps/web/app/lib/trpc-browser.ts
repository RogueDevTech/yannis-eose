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

export type OrderCountForDateResult = {
  orderCount: number;
  existingRecord: { id: string; spendAmount: string; status: string; orderCountSnapshot: number | null } | null;
};

export async function fetchOrderCountForDate(
  spendDate: string,
  signal?: AbortSignal,
): Promise<OrderCountForDateResult | null> {
  const base = getBrowserApiBaseUrl();
  if (!base) return null;
  const url = `${base}/trpc/marketing.orderCountForDate?input=${encodeURIComponent(
    JSON.stringify({ spendDate }),
  )}`;
  try {
    const res = await fetch(url, { credentials: 'include', signal });
    if (!res.ok) return null;
    const json = (await res.json()) as TrpcEnvelope<OrderCountForDateResult>;
    return json?.result?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Hard cap for "Select all matching this filter" deep-selects. Matches the
 * server-side bulk-action max (`bulkTransition` / `bulkAssignToCS` cap at 2000),
 * so a single deep-select never exceeds what a follow-up bulk action can process.
 * If you ever raise this, raise the bulk-action caps in lock-step.
 */
export const ORDERS_DEEP_SELECT_MAX = 2000;

/**
 * GET `orders.list` with the same filter input the loader used, capped at
 * {@link ORDERS_DEEP_SELECT_MAX}. Returns just the order IDs so the page can
 * populate `selectedIds` for a "select all matching this filter" deep-select.
 *
 * Pass the listInput that the loader serialized for the current page — the
 * server applies the same authz/scope as the visible list, so we don't have to
 * recreate that on the client.
 */
export async function fetchOrdersMatchingIds(
  serializedListInput: string,
  /** tRPC endpoint to query — defaults to `orders.list`. Pass `orders.followUpOrdersList` for follow-up scoped lists. */
  endpoint = 'orders.list',
): Promise<{
  ids: string[];
  capped: boolean;
}> {
  const base = getBrowserApiBaseUrl();
  if (!base) return { ids: [], capped: false };
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(serializedListInput) as Record<string, unknown>;
  } catch {
    return { ids: [], capped: false };
  }
  const input = encodeURIComponent(
    JSON.stringify({ ...parsed, page: 1, limit: ORDERS_DEEP_SELECT_MAX }),
  );
  try {
    const res = await fetch(`${base}/trpc/${endpoint}?input=${input}`, {
      credentials: 'include',
    });
    if (!res.ok) return { ids: [], capped: false };
    const json = (await res.json()) as TrpcEnvelope<{
      orders: Array<{ id: string }>;
      pagination: { total: number };
    }>;
    const data = json?.result?.data;
    const ids = (data?.orders ?? []).map((o) => o.id);
    const total = data?.pagination?.total ?? ids.length;
    return { ids, capped: total > ids.length };
  } catch {
    return { ids: [], capped: false };
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

/**
 * Fetch raw customer phones for a duplicate comparison pair. Returns `null`
 * when the viewer lacks `orders.flaggedDuplicates` permission (403) — the
 * modal falls back to masked `customerPhoneDisplay`.
 */
/**
 * POST `marketing.approveAdSpend` — used by bulk-approve flow (session cookie).
 * Returns true on success, throws on failure.
 */
export async function postApproveAdSpend(adSpendId: string): Promise<boolean> {
  const base = getBrowserApiBaseUrl();
  if (!base) throw new Error('API base URL not configured');
  const res = await fetch(`${base}/trpc/marketing.approveAdSpend`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adSpendId }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(json?.error?.message ?? 'Failed to approve ad spend');
  }
  return true;
}

/**
 * POST `marketing.rejectAdSpend` — used by bulk-reject flow (session cookie).
 * Returns true on success, throws on failure.
 */
export async function postRejectAdSpend(adSpendId: string, reason?: string): Promise<boolean> {
  const base = getBrowserApiBaseUrl();
  if (!base) throw new Error('API base URL not configured');
  const res = await fetch(`${base}/trpc/marketing.rejectAdSpend`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adSpendId, reason }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(json?.error?.message ?? 'Failed to reject ad spend');
  }
  return true;
}

export async function fetchDuplicateComparisonPhones(
  orderId: string,
  originalOrderId: string,
): Promise<{ orderPhone: string; originalPhone: string } | null> {
  const base = getBrowserApiBaseUrl();
  if (!base) return null;
  const input = encodeURIComponent(JSON.stringify({ orderId, originalOrderId }));
  try {
    const res = await fetch(
      `${base}/trpc/orders.getDuplicateComparisonPhones?input=${input}`,
      { credentials: 'include' },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as TrpcEnvelope<{ orderPhone: string; originalPhone: string }>;
    return json.result?.data ?? null;
  } catch {
    return null;
  }
}
