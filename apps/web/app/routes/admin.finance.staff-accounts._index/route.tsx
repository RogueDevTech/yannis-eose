import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { CachedAwait } from '~/components/ui/cached-await';
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
  const { usersShell, usersPromise } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={usersPromise}
      fallback={
        <UsersListPage
          usersPromise={usersPromise}
          statusParam={usersShell.statusParam}
          roleParam={usersShell.roleParam}
          searchParam={usersShell.searchParam}
          branchParam={usersShell.branchParam}
          canPickBranch={usersShell.canPickBranch}
          pageSize={usersShell.perPage}
          pageSizeOptions={usersShell.pageSizeOptions}
          canExport={usersShell.canExport}
          usersBasePath="/admin/finance/staff-accounts"
          variant="staffAccounts"
        />
      }
      loaderShell={{ usersShell }}
      deferredKey="usersPromise"
    >
      {(roster) => (
        <UsersListPage
          statusParam={usersShell.statusParam}
          roleParam={usersShell.roleParam}
          searchParam={usersShell.searchParam}
          branchParam={usersShell.branchParam}
          canPickBranch={usersShell.canPickBranch}
          usersPromise={roster}
          pageSize={usersShell.perPage}
          pageSizeOptions={usersShell.pageSizeOptions}
          canExport={usersShell.canExport}
          usersBasePath="/admin/finance/staff-accounts"
          variant="staffAccounts"
        />
      )}
    </CachedAwait>
  );
}
