import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { DeferredSection } from '~/components/ui/deferred-section';
import { UserDetailPage } from '~/features/users/UserDetailPage';
import type { UserDetailLoaderData } from '~/features/users/types';
import { loader as userDetailLoader, action as userDetailAction, meta as userDetailMeta } from '../hr.users.$id/route';

export const meta: MetaFunction = userDetailMeta;

export async function loader(args: LoaderFunctionArgs) {
  return userDetailLoader(args);
}

export async function action(args: ActionFunctionArgs) {
  return userDetailAction(args);
}

export default function FinanceStaffAccountsDetailRoute() {
  const { userDetail } = useLoaderData<typeof loader>();
  return (
    <DeferredSection resolve={userDetail} skeleton="card">
      {(data) =>
        'notFound' in data && data.notFound ? (
          <div className="card text-center py-12">
            <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
            <h2 className="text-xl font-bold text-app-fg">User not found</h2>
            <p className="mt-2 text-sm text-app-fg-muted">
              The user you&apos;re looking for doesn&apos;t exist or has been removed.
            </p>
            <a href="/admin/finance/staff-accounts" className="btn-primary mt-4 inline-block">
              Back to Staff Accounts
            </a>
          </div>
        ) : (
          <UserDetailPage
            {...(data as UserDetailLoaderData)}
            usersBasePath="/admin/finance/staff-accounts"
          />
        )
      }
    </DeferredSection>
  );
}
