import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
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

export default function FinanceStaffAccountsRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <UsersListPage
      {...data}
      usersBasePath="/admin/finance/staff-accounts"
      variant="staffAccounts"
    />
  );
}
