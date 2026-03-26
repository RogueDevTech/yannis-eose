import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, redirectIfUnauthorized, safeStatus } from '~/lib/api.server';
import { CSTeamPage } from '~/features/cs/CSTeamPage';
import type { CSTeamMemberOverview } from '~/features/cs/types';
import type { AgentWorkload, CSLeaderboardEntry, InactiveAgent } from '~/features/cs/types';

export const meta: MetaFunction = () => [
  { title: 'Team — Yannis EOSE' },
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
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'HEAD_OF_CS'],
    permission: 'cs.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  const [teamRes, workloadsRes, leaderboardRes, inactiveRes] = await Promise.all([
    apiRequest<unknown>('/trpc/users.listCSTeam', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/orders.csWorkloads', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify({ period: 'this_month' }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/orders.inactiveAgents?input=${encodeURIComponent(JSON.stringify({ thresholdMinutes: 10 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  redirectIfUnauthorized(teamRes, new URL(request.url).pathname);
  const list = parseCSTeamList(teamRes);
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

  // Role-based: only these roles can redistribute (permission-based checks only when decided otherwise)
  const canReassign = user.role === 'SUPER_ADMIN' || user.role === 'HEAD_OF_CS';

  return {
    teamMembers,
    summary: {
      agentCount: list.length,
      totalPending,
      idleCount,
    },
    canReassign,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'HEAD_OF_CS'],
    permission: 'cs.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Session cookie missing' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  if (intent !== 'redistribute') return json({ error: 'Unknown action' }, { status: 400 });

  const agentId = formData.get('agentId')?.toString() ?? '';
  if (!agentId) return json({ error: 'Agent ID required' }, { status: 400 });

  const res = await apiRequest<{ result?: { data?: { redistributed: number } } }>(
    '/trpc/orders.redistributeOrdersFromAgent',
    { method: 'POST', cookie, body: { agentId } },
  );

  if (!res.ok) {
    const errorData = res.data as { error?: { message?: string } };
    return json({ success: false, error: errorData?.error?.message ?? 'Redistribute failed' }, { status: safeStatus(res.status) });
  }

  const redistributed = res.data?.result?.data?.redistributed ?? 0;
  return json({ success: true, redistributed });
}

export default function CSTeamRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <CSTeamPage
      teamMembers={data.teamMembers}
      summary={data.summary}
      canReassign={data.canReassign}
    />
  );
}
