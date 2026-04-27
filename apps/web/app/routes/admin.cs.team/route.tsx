import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, redirectIfUnauthorized } from '~/lib/api.server';
import { resolveMarketingDateFilters, buildLeaderboardInput } from '~/lib/marketing-pages.server';
import { CSTeamPage } from '~/features/cs/CSTeamPage';
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

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
    permission: 'cs.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  // Reuse the marketing date-filter helper — same shape (this_month default, all_time toggle,
  // explicit startDate/endDate) and same downstream leaderboard input format.
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters } = resolveMarketingDateFilters(url);
  const leaderboardInput = buildLeaderboardInput(startDate, endDate, periodAllTime);

  const [teamRes, workloadsRes, leaderboardRes, inactiveRes] = await Promise.all([
    apiRequest<unknown>('/trpc/users.listCSTeam', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/orders.csWorkloads', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/orders.inactiveAgents?input=${encodeURIComponent(JSON.stringify({ thresholdMinutes: 10 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  redirectIfUnauthorized(teamRes, new URL(request.url).pathname);
  // Hide HEAD_OF_CS from the table — the page is for the team's CS Agents (Closers).
  // Per CEO directive 2026-04-26, the head viewing the page sees only their direct reports.
  const list = parseCSTeamList(teamRes).filter((m) => m.role === 'CS_AGENT');
  const workloads: AgentWorkload[] = workloadsRes.ok
    ? (workloadsRes.data as { result?: { data?: AgentWorkload[] } })?.result?.data ?? []
    : [];
  const leaderboard: CSLeaderboardEntry[] = leaderboardRes.ok
    ? (leaderboardRes.data as { result?: { data?: CSLeaderboardEntry[] } })?.result?.data ?? []
    : [];
  const inactiveAgents: InactiveAgent[] = inactiveRes.ok
    ? (inactiveRes.data as { result?: { data?: InactiveAgent[] } })?.result?.data ?? []
    : [];

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

  const totalPending = workloads.reduce((sum, w) => sum + w.pendingCount, 0);
  const idleCount = inactiveAgents.length;

  // Client-side pagination — `users.listCSTeam` returns all members. With 20/page the loader
  // is the single source of truth for which slice is shown.
  const PAGE_SIZE = 20;
  const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
  const totalCount = teamMembers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pagedMembers = teamMembers.slice(start, start + PAGE_SIZE);

  return {
    teamMembers: pagedMembers,
    summary: {
      agentCount: list.length,
      totalPending,
      idleCount,
    },
    page,
    totalPages,
    totalCount,
    dateFilters: filters,
  };
}

export default function CSTeamRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <CSTeamPage
      teamMembers={data.teamMembers}
      summary={data.summary}
      page={data.page}
      totalPages={data.totalPages}
      dateFilters={data.dateFilters}
    />
  );
}
