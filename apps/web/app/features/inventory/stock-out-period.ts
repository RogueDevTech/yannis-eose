import { getLagosCalendarYmd } from '~/lib/order-delivery-today';

/**
 * The period both stock out pages read from the URL. Defaults to this month on the
 * Lagos calendar (the API reads dates as WAT days). Whole days only, so the summary,
 * a product's transactions and the export share one window.
 */
export function parseStockOutPeriod(searchParams: URLSearchParams): {
  startDate: string | null;
  endDate: string | null;
  periodAllTime: boolean;
} {
  const periodAllTime = searchParams.get('period') === 'all_time';
  if (periodAllTime) return { startDate: null, endDate: null, periodAllTime };
  const today = getLagosCalendarYmd();
  return {
    startDate: (searchParams.get('startDate')?.trim() || `${today.slice(0, 8)}01`).slice(0, 10),
    endDate: (searchParams.get('endDate')?.trim() || today).slice(0, 10),
    periodAllTime,
  };
}
