import { useLoaderData } from '@remix-run/react';
import type { ShouldRevalidateFunctionArgs } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
  redirectIfUnauthorized,
} from '~/lib/api.server';
import { resolveMarketingDateFilters } from '~/lib/marketing-pages.server';
import { LogisticsProviderDetailPage } from '~/features/logistics/LogisticsProviderDetailPage';
import type { LogisticsProviderDetailRecord, LogisticsProviderRow } from '~/features/logistics/team-types';
import type { Location } from '~/features/logistics/types';
import type { HistoryEntry } from '~/features/orders/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseProvidersList(res: { ok: boolean; status: number; data: unknown }): LogisticsProviderRow[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const result = raw.result as { data?: LogisticsProviderRow[] } | undefined;
  const data = result?.data;
  return Array.isArray(data) ? data : [];
}

function parseProvider(res: { ok: boolean; data: unknown }): LogisticsProviderDetailRecord | null {
  if (!res.ok) return null;
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || 'error' in raw) return null;
  const data = (raw.result as { data?: LogisticsProviderDetailRecord } | undefined)?.data;
  if (!data || typeof data.id !== 'string') return null;
  return data;
}

function parseLocations(res: { ok: boolean; data: unknown }): Location[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const data = (raw.result as { data?: { locations: Location[] } } | undefined)?.data;
  return Array.isArray(data?.locations) ? data.locations : [];
}

function parseProviderRecordHistory(res: { ok: boolean; data: unknown }): {
  rows: HistoryEntry[];
  total: number;
} {
  if (!res.ok) return { rows: [], total: 0 };
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || 'error' in raw) return { rows: [], total: 0 };
  const payload = (raw.result as { data?: { rows?: HistoryEntry[]; total?: number } } | undefined)?.data;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const total = typeof payload?.total === 'number' ? payload.total : rows.length;
  return { rows, total };
}

function parseActorNameMap(res: { ok: boolean; data: unknown }): Record<string, string> {
  if (!res.ok) return {};
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return {};
  const data = (raw.result as { data?: Record<string, { nameNow?: string }> } | undefined)?.data;
  if (!data || typeof data !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [id, rec] of Object.entries(data)) {
    if (rec && typeof rec.nameNow === 'string') out[id] = rec.nameNow;
  }
  return out;
}

function buildTeamListHref(url: URL): string {
  const qs = url.searchParams.toString();
  return qs ? `/admin/logistics/team?${qs}` : '/admin/logistics/team';
}

/** Skip loader when only `?tab=` changes — data is identical; instant tab UX. */
function normalizeSearchExcludingTab(search: string): string {
  const sp = new URLSearchParams(search);
  sp.delete('tab');
  const entries = [...sp.entries()].sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

export function shouldRevalidate({ currentUrl, nextUrl }: ShouldRevalidateFunctionArgs): boolean {
  const cur = new URL(currentUrl);
  const nex = new URL(nextUrl);
  if (cur.pathname !== nex.pathname) return true;
  if (cur.pathname === nex.pathname && cur.search === nex.search) return true;
  if (normalizeSearchExcludingTab(cur.search) === normalizeSearchExcludingTab(nex.search)) {
    return false;
  }
  return true;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS'],
    permission: 'logistics.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  const providerId = params['providerId']?.trim() ?? '';
  if (!providerId || !UUID_RE.test(providerId)) {
    throw redirect('/admin/logistics/team');
  }

  const url = new URL(request.url);
  const backHref = buildTeamListHref(url);
  const { startDate, endDate, filters } = resolveMarketingDateFilters(url);
  const teamInput = {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };

  const providerInput = encodeURIComponent(JSON.stringify({ providerId }));
  const locationsInput = encodeURIComponent(
    JSON.stringify({ providerId, page: 1, limit: 100 }),
  );
  const teamInputEnc = encodeURIComponent(JSON.stringify(teamInput));
  const recordHistoryInput = encodeURIComponent(
    JSON.stringify({
      tableName: 'logistics_providers',
      recordId: providerId,
      page: 1,
      limit: 50,
    }),
  );

  const [providerRes, locationsRes, teamRes, historyRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/logistics.getProvider?input=${providerInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/logistics.listLocations?input=${locationsInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/logistics.teamOverview?input=${teamInputEnc}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/audit.recordHistory?input=${recordHistoryInput}`,
      { method: 'GET', cookie },
    ),
  ]);

  redirectIfUnauthorized(providerRes, url.pathname);
  redirectIfUnauthorized(teamRes, url.pathname);

  const provider = parseProvider(providerRes);
  if (!provider) {
    throw new Response('Logistics company not found', { status: 404 });
  }

  const locations = parseLocations(locationsRes);
  const overviewRow =
    parseProvidersList(teamRes).find((p) => p.providerId === providerId) ?? null;

  const { rows: providerActivity, total: providerActivityTotal } = parseProviderRecordHistory(historyRes);
  const actorIds = [...new Set(providerActivity.map((r) => r.changedBy).filter(Boolean))] as string[];
  let actorNamesById: Record<string, string> = {};
  if (actorIds.length > 0) {
    const namesRes = await apiRequest<unknown>(
      `/trpc/audit.actorNames?input=${encodeURIComponent(JSON.stringify({ userIds: actorIds }))}`,
      { method: 'GET', cookie },
    );
    actorNamesById = parseActorNameMap(namesRes);
  }

  return {
    provider,
    locations,
    performance: overviewRow,
    dateFilters: filters,
    periodAllTime: url.searchParams.get('period') === 'all_time',
    backHref,
    providerActivity,
    providerActivityTotal,
    actorNamesById,
  };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const name = data?.provider?.name;
  return [{ title: name ? `${name} — Logistics company` : 'Logistics company — Yannis EOSE' }];
};

export default function LogisticsProviderDetailRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <LogisticsProviderDetailPage
      provider={data.provider}
      locations={data.locations}
      performance={data.performance}
      dateFilters={data.dateFilters}
      periodAllTime={data.periodAllTime}
      backHref={data.backHref}
      providerActivity={data.providerActivity}
      providerActivityTotal={data.providerActivityTotal}
      actorNamesById={data.actorNamesById}
    />
  );
}
