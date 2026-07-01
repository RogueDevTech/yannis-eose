import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, parsePerPage } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { FundingLedgerPage } from '~/features/marketing/FundingLedgerPage';
import type { FundingLedgerLoaderData, FundingLedgerEntry } from '~/features/marketing/types';
import { resolveMarketingDateFilters } from '~/lib/marketing-pages.server';

export const meta: MetaFunction = () => [{ title: 'Funding Ledger — Marketing — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters } = resolveMarketingDateFilters(url, 'all_time');

  const userId = url.searchParams.get('userId') || (user.role === 'MEDIA_BUYER' ? user.id : '');
  const entryTypeFilter = url.searchParams.get('entryType') || 'all';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 100 });

  // Fetch MB list for the picker (admin/HoM only)
  const isAdmin = isAdminLevel(user) || user.role === 'HEAD_OF_MARKETING' || user.role === 'FINANCE_OFFICER';
  const mediaBuyers: Array<{ id: string; name: string }> = [];
  if (isAdmin) {
    const usersRes = await apiRequest<unknown>(
      `/trpc/marketing.listFundingBalances`,
      { method: 'GET', cookie },
    );
    if (usersRes.ok) {
      const rows = (usersRes.data as { result?: { data?: Array<{ userId: string; name: string; role: string }> } })?.result?.data ?? [];
      for (const r of rows) {
        if (r.role === 'MEDIA_BUYER' || r.role === 'HEAD_OF_MARKETING') mediaBuyers.push({ id: r.userId, name: r.name });
      }
    }
  } else if (user.role === 'MEDIA_BUYER') {
    mediaBuyers.push({ id: user.id, name: user.name ?? 'You' });
  }

  // If no userId selected, return empty
  if (!userId) {
    const data: FundingLedgerLoaderData = {
      entries: [],
      total: 0,
      page: 1,
      totalPages: 1,
      limit: perPage,
      summary: { totalCredits: '0', totalDebits: '0', closingBalance: '0' },
      selectedUserId: '',
      selectedUserName: '',
      mediaBuyers,
      filters,
      entryTypeFilter,
    };
    return json(data);
  }

  const selectedUserName = mediaBuyers.find((m) => m.id === userId)?.name ?? '';

  // Fetch ledger
  const ledgerInput: Record<string, unknown> = {
    userId,
    entryType: entryTypeFilter,
    page,
    limit: perPage,
  };
  if (!periodAllTime) {
    if (startDate) ledgerInput.startDate = startDate;
    if (endDate) ledgerInput.endDate = endDate;
  }

  const res = await apiRequest<unknown>(
    `/trpc/marketing.fundingLedger?input=${encodeURIComponent(JSON.stringify(ledgerInput))}`,
    { method: 'GET', cookie },
  );

  type LedgerResponse = {
    entries: FundingLedgerEntry[];
    total: number;
    page: number;
    totalPages: number;
    summary: { totalCredits: string; totalDebits: string; closingBalance: string };
  };

  const ledger: LedgerResponse = res.ok
    ? ((res.data as { result?: { data?: LedgerResponse } })?.result?.data ?? {
        entries: [],
        total: 0,
        page: 1,
        totalPages: 1,
        summary: { totalCredits: '0', totalDebits: '0', closingBalance: '0' },
      })
    : { entries: [], total: 0, page: 1, totalPages: 1, summary: { totalCredits: '0', totalDebits: '0', closingBalance: '0' } };

  const data: FundingLedgerLoaderData = {
    ...ledger,
    limit: perPage,
    selectedUserId: userId,
    selectedUserName,
    mediaBuyers,
    filters,
    entryTypeFilter,
  };

  return json(data);
}

export default function FundingLedgerRoute() {
  const data = useLoaderData<typeof loader>() as FundingLedgerLoaderData;
  return <FundingLedgerPage {...data} />;
}
