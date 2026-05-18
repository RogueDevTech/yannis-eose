import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requireStaffAccountsAccess,
} from '~/lib/api.server';
import { UsersImportPage } from '../../features/users/UsersImportPage';
import type { BranchInfo } from '../../features/users/users-import-shared';

export const meta: MetaFunction = () => [
  { title: 'Import users — Yannis EOSE' },
];

/**
 * Loader for `/hr/users/import` — dedicated page replacement for the old
 * `<UsersImportModal>`. Loads the active branch list up-front (the editor
 * needs it for code/name → id resolution on every keystroke), so the page
 * is ready to validate inline from the moment the operator drops a sheet.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireStaffAccountsAccess(request);
  const cookie = getSessionCookie(request);

  const branchesRes = await apiRequest<unknown>('/trpc/branches.list', {
    method: 'GET',
    cookie,
  });
  let branches: BranchInfo[] = [];
  if (branchesRes.ok) {
    const data = branchesRes.data as {
      result?: { data?: Array<{ id: string; code: string; name: string; status: string }> };
    };
    branches = (data?.result?.data ?? []).filter((b) => b.status === 'ACTIVE');
  }

  return json({ branches });
}

export default function UsersImportRoute() {
  const { branches } = useLoaderData<typeof loader>();
  return <UsersImportPage branches={branches} />;
}
