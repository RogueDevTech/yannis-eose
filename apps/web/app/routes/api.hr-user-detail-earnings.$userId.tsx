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

/**
 * POST-mount slice for the Earnings tab — never blocks shell load.
 * Accepts optional `?year=YYYY&month=M` (1-indexed) to fetch a specific month.
 * Defaults to the current calendar month when omitted.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { cookie } = gate;
  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const url = new URL(request.url);
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth0 = now.getUTCMonth(); // 0-indexed

  const qYear = parseInt(url.searchParams.get('year') ?? '', 10);
  const qMonth = parseInt(url.searchParams.get('month') ?? '', 10); // 1-indexed from URL
  const targetYear = Number.isFinite(qYear) ? qYear : currentYear;
  const targetMonth0 = Number.isFinite(qMonth) ? qMonth - 1 : currentMonth0;

  const isCurrentMonth = targetYear === currentYear && targetMonth0 === currentMonth0;

  const period = utcCalendarMonth(targetYear, targetMonth0);

  const previewInput = encodeURIComponent(
    JSON.stringify({ staffId: userId, periodStart: period.periodStart, periodEnd: period.periodEnd }),
  );

  const [previewRes, paidRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/hr.previewPayout?input=${previewInput}`, opt),
    apiRequest<unknown>(
      `/trpc/hr.listPayouts?input=${encodeURIComponent(
        JSON.stringify({ staffId: userId, status: 'PAID' as const, limit: 1, page: 1 }),
      )}`,
      opt,
    ),
  ]);

  const preview = extractTrpc(previewRes, null) as StaffPayoutEstimate | null;
  const paidPayload = extractTrpc(paidRes, null) as { payouts?: unknown[] } | null;
  const firstPaid = paidPayload?.payouts?.[0] as Record<string, unknown> | undefined;
  let lastPaidPayout: UserPaidPayoutSnapshot | null = null;
  if (
    firstPaid &&
    typeof firstPaid['id'] === 'string' &&
    typeof firstPaid['periodStart'] === 'string' &&
    typeof firstPaid['periodEnd'] === 'string' &&
    typeof firstPaid['totalPayout'] !== 'undefined'
  ) {
    lastPaidPayout = {
      id: String(firstPaid['id']),
      periodStart: String(firstPaid['periodStart']),
      periodEnd: String(firstPaid['periodEnd']),
      totalPayout: String(firstPaid['totalPayout']),
      createdAt:
        typeof firstPaid['createdAt'] === 'string' ? String(firstPaid['createdAt']) : undefined,
    };
  }

  return secondaryCacheJson({
    ok: true as const,
    month: { ...period, preview, year: targetYear, monthIndex1: targetMonth0 + 1 },
    isCurrentMonth,
    lastPaidPayout,
    generatedAt: new Date().toISOString(),
  });
}
