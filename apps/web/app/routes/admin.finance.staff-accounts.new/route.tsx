import { useLoaderData, Await } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { UserCreatePage } from '~/features/users/UserCreatePage';
import type { UserCreateLoaderData } from '~/features/users/types';
import { UserCreateEditLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import { loader as userCreateLoader, action as userCreateAction, meta as userCreateMeta } from '../hr.users.new/route';

export const meta: MetaFunction = userCreateMeta;

export async function loader(args: LoaderFunctionArgs) {
  return userCreateLoader(args);
}

export async function action(args: ActionFunctionArgs) {
  return userCreateAction(args);
}

export default function FinanceStaffAccountsNewRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<UserCreateEditLoadingShell mode="create" />}>
      <Await resolve={pageData}>
        {(data) => (
          <UserCreatePage {...(data as UserCreateLoaderData)} usersBasePath="/admin/finance/staff-accounts" />
        )}
      </Await>
    </Suspense>
  );
}
