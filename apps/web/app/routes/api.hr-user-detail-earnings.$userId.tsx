import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import { extractTrpc } from '~/lib/trpc-extract.server';
import type { StaffPayoutEstimate, UserPaidPayoutSnapshot } from '~/features/users/types';

function utcCalendarMonth(year: number, monthIndex0: number) {
  const start = new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex0 + 1, 0, 23, 59, 59, 999));
  const periodLabel = new Intl.DateTimeFormat('en-NG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(start);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    periodLabel,
  };
}

function nextUtcMonth(year: number, monthIndex0: number) {
  if (monthIndex0 === 11) return utcCalendarMonth(year + 1, 0);
  return utcCalendarMonth(year, monthIndex0 + 1);
}

/** POST-mount slice for the Earnings tab — never blocks shell load. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { cookie } = gate;
  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const current = utcCalendarMonth(y, m);
  const upcoming = nextUtcMonth(y, m);

  const previewInput = (period: { periodStart: string; periodEnd: string }) =>
    encodeURIComponent(JSON.stringify({ staffId: userId, periodStart: period.periodStart, periodEnd: period.periodEnd }));

  const [currentRes, nextRes, paidRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/hr.previewPayout?input=${previewInput(current)}`, opt),
    apiRequest<unknown>(`/trpc/hr.previewPayout?input=${previewInput(upcoming)}`, opt),
    apiRequest<unknown>(
      `/trpc/hr.listPayouts?input=${encodeURIComponent(
        JSON.stringify({ staffId: userId, status: 'PAID' as const, limit: 1, page: 1 }),
      )}`,
      opt,
    ),
  ]);

  const currentPreview = extractTrpc(currentRes, null) as StaffPayoutEstimate | null;
  const nextPreview = extractTrpc(nextRes, null) as StaffPayoutEstimate | null;
  const paidPayload = extractTrpc(paidRes, null) as { payouts?: unknown[] } | null;
  const firstPaid = paidPayload?.payouts?.[0] as Record<string, unknown> | undefined;
  let lastPaidPayout: UserPaidPayoutSnapshot | null = null;
  if (
    firstPaid &&
    typeof firstPaid['periodStart'] === 'string' &&
    typeof firstPaid['periodEnd'] === 'string' &&
    typeof firstPaid['totalPayout'] !== 'undefined'
  ) {
    lastPaidPayout = {
      periodStart: String(firstPaid['periodStart']),
      periodEnd: String(firstPaid['periodEnd']),
      totalPayout: String(firstPaid['totalPayout']),
      createdAt:
        typeof firstPaid['createdAt'] === 'string' ? String(firstPaid['createdAt']) : undefined,
    };
  }

  return secondaryCacheJson({
    ok: true as const,
    currentMonth: { ...current, preview: currentPreview },
    nextMonth: { ...upcoming, preview: nextPreview },
    lastPaidPayout,
    generatedAt: new Date().toISOString(),
  });
}
