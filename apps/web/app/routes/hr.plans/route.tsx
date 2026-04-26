import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { redirect } from '@remix-run/node';
import { CommissionPlansPage } from '~/features/hr/CommissionPlansPage';
import type { CommissionPlan } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Commission Plans — Yannis EOSE' }];

/**
 * Roles allowed on this page. Admins + HR Manager always; Heads of Department may manage their
 * own dept's plans (the service does the per-role guard, so this just gates entry).
 */
const PLANS_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: PLANS_VIEWER_ROLES, permission: 'hr.read' });
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');

  const res = await apiRequest<unknown>(
    `/trpc/hr.listPlans?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100, activeOnly: false }))}`,
    { method: 'GET', cookie },
  );
  const data = res.ok
    ? (res.data as {
        result?: {
          data?: {
            plans: CommissionPlan[];
            pagination: { total: number };
            manageableRoles: string[];
          };
        };
      })?.result?.data
    : null;

  return {
    plans: data?.plans ?? [],
    total: data?.pagination?.total ?? 0,
    manageableRoles: data?.manageableRoles ?? [],
    viewer: { id: user.id, role: user.role },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createPlan') {
    const rules: Record<string, number> = {};
    const baseSalary = formData.get('baseSalary')?.toString();
    const baseThreshold = formData.get('baseThreshold')?.toString();
    const perOrderRate = formData.get('perOrderRate')?.toString();
    const bonusPerExtraOrder = formData.get('bonusPerExtraOrder')?.toString();
    const penaltyPerReturn = formData.get('penaltyPerReturn')?.toString();
    const deliveryRateThreshold = formData.get('deliveryRateThreshold')?.toString();
    if (baseSalary) rules['baseSalary'] = Number(baseSalary);
    if (baseThreshold) rules['baseThreshold'] = Number(baseThreshold);
    if (perOrderRate) rules['perOrderRate'] = Number(perOrderRate);
    if (bonusPerExtraOrder) rules['bonusPerExtraOrder'] = Number(bonusPerExtraOrder);
    if (penaltyPerReturn) rules['penaltyPerReturn'] = Number(penaltyPerReturn);
    if (deliveryRateThreshold) rules['deliveryRateThreshold'] = Number(deliveryRateThreshold);

    const res = await apiRequest<unknown>('/trpc/hr.createPlan', {
      method: 'POST',
      cookie,
      body: {
        role: formData.get('role')?.toString() ?? '',
        planName: formData.get('planName')?.toString() ?? '',
        rules,
        effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().split('T')[0],
        effectiveTo: formData.get('effectiveTo')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to create plan';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PlansRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <CommissionPlansPage
      plans={data.plans}
      total={data.total}
      manageableRoles={data.manageableRoles}
      viewer={data.viewer}
    />
  );
}
