import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, redirectIfUnauthorized } from '~/lib/api.server';
import { MarketingTeamPage } from '~/features/marketing/MarketingTeamPage';
import type { FundingBalanceRow } from '~/features/marketing/types';

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

  const [balancesRes, summaryRes, leaderboardRes] = await Promise.all([
    apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify({ period: 'this_month' }))}`,
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

  return { teamMembers: teamMembersWithMetrics, fundingSummary };
}

export default function MarketingTeamRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketingTeamPage teamMembers={data.teamMembers} fundingSummary={data.fundingSummary} />;
}
