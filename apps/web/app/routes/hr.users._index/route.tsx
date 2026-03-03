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

  const input = encodeURIComponent(JSON.stringify({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }));
  const res = await apiRequest<{ users: User[]; pagination: { total: number; page: number; totalPages: number } }>(
    `/trpc/users.list?input=${input}`,
    {
      method: 'GET',
      cookie,
    },
  );

  if (!res.ok) {
    return { users: [] as User[], total: 0 };
  }

  const trpcData = res.data as unknown as { result?: { data?: { users: User[]; pagination: { total: number } } } };
  const data = trpcData?.result?.data;

  return {
    users: data?.users ?? [],
    total: data?.pagination?.total ?? 0,
  };
}

export default function UsersRoute() {
  const data = useLoaderData<typeof loader>();
  return <UsersListPage {...data} />;
}
