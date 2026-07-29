import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { PayrollRuleBuilderPage } from '~/features/hr/PayrollRuleBuilderPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { CommissionPlan } from '~/features/hr/types';
import type { PayRole } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Edit pay role formula — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER', 'HEAD_OF_CS'];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'payroll.config.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const roleId = params.roleId;
  if (!roleId || roleId === 'new') throw redirect('/hr/payroll/config/roles');

  const perms = user.permissions ?? [];
  const canWrite =
    perms.includes('payroll.config.write') ||
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'HR_MANAGER';
  if (!canWrite) throw redirect(`/hr/payroll/config/rules/${roleId}`);

  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const detailRes = await apiRequest<unknown>(
      `/trpc/hr.getPayRoleWithFormula?input=${encodeURIComponent(JSON.stringify({ payRoleId: roleId }))}`,
      { method: 'GET', cookie },
    );
    if (!detailRes.ok) throw redirect('/hr/payroll/config/roles');
    const detail = (detailRes.data as {
      result?: { data?: { payRole: PayRole; plan: CommissionPlan | null } };
    })?.result?.data;
    if (!detail?.payRole) throw redirect('/hr/payroll/config/roles');
    return { payRole: detail.payRole, plan: detail.plan ?? null, canWrite };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const payRoleId = formData.get('payRoleId')?.toString() ?? params.roleId ?? '';

  const rulesJson = formData.get('rulesJson')?.toString()?.trim();
  let rules: Record<string, unknown> = {};
  if (rulesJson) {
    try {
      const parsed: unknown = JSON.parse(rulesJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rules = parsed as Record<string, unknown>;
      } else {
        return json({ error: 'Rules must be a JSON object' }, { status: 400 });
      }
    } catch {
      return json({ error: 'Invalid rules JSON' }, { status: 400 });
    }
  }

  if (intent === 'saveFormulaConfig') {
    const name = formData.get('name')?.toString()?.trim();
    const category = formData.get('category')?.toString();
    if (name && category && payRoleId) {
      const updateBody = {
        id: payRoleId,
        name,
        category,
        reportsToRequired: formData.get('reportsToRequired') === 'true',
        perProductBonus: formData.get('perProductBonus') === 'true',
      };
      const updateRes = await apiRequest<unknown>('/trpc/hr.updatePayRole', {
        method: 'POST',
        cookie,
        body: updateBody,
      });
      if (!updateRes.ok) {
        return json(
          { error: extractApiErrorMessage(updateRes.data, 'Failed to update pay role') },
          { status: safeStatus(updateRes.status) },
        );
      }
    }

    const rulesSource = formData.get('rulesJsonOverride')?.toString()?.trim() || rulesJson;
    let formula: Record<string, unknown> = rules;
    if (rulesSource) {
      try {
        formula = JSON.parse(rulesSource) as Record<string, unknown>;
      } catch {
        return json({ error: 'Invalid formula JSON' }, { status: 400 });
      }
    }
    const res = await apiRequest<unknown>('/trpc/hr.saveFormulaConfig', {
      method: 'POST',
      cookie,
      body: {
        payRoleId,
        planName: formData.get('planName')?.toString(),
        effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().slice(0, 10),
        formula,
      },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save formula') },
        { status: safeStatus(res.status) },
      );
    }
    return redirect(`/hr/payroll/config/rules/${payRoleId}`);
  }

  if (intent === 'previewFormula') {
    const formulaJson = formData.get('formulaJson')?.toString() ?? '{}';
    let formula: Record<string, unknown> = {};
    try {
      formula = JSON.parse(formulaJson) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid formula JSON' }, { status: 400 });
    }
    const sampleDr = Number(formData.get('sampleDr') ?? 0);
    const sampleTeamDr = Number(formData.get('sampleTeamDr') ?? 0);
    const sampleCpa = Number(formData.get('sampleCpa') ?? 0);
    const sampleDeliveredCount = Number(formData.get('sampleDeliveredCount') ?? 10);
    const sampleReturnedCount = Number(formData.get('sampleReturnedCount') ?? 0);
    const sampleTargetMet = formData.get('sampleTargetMet')?.toString() === 'true';
    const delivered = Number.isFinite(sampleDeliveredCount) ? Math.max(0, Math.floor(sampleDeliveredCount)) : 10;
    const returned = Number.isFinite(sampleReturnedCount) ? Math.max(0, Math.floor(sampleReturnedCount)) : 0;
    const input = encodeURIComponent(
      JSON.stringify({
        formula,
        metrics: {
          individualDr: sampleDr,
          teamDr: sampleTeamDr,
          cpa: sampleCpa,
          deliveredCount: delivered,
          totalOrders: Math.max(delivered + returned, delivered || 1),
          returnedCount: returned,
          targetMet: sampleTargetMet,
        },
      }),
    );
    const res = await apiRequest<unknown>(`/trpc/hr.previewPayrollFormula?input=${input}`, {
      method: 'GET',
      cookie,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Preview failed') },
        { status: safeStatus(res.status) },
      );
    }
    const preview = (res.data as { result?: { data?: unknown } })?.result?.data;
    return json({ preview });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollPayRoleEditRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollRuleBuilderPage payRole={data.payRole} plan={data.plan} canWrite={data.canWrite} />
      )}
    </CachedAwait>
  );
}
