import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
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

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function FinanceStaffAccountsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<HRUsersListLoadingShell staffAccounts />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
        <UsersListPage
          {...data}
          usersBasePath="/admin/finance/staff-accounts"
          variant="staffAccounts"
        />
      )}
    </CachedAwait>
  );
}
