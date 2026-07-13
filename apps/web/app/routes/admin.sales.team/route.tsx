import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { defer, type LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, redirectIfUnauthorized } from '~/lib/api.server';
import { resolveMarketingDateFilters, buildLeaderboardInput } from '~/lib/marketing-pages.server';
import { CSTeamPage } from '~/features/cs/CSTeamPage';
import { CSTeamLoadingShell } from '~/features/cs/CSDeferredLoadingShells';
import type { CSTeamMemberOverview } from '~/features/cs/types';
import type { AgentWorkload, CSLeaderboardEntry, InactiveAgent } from '~/features/cs/types';

export const meta: MetaFunction = () => [
  { title: 'Team Analysis — Yannis EOSE' },
];

function parseCSTeamList(res: { ok: boolean; status: number; data: unknown }): Array<{
  id: string;
  name: string;
  role: string;
  branchMemberships?: Array<{
    branchId: string;
    branchName: string;
    branchCode: string;
    isPrimary: boolean;
    roleInBranch: string | null;
  }>;
}> {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (raw && typeof raw === 'object' && 'error' in raw) return [];
  const data = (res.data as {
    result?: {
      data?: Array<{
        id: string;
        name: string;
        role: string;
        branchMemberships?: Array<{
          branchId: string;
          branchName: string;
          branchCode: string;
          isPrimary: boolean;
          roleInBranch: string | null;
        }>;
      }>;
    };
  })?.result?.data;
  return Array.isArray(data) ? data : [];
}

const CS_ACTIVITY_FILTERS = new Set(['ALL', 'ACTIVE', 'IDLE']);
const CS_BACKLOG_FILTERS = new Set(['ALL', 'HAS_PENDING', 'NO_PENDING']);
const VALID_CATEGORIES = new Set(['funnel', 'offline', 'follow_up', 'cart', 'delivered_follow_up']);
const CS_SORT_OPTIONS = new Set([
  'name', 'total-desc', 'total-asc', 'confirmed-desc', 'delivered-desc',
  'cancelled-desc', 'calls-desc', 'conf-rate-desc', 'conf-rate-asc',
  'delivery-rate-desc', 'delivery-rate-asc', 'backlog-desc', 'backlog-asc',
]);

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
    permission: 'cs.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters } = resolveMarketingDateFilters(url);
  const leaderboardInput = buildLeaderboardInput(startDate, endDate, periodAllTime);

  const qSync = (url.searchParams.get('q') ?? '').trim();
  const activityRaw = url.searchParams.get('activity') ?? 'ALL';
  const backlogRaw = url.searchParams.get('backlog') ?? 'ALL';
  const activityFilterSync = CS_ACTIVITY_FILTERS.has(activityRaw) ? activityRaw : 'ALL';
  const backlogFilterSync = CS_BACKLOG_FILTERS.has(backlogRaw) ? backlogRaw : 'ALL';
  const sortRaw = url.searchParams.get('sort') ?? 'total-desc';
  const sortSync = CS_SORT_OPTIONS.has(sortRaw) ? sortRaw : 'total-desc';
  const categoriesRaw = url.searchParams.get('categories') ?? '';
  const categoriesSync = categoriesRaw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => VALID_CATEGORIES.has(c));

  const teamShell = {
    dateFilters: filters,
    q: qSync,
    activityFilter: activityFilterSync,
    backlogFilter: backlogFilterSync,
    sort: sortSync,
    categories: categoriesSync,
  };

  const pageData = (async () => {
    // One bundle endpoint replaces the previous 4 parallel calls (listCSTeam +
    // csWorkloads + csLeaderboard + inactiveAgents). The four service calls
    // still run in parallel server-side.
    const bundleInput = encodeURIComponent(
      JSON.stringify({
        ...leaderboardInput,
        inactiveThresholdMinutes: 10,
        ...(categoriesSync.length > 0 && { categories: categoriesSync }),
      }),
    );
    const bundleRes = await apiRequest<unknown>(
      `/trpc/orders.csTeamPageBundle?input=${bundleInput}`,
      { method: 'GET', cookie },
    );
    redirectIfUnauthorized(bundleRes, new URL(request.url).pathname);

    type TeamRow = ReturnType<typeof parseCSTeamList>[number];
    type BundleData = {
      team: TeamRow[];
      workloads: AgentWorkload[];
      leaderboard: CSLeaderboardEntry[];
      inactiveAgents: InactiveAgent[];
      offlineCount: number;
    };
    const bundle = bundleRes.ok
      ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
      : null;

    const list = (bundle?.team ?? []).filter((m) => m.role === 'CS_CLOSER');
    const workloads: AgentWorkload[] = bundle?.workloads ?? [];
    const leaderboard: CSLeaderboardEntry[] = bundle?.leaderboard ?? [];
    const inactiveAgents: InactiveAgent[] = bundle?.inactiveAgents ?? [];

    const workloadById = new Map(workloads.map((w) => [w.agentId, w]));
    const leaderboardById = new Map(leaderboard.map((e) => [e.agentId, e]));
    const inactiveAgentIds = new Set(inactiveAgents.map((a) => a.agentId));

    const teamMembers: CSTeamMemberOverview[] = list.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      branchMemberships: m.branchMemberships ?? [],
      workload: workloadById.get(m.id),
      leaderboardEntry: leaderboardById.get(m.id),
      isIdle: inactiveAgentIds.has(m.id),
    }));

    const q = (url.searchParams.get('q') ?? '').trim();
    const qLower = q.toLowerCase();
    const activityRaw = url.searchParams.get('activity') ?? 'ALL';
    const backlogRaw = url.searchParams.get('backlog') ?? 'ALL';
    const activityFilter = CS_ACTIVITY_FILTERS.has(activityRaw) ? activityRaw : 'ALL';
    const backlogFilter = CS_BACKLOG_FILTERS.has(backlogRaw) ? backlogRaw : 'ALL';

    let filteredMembers = teamMembers;
    if (qLower.length > 0) {
      filteredMembers = filteredMembers.filter((member) => {
        const branchText = (member.branchMemberships ?? [])
          .flatMap((branch) => [branch.branchName, branch.branchCode])
          .join(' ')
          .toLowerCase();
        const roleText = member.role.toLowerCase().replaceAll('_', ' ');
        return (
          member.name.toLowerCase().includes(qLower) ||
          member.role.toLowerCase().includes(qLower) ||
          roleText.includes(qLower) ||
          branchText.includes(qLower)
        );
      });
    }
    if (activityFilter === 'ACTIVE') {
      filteredMembers = filteredMembers.filter((member) => !member.isIdle);
    } else if (activityFilter === 'IDLE') {
      filteredMembers = filteredMembers.filter((member) => member.isIdle);
    }
    if (backlogFilter === 'HAS_PENDING') {
      filteredMembers = filteredMembers.filter((member) => (member.workload?.pendingCount ?? 0) > 0);
    } else if (backlogFilter === 'NO_PENDING') {
      filteredMembers = filteredMembers.filter((member) => (member.workload?.pendingCount ?? 0) === 0);
    }

    // Sort
    const sortKey = url.searchParams.get('sort') ?? 'total-desc';
    filteredMembers = [...filteredMembers].sort((a, b) => {
      const aLb = a.leaderboardEntry;
      const bLb = b.leaderboardEntry;
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'total-desc':
          return (bLb?.ordersEngaged ?? 0) - (aLb?.ordersEngaged ?? 0);
        case 'total-asc':
          return (aLb?.ordersEngaged ?? 0) - (bLb?.ordersEngaged ?? 0);
        case 'confirmed-desc':
          return (bLb?.ordersConfirmed ?? 0) - (aLb?.ordersConfirmed ?? 0);
        case 'delivered-desc':
          return (bLb?.ordersDelivered ?? 0) - (aLb?.ordersDelivered ?? 0);
        case 'cancelled-desc':
          return (bLb?.ordersCancelled ?? 0) - (aLb?.ordersCancelled ?? 0);
        case 'calls-desc':
          return (bLb?.callsMade ?? 0) - (aLb?.callsMade ?? 0);
        case 'conf-rate-desc':
          return (bLb?.confirmationRate ?? 0) - (aLb?.confirmationRate ?? 0);
        case 'conf-rate-asc':
          return (aLb?.confirmationRate ?? 0) - (bLb?.confirmationRate ?? 0);
        case 'delivery-rate-desc':
          return (bLb?.deliveryRate ?? 0) - (aLb?.deliveryRate ?? 0);
        case 'delivery-rate-asc':
          return (aLb?.deliveryRate ?? 0) - (bLb?.deliveryRate ?? 0);
        case 'backlog-desc':
          return (b.workload?.pendingCount ?? 0) - (a.workload?.pendingCount ?? 0);
        case 'backlog-asc':
          return (a.workload?.pendingCount ?? 0) - (b.workload?.pendingCount ?? 0);
        default:
          return (bLb?.ordersEngaged ?? 0) - (aLb?.ordersEngaged ?? 0);
      }
    });

    const totalPending = filteredMembers.reduce((sum, member) => sum + (member.workload?.pendingCount ?? 0), 0);

    // Team-level totals from the full leaderboard (not the filtered subset)
    // so the overview reflects how the whole CS team did in the period — not
    // just the search/activity slice the table is currently showing.
    const teamTotals = leaderboard.reduce(
      (acc, entry) => ({
        engaged: acc.engaged + (entry.ordersEngaged ?? 0),
        confirmed: acc.confirmed + (entry.ordersConfirmed ?? 0),
        delivered: acc.delivered + (entry.ordersDelivered ?? 0),
        cancelled: acc.cancelled + (entry.ordersCancelled ?? 0),
        callsMade: acc.callsMade + (entry.callsMade ?? 0),
        totalCallDuration: acc.totalCallDuration + ((entry.avgCallDurationSeconds ?? 0) * (entry.callsMade ?? 0)),
      }),
      { engaged: 0, confirmed: 0, delivered: 0, cancelled: 0, callsMade: 0, totalCallDuration: 0 },
    );
    const confirmationRate =
      teamTotals.engaged > 0 ? (teamTotals.confirmed / teamTotals.engaged) * 100 : null;
    const deliveryRate =
      teamTotals.engaged > 0 ? (teamTotals.delivered / teamTotals.engaged) * 100 : null;
    const avgCallDuration =
      teamTotals.callsMade > 0 ? Math.round(teamTotals.totalCallDuration / teamTotals.callsMade) : null;

    const unfilteredCount = teamMembers.length;
    const totalCount = filteredMembers.length;

    return {
      teamMembers: filteredMembers,
      summary: {
        agentCount: totalCount,
        totalPending,
        engagedTotal: teamTotals.engaged,
        confirmedTotal: teamTotals.confirmed,
        deliveredTotal: teamTotals.delivered,
        cancelledTotal: teamTotals.cancelled,
        callsMadeTotal: teamTotals.callsMade,
        avgCallDuration,
        confirmationRate,
        deliveryRate,
      },
      page: 1,
      totalPages: 1,
      totalCount,
      unfilteredCount,
      q,
      activityFilter,
      backlogFilter,
      sort: sortKey,
      dateFilters: filters,
      offlineCount: bundle?.offlineCount ?? 0,
      categories: categoriesSync,
    };
  })();

  return defer({ teamShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function CSTeamRoute() {
  const { teamShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<CSTeamLoadingShell {...teamShell} />}
      loaderShell={{ teamShell }}
      deferredKey="pageData"
    >
      {(data) => (
          <CSTeamPage
            teamMembers={data.teamMembers}
            summary={data.summary}
            page={data.page}
            totalPages={data.totalPages}
            totalCount={data.totalCount}
            unfilteredCount={data.unfilteredCount}
            q={data.q}
            activityFilter={data.activityFilter}
            backlogFilter={data.backlogFilter}
            sort={data.sort}
            dateFilters={data.dateFilters}
            offlineCount={data.offlineCount}
            categories={data.categories}
          />
        )}
    </CachedAwait>
  );
}
