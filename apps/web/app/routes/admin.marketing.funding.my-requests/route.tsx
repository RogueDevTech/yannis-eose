import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import type { FundingRequestRecord } from '~/features/marketing/types';

function parseFundingRequests(res: { ok: boolean; data: unknown }): FundingRequestRecord[] {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: { records: FundingRequestRecord[] } } })?.result?.data;
  return data?.records ?? [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);

  const input = JSON.stringify({
    requesterId: user.id,
    page: 1,
    limit: 50,
  });
  const res = await apiRequest<unknown>(
    `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(input)}`,
    { method: 'GET', cookie },
  );
  const records = parseFundingRequests(res);
  return json({ records });
}

export default function AdminMarketingFundingMyRequestsRoute() {
  return null;
}
