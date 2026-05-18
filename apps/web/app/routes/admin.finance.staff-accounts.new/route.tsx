import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { cachedClientLoader } from '~/lib/loader-cache';
import { UserCreatePage } from '~/features/users/UserCreatePage';
import { loader as userCreateLoader, action as userCreateAction, meta as userCreateMeta } from '../hr.users.new/route';

export const meta: MetaFunction = userCreateMeta;

export async function loader(args: LoaderFunctionArgs) {
  return userCreateLoader(args);
}

export async function action(args: ActionFunctionArgs) {
  return userCreateAction(args);
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function FinanceStaffAccountsNewRoute() {
  const { picklistsPromise } = useLoaderData<typeof loader>();
  return (
    <UserCreatePage
      picklistsPromise={picklistsPromise}
      usersBasePath="/admin/finance/staff-accounts"
    />
  );
}
