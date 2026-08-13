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
import { PayrollConfigTaxBandsPage } from '~/features/hr/PayrollConfigTaxBandsPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayePreviewResult, TaxBandConfig } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'PAYE tax bands — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'payroll.config.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const res = await apiRequest<unknown>('/trpc/hr.listTaxBandConfigs', { method: 'GET', cookie });
    const configs = res.ok
      ? (((res.data as { result?: { data?: TaxBandConfig[] } })?.result?.data) ?? [])
      : [];
    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('payroll.config.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';
    return { configs, canWrite };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'previewPaye') {
    const monthlyGross = Number(formData.get('monthlyGross')?.toString() ?? '0');
    const taxStatus = formData.get('taxStatus')?.toString() ?? 'STANDARD_PAYE';
    const subsidyRaw = formData.get('employerSubsidyPercent')?.toString()?.trim();
    const annualRentRaw = formData.get('annualRent')?.toString()?.trim();
    const body: Record<string, unknown> = { monthlyGross, taxStatus };
    if (subsidyRaw) body.employerSubsidyPercent = Number(subsidyRaw);
    if (annualRentRaw) body.annualRent = Number(annualRentRaw);

    const inputEnc = encodeURIComponent(JSON.stringify(body));
    const res = await apiRequest<unknown>(`/trpc/hr.previewPaye?input=${inputEnc}`, { method: 'GET', cookie });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to preview PAYE') },
        { status: safeStatus(res.status) },
      );
    }
    const preview = (res.data as { result?: { data?: PayePreviewResult } })?.result?.data;
    return json({ preview });
  }

  if (intent === 'saveTaxBandConfig') {
    const bandsJson = formData.get('bandsJson')?.toString()?.trim();
    const reliefsJson = formData.get('reliefsJson')?.toString()?.trim();
    const statutoryDeductionsJson = formData.get('statutoryDeductionsJson')?.toString()?.trim();
    let bands: unknown[] = [];
    let reliefs: unknown[] = [];
    let statutoryDeductions: unknown[] = [];
    try {
      if (bandsJson) {
        const parsed: unknown = JSON.parse(bandsJson);
        if (Array.isArray(parsed)) bands = parsed;
      }
      if (reliefsJson) {
        const parsed: unknown = JSON.parse(reliefsJson);
        if (Array.isArray(parsed)) reliefs = parsed;
      }
      if (statutoryDeductionsJson) {
        const parsed: unknown = JSON.parse(statutoryDeductionsJson);
        if (Array.isArray(parsed)) statutoryDeductions = parsed;
      }
    } catch {
      return json({ error: 'Invalid bands, reliefs, or statutory deductions JSON' }, { status: 400 });
    }

    const lowIncomeExemptionRaw = formData.get('lowIncomeExemptionMonthly')?.toString()?.trim();
    const lowIncomeExemptionMonthly =
      lowIncomeExemptionRaw != null && lowIncomeExemptionRaw !== ''
        ? Number(lowIncomeExemptionRaw)
        : 66667;

    const configId = formData.get('configId')?.toString();
    const body: Record<string, unknown> = {
      label: formData.get('label')?.toString() ?? 'Default PAYE',
      taxFreeThreshold: Number(formData.get('taxFreeThreshold')?.toString() ?? '800000'),
      bands,
      reliefs,
      statutoryDeductions,
      lowIncomeExemptionMonthly,
      effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().slice(0, 10),
    };
    if (configId) body.id = configId;

    const res = await apiRequest<unknown>('/trpc/hr.saveTaxBandConfig', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save tax band config') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'deleteTaxBandConfig') {
    const configId = formData.get('configId')?.toString();
    if (!configId) {
      return json({ error: 'Tax band config id is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/hr.deleteTaxBandConfig', {
      method: 'POST',
      cookie,
      body: { id: configId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to delete tax band config') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Tax band config deleted' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollConfigTaxBandsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <PayrollConfigTaxBandsPage configs={data.configs} canWrite={data.canWrite} />}
    </CachedAwait>
  );
}
