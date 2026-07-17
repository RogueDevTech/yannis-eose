import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requireAccountingEnabled, requirePermissionOrRoles, parsePerPage } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { AssetRegisterPage, type AssetRow } from '~/features/finance/AssetRegisterPage';

export const meta: MetaFunction = () => [{ title: 'Asset Register — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface ListResponse {
  records: AssetRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  summary: {
    totalAssets: number;
    totalCost: string;
    totalAccumulatedDepreciation: string;
    totalNbv: string;
  };
}

const EMPTY: ListResponse = {
  records: [],
  pagination: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
  summary: {
    totalAssets: 0,
    totalCost: '0',
    totalAccumulatedDepreciation: '0',
    totalNbv: '0',
  },
};

export async function loader({ request }: LoaderFunctionArgs) {
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 50 });
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;

  const shell = { canWrite: true };

  const pageData = (async () => {
    const input = encodeURIComponent(
      JSON.stringify({
        page,
        limit: perPage,
        ...(status && { status }),
        ...(search && { search }),
      }),
    );
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.listAssets?input=${input}`,
      { method: 'GET', cookie },
    );
    const data: ListResponse = res.ok
      ? ((res.data as { result?: { data?: ListResponse } })?.result?.data ?? EMPTY)
      : EMPTY;
    return data;
  })();

  return defer({ shell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  requireAccountingEnabled();
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createAsset') {
    const res = await apiRequest<unknown>('/trpc/generalLedger.createAsset', {
      method: 'POST',
      cookie,
      body: {
        assetName: formData.get('assetName')?.toString() ?? '',
        assetCategory: formData.get('assetCategory')?.toString() ?? '',
        acquisitionDate: formData.get('acquisitionDate')?.toString() ?? '',
        cost: formData.get('cost')?.toString() ?? '0',
        residualValue: formData.get('residualValue')?.toString() ?? '0',
        depreciationMethod: formData.get('depreciationMethod')?.toString() ?? 'STRAIGHT_LINE',
        usefulLifeMonths: formData.get('usefulLifeMonths')
          ? parseInt(formData.get('usefulLifeMonths')!.toString(), 10)
          : undefined,
        depreciationRate: formData.get('depreciationRate')
          ? parseFloat(formData.get('depreciationRate')!.toString())
          : undefined,
        location: formData.get('location')?.toString() || undefined,
        serialNumber: formData.get('serialNumber')?.toString() || undefined,
        notes: formData.get('notes')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create asset') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'disposeAsset') {
    const res = await apiRequest<unknown>('/trpc/generalLedger.disposeAsset', {
      method: 'POST',
      cookie,
      body: {
        assetId: formData.get('assetId')?.toString() ?? '',
        disposalDate: formData.get('disposalDate')?.toString() ?? '',
        proceeds: formData.get('proceeds')?.toString() ?? '0',
        reason: formData.get('reason')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to dispose asset') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'runDepreciation') {
    const res = await apiRequest<unknown>('/trpc/generalLedger.runDepreciation', {
      method: 'POST',
      cookie,
      body: {
        month: parseInt(formData.get('month')?.toString() ?? '0', 10),
        year: parseInt(formData.get('year')?.toString() ?? '0', 10),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Depreciation run failed') }, { status: 400 });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AssetRegisterRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <AssetRegisterPage
          records={[]}
          pagination={EMPTY.pagination}
          summary={EMPTY.summary}
          canWrite={shell.canWrite}
        />
      }
    >
      {(data) => (
        <AssetRegisterPage
          records={data.records}
          pagination={data.pagination}
          summary={data.summary}
          canWrite={shell.canWrite}
        />
      )}
    </CachedAwait>
  );
}
