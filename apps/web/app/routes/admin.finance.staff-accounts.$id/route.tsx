import { useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import type { UserDetailLoaderData } from '~/features/users/types';
import {
  loader as userDetailLoader,
  action as userDetailAction,
  meta as userDetailMeta,
  UserDetailPageWithMirror,
} from '../hr.users.$id._index/route';
import { UserDetailShellSkeleton } from '~/features/users/UserDetailShellSkeleton';

export const meta: MetaFunction = userDetailMeta;

export async function loader(args: LoaderFunctionArgs) {
  return userDetailLoader(args);
}

export async function action(args: ActionFunctionArgs) {
  return userDetailAction(args);
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function FinanceStaffAccountsDetailRoute() {
  const { userDetail } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={userDetail}
      fallback={<UserDetailShellSkeleton />}
      loaderShell={{}}
      deferredKey="userDetail"
    >
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
          <UserDetailPageWithMirror
            data={data as UserDetailLoaderData}
            usersBasePath="/admin/finance/staff-accounts"
          />
        )
      }
    </CachedAwait>
  );
}
