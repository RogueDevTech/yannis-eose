import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { UsersListPage } from '~/features/users/UsersListPage';
import { ListFilterPersistence } from '~/components/list-filter-persistence';
import { ALLOWLIST_USERS, LIST_FILTER_SCOPES } from '~/lib/list-filter-persistence-scopes';
import { loader as usersLoader, action as usersAction } from '../hr.users._index/route';

export const meta: MetaFunction = () => [
  { title: 'Staff accounts — Yannis EOSE' },
];

export async function loader(args: LoaderFunctionArgs) {
  return usersLoader(args);
}

export async function action(args: ActionFunctionArgs) {
  return usersAction(args);
}

export default function FinanceStaffAccountsRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <>
      <ListFilterPersistence scope={LIST_FILTER_SCOPES.adminStaffAccounts} allowlist={ALLOWLIST_USERS} />
    <UsersListPage
      {...data}
      usersBasePath="/admin/finance/staff-accounts"
      variant="staffAccounts"
    />
    </>
  );
}
