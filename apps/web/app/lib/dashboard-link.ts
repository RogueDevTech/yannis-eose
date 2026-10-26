/**
 * Link from a dashboard tile to its list, carrying the dashboard's date range
 * and team filter so the list shows the same orders the tile counted. Without
 * them the list falls back to its own default ("this month", every team) and an
 * all-time or custom-range count can open on an empty list.
 */
export function dashboardLink(
  base: string,
  filters: { startDate?: string; endDate?: string; periodAllTime?: boolean; teamId?: string } | null | undefined,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (filters?.periodAllTime) {
    params.set('period', 'all_time');
  } else {
    if (filters?.startDate) params.set('startDate', filters.startDate);
    if (filters?.endDate) params.set('endDate', filters.endDate);
  }
  if (filters?.teamId) params.set('teamId', filters.teamId);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
