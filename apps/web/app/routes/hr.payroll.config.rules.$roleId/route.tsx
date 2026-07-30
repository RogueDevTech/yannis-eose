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
import {
  PayrollPayRoleViewPage,
  type AssignedContractorRow,
  type AssignedStaffRow,
} from '~/features/hr/PayrollPayRoleViewPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { CommissionPlan } from '~/features/hr/types';
import type { PayRole } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = ({ params }) => [
  { title: `${params.roleId === 'new' ? 'Create pay role' : 'Pay role rules'} — Yannis EOSE` },
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
    return defer({
      pageData: {
        mode: 'create' as const,
        payRole: null,
        plan: null,
        assignedStaff: [],
        assignedContractors: [],
        canWrite,
      },
    });
  }

  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const detailRes = await apiRequest<unknown>(
      `/trpc/hr.getPayRoleWithFormula?input=${encodeURIComponent(JSON.stringify({ payRoleId: roleId }))}`,
      { method: 'GET', cookie },
    );
    if (!detailRes.ok) {
      throw redirect('/hr/payroll/config/roles');
    }
    const detail = (detailRes.data as {
      result?: {
        data?: {
          payRole: PayRole;
          plan: CommissionPlan | null;
          assignedStaff?: AssignedStaffRow[];
          assignedContractors?: AssignedContractorRow[];
        };
      };
    })?.result?.data;
    if (!detail?.payRole) throw redirect('/hr/payroll/config/roles');

    return {
      mode: 'view' as const,
      payRole: detail.payRole,
      plan: detail.plan ?? null,
      assignedStaff: detail.assignedStaff ?? [],
      assignedContractors: detail.assignedContractors ?? [],
      canWrite,
    };
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

  // ── Combined create: role metadata + formula in one submit ──
  if (intent === 'createPayRoleWithFormula') {
    const roleBody = {
      name: formData.get('name')?.toString() ?? '',
      category: formData.get('category')?.toString() ?? 'CS',
      reportsToRequired: formData.get('reportsToRequired') === 'true',
      perProductBonus: formData.get('perProductBonus') === 'true',
      defaultTaxStatus: formData.get('defaultTaxStatus')?.toString() ?? 'STANDARD_PAYE',
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
        return redirect(`/hr/payroll/config/rules/${createdId}/edit`);
      }
    }

    return redirect(`/hr/payroll/config/rules/${createdId}`);
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

export default function PayrollPayRoleRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) =>
        data.mode === 'create' || !data.payRole ? (
          <PayrollRuleBuilderPage payRole={null} plan={null} canWrite={data.canWrite} />
        ) : (
          <PayrollPayRoleViewPage
            payRole={data.payRole}
            plan={data.plan}
            assignedStaff={data.assignedStaff ?? []}
            assignedContractors={data.assignedContractors ?? []}
            canWrite={data.canWrite}
          />
        )
      }
    </CachedAwait>
  );
}
