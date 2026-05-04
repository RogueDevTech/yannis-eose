import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, requireStaffAccountsAccess } from '~/lib/api.server';
import { UsersListPage } from '~/features/users/UsersListPage';
import { ListFilterPersistence } from '~/components/list-filter-persistence';
import { ALLOWLIST_USERS, LIST_FILTER_SCOPES } from '~/lib/list-filter-persistence-scopes';
import type { User } from '~/features/users/types';

export const meta: MetaFunction = () => [
  { title: 'Users — Yannis EOSE' },
];

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'users.create');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'resendInvite') {
    const userId = formData.get('userId') as string;
    if (!userId) return json({ error: 'Missing userId' }, { status: 400 });

    const res = await apiRequest('/trpc/users.resendInvite', {
      method: 'POST',
      cookie,
      // `apiRequest` calls `JSON.stringify(body)` internally — pass the object, not a string.
      body: { userId },
    });

    if (!res.ok) {
      const msg = (res.data as Record<string, unknown>)?.message ?? 'Failed to resend invite';
      return json({ error: msg, intent }, { status: 400 });
    }

    return json({ success: true, intent, message: 'Invite re-sent successfully' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireStaffAccountsAccess(request);
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status') || undefined;
  const roleParam = url.searchParams.get('role') || undefined;
  const pageParam = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const input: Record<string, unknown> = { page, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' };
  if (statusParam && statusParam !== 'ALL') input.status = statusParam;
  if (roleParam && roleParam !== 'ALL') input.role = roleParam;

  const inputEnc = encodeURIComponent(JSON.stringify(input));
  const res = await apiRequest<{ users: User[]; pagination: { total: number; page: number; limit: number; totalPages: number } }>(
    `/trpc/users.list?input=${inputEnc}`,
    {
      method: 'GET',
      cookie,
    },
  );

  if (!res.ok) {
    return {
      users: [] as User[],
      total: 0,
      page,
      limit: 20,
      totalPages: 0,
      statusParam: statusParam ?? 'ALL',
      roleParam: roleParam ?? 'ALL',
    };
  }

  const trpcData = res.data as unknown as {
    result?: { data?: { users: User[]; pagination: { total: number; page: number; limit: number; totalPages: number } } };
  };
  const data = trpcData?.result?.data;
  const pagination = data?.pagination;

  return {
    users: data?.users ?? [],
    total: pagination?.total ?? 0,
    page: pagination?.page ?? page,
    limit: pagination?.limit ?? 20,
    totalPages: pagination?.totalPages ?? 0,
    statusParam: statusParam ?? 'ALL',
    roleParam: roleParam ?? 'ALL',
  };
}

export default function UsersRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <>
      <ListFilterPersistence scope={LIST_FILTER_SCOPES.hrUsers} allowlist={ALLOWLIST_USERS} />
      <UsersListPage {...data} />
    </>
  );
}
