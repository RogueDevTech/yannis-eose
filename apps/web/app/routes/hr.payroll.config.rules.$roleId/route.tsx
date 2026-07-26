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

export const meta: MetaFunction = ({ params }) => [
  { title: `${params.roleId === 'new' ? 'Create pay role' : 'Payroll formula'} — Yannis EOSE` },
];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER', 'HEAD_OF_CS'];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'payroll.config.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const roleId = params.roleId;
  if (!roleId) throw redirect('/hr/payroll/config/roles');

  const perms = user.permissions ?? [];
  const canWrite =
    perms.includes('payroll.config.write') ||
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'HR_MANAGER';

  // Create mode — no existing role to fetch
  if (roleId === 'new') {
    if (!canWrite) throw redirect('/hr/payroll/config/roles');
    return defer({ pageData: { payRole: null, plan: null, canWrite } });
  }

  const cookie = getSessionCookie(request);

  const [rolesRes, plansRes] = await Promise.all([
    apiRequest<unknown>('/trpc/hr.listPayRoles', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/hr.listPlans?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 200, activeOnly: false }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  const roles = rolesRes.ok
    ? (((rolesRes.data as { result?: { data?: PayRole[] } })?.result?.data) ?? [])
    : [];
  const payRole = roles.find((r) => r.id === roleId);
  if (!payRole) throw redirect('/hr/payroll/config/roles');

  const plansPayload = plansRes.ok
    ? (plansRes.data as { result?: { data?: { plans: CommissionPlan[] } } })?.result?.data
    : null;
  const plans = plansPayload?.plans ?? [];
  const plan = payRole.commissionPlanId
    ? plans.find((p) => p.id === payRole.commissionPlanId) ?? null
    : null;

  const pageData = { payRole, plan, canWrite };

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

  // ── Combined create: role metadata + formula in one submit ──
  if (intent === 'createPayRoleWithFormula') {
    const roleBody = {
      name: formData.get('name')?.toString() ?? '',
      category: formData.get('category')?.toString() ?? 'CS',
      reportsToRequired: formData.get('reportsToRequired') === 'true',
      perProductBonus: formData.get('perProductBonus') === 'true',
    };

    const createRes = await apiRequest<unknown>('/trpc/hr.createPayRole', {
      method: 'POST',
      cookie,
      body: roleBody,
    });
    if (!createRes.ok) {
      return json(
        { error: extractApiErrorMessage(createRes.data, 'Failed to create pay role') },
        { status: safeStatus(createRes.status) },
      );
    }

    const createdId = (createRes.data as { result?: { data?: { id?: string } } })?.result?.data?.id;
    if (!createdId) {
      return json({ error: 'Pay role created but ID not returned' }, { status: 500 });
    }

    // Save formula if tiers were configured
    const rulesSource = formData.get('rulesJsonOverride')?.toString()?.trim() || rulesJson;
    if (rulesSource) {
      let formula: Record<string, unknown> = {};
      try {
        formula = JSON.parse(rulesSource) as Record<string, unknown>;
      } catch {
        return json({ error: 'Invalid formula JSON' }, { status: 400 });
      }

      const formulaRes = await apiRequest<unknown>('/trpc/hr.saveFormulaConfig', {
        method: 'POST',
        cookie,
        body: {
          payRoleId: createdId,
          planName: formData.get('name')?.toString() ?? 'Formula',
          effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().slice(0, 10),
          formula,
        },
      });
      if (!formulaRes.ok) {
        // Role was created but formula save failed — redirect to edit so user can retry
        return redirect(`/hr/payroll/config/rules/${createdId}`);
      }
    }

    return redirect('/hr/payroll/config/roles');
  }

  if (intent === 'saveFormulaConfig') {
    // Also update role metadata if fields are present
    const name = formData.get('name')?.toString()?.trim();
    const category = formData.get('category')?.toString();
    if (name && category && payRoleId && payRoleId !== 'new') {
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
    return redirect('/hr/payroll/config/roles');
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
    const input = encodeURIComponent(
      JSON.stringify({
        formula,
        metrics: {
          individualDr: sampleDr,
          teamDr: sampleTeamDr,
          deliveredCount: 10,
          totalOrders: 20,
          returnedCount: 1,
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

  if (intent === 'createPlan') {
    const res = await apiRequest<unknown>('/trpc/hr.createPlan', {
      method: 'POST',
      cookie,
      body: {
        role: '',
        planName: formData.get('planName')?.toString() ?? 'Payroll formula',
        rules,
        effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().slice(0, 10),
      },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create plan') },
        { status: safeStatus(res.status) },
      );
    }
    const created = (res.data as { result?: { data?: { id: string } } })?.result?.data;
    const planId = created?.id;
    if (planId && payRoleId) {
      await apiRequest<unknown>('/trpc/hr.updatePayRole', {
        method: 'POST',
        cookie,
        body: { id: payRoleId, commissionPlanId: planId },
      });
    }
    return redirect('/hr/payroll/config/roles');
  }

  if (intent === 'updatePlan') {
    const body: Record<string, unknown> = {
      planId: formData.get('planId')?.toString() ?? '',
      rules,
    };
    const planName = formData.get('planName')?.toString();
    if (planName) body.planName = planName;

    const res = await apiRequest<unknown>('/trpc/hr.updatePlan', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update plan') },
        { status: safeStatus(res.status) },
      );
    }
    return redirect('/hr/payroll/config/roles');
  }

  if (intent === 'archivePayRole') {
    const body = { id: formData.get('payRoleId')?.toString() ?? payRoleId };
    const res = await apiRequest<unknown>('/trpc/hr.archivePayRole', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to archive pay role') },
        { status: safeStatus(res.status) },
      );
    }
    return redirect('/hr/payroll/config/roles');
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollRuleBuilderRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollRuleBuilderPage payRole={data.payRole} plan={data.plan} canWrite={data.canWrite} />
      )}
    </CachedAwait>
  );
}
