import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => [{ title: 'Peer transfers — Funding — Yannis EOSE' }];

/**
 * Legacy MB fund-transfers URL. Canonical surface is Funding → Peer transfers.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const next = new URL('/admin/marketing/funding', url.origin);
  next.searchParams.set('section', 'peer');
  const direction = url.searchParams.get('direction');
  if (direction) next.searchParams.set('direction', direction);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const period = url.searchParams.get('period');
  if (startDate) next.searchParams.set('startDate', startDate);
  if (endDate) next.searchParams.set('endDate', endDate);
  if (period) next.searchParams.set('period', period);
  throw redirect(`${next.pathname}?${next.searchParams.toString()}`);
}
