import { Suspense } from 'react';
import { json, defer } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Await, useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { USERS_LIST_MAX_LIMIT } from '~/lib/trpc-list-limits';
import type { DeliveryRemittanceDetail } from '~/features/finance/DeliveryRemittancesPage';
import { DeliveryRemittanceDetailPage } from '~/features/finance/DeliveryRemittanceDetailPage';
import { DeliveryRemittanceDetailLoadingShell } from '~/features/finance/FinanceDeferredLoadingShells';

export const meta: MetaFunction = () => [
  { title: 'Cash Remittance Detail — Finance — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const remittanceId = params['id'];

  if (!remittanceId) {
    throw new Response('Remittance ID required', { status: 400 });
  }

  const detailShell = { remittanceId };

  const pageData = (async () => {
    const [detailRes, usersRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/logistics.getDeliveryRemittance?input=${encodeURIComponent(
          JSON.stringify({ deliveryRemittanceId: remittanceId }),
        )}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ limit: USERS_LIST_MAX_LIMIT }))}`,
        { method: 'GET', cookie },
      ),
    ]);

    if (!detailRes.ok) {
      throw new Response('Remittance not found', { status: safeStatus(detailRes.status) });
    }

    const detail =
      (detailRes.data as { result?: { data?: DeliveryRemittanceDetail } })?.result?.data ?? null;
    if (!detail) {
      throw new Response('Remittance not found', { status: 404 });
    }

    const usersData = usersRes.ok
      ? (
          usersRes.data as { result?: { data?: { users: Array<{ id: string; name: string }> } } }
        )?.result?.data?.users
      : null;
    const userMap: Record<string, string> = {};
    if (usersData) {
      for (const u of usersData) userMap[u.id] = u.name;
    }

    const userPerms = (user?.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasApprovePermission =
      isAdminLevel(user) ||
      userPerms.includes(canonicalPermissionCode('finance.approve')) ||
      userPerms.includes(canonicalPermissionCode('finance.cashRemittance.markReceived'));

    return { detail, hasApprovePermission, userMap };
  })();

  return defer({ detailShell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  // Phase 21 — accept either legacy `finance.approve` or the granular
  // `finance.cashRemittance.markReceived` permission. The service-layer gate
  // in `logistics.service.ts` performs the same widened check.
  await requirePermission(request, ['finance.approve', 'finance.cashRemittance.markReceived']);
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const deliveryRemittanceId = formData.get('deliveryRemittanceId')?.toString();
  if (!deliveryRemittanceId) {
    return json({ error: 'Missing delivery remittance ID' }, { status: 400 });
  }

  if (intent === 'markReceived') {
    const res = await apiRequest<unknown>('/trpc/logistics.markDeliveryRemittanceReceived', {
      method: 'POST',
      cookie,
      body: { deliveryRemittanceId },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to mark received');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'dispute') {
    const disputeReason = formData.get('disputeReason')?.toString();
    if (!disputeReason || disputeReason.length < 10) {
      return json({ error: 'Dispute reason must be at least 10 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/logistics.disputeDeliveryRemittance', {
      method: 'POST',
      cookie,
      body: { deliveryRemittanceId, disputeReason },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to dispute remittance');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AdminFinanceDeliveryRemittanceDetailRoute() {
  const { detailShell, pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<DeliveryRemittanceDetailLoadingShell remittanceId={detailShell.remittanceId} />}>
      <Await resolve={pageData}>
        {(data) => (
          <DeliveryRemittanceDetailPage
            detail={data.detail}
            hasApprovePermission={data.hasApprovePermission}
            userMap={data.userMap}
          />
        )}
      </Await>
    </Suspense>
  );
}
