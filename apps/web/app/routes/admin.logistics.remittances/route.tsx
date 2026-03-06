import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { RemittancesAdminPage } from '~/features/remittances/RemittancesAdminPage';
import type { RemittanceAdminRecord } from '~/features/remittances/RemittancesAdminPage';

export const meta: MetaFunction = () => [
  { title: 'Remittances — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'logistics.write');
  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>(
    '/trpc/logistics.listRemittances?input=' + encodeURIComponent(JSON.stringify({ page: 1, limit: 20 })),
    { method: 'GET', cookie },
  );

  const data = res.ok
    ? (res.data as { result?: { data?: { records: RemittanceAdminRecord[] } } })?.result?.data
    : null;

  return {
    remittances: data?.records ?? [],
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'markRemittanceReceived') {
    await requirePermission(request, 'logistics.write');
    const remittanceId = formData.get('remittanceId')?.toString();
    const quantityReceived = parseInt(formData.get('quantityReceived')?.toString() ?? '0', 10);
    const shrinkageReason = formData.get('shrinkageReason')?.toString()?.trim() || undefined;

    if (!remittanceId) {
      return json({ error: 'Remittance ID is required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/logistics.markRemittanceReceived', {
      method: 'POST',
      cookie,
      body: {
        remittanceId,
        quantityReceived,
        ...(shrinkageReason && { shrinkageReason }),
      },
    });

    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to mark as received';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AdminLogisticsRemittancesRoute() {
  const data = useLoaderData<typeof loader>();
  return <RemittancesAdminPage remittances={data.remittances} />;
}
