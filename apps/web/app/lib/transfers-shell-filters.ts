/**
 * URL date filter parsing for `/admin/transfers` loading shells — mirrors
 * `TransfersPage` so the deferred `DateFilterBar` matches search params.
 */
export type TransfersShellDateFilters = {
  startDate: string;
  endDate: string;
  periodAllTime: boolean;
};

export function parseTransfersShellDateFilters(searchParams: URLSearchParams): TransfersShellDateFilters {
  const hasDateParams =
    searchParams.has('startDate') || searchParams.has('endDate') || searchParams.has('period');
  const periodAllTime = searchParams.get('period') === 'all_time' || !hasDateParams;
  const rawStartDate = searchParams.get('startDate') ?? '';
  const rawEndDate = searchParams.get('endDate') ?? '';
  if (periodAllTime) {
    return { startDate: '', endDate: '', periodAllTime: true };
  }
  if (rawStartDate && rawEndDate) {
    return { startDate: rawStartDate, endDate: rawEndDate, periodAllTime: false };
  }
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: first.toISOString().slice(0, 10),
    endDate: last.toISOString().slice(0, 10),
    periodAllTime: false,
  };
}
