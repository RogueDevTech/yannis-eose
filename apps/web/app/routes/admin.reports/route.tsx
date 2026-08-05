import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { requireRole } from '~/lib/api.server';
import { ReportsCatalogPage } from '~/features/reports/ReportsCatalogPage';

export const meta: MetaFunction = () => [{ title: 'Reports — Yannis EOSE' }];

/** Admin-level roles that may access the centralized Reports module. */
const REPORTS_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'];

export async function loader({ request }: LoaderFunctionArgs) {
  // Server-side gate. SUPER_ADMIN / SUPPORT bypass inside requireRole; ADMIN
  // matches the allowlist. Anyone else is redirected to unauthorized.
  await requireRole(request, REPORTS_ROLES);
  return json({});
}

export default function ReportsCatalogRoute() {
  return <ReportsCatalogPage />;
}
