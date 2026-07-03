import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, parsePerPage } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { safeStatus } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { resolveMarketingDateFilters, getMarketingRoleFlags } from '~/lib/marketing-pages.server';
import { MbFundTransfersPage } from '~/features/marketing/MbFundTransfersPage';
import type { MbFundTransfersLoaderData, MbFundTransferRecord } from '~/features/marketing/MbFundTransfersPage';

export const meta: MetaFunction = () => [{ title: 'MB Fund Transfers — Marketing — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters } = resolveMarketingDateFilters(url);

  const { isFundingAdmin } = getMarketingRoleFlags(user);

  const direction = url.searchParams.get('direction') || 'all';
  const status = url.searchParams.get('status') || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 20 });

  // Build the input for listMbFundTransfers
  const listInput: Record<string, unknown> = {
    direction,
    page,
    limit: perPage,
  };
  if (status) listInput.status = status;
  if (!periodAllTime) {
    if (startDate) listInput.startDate = startDate;
    if (endDate) listInput.endDate = endDate;
  }

  // Fetch transfers + media buyers in parallel
  const [transfersRes, balancesRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.listMbFundTransfers?input=${encodeURIComponent(JSON.stringify(listInput))}`,
      { method: 'GET', cookie },
    ),
    // Get MB list from funding balances (same pattern as ledger page)
    apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie }),
  ]);

  type TransfersResponse = {
    transfers: MbFundTransferRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };

  const transfersData: TransfersResponse = transfersRes.ok
    ? ((transfersRes.data as { result?: { data?: TransfersResponse } })?.result?.data ?? {
        transfers: [],
        pagination: { page: 1, limit: perPage, total: 0, totalPages: 1 },
      })
    : { transfers: [], pagination: { page: 1, limit: perPage, total: 0, totalPages: 1 } };

  // Parse media buyers for recipient selector
  const mediaBuyers: Array<{ id: string; name: string }> = [];
  if (balancesRes.ok) {
    const rows = (balancesRes.data as { result?: { data?: Array<{ userId: string; name: string; role: string }> } })?.result?.data ?? [];
    for (const r of rows) {
      if (r.role === 'MEDIA_BUYER') mediaBuyers.push({ id: r.userId, name: r.name });
    }
  }

  // Compute status counts from the transfers (approximate from current page for now)
  // A production version would add a dedicated counts query; for now we use total from pagination
  const statusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, ACCEPTED: 0, ALL: transfersData.pagination.total };
  for (const t of transfersData.transfers) {
    if (t.status in statusCounts) {
      statusCounts[t.status as keyof typeof statusCounts] += 1;
    }
  }

  const data: MbFundTransfersLoaderData = {
    transfers: transfersData.transfers,
    total: transfersData.pagination.total,
    page: transfersData.pagination.page,
    totalPages: transfersData.pagination.totalPages,
    limit: transfersData.pagination.limit,
    currentUserId: user.id,
    currentUserRole: user.role,
    canApprove: isFundingAdmin,
    mediaBuyers,
    filters,
    direction,
    statusCounts,
  };

  return json(data);
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'create') {
    const amount = Number(formData.get('amount')?.toString() ?? '0');
    const receiverMbId = formData.get('receiverMbId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString() || undefined;
    if (!receiverMbId || !amount || amount <= 0) {
      return json({ error: 'Recipient and a positive amount are required.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.createMbFundTransfer', {
      method: 'POST',
      cookie,
      body: { receiverMbId, amount, ...(reason ? { reason } : {}) },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create transfer') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'approve') {
    const transferId = formData.get('transferId')?.toString() ?? '';
    const res = await apiRequest<unknown>('/trpc/marketing.approveMbFundTransfer', {
      method: 'POST',
      cookie,
      body: { transferId },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to approve transfer') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'reject') {
    const transferId = formData.get('transferId')?.toString() ?? '';
    const rejectionReason = formData.get('rejectionReason')?.toString() ?? '';
    if (!rejectionReason.trim()) {
      return json({ error: 'Rejection reason is required.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.rejectMbFundTransfer', {
      method: 'POST',
      cookie,
      body: { transferId, rejectionReason: rejectionReason.trim() },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reject transfer') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'accept') {
    const transferId = formData.get('transferId')?.toString() ?? '';
    const res = await apiRequest<unknown>('/trpc/marketing.acceptMbFundTransfer', {
      method: 'POST',
      cookie,
      body: { transferId },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to accept transfer') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MbFundTransfersRoute() {
  const data = useLoaderData<typeof loader>() as MbFundTransfersLoaderData;
  return <MbFundTransfersPage {...data} />;
}
