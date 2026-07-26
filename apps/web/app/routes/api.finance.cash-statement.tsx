import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import type { CashLedgerStatement } from '~/features/finance/cash-statement-types';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false as const, error: 'Unauthorized', statement: null }, { status: 401 });
  }

  const url = new URL(request.url);
  const logisticsLocationId = url.searchParams.get('logisticsLocationId') || undefined;
  const providerId = url.searchParams.get('providerId') || undefined;
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;
  const dateScope =
    url.searchParams.get('dateScope') === 'deliveredAt' ? 'deliveredAt' : 'createdAt';

  if (Boolean(logisticsLocationId) === Boolean(providerId)) {
    return json(
      {
        ok: false as const,
        error: 'Provide exactly one of logisticsLocationId or providerId',
        statement: null,
      },
      { status: 400 },
    );
  }

  const input: Record<string, unknown> = { dateScope };
  if (logisticsLocationId) input.logisticsLocationId = logisticsLocationId;
  if (providerId) input.providerId = providerId;
  if (startDate) input.startDate = startDate;
  if (endDate) input.endDate = endDate;

  const cookie = getSessionCookie(request);
  const res = await apiRequest<unknown>(
    `/trpc/logistics.getCashLedgerStatement?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    return json(
      {
        ok: false as const,
        error: extractApiErrorMessage(res.data, 'Failed to load cash statement'),
        statement: null,
      },
      { status: res.status >= 400 && res.status < 600 ? res.status : 400 },
    );
  }

  const statement =
    (res.data as { result?: { data?: CashLedgerStatement } })?.result?.data ?? null;
  if (!statement) {
    return json({ ok: false as const, error: 'Empty statement response', statement: null }, { status: 502 });
  }

  return json({ ok: true as const, statement, error: null });
}
