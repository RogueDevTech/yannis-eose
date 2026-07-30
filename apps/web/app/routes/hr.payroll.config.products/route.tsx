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
import { PayrollConfigProductsPage } from '~/features/hr/PayrollConfigProductsPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { ProductTierConfig } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Product tier configs — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER', 'HEAD_OF_CS'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const [res, productsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/hr.listProductTierConfigs', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/products.options', { method: 'GET', cookie }),
    ]);
    const configs = res.ok
      ? (((res.data as { result?: { data?: ProductTierConfig[] } })?.result?.data) ?? [])
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
    return { configs, products, canWrite };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

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

    const res = await apiRequest<unknown>('/trpc/hr.saveProductTierConfig', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save product tier config') },
        { status: safeStatus(res.status) },
      );
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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollConfigProductsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <PayrollConfigProductsPage configs={data.configs} products={data.products} canWrite={data.canWrite} />}
    </CachedAwait>
  );
}
