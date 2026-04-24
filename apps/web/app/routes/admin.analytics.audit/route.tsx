import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import { AuditPage } from '~/features/audit/AuditPage';
import type { AuditEntry, AuditStreamData } from '~/features/audit/types';

export const meta: MetaFunction = () => [
  { title: 'Audit Trail — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  // Audit trail is visible to every authenticated user (Pillar 4: transparency).
  // Column-level security still applies — hasFinanceAccess strips cost/margin keys.
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const tableName = url.searchParams.get('tableName') || '';
  const actorId = url.searchParams.get('actorId') || '';
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = 20;

  const filters = { tableName, actorId, startDate, endDate, periodAllTime, page, limit };

  // Build tRPC input
  const input: Record<string, unknown> = { page, limit };
  if (tableName) input.tableName = tableName;
  if (actorId) input.actorId = actorId;
  if (startDate && !periodAllTime) input.startDate = new Date(startDate).toISOString();
  if (endDate && !periodAllTime) input.endDate = new Date(endDate).toISOString();

  // Audit log fetch MUST be awaited (rows needed for extracting actorIds)
  const res = await apiRequest<unknown>(
    `/trpc/audit.globalLog?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  );

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
      actorNames: Promise.resolve({} as Record<string, { name: string; role: string }>),
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
    'cs_agent_id', 'rider_id',
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

  // Start the actorNames fetch but DON'T await it — return as promise
  const actorNames = actorIds.length > 0
    ? apiRequest<unknown>(
        `/trpc/audit.actorNames?input=${encodeURIComponent(JSON.stringify({ userIds: actorIds }))}`,
        { method: 'GET', cookie },
      )
        .then((namesRes) => {
          if (namesRes.ok) {
            const namesData = namesRes.data as { result?: { data?: Record<string, { name: string; role: string }> } };
            return namesData?.result?.data ?? {};
          }
          return {} as Record<string, { name: string; role: string }>;
        })
        .catch(() => ({} as Record<string, { name: string; role: string }>))
    : Promise.resolve({} as Record<string, { name: string; role: string }>);

  return {
    ...result,
    filters,
    actorNames,
  } satisfies AuditStreamData;
}

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
  const data = useLoaderData<typeof loader>();

  return (
    <AuditPage
      rows={data.rows}
      total={data.total}
      filters={data.filters}
      actorNames={data.actorNames}
      error={data.error}
    />
  );
}
