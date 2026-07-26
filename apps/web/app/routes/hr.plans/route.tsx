import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { requirePermissionOrRoles } from '~/lib/api.server';

export const meta: MetaFunction = () => [{ title: 'Commission Plans — Yannis EOSE' }];

const PLANS_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'HEAD_OF_CS',
  'HEAD_OF_LOGISTICS',
];

/** Legacy `/hr/plans` URL redirects to payroll config role library. */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: PLANS_VIEWER_ROLES, permission: 'hr.read' });
  throw redirect('/hr/payroll/config/roles');
}

export default function PlansRedirectRoute() {
  return null;
}
