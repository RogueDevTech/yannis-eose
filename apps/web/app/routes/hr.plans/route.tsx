import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { CommissionPlansPage } from '~/features/hr/CommissionPlansPage';
import { CommissionPlansLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { CommissionPlan } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Commission Plans — Yannis EOSE' }];

/**
 * Roles allowed on this page. Admins + HR Manager always; HEAD_OF_CS and
 * HEAD_OF_LOGISTICS may still manage their own dept's plans (per the original
 * 2026-04-26 directive). HEAD_OF_MARKETING was removed per follow-up CEO
 * directive — Marketing commission plans are managed by HR / admin only.
 * The service still does the per-role guard via getManageableRolesForViewer,
 * so this allowlist just gates entry.
 */
const PLANS_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'HEAD_OF_CS',
  'HEAD_OF_LOGISTICS',
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: PLANS_VIEWER_ROLES, permission: 'hr.read' });
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');

  const pageData = (async () => {
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
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createPlan') {
    const rules: Record<string, unknown> = {};
    const baseSalary = formData.get('baseSalary')?.toString();
    const baseThreshold = formData.get('baseThreshold')?.toString();
    const perOrderRate = formData.get('perOrderRate')?.toString();
    const bonusPerExtraOrder = formData.get('bonusPerExtraOrder')?.toString();
    const penaltyPerReturn = formData.get('penaltyPerReturn')?.toString();
    const deliveryRateThreshold = formData.get('deliveryRateThreshold')?.toString();
    const deliveryRateBonusMultiplier = formData.get('deliveryRateBonusMultiplier')?.toString();
    const minPerformanceBonus = formData.get('minPerformanceBonus')?.toString();
    const maxPerformanceBonus = formData.get('maxPerformanceBonus')?.toString();
    const orderRateTiersJson = formData.get('orderRateTiersJson')?.toString()?.trim();

    if (baseSalary) rules['baseSalary'] = Number(baseSalary);
    if (baseThreshold) rules['baseThreshold'] = Number(baseThreshold);
    if (perOrderRate) rules['perOrderRate'] = Number(perOrderRate);
    if (bonusPerExtraOrder) rules['bonusPerExtraOrder'] = Number(bonusPerExtraOrder);
    if (penaltyPerReturn) rules['penaltyPerReturn'] = Number(penaltyPerReturn);
    if (deliveryRateThreshold) rules['deliveryRateThreshold'] = Number(deliveryRateThreshold);
    if (deliveryRateBonusMultiplier)
      rules['deliveryRateBonusMultiplier'] = Number(deliveryRateBonusMultiplier);
    if (minPerformanceBonus) rules['minPerformanceBonus'] = Number(minPerformanceBonus);
    if (maxPerformanceBonus) rules['maxPerformanceBonus'] = Number(maxPerformanceBonus);
    if (orderRateTiersJson) {
      try {
        const parsedUnknown: unknown = JSON.parse(orderRateTiersJson);
        if (Array.isArray(parsedUnknown) && parsedUnknown.length > 0) {
          rules['orderRateTiers'] = parsedUnknown;
        }
      } catch {
        // malformed JSON — omit; server rejects if partial body is invalid
      }
    }

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
      const err = extractApiErrorMessage(res.data, 'Failed to create plan');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updatePlan') {
    // Optional rules — only include keys the user typed something into. Unset fields stay as-is
    // server-side because we send the rules object only when at least one key is present.
    const rules: Record<string, unknown> = {};
    const fields = [
      'baseSalary',
      'baseThreshold',
      'perOrderRate',
      'bonusPerExtraOrder',
      'penaltyPerReturn',
      'deliveryRateThreshold',
      'deliveryRateBonusMultiplier',
      'minPerformanceBonus',
      'maxPerformanceBonus',
    ] as const;
    for (const f of fields) {
      const v = formData.get(f)?.toString();
      if (v !== undefined && v !== '') rules[f] = Number(v);
    }

    const orderRateTiersJson = formData.get('orderRateTiersJson')?.toString()?.trim();
    if (orderRateTiersJson) {
      try {
        const parsedUnknown: unknown = JSON.parse(orderRateTiersJson);
        if (Array.isArray(parsedUnknown)) {
          rules['orderRateTiers'] = parsedUnknown;
        }
      } catch {
        // ignore malformed
      }
    }

    const body: Record<string, unknown> = { planId: formData.get('planId')?.toString() ?? '' };
    const planName = formData.get('planName')?.toString();
    const effectiveTo = formData.get('effectiveTo')?.toString();
    if (planName) body['planName'] = planName;
    if (Object.keys(rules).length) body['rules'] = rules;
    if (effectiveTo) body['effectiveTo'] = effectiveTo;

    const res = await apiRequest<unknown>('/trpc/hr.updatePlan', { method: 'POST', cookie, body });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to update plan');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PlansRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<CommissionPlansLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
          <CommissionPlansPage
            plans={data.plans}
            total={data.total}
            manageableRoles={data.manageableRoles}
            viewer={data.viewer}
          />
        )}
    </CachedAwait>
  );
}
