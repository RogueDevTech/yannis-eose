import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
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
import { FundingRefundsPage } from '~/features/marketing/FundingRefundsPage';
import type {
  FundingRefundRecord,
  FundingRefundStatus,
  FundingRefundView,
  FundingRefundsLoaderData,
  RefundableFunding,
} from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'Funding Refunds — Marketing — Yannis EOSE' }];

const STATUSES: readonly FundingRefundStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
/** Who can open the page: refunders, funders (marketing), Finance (company money), reconcilers. */
const PAGE_PERMISSIONS = ['marketing.read', 'marketing.funding.refund', 'marketing.funding.reconcile', 'finance.read'];

/**
 * Funding refunds (mig 0361): a funding receiver returns unspent money to the
 * person who funded them. "My refunds" = ones I asked for; "To review" = ones
 * owed to me (or company money, for Admin / Finance); "All" = company view.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, PAGE_PERMISSIONS);
  const flags = getMarketingRoleFlags(user);
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const views: FundingRefundView[] = [];
  if (flags.canRefundFunding) views.push('mine');
  views.push('to_review');
  if (flags.canReconcileFunding || isAdminLevel(user)) views.push('all');

  const rawView = url.searchParams.get('view') as FundingRefundView | null;
  const defaultView: FundingRefundView = user.role === 'MEDIA_BUYER' && flags.canRefundFunding ? 'mine' : 'to_review';
  const view = rawView && views.includes(rawView) ? rawView : defaultView;
  const rawStatus = url.searchParams.get('status') as FundingRefundStatus | null;
  const status = rawStatus && STATUSES.includes(rawStatus) ? rawStatus : null;
  const search = url.searchParams.get('search')?.trim() ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 20 });
  const input = { view, page, limit: Math.min(perPage, 100), ...(status ? { status } : {}), ...(search ? { search } : {}) };

  const [listRes, refundableRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/marketing.listFundingRefunds?input=${encodeURIComponent(JSON.stringify(input))}`, {
      method: 'GET',
      cookie,
    }),
    flags.canRefundFunding
      ? apiRequest<unknown>('/trpc/marketing.listRefundableFundings', { method: 'GET', cookie })
      : Promise.resolve(null),
  ]);
  if (!listRes.ok) {
    throw json(
      { error: extractApiErrorMessage(listRes.data, 'Failed to load refunds') },
      { status: safeStatus(listRes.status) },
    );
  }
  type ListResponse = {
    records: FundingRefundRecord[];
    pagination: { page: number; limit: number; total: number };
    filteredTotalAmount: string;
    statusCounts: Record<FundingRefundStatus, number>;
  };
  const body = (listRes.data as { result?: { data?: ListResponse } })?.result?.data;
  const refundable =
    refundableRes && refundableRes.ok
      ? ((refundableRes.data as { result?: { data?: { available: string; fundings: RefundableFunding[] } } })?.result?.data ?? null)
      : null;

  const data: FundingRefundsLoaderData = {
    view,
    views,
    status,
    search,
    records: body?.records ?? [],
    page,
    limit: input.limit,
    total: body?.pagination.total ?? 0,
    filteredTotalAmount: body?.filteredTotalAmount ?? '0',
    statusCounts: body?.statusCounts ?? { PENDING: 0, APPROVED: 0, REJECTED: 0, COMPLETED: 0, CANCELLED: 0 },
    canRefund: flags.canRefundFunding,
    refundable,
  };
  return json(data);
}

export async function action({ request }: ActionFunctionArgs) {
  const auth = await requirePermissionForAction(request, PAGE_PERMISSIONS);
  if (!auth.ok) return json({ error: auth.error }, { status: auth.status });
  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString();
  const refundId = fd.get('refundId')?.toString() ?? '';

  const call = async (path: string, body: Record<string, unknown>, fallback: string, message: string) => {
    const res = await apiRequest<unknown>(`/trpc/marketing.${path}`, { method: 'POST', cookie, body });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, fallback), intent }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message, intent });
  };

  switch (intent) {
    case 'requestRefund': {
      const amount = Number(fd.get('amount')?.toString() ?? '');
      const reason = fd.get('reason')?.toString().trim() ?? '';
      const fundingId = fd.get('fundingId')?.toString() ?? '';
      if (!fundingId) return json({ error: 'Choose the funding you are refunding', intent }, { status: 400 });
      if (!(amount > 0)) return json({ error: 'Enter an amount above zero', intent }, { status: 400 });
      if (reason.length < 10) return json({ error: 'Reason must be at least 10 characters', intent }, { status: 400 });
      return call('requestFundingRefund', { fundingId, amount, reason }, 'Failed to request refund', 'Refund requested');
    }
    case 'approveRefund':
      return call('reviewFundingRefund', { refundId, action: 'APPROVE' }, 'Failed to approve refund', 'Refund approved');
    case 'rejectRefund': {
      const note = fd.get('note')?.toString().trim() ?? '';
      if (note.length < 10) return json({ error: 'Reason must be at least 10 characters', intent }, { status: 400 });
      return call('reviewFundingRefund', { refundId, action: 'REJECT', note }, 'Failed to reject refund', 'Refund rejected');
    }
    case 'completeRefund':
      return call('completeFundingRefund', { refundId }, 'Failed to complete refund', 'Refund completed');
    case 'cancelRefund':
      return call('cancelFundingRefund', { refundId }, 'Failed to cancel refund', 'Refund cancelled');
    default:
      return json({ error: 'Unknown action' }, { status: 400 });
  }
}

export default function FundingRefundsRoute() {
  const data = useLoaderData<typeof loader>() as FundingRefundsLoaderData;
  return <FundingRefundsPage {...data} />;
}
