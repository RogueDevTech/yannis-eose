import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, redirectIfUnauthorized } from '~/lib/api.server';
import { CSTeamPage } from '~/features/cs/CSTeamPage';
import type { CSTeamMember } from '~/features/cs/CSTeamPage';

export const meta: MetaFunction = () => [
  { title: 'Team — Yannis EOSE' },
];

function parseCSTeamList(res: { ok: boolean; status: number; data: unknown }): CSTeamMember[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (raw && typeof raw === 'object' && 'error' in raw) return [];
  const data = (res.data as { result?: { data?: CSTeamMember[] } })?.result?.data;
  return Array.isArray(data) ? data : [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'HEAD_OF_CS'],
    permission: 'cs.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  const res = await apiRequest<unknown>('/trpc/users.listCSTeam', { method: 'GET', cookie });
  redirectIfUnauthorized(res, new URL(request.url).pathname);
  const teamMembers = parseCSTeamList(res);

  return { teamMembers };
}

export default function CSTeamRoute() {
  const data = useLoaderData<typeof loader>();
  return <CSTeamPage teamMembers={data.teamMembers} />;
}
