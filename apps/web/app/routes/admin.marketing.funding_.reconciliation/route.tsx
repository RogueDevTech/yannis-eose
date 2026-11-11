import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  requirePermissionForAction,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { getMarketingRoleFlags } from '~/lib/marketing-pages.server';
import { FundingReconciliationPage } from '~/features/marketing/FundingReconciliationPage';
import {
  comparePeriod,
  defaultPeriod,
  isReconciliationCompare,
  isReconciliationView,
} from '~/features/marketing/reconciliation-period';
import type {
  FundingAdjustmentRecord,
  FundingPeriodClose,
  FundingReconciliation,
  FundingReconciliationLoaderData,
} from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'Funding Reconciliation — Marketing — Yannis EOSE' }];

/** Media Buyers (own figures), marketing leads, Finance / Accountant and reconcilers. */
const PAGE_PERMISSIONS = ['marketing.read', 'marketing.funding.reconcile', 'finance.read'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

type TrpcBody<T> = { result?: { data?: T } };

/**
 * Funding reconciliation (mig 0361): opening balance, every movement, closing
 * balance for a day / week / month / custom range, with month close and
 * approved adjustments. The API enforces who may see whom.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, PAGE_PERMISSIONS);
  const flags = getMarketingRoleFlags(user);
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const rawView = url.searchParams.get('view');
  const view = isReconciliationView(rawView) ? rawView : 'month';
  const fallback = defaultPeriod(view);
  const startParam = url.searchParams.get('startDate') ?? '';
  const endParam = url.searchParams.get('endDate') ?? '';
  const startDate = YMD.test(startParam) ? startParam : fallback.startDate;
  const endDate = YMD.test(endParam) ? endParam : fallback.endDate;
  const selectedUserId = url.searchParams.get('userId') || (flags.canReconcileFunding ? '' : user.id);
  const rawCompare = url.searchParams.get('compare');
  const compare = isReconciliationCompare(rawCompare) ? rawCompare : 'none';
  const comparedTo = comparePeriod(view, startDate, endDate, compare);

  const get = (path: string, input?: unknown) =>
    apiRequest<unknown>(
      `/trpc/marketing.${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      { method: 'GET', cookie },
    );

  const showCloses = flags.canCloseFundingPeriod || flags.canReconcileFunding;
  const [usersRes, reconRes, closesRes, adjRes] = await Promise.all([
    get('fundingReconcilableUsers'),
    selectedUserId
      ? get('fundingReconciliation', {
          userId: selectedUserId,
          view,
          ...(view === 'all' ? {} : { startDate, endDate }),
          ...(comparedTo ? { compareStartDate: comparedTo.startDate, compareEndDate: comparedTo.endDate } : {}),
        })
      : Promise.resolve(null),
    showCloses ? get('listFundingPeriodCloses') : Promise.resolve(null),
    flags.canAdjustFunding || flags.canReconcileFunding
      ? get('listFundingAdjustments', { page: 1, limit: 50, ...(selectedUserId ? { userId: selectedUserId } : { status: 'PENDING' }) })
      : Promise.resolve(null),
  ]);

  const users = usersRes.ok
    ? ((usersRes.data as TrpcBody<Array<{ id: string; name: string; role: string }>>)?.result?.data ?? [])
    : [];
  const data = reconRes && reconRes.ok ? ((reconRes.data as TrpcBody<FundingReconciliation>)?.result?.data ?? null) : null;
  const error = reconRes && !reconRes.ok ? extractApiErrorMessage(reconRes.data, 'Failed to load the reconciliation') : null;
  const closes =
    closesRes && closesRes.ok
      ? ((closesRes.data as TrpcBody<{ closes: FundingPeriodClose[]; nextMonth: string | null; closableMonths: string[]; groupId: string | null }>)?.result?.data ?? null)
      : null;
  const adjustments =
    adjRes && adjRes.ok
      ? ((adjRes.data as TrpcBody<{ records: FundingAdjustmentRecord[] }>)?.result?.data?.records ?? [])
      : [];

  const loaderData: FundingReconciliationLoaderData = {
    users,
    selectedUserId,
    view,
    startDate,
    endDate,
    compare,
    data,
    error,
    canAdjust: flags.canAdjustFunding,
    canClosePeriod: flags.canCloseFundingPeriod,
    closes,
    adjustments,
  };
  return json(loaderData);
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString();

  const post = async (path: string, body: Record<string, unknown>, fallback: string, message: string) => {
    const res = await apiRequest<unknown>(`/trpc/marketing.${path}`, { method: 'POST', cookie, body });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, fallback), intent }, { status: safeStatus(res.status) });
    return json({ success: true, message, intent });
  };

  if (intent === 'closePeriod') {
    const auth = await requirePermissionForAction(request, 'marketing.funding.closePeriod');
    if (!auth.ok) return json({ error: auth.error, intent }, { status: auth.status });
    const month = fd.get('month')?.toString() ?? '';
    const note = fd.get('note')?.toString().trim() || undefined;
    return post('closeFundingPeriod', { month, ...(note ? { note } : {}) }, 'Failed to close the month', `${month} closed`);
  }

  const auth = await requirePermissionForAction(request, 'marketing.funding.adjust');
  if (!auth.ok) return json({ error: auth.error, intent }, { status: auth.status });

  if (intent === 'createAdjustment') {
    const amount = Number(fd.get('amount')?.toString() ?? '');
    const reason = fd.get('reason')?.toString().trim() ?? '';
    const userId = fd.get('userId')?.toString() ?? '';
    const direction = fd.get('direction')?.toString();
    const relatedPeriodMonth = fd.get('relatedPeriodMonth')?.toString() || undefined;
    if (!userId) return json({ error: 'Choose a person', intent }, { status: 400 });
    if (direction !== 'CREDIT' && direction !== 'DEBIT') return json({ error: 'Choose credit or debit', intent }, { status: 400 });
    if (!(amount > 0)) return json({ error: 'Enter an amount above zero', intent }, { status: 400 });
    if (reason.length < 10) return json({ error: 'Reason must be at least 10 characters', intent }, { status: 400 });
    return post(
      'createFundingAdjustment',
      { userId, direction, amount, reason, ...(relatedPeriodMonth ? { relatedPeriodMonth } : {}) },
      'Failed to request the adjustment',
      'Adjustment sent for approval',
    );
  }
  if (intent === 'approveAdjustment' || intent === 'rejectAdjustment') {
    const adjustmentId = fd.get('adjustmentId')?.toString() ?? '';
    const note = fd.get('note')?.toString().trim() || undefined;
    if (intent === 'rejectAdjustment' && (note?.length ?? 0) < 10) {
      return json({ error: 'Reason must be at least 10 characters', intent }, { status: 400 });
    }
    return post(
      'reviewFundingAdjustment',
      { adjustmentId, action: intent === 'approveAdjustment' ? 'APPROVE' : 'REJECT', ...(note ? { note } : {}) },
      'Failed to review the adjustment',
      intent === 'approveAdjustment' ? 'Adjustment approved' : 'Adjustment rejected',
    );
  }
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FundingReconciliationRoute() {
  const data = useLoaderData<typeof loader>() as FundingReconciliationLoaderData;
  return <FundingReconciliationPage {...data} />;
}
