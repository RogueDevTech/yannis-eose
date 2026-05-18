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

  const teamShell = {
    dateFilters: filters,
    q: qSync,
    activityFilter: activityFilterSync,
    backlogFilter: backlogFilterSync,
  };

  const pageData = (async () => {
    // One bundle endpoint replaces the previous 4 parallel calls (listCSTeam +
    // csWorkloads + csLeaderboard + inactiveAgents). The four service calls
    // still run in parallel server-side.
    const bundleInput = encodeURIComponent(
      JSON.stringify({ ...leaderboardInput, inactiveThresholdMinutes: 10 }),
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

    const totalPending = filteredMembers.reduce((sum, member) => sum + (member.workload?.pendingCount ?? 0), 0);
    const idleCount = filteredMembers.filter((member) => member.isIdle).length;

    const PAGE_SIZE = 20;
    const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
    const unfilteredCount = teamMembers.length;
    const totalCount = filteredMembers.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const page = Math.min(Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const pagedMembers = filteredMembers.slice(start, start + PAGE_SIZE);

    return {
      teamMembers: pagedMembers,
      summary: {
        agentCount: totalCount,
        totalPending,
        idleCount,
      },
      page,
      totalPages,
      totalCount,
      unfilteredCount,
      q,
      activityFilter,
      backlogFilter,
      dateFilters: filters,
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
            dateFilters={data.dateFilters}
          />
        )}
    </CachedAwait>
  );
}
