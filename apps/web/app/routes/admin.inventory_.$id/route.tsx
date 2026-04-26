import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import type { StockMovement } from '~/features/inventory/types';
import { MOVEMENT_COLORS, formatMovementType } from '~/features/inventory/types';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Level Detail — Yannis EOSE' },
];

interface LevelBatch {
  id: string;
  factoryCost: string;
  landingCost: string;
  totalLandedCost: string;
  quantity: number;
  remainingQuantity: number;
  receivedAt: string;
}

interface LevelHeader {
  id: string;
  productId: string;
  productName: string | null;
  locationId: string;
  locationName: string | null;
  stockCount: number;
  reservedCount: number;
  status: string;
  updatedAt: string;
}

interface LoaderData {
  level: LevelHeader | null;
  batches: LevelBatch[];
  movements: StockMovement[];
  total: number;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });

  const id = params['id'];
  if (!id) throw new Response('Inventory level ID required', { status: 400 });

  const cookie = getSessionCookie(request);
  const input = { id, limit: 200 };
  const res = await apiRequest<unknown>(
    `/trpc/inventory.getLevelById?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    return json<LoaderData>({ level: null, batches: [], movements: [], total: 0 });
  }

  const data = (res.data as {
    result?: { data?: { level: LevelHeader; batches: LevelBatch[]; movements: StockMovement[]; total: number } };
  })?.result?.data;

  return json<LoaderData>({
    level: data?.level ?? null,
    batches: data?.batches ?? [],
    movements: data?.movements ?? [],
    total: data?.total ?? 0,
  });
}

export default function InventoryLevelDetailRoute() {
  const { level, batches, movements, total } = useLoaderData<typeof loader>();

  if (!level) {
    return (
      <div className="space-y-4">
        <PageHeader title="Inventory level" />
        <EmptyState
          variant="card"
          title="Inventory level not found"
          description="It may have been deleted or you do not have access."
        />
      </div>
    );
  }

  const available = level.stockCount - level.reservedCount;
  const productLabel = level.productName ?? 'Unknown product';
  const locationLabel = level.locationName ?? 'Unknown location';

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <Link
            to="/admin/inventory"
            prefetch="intent"
            className="text-xs text-app-fg-muted hover:text-app-fg transition-colors inline-flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Inventory
          </Link>
        }
        title={productLabel}
        description={
          <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1.5 shrink-0 text-app-fg-muted">
              <svg className="w-3.5 h-3.5 text-app-fg-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="uppercase tracking-wide text-[11px] font-medium">Stock location</span>
            </span>
            <span className="font-semibold text-app-fg">{locationLabel}</span>
          </span>
        }
      />

      {/* Snapshot */}
      <div className="card">
        <div className="pb-4 mb-4 border-b border-app-border">
          <p className="text-xs font-medium uppercase tracking-wide text-app-fg-muted">Stock location</p>
          <p className="text-base font-semibold text-app-fg mt-1">{locationLabel}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-app-fg-muted">Stock</p>
            <p className="text-2xl font-semibold text-app-fg">{level.stockCount}</p>
          </div>
          <div>
            <p className="text-xs text-app-fg-muted">Reserved</p>
            <p className="text-2xl font-semibold text-warning-600 dark:text-warning-400">{level.reservedCount}</p>
          </div>
          <div>
            <p className="text-xs text-app-fg-muted">Available</p>
            <p className="text-2xl font-semibold text-success-600 dark:text-success-400">{available}</p>
          </div>
          <div>
            <p className="text-xs text-app-fg-muted mb-1">Status</p>
            <StatusBadge status={level.status} />
          </div>
        </div>
      </div>

      {/* FIFO batches */}
      <div className="card">
        <h2 className="text-lg font-semibold text-app-fg mb-3">FIFO batches at {locationLabel}</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-app-fg-muted italic">No batches received at this location yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-app-border">
            <table className="w-full text-sm">
              <thead className="bg-app-hover">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-xs text-app-fg-muted uppercase tracking-wide">Received</th>
                  <th className="text-right px-3 py-2 font-medium text-xs text-app-fg-muted uppercase tracking-wide">Intake qty</th>
                  <th className="text-right px-3 py-2 font-medium text-xs text-app-fg-muted uppercase tracking-wide">Remaining</th>
                  <th className="text-right px-3 py-2 font-medium text-xs text-app-fg-muted uppercase tracking-wide">Factory ₦</th>
                  <th className="text-right px-3 py-2 font-medium text-xs text-app-fg-muted uppercase tracking-wide">Landing ₦</th>
                  <th className="text-right px-3 py-2 font-medium text-xs text-app-fg-muted uppercase tracking-wide">Landed ₦</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const depleted = b.remainingQuantity === 0;
                  return (
                    <tr key={b.id} className={`border-t border-app-border ${depleted ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2 text-app-fg-muted">
                        {new Date(b.receivedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-app-fg">{b.quantity}</td>
                      <td className={`px-3 py-2 text-right font-medium ${depleted ? 'text-app-fg-muted' : 'text-success-600 dark:text-success-400'}`}>
                        {b.remainingQuantity}
                      </td>
                      <td className="px-3 py-2 text-right text-app-fg-muted">
                        {Number(b.factoryCost).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-app-fg-muted">
                        {Number(b.landingCost).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-app-fg">
                        {Number(b.totalLandedCost).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movement history */}
      <div className="card">
        <h2 className="text-lg font-semibold text-app-fg mb-3">Movement history</h2>
        {movements.length === 0 ? (
          <EmptyState
            title="No movements yet"
            description="Stock intakes, transfers, and other events will appear here."
          />
        ) : (
          <ul className="space-y-2">
            {movements.map((m) => {
              const isIncoming =
                m.movementType === 'INTAKE' ||
                m.movementType === 'TRANSFER_IN' ||
                m.movementType === 'RESTOCK' ||
                (m.movementType === 'ADJUSTMENT' && m.quantity > 0);
              const isNeutral = m.movementType === 'ALLOCATION' || m.movementType === 'RESERVATION';
              const qtyColor = isNeutral
                ? 'text-app-fg-muted'
                : isIncoming
                  ? 'text-success-600 dark:text-success-400'
                  : 'text-danger-600 dark:text-danger-400';
              const qtyPrefix = isNeutral ? '→' : isIncoming ? '+' : '';

              return (
                <li
                  key={m.id}
                  className="rounded-lg border border-app-border bg-app-canvas px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
                        {formatMovementType(m.movementType)}
                      </span>
                      <span className={`font-medium ${qtyColor}`}>
                        {qtyPrefix}{Math.abs(m.quantity)}
                      </span>
                    </div>
                    <span className="text-xs text-app-fg-muted whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleString('en-NG', {
                        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {m.reason && (
                    <p className="text-xs text-app-fg-muted mt-1 italic">{m.reason}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {total > movements.length && (
          <p className="text-xs text-app-fg-muted mt-3">
            Showing latest {movements.length} of {total} movements.
          </p>
        )}
      </div>
    </div>
  );
}
