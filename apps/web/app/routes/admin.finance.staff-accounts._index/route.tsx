import { useLoaderData, Await } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { UsersListPage } from '~/features/users/UsersListPage';
import { HRUsersListLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
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
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<HRUsersListLoadingShell staffAccounts />}>
      <Await resolve={pageData}>
        {(data) => (
          <UsersListPage
            {...data}
            usersBasePath="/admin/finance/staff-accounts"
            variant="staffAccounts"
          />
        )}
      </Await>
    </Suspense>
  );
}
