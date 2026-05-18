import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

import { Await, useLoaderData } from '@remix-run/react';
import { apiRequest, getCurrentUser, getSessionCookie, parsePerPage, requireGlobalAuditAccess, safeStatus } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { AuditPage } from '~/features/audit/AuditPage';
import { AuditLoadingShell } from '~/features/audit/AuditLoadingShell';
import type { AuditActorFilterOption, AuditEntry, AuditStreamData, PermissionNameMap } from '~/features/audit/types';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';

export const meta: MetaFunction = () => [
  { title: 'Audit Trail — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireGlobalAuditAccess(request);
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  const userPerms = (user?.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canExport =
    !!user && (isAdminLevel(user) || userPerms.includes(canonicalPermissionCode('audit.export')));
  const url = new URL(request.url);

  const tableName = url.searchParams.get('tableName') || '';
  const actorId = url.searchParams.get('actorId') || '';
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const { perPage: limit } = parsePerPage(url.searchParams);

  const filters = { tableName, actorId, startDate, endDate, periodAllTime, page, limit };

  const auditShell = {
    filters: {
      tableName,
      actorId,
      startDate,
      endDate,
      periodAllTime,
    },
  };

  const pageData = (async (): Promise<AuditStreamData> => {
  // Build tRPC input
  const input: Record<string, unknown> = { page, limit };
  if (tableName) input.tableName = tableName;
  if (actorId) input.actorId = actorId;
  if (startDate && !periodAllTime) input.startDate = new Date(startDate).toISOString();
  if (endDate && !periodAllTime) input.endDate = new Date(endDate).toISOString();

  const encodedLogInput = encodeURIComponent(JSON.stringify(input));
  const [res, actorOptsRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/audit.globalLog?input=${encodedLogInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/audit.actorFilterOptions?input=${encodeURIComponent(JSON.stringify({}))}`, {
      method: 'GET',
      cookie,
    }),
  ]);

  const actorFilterOptions: AuditActorFilterOption[] =
    actorOptsRes.ok
      ? ((actorOptsRes.data as { result?: { data?: AuditActorFilterOption[] } }).result?.data ?? [])
      : [];

  if (!res.ok) {
    const data = res.data as Record<string, unknown> | undefined;
    const tRpcError = data?.error as { message?: string; code?: string } | undefined;
    const apiMessage = typeof tRpcError?.message === 'string' ? tRpcError.message : undefined;
    const fallback =
      res.status === 401
        ? 'Not authenticated. Please sign in again.'
        : res.status === 403
          ? 'You do not have permission to view the audit trail (audit.read required).'
          : 'Failed to load audit log. Check that the API is reachable and that history tables exist.';
    const error = apiMessage ?? fallback;

    return {
      rows: [] as AuditEntry[],
      total: 0,
      filters,
      actorIds: [],
      actorFilterOptions,
      locationNames: {},
      permissionNames: {},
      error,
    } satisfies AuditStreamData;
  }

  const trpcData = res.data as { result?: { data?: { rows: AuditEntry[]; total: number } } };
  const result = trpcData?.result?.data ?? { rows: [], total: 0 };

  // Collect unique user IDs to resolve to names — actor (changedBy) PLUS any
  // user-reference field inside each row's data (sender, receiver, requester, etc.).
  // Lets the description renderer print "Sarah disbursed to John" instead of UUIDs.
  const USER_REF_FIELDS = [
    'sender_id', 'receiver_id', 'requester_id', 'requested_by', 'approver_id', 'approved_by',
    'assigned_cs_id', 'assigned_rider_id', 'media_buyer_id', 'staff_id', 'user_id', 'created_by',
    'cs_closer_id', 'rider_id',
    // mirror_sessions row carries `actor_id` + `target_id`; loading their names lets the
    // description renderer print "Kabir mirrored Amina" instead of UUID stubs.
    'actor_id', 'target_id',
  ] as const;
  const ids = new Set<string>();
  for (const row of result.rows) {
    if (row.changedBy) ids.add(row.changedBy);
    const data = (row.data ?? {}) as Record<string, unknown>;
    for (const field of USER_REF_FIELDS) {
      const v = data[field];
      if (typeof v === 'string' && v.length > 0) ids.add(v);
    }
  }
  const actorIds = [...ids];

  const LOCATION_REF_KEYS = ['from_location_id', 'fromLocationId', 'to_location_id', 'toLocationId'] as const;
  const PERMISSION_REF_KEYS = ['permission_id', 'permissionId'] as const;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  const locationIdsSet = new Set<string>();
  const permissionIdsSet = new Set<string>();
  for (const row of result.rows) {
    const data = row.data as Record<string, unknown>;
    if (row.tableName === 'stock_transfers') {
      for (const field of LOCATION_REF_KEYS) {
        const v = data[field];
        if (typeof v === 'string' && UUID_RE.test(v)) locationIdsSet.add(v);
      }
    }
    if (row.tableName === 'user_permissions') {
      for (const field of PERMISSION_REF_KEYS) {
        const v = data[field];
        if (typeof v === 'string' && UUID_RE.test(v)) permissionIdsSet.add(v);
      }
    }
  }

  let locationNames: Record<string, string> = {};
  let permissionNames: PermissionNameMap = {};
  const locationIds = [...locationIdsSet];
  const permissionIds = [...permissionIdsSet];
  const [locRes, permRes] = await Promise.all([
    locationIds.length > 0
      ? apiRequest<unknown>(
          `/trpc/audit.locationNames?input=${encodeURIComponent(JSON.stringify({ locationIds }))}`,
          { method: 'GET', cookie },
        )
      : Promise.resolve(null),
    permissionIds.length > 0
      ? apiRequest<unknown>(
          `/trpc/audit.permissionNames?input=${encodeURIComponent(JSON.stringify({ permissionIds }))}`,
          { method: 'GET', cookie },
        )
      : Promise.resolve(null),
  ]);
  if (locRes?.ok) {
    const locParsed = locRes.data as { result?: { data?: Record<string, string> } };
    locationNames = locParsed?.result?.data ?? {};
  }
  if (permRes?.ok) {
    const permParsed = permRes.data as { result?: { data?: PermissionNameMap } };
    permissionNames = permParsed?.result?.data ?? {};
  }

  return {
    ...result,
    filters,
    actorIds,
    actorFilterOptions,
    locationNames,
    permissionNames,
  } satisfies AuditStreamData;
  })();

  return defer({ auditShell, pageData, canExport });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'timeTravel') {
    const tableName = formData.get('tableName')?.toString() ?? '';
    const recordId = formData.get('recordId')?.toString() ?? '';
    const asOf = formData.get('asOf')?.toString() ?? '';

    if (!tableName || !recordId || !asOf) {
      return json({ error: 'All fields are required' }, { status: 400 });
    }

    const input = { tableName, recordId, asOf: new Date(asOf).toISOString() };
    const res = await apiRequest<unknown>(
      `/trpc/audit.timeTravel?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );

    if (!res.ok) {
      return json({ error: 'Time travel query failed. Check record ID and access.' }, { status: safeStatus(res.status) });
    }

    const trpcData = res.data as { result?: { data?: Record<string, unknown> | null } };
    const result = trpcData?.result?.data ?? null;

    if (!result) {
      return json({ error: 'No record found at that point in time' }, { status: 404 });
    }

    return json({ result });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AuditRoute() {
  const { auditShell, pageData, canExport } = useLoaderData<typeof loader>();

  return (
    <CachedAwait
      resolve={pageData}
      fallback={<AuditLoadingShell filters={auditShell.filters} />}
      loaderShell={{ auditShell, canExport }}
      deferredKey="pageData"
    >
        {(data) => (
          <AuditPage
            rows={data.rows}
            total={data.total}
            filters={data.filters}
            actorIds={data.actorIds}
            actorFilterOptions={data.actorFilterOptions ?? []}
            locationNames={data.locationNames ?? {}}
            permissionNames={data.permissionNames ?? {}}
            error={data.error}
            canExport={canExport}
          />
        )}
      </CachedAwait>
  );
}
