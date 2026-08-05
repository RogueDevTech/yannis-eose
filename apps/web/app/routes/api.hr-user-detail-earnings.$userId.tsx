import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import { extractTrpc } from '~/lib/trpc-extract.server';
import type { StaffPayoutEstimate, UserPaidPayoutSnapshot } from '~/features/users/types';

/** Calendar month in Africa/Lagos (payroll timezone), returned as ISO bounds. */
function nigeriaCalendarMonth(year: number, monthIndex0: number) {
  const month = String(monthIndex0 + 1).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const start = new Date(`${year}-${month}-01T00:00:00+01:00`);
  const end = new Date(`${year}-${month}-${String(lastDay).padStart(2, '0')}T23:59:59.999+01:00`);
  const periodLabel = new Intl.DateTimeFormat('en-NG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
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
  // Align "current month" with Nigeria (same as payroll), not UTC.
  const lagosParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const currentYear = Number(lagosParts.find((p) => p.type === 'year')?.value);
  const currentMonth0 = Number(lagosParts.find((p) => p.type === 'month')?.value) - 1;

  const qYear = parseInt(url.searchParams.get('year') ?? '', 10);
  const qMonth = parseInt(url.searchParams.get('month') ?? '', 10); // 1-indexed from URL
  const targetYear = Number.isFinite(qYear) ? qYear : currentYear;
  const targetMonth0 = Number.isFinite(qMonth) ? qMonth - 1 : currentMonth0;

  const isCurrentMonth = targetYear === currentYear && targetMonth0 === currentMonth0;

  const period = nigeriaCalendarMonth(targetYear, targetMonth0);

  const previewInput = encodeURIComponent(
    JSON.stringify({ staffId: userId, periodStart: period.periodStart, periodEnd: period.periodEnd }),
  );

  // Scope the paid-payroll lookup to the SELECTED period, not "latest paid
  // overall". Without period bounds this returned the single most-recent PAID
  // payout for every month, so June/July/August all showed July's payslip and
  // months that were never paid still showed a paid card. listPayouts filters
  // periodStart >= / periodEnd <= these bounds — send the Lagos-anchored ISO
  // instants, NOT plain dates: a July payout is stored at 2026-06-30T23:00Z
  // (= 2026-07-01 00:00 +01:00), which a UTC-midnight date bound would exclude.
  const paidInput = encodeURIComponent(
    JSON.stringify({
      staffId: userId,
      status: 'PAID' as const,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      limit: 1,
      page: 1,
    }),
  );

  const [previewRes, paidRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/hr.previewPayout?input=${previewInput}`, opt),
    apiRequest<unknown>(`/trpc/hr.listPayouts?input=${paidInput}`, opt),
  ]);

  if (!previewRes.ok) {
    return json({
      ok: false as const,
      error: extractApiErrorMessage(
        previewRes.data,
        previewRes.status === 504
          ? 'Earnings estimate timed out. Try again in a moment.'
          : 'Could not compute earnings estimate',
      ),
    });
  }

  const preview = extractTrpc(previewRes, null) as StaffPayoutEstimate | null;
  if (!preview) {
    return json({
      ok: false as const,
      error: 'Earnings estimate response was empty. Try again or contact HR.',
    });
  }

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
