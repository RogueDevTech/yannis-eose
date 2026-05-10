import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { cachedClientLoader } from '~/lib/loader-cache';
import { UsersListPage } from '~/features/users/UsersListPage';
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

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function FinanceStaffAccountsRoute() {
  const { statusParam, roleParam, searchParam, usersPromise } = useLoaderData<typeof loader>();
  return (
    <UsersListPage
      statusParam={statusParam}
      roleParam={roleParam}
      searchParam={searchParam}
      usersPromise={usersPromise}
      usersBasePath="/admin/finance/staff-accounts"
      variant="staffAccounts"
    />
  );
}
