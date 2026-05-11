import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { defer, type LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, redirectIfUnauthorized } from '~/lib/api.server';
import { MarketingTeamPage } from '~/features/marketing/MarketingTeamPage';
import { MarketingTeamLoadingShell } from '~/features/marketing/MarketingDeferredLoadingShells';
import type { FundingBalanceRow, MarketingTeamOverviewStats } from '~/features/marketing/types';
import { buildLeaderboardInput, resolveMarketingDateFilters } from '~/lib/marketing-pages.server';

export const meta: MetaFunction = () => [
  { title: 'Team Analysis — Yannis EOSE' },
];

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

function computeMarketingTeamOverview(
  teamMembers: FundingBalanceRow[],
  leaderboard: Array<{
    totalOrders: number;
    confirmedOrders: number;
    deliveredOrders: number;
  }>,
): MarketingTeamOverviewStats {
  const totals = leaderboard.reduce(
    (acc, entry) => {
      acc.totalOrders += entry.totalOrders;
      acc.confirmedOrders += entry.confirmedOrders;
      acc.deliveredOrders += entry.deliveredOrders;
      return acc;
    },
    { totalOrders: 0, confirmedOrders: 0, deliveredOrders: 0 },
  );

  return {
    teamMembers: teamMembers.length,
    totalOrders: totals.totalOrders,
    averageConfirmationRate:
      totals.totalOrders > 0 ? (totals.confirmedOrders / totals.totalOrders) * 100 : null,
    averageDeliveryRate:
      totals.totalOrders > 0 ? (totals.deliveredOrders / totals.totalOrders) * 100 : null,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.teamOverview',
    orMarketingTeamSupervisorOnBranch: true,
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  // Resolve URL date filters; defaults to current month so confirmation/delivery rates and
  // the "View orders" deep-link reflect the picked range.
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters, leaderboardPeriod } = resolveMarketingDateFilters(url);
  const leaderboardInput = buildLeaderboardInput(startDate, endDate, periodAllTime);

  const teamShell = { dateFilters: filters, leaderboardPeriod };

  const pageData = (async () => {
  // One bundle endpoint replaces the original 4 parallel calls (and the optional
  // 2-call MB+HoM fallback when balances are empty). All four fans out in
  // parallel on the API side; the wire trip happens once.
  const bundleInput = encodeURIComponent(JSON.stringify(leaderboardInput));
  const bundleRes = await apiRequest<unknown>(
    `/trpc/marketing.teamPageBundle?input=${bundleInput}`,
    { method: 'GET', cookie },
  );
  redirectIfUnauthorized(bundleRes, new URL(request.url).pathname);

  type BundleData = {
    balances: FundingBalanceRow[];
    fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
    leaderboard: LeaderboardEntry[];
    profitabilityConfig: { targetRoas: number; greenThreshold: number };
    usersFallback: Array<{ id: string; name: string; role: string }> | null;
  };
  const bundle = bundleRes.ok
    ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
    : null;

  const profitabilityConfig = bundle?.profitabilityConfig ?? { targetRoas: 3, greenThreshold: 2.5 };
  let teamMembers: FundingBalanceRow[] = bundle?.balances ?? [];
  const fundingSummary = bundle?.fundingSummary ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0' };

  if (teamMembers.length === 0 && bundle?.usersFallback?.length) {
    const merged = [...bundle.usersFallback].sort((a, b) => a.name.localeCompare(b.name));
    teamMembers = toBalanceRows(merged);
  }

  type LeaderboardEntry = {
    mediaBuyerId: string;
    totalOrders: number;
    confirmedOrders: number;
    deliveredOrders: number;
    confirmationRate: number;
    deliveryRate: number;
    cpa: number;
    trueRoas: number;
    profitabilityScore: number | null;
  };
  const leaderboard: LeaderboardEntry[] = bundle?.leaderboard ?? [];
  const overviewStats = computeMarketingTeamOverview(teamMembers, leaderboard);
  const metricsByUser = new Map(
    leaderboard.map((e) => [
      e.mediaBuyerId,
      {
        totalOrders: e.totalOrders,
        confirmedOrders: e.confirmedOrders,
        deliveredOrders: e.deliveredOrders,
        confirmationRate: e.confirmationRate,
        deliveryRate: e.deliveryRate,
        cpa: e.cpa,
        trueRoas: e.trueRoas,
        profitabilityScore: e.profitabilityScore,
      },
    ]),
  );

  const teamMembersWithMetrics: FundingBalanceRow[] = teamMembers.map((m) => {
    const metrics = metricsByUser.get(m.userId);
    return metrics
      ? {
          ...m,
          totalOrders: metrics.totalOrders,
          confirmationRate: metrics.confirmationRate,
          deliveryRate: metrics.deliveryRate,
          cpa: metrics.cpa,
          trueRoas: metrics.trueRoas,
          profitabilityScore: metrics.profitabilityScore,
        }
      : m;
  });

  const SORT_BY_VALUES = new Set([
    'name',
    'balance',
    'received',
    'spent',
    'orders',
    'confirm',
    'delivery',
    'cpa',
    'profitability',
  ]);
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
    const num = (m: FundingBalanceRow) =>
      sortBy === 'balance'
        ? Number(m.balance)
        : sortBy === 'received'
          ? Number(m.totalReceived)
          : sortBy === 'spent'
            ? Number(m.totalSpend)
            : sortBy === 'orders'
              ? m.totalOrders ?? 0
              : sortBy === 'cpa'
                ? m.cpa ?? 0
                : 0;
    const rate = (m: FundingBalanceRow, k: 'confirmationRate' | 'deliveryRate') => m[k];
    sorted.sort((a, b) => {
      if (
        sortBy === 'balance' ||
        sortBy === 'received' ||
        sortBy === 'spent' ||
        sortBy === 'orders' ||
        sortBy === 'cpa'
      ) {
        return sortDir === 'asc' ? num(a) - num(b) : num(b) - num(a);
      }
      if (sortBy === 'profitability') {
        const av = a.profitabilityScore;
        const bv = b.profitabilityScore;
        const aNull = av == null;
        const bNull = bv == null;
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        return sortDir === 'asc' ? av - bv : bv - av;
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
    profitabilityConfig,
    overviewStats,
  };
  })();

  return defer({ teamShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function MarketingTeamRoute() {
  const { teamShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<MarketingTeamLoadingShell dateFilters={teamShell.dateFilters} />}
      loaderShell={{ teamShell }}
      deferredKey="pageData"
    >
      {(data) => (
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
            profitabilityConfig={data.profitabilityConfig}
            overviewStats={data.overviewStats}
          />
        )}
    </CachedAwait>
  );
}
