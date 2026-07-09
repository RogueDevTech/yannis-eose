import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requirePermission, apiRequest, getSessionCookie } from '~/lib/api.server';
import { handleExportReportAction } from '~/lib/export-report.server';
import { ExportPage } from '~/features/data/ExportPage';
import { cachedClientLoader } from '~/lib/loader-cache';

export const meta: MetaFunction = () => [{ title: 'Export — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'data.export');
  const cookie = getSessionCookie(request);
  const permissions = user.permissions ?? [];

  // Fetch picklists for all report types in parallel.
  // Each report type only uses the subset it needs — the feature component filters.
  const [csClosersRes, mediaBuyersRes, productsRes, campaignsRes, recipientsRes] =
    await Promise.all([
      apiRequest<unknown>(
        `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: 'CS_CLOSER', status: 'ACTIVE', limit: 500, sortBy: 'name', sortOrder: 'asc', includeBranchMemberships: false, companyWideUserList: true }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: 'MEDIA_BUYER', status: 'ACTIVE', limit: 500, sortBy: 'name', sortOrder: 'asc', includeBranchMemberships: false, companyWideUserList: true }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 500, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/campaigns.list?input=${encodeURIComponent(JSON.stringify({ limit: 500, status: 'ACTIVE' }))}`,
        { method: 'GET', cookie },
      ),
      // Recipients = Head of Marketing users (disbursement receivers)
      apiRequest<unknown>(
        `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: 'HEAD_OF_MARKETING', status: 'ACTIVE', limit: 500, sortBy: 'name', sortOrder: 'asc', includeBranchMemberships: false, companyWideUserList: true }))}`,
        { method: 'GET', cookie },
      ),
    ]);

  type UserRow = { id: string; name: string };
  type ProductRow = { id: string; name: string };
  type CampaignRow = { id: string; name: string };

  const extractUsers = (res: typeof csClosersRes): UserRow[] => {
    if (!res.ok) return [];
    const data = res.data as { result?: { data?: { users?: UserRow[] } } };
    return (data?.result?.data?.users ?? []).map((u) => ({ id: u.id, name: u.name }));
  };

  const csClosers = extractUsers(csClosersRes);
  const mediaBuyers = extractUsers(mediaBuyersRes);
  const recipients = extractUsers(recipientsRes);

  let products: ProductRow[] = [];
  if (productsRes.ok) {
    const data = productsRes.data as { result?: { data?: { products?: ProductRow[] } } };
    products = (data?.result?.data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  let campaigns: CampaignRow[] = [];
  if (campaignsRes.ok) {
    const data = campaignsRes.data as { result?: { data?: { campaigns?: CampaignRow[] } } };
    campaigns = (data?.result?.data?.campaigns ?? []).map((c) => ({ id: c.id, name: c.name }));
  }

  return defer({
    permissions,
    picklists: {
      csClosers,
      mediaBuyers,
      products,
      campaigns,
      recipients,
    },
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;
  return new Response('Unknown action', { status: 400 });
}

export default function ExportRoute() {
  const { permissions, picklists } = useLoaderData<typeof loader>();
  return <ExportPage permissions={permissions} picklists={picklists} />;
}
