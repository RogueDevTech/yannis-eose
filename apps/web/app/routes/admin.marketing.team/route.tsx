import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, redirectIfUnauthorized } from '~/lib/api.server';
import { MarketingTeamPage } from '~/features/marketing/MarketingTeamPage';
import type { FundingBalanceRow } from '~/features/marketing/types';
import { buildLeaderboardInput, resolveMarketingDateFilters } from '~/lib/marketing-pages.server';

export const meta: MetaFunction = () => [
  { title: 'Team — Yannis EOSE' },
];

function parseBalancesList(res: { ok: boolean; status: number; data: unknown }): FundingBalanceRow[] {
  const raw = res.data as Record<string, unknown> | undefined;
  if (raw && typeof raw === 'object' && 'error' in raw) return [];
  if (!res.ok) return [];
  if (!raw || typeof raw !== 'object') return [];
  const result = raw.result as { data?: FundingBalanceRow[]; json?: FundingBalanceRow[] } | undefined;
  const data = result?.data ?? result?.json ?? (Array.isArray(raw.result) ? raw.result : undefined);
  return Array.isArray(data) ? data : [];
}

function parseUsersList(res: { ok: boolean; data: unknown }): Array<{ id: string; name: string; role: string }> {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  const result = raw?.result as { data?: { users?: Array<{ id: string; name: string; role: string }> } } | undefined;
  const users = result?.data?.users;
  return Array.isArray(users) ? users : [];
}

function toBalanceRows(users: Array<{ id: string; name: string; role: string }>): FundingBalanceRow[] {
  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    role: u.role,
    totalReceived: '0',
    totalSpend: '0',
    balance: '0',
  }));
}

function parseFundingSummary(res: { ok: boolean; data: unknown }) {
  const data = res.ok
    ? (res.data as { result?: { data?: { totalSent: string; totalCompleted: string; totalDisputed: string } } })?.result?.data
    : null;
  return data ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0' };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  // Resolve URL date filters; defaults to current month so confirmation/delivery rates and
  // the "View orders" deep-link reflect the picked range.
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters, leaderboardPeriod } = resolveMarketingDateFilters(url);
  const leaderboardInput = buildLeaderboardInput(startDate, endDate, periodAllTime);

  const [balancesRes, summaryRes, leaderboardRes] = await Promise.all([
    apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
      { method: 'GET', cookie },
    ),
  ]);
  redirectIfUnauthorized(balancesRes, new URL(request.url).pathname);
  let teamMembers = parseBalancesList(balancesRes);
  const fundingSummary = parseFundingSummary(summaryRes);

  if (teamMembers.length === 0 && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'HEAD_OF_MARKETING')) {
    const listInput = (input: { role: string }) =>
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: input.role, limit: 20 }))}`;
    const [mbRes, homRes] = await Promise.all([
      apiRequest<unknown>(listInput({ role: 'MEDIA_BUYER' }), { method: 'GET', cookie }),
      apiRequest<unknown>(listInput({ role: 'HEAD_OF_MARKETING' }), { method: 'GET', cookie }),
    ]);
    const mediaBuyers = parseUsersList(mbRes);
    const heads = parseUsersList(homRes);
    const merged = [...heads, ...mediaBuyers].sort((a, b) => a.name.localeCompare(b.name));
    teamMembers = toBalanceRows(merged);
  }

  type LeaderboardEntry = { mediaBuyerId: string; confirmationRate: number; deliveryRate: number };
  const leaderboard: LeaderboardEntry[] = leaderboardRes.ok
    ? (leaderboardRes.data as { result?: { data?: LeaderboardEntry[] } })?.result?.data ?? []
    : [];
  const metricsByUser = new Map(leaderboard.map((e) => [e.mediaBuyerId, { confirmationRate: e.confirmationRate, deliveryRate: e.deliveryRate }]));

  const teamMembersWithMetrics: FundingBalanceRow[] = teamMembers.map((m) => {
    const metrics = metricsByUser.get(m.userId);
    return metrics
      ? { ...m, confirmationRate: metrics.confirmationRate, deliveryRate: metrics.deliveryRate }
      : m;
  });

  const SORT_BY_VALUES = new Set(['name', 'balance', 'received', 'spent', 'confirm', 'delivery']);
  const q = (url.searchParams.get('q') ?? '').trim();
  const qLower = q.toLowerCase();
  const sortByRaw = url.searchParams.get('sortBy') ?? 'name';
  const sortBy = SORT_BY_VALUES.has(sortByRaw) ? sortByRaw : 'name';
  const sortDirParam = url.searchParams.get('sortDir');
  const sortDir: 'asc' | 'desc' =
    sortDirParam === 'asc' || sortDirParam === 'desc'
      ? sortDirParam
      : sortBy === 'name'
        ? 'asc'
        : 'desc';

  const unfilteredCount = teamMembersWithMetrics.length;
  let afterSearch = teamMembersWithMetrics;
  if (qLower.length > 0) {
    afterSearch = teamMembersWithMetrics.filter((m) => {
      const name = m.name.toLowerCase();
      const role = m.role.toLowerCase().replaceAll('_', ' ');
      if (name.includes(qLower) || m.role.toLowerCase().includes(qLower) || role.includes(qLower)) {
        return true;
      }
      return false;
    });
  }

  const sorted = [...afterSearch];
  if (sortBy === 'name') {
    sorted.sort((a, b) => {
      const c = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? c : -c;
    });
  } else {
    const num = (m: FundingBalanceRow) => (sortBy === 'balance' ? Number(m.balance) : sortBy === 'received' ? Number(m.totalReceived) : Number(m.totalSpend));
    const rate = (m: FundingBalanceRow, k: 'confirmationRate' | 'deliveryRate') => m[k];
    sorted.sort((a, b) => {
      if (sortBy === 'balance' || sortBy === 'received' || sortBy === 'spent') {
        return sortDir === 'asc' ? num(a) - num(b) : num(b) - num(a);
      }
      const k = sortBy === 'confirm' ? 'confirmationRate' : 'deliveryRate';
      const av = rate(a, k);
      const bv = rate(b, k);
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }

  // Client-side pagination — `marketing.listFundingBalances` returns all members. With 20/page
  // the loader is the single source of truth for which slice is shown.
  const PAGE_SIZE = 20;
  const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
  const totalCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalCount) / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pagedMembers = sorted.slice(start, start + PAGE_SIZE);

  return {
    teamMembers: pagedMembers,
    fundingSummary,
    dateFilters: filters,
    leaderboardPeriod,
    page,
    totalPages,
    totalCount,
    q,
    sortBy,
    sortDir,
    unfilteredCount,
  };
}

export default function MarketingTeamRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <MarketingTeamPage
      teamMembers={data.teamMembers}
      fundingSummary={data.fundingSummary}
      dateFilters={data.dateFilters}
      leaderboardPeriod={data.leaderboardPeriod}
      page={data.page}
      totalPages={data.totalPages}
      totalCount={data.totalCount}
      q={data.q}
      sortBy={data.sortBy}
      sortDir={data.sortDir}
      unfilteredCount={data.unfilteredCount}
    />
  );
}
