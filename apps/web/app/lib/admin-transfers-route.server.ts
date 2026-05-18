import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import type { Location, Transfer } from '~/features/transfers/types';
import { parseTransfersShellDateFilters } from '~/lib/transfers-shell-filters';

export async function loadTransfersRouteData({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'transfers.read');
  const cookie = getSessionCookie(request);
  const transfersShell = {
    filters: parseTransfersShellDateFilters(new URL(request.url).searchParams),
  };

  const pageData = (async () => {
    const transfersPromise = apiRequest<unknown>('/trpc/inventory.transfers', { method: 'GET', cookie });
    const locationsPromise = apiRequest<unknown>('/trpc/logistics.listLocations', { method: 'GET', cookie });

    const [transfersRes, locationsRes] = await Promise.all([transfersPromise, locationsPromise]);

    const transfersData = transfersRes.ok
      ? (transfersRes.data as { result?: { data?: Transfer[] } })?.result?.data
      : null;

    const locationsRaw = locationsRes.ok
      ? (
          locationsRes.data as {
            result?: {
              data?: {
                locations: {
                  id: string;
                  providerId: string;
                  name: string;
                  address: string;
                  status: string;
                  providerName?: string | null;
                }[];
              };
            };
          }
        )?.result?.data?.locations ?? []
      : [];
    const locationsData: Location[] = locationsRaw.map((l) => ({
      id: l.id,
      providerId: l.providerId,
      name: l.name,
      address: l.address,
      status: l.status,
      providerName: l.providerName ?? null,
    }));

    return {
      transfers: transfersData ?? [],
      locations: locationsData,
      products: null,
      levels: null,
    };
  })();

  return defer({ transfersShell, pageData });
}

export async function transfersRouteAction({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'initiateTransfer') {
    // Multi-product transfer: one source → one destination, N product lines.
    // The modal serialises `lines` as JSON so we don't juggle indexed field names.
    const fromLocationId = formData.get('fromLocationId')?.toString() ?? '';
    const toLocationId = formData.get('toLocationId')?.toString() ?? '';

    let lines: Array<{ productId: string; quantity: number }>;
    try {
      const raw = JSON.parse(formData.get('lines')?.toString() ?? '[]') as unknown;
      if (!Array.isArray(raw)) throw new Error('lines is not an array');
      lines = raw.map((l) => {
        const o = (l ?? {}) as { productId?: unknown; quantity?: unknown };
        return { productId: String(o.productId ?? ''), quantity: Number(o.quantity ?? 0) };
      });
    } catch {
      return json({ error: 'Invalid transfer lines payload' }, { status: 400 });
    }

    if (lines.length === 0) {
      return json({ error: 'Add at least one product to transfer' }, { status: 400 });
    }
    if (lines.some((l) => !l.productId || !Number.isFinite(l.quantity) || l.quantity <= 0)) {
      return json(
        { error: 'Every product line needs a product and a quantity of at least 1' },
        { status: 400 },
      );
    }

    const res = await apiRequest<unknown>('/trpc/inventory.transferBatch', {
      method: 'POST',
      cookie,
      body: { fromLocationId, toLocationId, lines },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to initiate transfer') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'cancelTransfer') {
    const transferId = formData.get('transferId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString().trim() ?? '';
    if (!transferId) {
      return json({ error: 'Transfer ID is required' }, { status: 400 });
    }
    if (reason.length < 10) {
      return json({ error: 'Cancellation reason must be at least 10 characters' }, { status: 400 });
    }
    // PENDING transfers can also be cancelled by the original initiator (no
    // inventory side effects — server-side handler short-circuits for PENDING).
    const res = await apiRequest<unknown>('/trpc/inventory.cancelTransfer', {
      method: 'POST',
      cookie,
      body: { transferId, reason },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to cancel transfer') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'approveTransfer') {
    const transferId = formData.get('transferId')?.toString() ?? '';
    if (!transferId) {
      return json({ error: 'Transfer ID is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/inventory.approveTransfer', {
      method: 'POST',
      cookie,
      body: { transferId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to approve transfer') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'rejectTransfer') {
    const transferId = formData.get('transferId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString().trim() ?? '';
    if (!transferId) {
      return json({ error: 'Transfer ID is required' }, { status: 400 });
    }
    if (reason.length < 10) {
      return json({ error: 'Rejection reason must be at least 10 characters' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/inventory.rejectTransfer', {
      method: 'POST',
      cookie,
      body: { transferId, reason },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reject transfer') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}
