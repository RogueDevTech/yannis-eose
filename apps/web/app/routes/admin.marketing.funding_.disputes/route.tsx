import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  requirePermissionForAction,
  parsePerPage,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { getMarketingRoleFlags } from '~/lib/marketing-pages.server';
import { isAdminLevel } from '~/lib/rbac';
import { FundingDisputesPage } from '~/features/marketing/FundingDisputesPage';
import type {
  FundingDisputeRecord,
  FundingDisputeStatus,
  FundingDisputesLoaderData,
} from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'Funding Disputes — Marketing — Yannis EOSE' }];

const STATUSES: readonly FundingDisputeStatus[] = ['DISPUTED', 'SENT', 'COMPLETED', 'REVERSED'];

/**
 * Admin dispute / reversal queue. Lists funding across the company (any sender),
 * because the main Funding page only shows the viewer's own sends.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  // Heads of Marketing also get the "funding disputed" alert; without the reverse
  // grant, land them on the disputed transfers they can already see.
  if (!getMarketingRoleFlags(user).canReverseFunding) {
    throw redirect('/admin/marketing/funding?section=distributing&entryType=transfer&entryStatus=DISPUTED');
  }

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status') as FundingDisputeStatus | null;
  const status: FundingDisputeStatus = rawStatus && STATUSES.includes(rawStatus) ? rawStatus : 'DISPUTED';
  const search = url.searchParams.get('search')?.trim() ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 20 });

  const input = { status, page, limit: Math.min(perPage, 100), ...(search ? { search } : {}) };
  const res = await apiRequest<unknown>(
    `/trpc/marketing.listFundingDisputes?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  );

  type DisputesResponse = {
    records: FundingDisputeRecord[];
    pagination: { page: number; limit: number; total: number };
    filteredTotalAmount: string;
    statusCounts: Record<FundingDisputeStatus, number>;
  };
  // Fail loudly: an empty queue would wrongly read as "no disputes".
  if (!res.ok) {
    throw json(
      { error: extractApiErrorMessage(res.data, 'Failed to load funding disputes') },
      { status: safeStatus(res.status) },
    );
  }
  const body = (res.data as { result?: { data?: DisputesResponse } })?.result?.data;

  const data: FundingDisputesLoaderData = {
    canReverseAny: isAdminLevel(user),
    status,
    search,
    records: body?.records ?? [],
    page,
    limit: input.limit,
    total: body?.pagination.total ?? 0,
    filteredTotalAmount: body?.filteredTotalAmount ?? '0',
    statusCounts: body?.statusCounts ?? { DISPUTED: 0, SENT: 0, COMPLETED: 0, REVERSED: 0 },
  };
  return json(data);
}

export async function action({ request }: ActionFunctionArgs) {
  const auth = await requirePermissionForAction(request, 'marketing.funding.reverse');
  if (!auth.ok) return json({ error: auth.error }, { status: auth.status });

  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'reverseFunding') {
    const fundingId = formData.get('fundingId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString().trim() ?? '';
    if (!fundingId) return json({ error: 'Funding ID is required' }, { status: 400 });
    if (reason.length < 10) return json({ error: 'Reason must be at least 10 characters' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/marketing.reverseFunding', {
      method: 'POST',
      cookie,
      body: { fundingId, reason },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reverse funding') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Funding reversed' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FundingDisputesRoute() {
  const data = useLoaderData<typeof loader>() as FundingDisputesLoaderData;
  return <FundingDisputesPage {...data} />;
}
