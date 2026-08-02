import { useState } from 'react';
import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
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
import { PayrollConfigRolesPage } from '~/features/hr/PayrollConfigRolesPage';
import { PayrollConfigProductsPage } from '~/features/hr/PayrollConfigProductsPage';
import { PayrollConfigTaxBandsPage } from '~/features/hr/PayrollConfigTaxBandsPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import { Tabs } from '~/components/ui/tabs';
import type { PayRole, ProductTierConfig, TaxBandConfig, PayePreviewResult } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Payroll Config — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER', 'HEAD_OF_CS'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'payroll.config.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const [rolesRes, productTiersRes, taxBandsRes, productsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/hr.listPayRoles', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/hr.listProductTierConfigs', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/hr.listTaxBandConfigs', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/products.options', { method: 'GET', cookie }),
    ]);

    const roles = rolesRes.ok
      ? (((rolesRes.data as { result?: { data?: PayRole[] } })?.result?.data) ?? [])
      : [];
    const productTierConfigs = productTiersRes.ok
      ? (((productTiersRes.data as { result?: { data?: ProductTierConfig[] } })?.result?.data) ?? [])
      : [];
    const taxBandConfigs = taxBandsRes.ok
      ? (((taxBandsRes.data as { result?: { data?: TaxBandConfig[] } })?.result?.data) ?? [])
      : [];
    const products: Array<{ id: string; name: string }> = productsRes.ok
      ? (((productsRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data) ?? [])
      : [];

    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('payroll.config.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';

    return { roles, productTierConfigs, taxBandConfigs, products, canWrite };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  // ── Pay Roles ──
  if (intent === 'archivePayRole') {
    const body = { id: formData.get('payRoleId')?.toString() ?? '' };
    const res = await apiRequest<unknown>('/trpc/hr.archivePayRole', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to archive pay role') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  // ── Product Tiers ──
  if (intent === 'saveProductTierConfig') {
    const tierRowsJson = formData.get('tierRowsJson')?.toString()?.trim();
    let tierRows: unknown[] = [];
    if (tierRowsJson) {
      try {
        const parsed: unknown = JSON.parse(tierRowsJson);
        if (Array.isArray(parsed)) tierRows = parsed;
      } catch {
        return json({ error: 'Invalid tier rows JSON' }, { status: 400 });
      }
    }
    if (!tierRows.length) {
      return json({ error: 'At least one tier row is required' }, { status: 400 });
    }
    const configId = formData.get('configId')?.toString();
    const body: Record<string, unknown> = {
      productId: formData.get('productId')?.toString() || undefined,
      productName: formData.get('productName')?.toString() ?? '',
      active: true,
      tierRows,
      effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().slice(0, 10),
    };
    if (configId) body.id = configId;
    const res = await apiRequest<unknown>('/trpc/hr.saveProductTierConfig', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to save product tier config') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'deleteProductTierConfig') {
    const configId = formData.get('configId')?.toString();
    if (!configId) {
      return json({ error: 'Product tier config id is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/hr.deleteProductTierConfig', {
      method: 'POST',
      cookie,
      body: { id: configId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to delete product tier config') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Product tier config deleted' });
  }

  // ── Tax Bands ──
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
      return json({ error: extractApiErrorMessage(res.data, 'Failed to preview PAYE') }, { status: safeStatus(res.status) });
    }
    const preview = (res.data as { result?: { data?: PayePreviewResult } })?.result?.data;
    return json({ preview });
  }

  if (intent === 'saveTaxBandConfig') {
    const bandsJson = formData.get('bandsJson')?.toString()?.trim();
    const reliefsJson = formData.get('reliefsJson')?.toString()?.trim();
    let bands: unknown[] = [];
    let reliefs: unknown[] = [];
    try {
      if (bandsJson) { const p: unknown = JSON.parse(bandsJson); if (Array.isArray(p)) bands = p; }
      if (reliefsJson) { const p: unknown = JSON.parse(reliefsJson); if (Array.isArray(p)) reliefs = p; }
    } catch {
      return json({ error: 'Invalid bands or reliefs JSON' }, { status: 400 });
    }
    const configId = formData.get('configId')?.toString();
    const body: Record<string, unknown> = {
      label: formData.get('label')?.toString() ?? 'Default PAYE',
      taxFreeThreshold: Number(formData.get('taxFreeThreshold')?.toString() ?? '800000'),
      bands,
      reliefs,
      effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().slice(0, 10),
    };
    if (configId) body.id = configId;
    const res = await apiRequest<unknown>('/trpc/hr.saveTaxBandConfig', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to save tax band config') }, { status: safeStatus(res.status) });
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

function PayrollConfigTabbedPage({
  roles,
  productTierConfigs,
  taxBandConfigs,
  products,
  canWrite,
}: {
  roles: PayRole[];
  productTierConfigs: ProductTierConfig[];
  taxBandConfigs: TaxBandConfig[];
  products: Array<{ id: string; name: string }>;
  canWrite: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // 'products' tab removed with per-product bonus; legacy links fall back to roles.
  const tab = tabParam === 'tax' || tabParam === 'roles' ? tabParam : 'roles';
  const [createTarget, setCreateTarget] = useState<'tax' | null>(null);

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'roles') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const tabsBar = (
    <Tabs
      value={tab}
      onChange={setTab}
      tabs={[
        { value: 'roles', label: `Pay roles (${roles.length})` },
        { value: 'tax', label: `Tax bands (${taxBandConfigs.length})` },
      ]}
    />
  );

  const headerAction = canWrite ? (
    tab === 'tax' ? (
      <Button variant="primary" size="sm" onClick={() => setCreateTarget('tax')}>
        + Tax band
      </Button>
    ) : null
  ) : null;

  return (
    <PayrollConfigRolesPage
      roles={roles}
      canWrite={canWrite}
      hideRolesContent={tab !== 'roles'}
      headerAction={headerAction}
      tabsSlot={
        <>
          {tabsBar}
          {tab === 'tax' && <PayrollConfigTaxBandsPage configs={taxBandConfigs} canWrite={canWrite} createOpen={createTarget === 'tax'} onCreateClose={() => setCreateTarget(null)} />}
        </>
      }
    />
  );
}

export default function PayrollConfigRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollConfigTabbedPage
          roles={data.roles ?? []}
          productTierConfigs={data.productTierConfigs ?? []}
          taxBandConfigs={data.taxBandConfigs ?? []}
          products={data.products ?? []}
          canWrite={data.canWrite}
        />
      )}
    </CachedAwait>
  );
}
