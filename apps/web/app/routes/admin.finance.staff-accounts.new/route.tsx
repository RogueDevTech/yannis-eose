import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { UserCreatePage } from '~/features/users/UserCreatePage';
import type { UserCreateLoaderData } from '~/features/users/types';
import { loader as userCreateLoader, action as userCreateAction, meta as userCreateMeta } from '../hr.users.new/route';

export const meta: MetaFunction = userCreateMeta;

export async function loader(args: LoaderFunctionArgs) {
  return userCreateLoader(args);
}

export async function action(args: ActionFunctionArgs) {
  return userCreateAction(args);
}

export default function FinanceStaffAccountsNewRoute() {
  const data = useLoaderData<typeof loader>() as UserCreateLoaderData;
  return <UserCreatePage {...data} usersBasePath="/admin/finance/staff-accounts" />;
}
