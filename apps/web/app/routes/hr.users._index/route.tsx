import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { UsersListPage } from '~/features/users/UsersListPage';
import type { User } from '~/features/users/types';

export const meta: MetaFunction = () => [
  { title: 'Users — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'users.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status') || undefined;
  const roleParam = url.searchParams.get('role') || undefined;
  const input: Record<string, unknown> = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' };
  if (statusParam && statusParam !== 'ALL') input.status = statusParam;
  if (roleParam && roleParam !== 'ALL') input.role = roleParam;

  const inputEnc = encodeURIComponent(JSON.stringify(input));
  const res = await apiRequest<{ users: User[]; pagination: { total: number; page: number; totalPages: number } }>(
    `/trpc/users.list?input=${inputEnc}`,
    {
      method: 'GET',
      cookie,
    },
  );

  if (!res.ok) {
    return { users: [] as User[], total: 0, statusParam: statusParam ?? 'ALL', roleParam: roleParam ?? 'ALL' };
  }

  const trpcData = res.data as unknown as { result?: { data?: { users: User[]; pagination: { total: number } } } };
  const data = trpcData?.result?.data;

  return {
    users: data?.users ?? [],
    total: data?.pagination?.total ?? 0,
    statusParam: statusParam ?? 'ALL',
    roleParam: roleParam ?? 'ALL',
  };
}

export default function UsersRoute() {
  const data = useLoaderData<typeof loader>();
  return <UsersListPage {...data} />;
}
