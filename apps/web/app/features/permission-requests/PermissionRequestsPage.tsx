import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useFetcher, useRevalidator, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { Button } from '~/components/ui/button';
import { formatRoleLabel } from '~/components/ui/role-badge';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Textarea } from '~/components/ui/textarea';
import { Tabs } from '~/components/ui/tabs';
import { DescriptionList } from '~/components/ui/description-list';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import type { PermissionRequest, PermissionRequestStatusFilter } from './types';

const REQUEST_TYPE_LABELS: Record<string, string> = {
  USER_CREATION: 'User Creation',
  ROLE_CHANGE: 'Role Change',
  PERMISSION_GRANT: 'Permission Grant',
  PRODUCT_ARCHIVE: 'Product archive',
  ORDER_LINE_PRICE_CHANGE: 'Order line prices',
  ORDER_DELETION: 'Order archive',
};

const STATUS_TABS: Array<{ value: PermissionRequestStatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function requestedSummary(req: PermissionRequest): string {
  if (req.type === 'PRODUCT_ARCHIVE') return 'Archive product';
  if (req.type === 'ORDER_LINE_PRICE_CHANGE') return 'Change order line prices';
  if (req.type === 'ORDER_DELETION') return 'Archive order (soft delete)';
  if (req.requestedRole) return formatRoleLabel(req.requestedRole);
  if (req.permissionCode) return req.permissionCode;
  return '—';
}

function targetSummary(req: PermissionRequest): string {
  if (req.type === 'USER_CREATION' && req.payload) {
    const name = (req.payload as { name?: string }).name;
    if (name) return name;
  }
  if (req.type === 'PRODUCT_ARCHIVE' && req.payload) {
    const name = (req.payload as { productName?: string }).productName;
    if (name) return name;
  }
  if (req.type === 'ORDER_LINE_PRICE_CHANGE' && req.payload) {
    const oid = (req.payload as { orderId?: string }).orderId;
    if (oid) return `Order ${oid.slice(0, 8).toUpperCase()}`;
  }
  if (req.type === 'ORDER_DELETION' && req.payload) {
    const oid = (req.payload as { orderId?: string }).orderId;
    if (oid) return `Order ${oid.slice(0, 8).toUpperCase()}`;
  }
  if (req.targetUserName) return req.targetUserName;
  return '—';
}

/** Resolved from `branches.list` — maps permission-request payload branch UUIDs to labels in modals. */
export type PermissionRequestBranchPicklist = ReadonlyArray<{ id: string; name: string }>;

export function PermissionRequestsPage({
  requests,
  total = 0,
  page = 1,
  totalPages = 1,
  limit = 20,
  statusCounts,
  branches = [],
  canApprove = false,
  canApproveProductArchive = false,
  canApproveOrderLinePriceChange = false,
  viewerId = '',
  activeStatus = 'ALL',
}: {
  requests: PermissionRequest[];
  /** Total rows for the active status filter (all pages). */
  total?: number;
  page?: number;
  totalPages?: number;
  limit?: number;
  statusCounts: { pending: number; approved: number; rejected: number; all: number };
  /** Viewer-visible branches (SuperAdmin: all; others: memberships). Used to label USER_CREATION payloads. */
  branches?: PermissionRequestBranchPicklist;
  canApprove?: boolean;
  /** Only Super Admin may approve/reject product archive requests (even if user has audit.read). */
  canApproveProductArchive?: boolean;
  /** Head of CS / Head of Logistics / Branch Admin / Admin — server re-checks branch for heads. */
  canApproveOrderLinePriceChange?: boolean;
  /** Current user id — used to allow withdrawing own pending order price request. */
  viewerId?: string;
  activeStatus?: PermissionRequestStatusFilter;
}) {
  const fetcher = useFetcher();
  const permissionReqSurface = useFetcherActionSurface(fetcher);
  const [viewing, setViewing] = useState<PermissionRequest | null>(null);

  const branchNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) {
      if (b.id && b.name) m.set(b.id, b.name);
    }
    return m;
  }, [branches]);
  const [modal, setModal] = useState<{ requestId: string; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reason, setReason] = useState('');
  const fetcherError = (fetcher.data as { error?: string })?.error;
  const [dismissedError, setDismissedError] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();

  useFetcherToast(fetcher.data, { successMessage: 'Request processed', skipErrorToast: modal != null });

  const onApproveRejectSuccess = useCallback(() => {
    // This route opts into the full-loader cache for instant revisits.
    // After approve/reject, force-drop every cached status slice and immediately
    // revalidate so `?status=PENDING` stops showing rows that are now processed.
    invalidateCachedLoader('/admin/permission-requests');
    revalidator.revalidate();
    setModal(null);
    setReason('');
  }, [revalidator]);
  useCloseOnFetcherSuccess(fetcher, onApproveRejectSuccess, {
    intent: ['approve', 'reject'],
  });

  useEffect(() => {
    if (fetcherError) setDismissedError(false);
  }, [fetcherError]);

  const handleStatusChange = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'ALL') {
      params.delete('status');
    } else {
      params.set('status', next);
    }
    // Each tab has its own row count; drop page so we do not land on an empty high page.
    params.delete('page');
    setSearchParams(params, { replace: true });
  };

  const statusTabItems = useMemo(
    () =>
      STATUS_TABS.map((t) => {
        const n =
          t.value === 'PENDING'
            ? statusCounts.pending
            : t.value === 'APPROVED'
              ? statusCounts.approved
              : t.value === 'REJECTED'
                ? statusCounts.rejected
                : statusCounts.all;
        return {
          value: t.value,
          label: t.label,
          badge: (
            <span className="tabular-nums rounded-full bg-app-hover px-1.5 py-px text-micro font-semibold leading-tight text-app-fg-muted">
              {n}
            </span>
          ),
        };
      }),
    [statusCounts],
  );

  const requestColumns: CompactTableColumn<PermissionRequest>[] = useMemo(
    () => [
      {
        key: 'status',
        header: 'Status',
        tight: true,
        render: (req) => <StatusBadge status={req.status} />,
      },
      {
        key: 'requester',
        header: 'Requester',
        minWidth: 'min-w-[10rem]',
        render: (req) => (
          <div className="text-sm max-w-[10rem]">
            <span className="font-medium text-app-fg line-clamp-1" title={req.requesterName}>
              {req.requesterName}
            </span>
            <span className="block text-xs text-app-fg-muted line-clamp-1" title={req.requesterEmail}>
              {req.requesterEmail}
            </span>
          </div>
        ),
      },
      {
        key: 'target',
        header: 'Target',
        minWidth: 'min-w-[9rem]',
        cellTitle: (req) => targetSummary(req),
        render: (req) => (
          <span className="text-sm line-clamp-2 text-app-fg">{targetSummary(req)}</span>
        ),
      },
      {
        key: 'requested',
        header: 'Requested',
        minWidth: 'min-w-[8rem]',
        cellTitle: (req) => requestedSummary(req),
        render: (req) => (
          <span className="text-sm line-clamp-2" title={requestedSummary(req)}>
            {requestedSummary(req)}
          </span>
        ),
      },
      {
        key: 'submitted',
        header: 'Submitted',
        nowrap: true,
        render: (req) => (
          <span className="text-app-fg-muted text-sm">{formatDateTime(req.createdAt)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (req) => {
          if (req.status !== 'PENDING') {
            return <CompactTableActionButton onClick={() => setViewing(req)}>View</CompactTableActionButton>;
          }
          const mayApprove =
            (req.type === 'PRODUCT_ARCHIVE' && canApproveProductArchive) ||
            ((req.type === 'ORDER_LINE_PRICE_CHANGE' || req.type === 'ORDER_DELETION') && canApproveOrderLinePriceChange) ||
            (req.type !== 'PRODUCT_ARCHIVE' && req.type !== 'ORDER_LINE_PRICE_CHANGE' && req.type !== 'ORDER_DELETION' && canApprove);
          const mayReject =
            mayApprove ||
            ((req.type === 'ORDER_LINE_PRICE_CHANGE' || req.type === 'ORDER_DELETION') && viewerId !== '' && viewerId === req.requesterId);
          return (
            <div className="flex items-center gap-1.5">
              <CompactTableActionButton onClick={() => setViewing(req)}>View</CompactTableActionButton>
              {mayApprove && (
                <CompactTableActionButton
                  tone="success"
                  onClick={() => { setModal({ requestId: req.id, action: 'APPROVED' }); setReason(''); }}
                >
                  Approve
                </CompactTableActionButton>
              )}
              {mayReject && (
                <CompactTableActionButton
                  tone="danger"
                  onClick={() => { setModal({ requestId: req.id, action: 'REJECTED' }); setReason(''); }}
                >
                  Reject
                </CompactTableActionButton>
              )}
            </div>
          );
        },
      },
    ],
    [canApprove, canApproveProductArchive, canApproveOrderLinePriceChange, viewerId],
  );

  const emptyTitle =
    activeStatus === 'PENDING'
      ? 'No pending permission requests'
      : activeStatus === 'ALL'
        ? 'No permission requests'
        : `No ${activeStatus.toLowerCase()} permission requests`;
  const emptyDescription =
    activeStatus === 'PENDING'
      ? 'New requests from HR will appear here for your review.'
      : activeStatus === 'ALL'
        ? 'When requests are submitted, they will appear here for your review.'
        : 'Try switching the tab to see requests in other states.';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Permission Requests"
        description="Review sensitive approval requests."
        mobileInlineActions
        actions={
          <>
            <PageRefreshButton className="hidden md:inline-flex" />
            <PageRefreshButton iconOnly className="md:hidden" />
          </>
        }
      />

      {fetcherError && !dismissedError && modal == null && (
        <PageNotification
          variant="error"
          message={permissionReqSurface.friendlyError || fetcherError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <Tabs value={activeStatus} onChange={handleStatusChange} tabs={statusTabItems} />

      <div className="list-panel">
        <CompactTable<PermissionRequest>
          withCard={false}
          className="min-h-0 min-w-0"
          columns={requestColumns}
          rows={requests}
          rowKey={(r) => r.id}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          renderMobileCard={(req) => (
            <button
              type="button"
              onClick={() => setViewing(req)}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-app-fg">
                  {req.requesterName}
                </span>
                <StatusBadge status={req.status} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-app-fg-muted truncate">
                  {REQUEST_TYPE_LABELS[req.type] ?? req.type}
                </span>
                <span className="shrink-0 text-xs text-app-fg-muted">
                  {formatDateTime(req.createdAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-app-fg truncate">
                  {targetSummary(req)}
                </span>
                <span className="shrink-0 text-xs text-app-fg-muted truncate max-w-[8rem]">
                  {requestedSummary(req)}
                </span>
              </div>
            </button>
          )}
        />
      </div>

      {total > 0 && totalPages > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {total > 0
              ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} ${total === 1 ? 'request' : 'requests'}`
              : 'No requests'}
          </p>
          <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} />
        </div>
      )}

      {viewing && (
        <Modal
          open
          onClose={() => setViewing(null)}
          maxWidth="max-w-lg"
          backdropBlur
          contentClassName="p-6 flex flex-col max-h-[85dvh] overflow-hidden border border-app-border bg-app-elevated"
        >
          <h3 className="text-lg font-semibold text-app-fg shrink-0 pr-8">Request details</h3>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4">
            <DescriptionList
              layout="grid"
              divided
              items={[
                {
                  label: 'Type',
                  value: REQUEST_TYPE_LABELS[viewing.type] ?? viewing.type,
                },
                {
                  label: 'Status',
                  value: <StatusBadge status={viewing.status} />,
                },
                {
                  label: 'Requester',
                  value: (
                    <span>
                      <span className="font-medium">{viewing.requesterName}</span>
                      <span className="block text-xs text-app-fg-muted">{viewing.requesterEmail}</span>
                    </span>
                  ),
                  fullWidth: true,
                },
                {
                  label: 'Target',
                  value:
                    viewing.type === 'USER_CREATION' && viewing.payload ? (
                      <span>
                        <span className="font-medium">
                          {(viewing.payload as { name?: string }).name ?? '—'}
                        </span>
                        <span className="block text-xs text-app-fg-muted">
                          {(viewing.payload as { email?: string }).email ?? ''}
                        </span>
                      </span>
                    ) : viewing.type === 'PRODUCT_ARCHIVE' && viewing.payload ? (
                      <span className="font-medium">
                        {(viewing.payload as { productName?: string }).productName ?? '—'}
                      </span>
                    ) : viewing.targetUserName ? (
                      <span>
                        <span className="font-medium">{viewing.targetUserName}</span>
                        <span className="block text-xs text-app-fg-muted">{viewing.targetUserEmail ?? ''}</span>
                      </span>
                    ) : (
                      '—'
                    ),
                  fullWidth: true,
                },
                {
                  label: 'Requested',
                  value: requestedSummary(viewing),
                  hideIfEmpty: true,
                },
                {
                  label: 'Reason (request)',
                  value: <p className="whitespace-pre-wrap text-sm">{viewing.reason}</p>,
                  fullWidth: true,
                },
                {
                  label: 'Submitted',
                  value: formatDateTime(viewing.createdAt),
                },
                ...(viewing.status !== 'PENDING'
                  ? [
                      {
                        label: 'Decision',
                        value: (
                          <div className="space-y-1">
                            <p className="text-sm">
                              <span className="font-medium text-app-fg">
                                {viewing.status === 'APPROVED' ? 'Approved' : 'Rejected'}
                              </span>
                              {' by '}
                              <span className="font-medium">{viewing.approverName ?? 'Unknown'}</span>
                            </p>
                            <p className="text-xs text-app-fg-muted">{formatDateTime(viewing.approvedAt)}</p>
                            {viewing.approvalReason ? (
                              <p className="text-sm text-app-fg-muted whitespace-pre-wrap pt-1">
                                {viewing.approvalReason}
                              </p>
                            ) : null}
                          </div>
                        ),
                        fullWidth: true as const,
                      },
                    ]
                  : []),
              ]}
            />
            <RequestPayloadView request={viewing} branchNameById={branchNameById} />
          </div>
          <div className="flex flex-wrap gap-2 justify-end shrink-0 pt-2 border-t border-app-border pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewing(null)}>
              Close
            </Button>
            {(() => {
              if (viewing.status !== 'PENDING') return null;
              const mayApprove =
                (viewing.type === 'PRODUCT_ARCHIVE' && canApproveProductArchive) ||
                ((viewing.type === 'ORDER_LINE_PRICE_CHANGE' || viewing.type === 'ORDER_DELETION') &&
                  canApproveOrderLinePriceChange) ||
                (viewing.type !== 'PRODUCT_ARCHIVE' &&
                  viewing.type !== 'ORDER_LINE_PRICE_CHANGE' &&
                  viewing.type !== 'ORDER_DELETION' &&
                  canApprove);
              const mayReject =
                mayApprove ||
                ((viewing.type === 'ORDER_LINE_PRICE_CHANGE' || viewing.type === 'ORDER_DELETION') &&
                  viewerId !== '' &&
                  viewerId === viewing.requesterId);
              if (!mayApprove && !mayReject) return null;
              return (
                <>
                  {mayApprove ? (
                    <Button
                      type="button"
                      variant="success"
                      size="sm"
                      onClick={() => {
                        const id = viewing.id;
                        setViewing(null);
                        setModal({ requestId: id, action: 'APPROVED' });
                        setReason('');
                      }}
                    >
                      Approve
                    </Button>
                  ) : null}
                  {mayReject ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        const id = viewing.id;
                        setViewing(null);
                        setModal({ requestId: id, action: 'REJECTED' });
                        setReason('');
                      }}
                    >
                      {(viewing.type === 'ORDER_LINE_PRICE_CHANGE' || viewing.type === 'ORDER_DELETION') &&
                      viewerId === viewing.requesterId
                        ? 'Withdraw request'
                        : 'Reject'}
                    </Button>
                  ) : null}
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* Approve/Reject Modal */}
      {modal && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state === 'submitting' || fetcher.state === 'loading') return;
            setModal(null);
          }}
          maxWidth="max-w-md"
          backdropBlur
          contentClassName="p-6 flex flex-col max-h-[80dvh] overflow-hidden border border-app-border bg-app-elevated"
        >
              <h3 className="text-lg font-semibold text-app-fg shrink-0">
                {modal.action === 'APPROVED' ? 'Approve Request' : 'Reject Request'}
              </h3>
              <ModalFetcherInlineError message={permissionReqSurface.errorMatchingIntent(['approve', 'reject'])} />
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
                {(() => {
                  const req = requests.find((r) => r.id === modal.requestId);
                  if (!req) return null;
                  return (
                    <div className="rounded-lg border border-app-border bg-app-bg p-3 space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-app-fg-muted">Type</span>
                        <span className="font-medium text-app-fg">{REQUEST_TYPE_LABELS[req.type] ?? req.type}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-app-fg-muted">Requester</span>
                        <span className="font-medium text-app-fg">{req.requesterName}</span>
                      </div>
                      {req.reason && (
                        <div className="pt-1 border-t border-app-border">
                          <span className="text-app-fg-muted text-xs">Reason for request</span>
                          <p className="whitespace-pre-wrap text-app-fg mt-0.5">{req.reason}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <Textarea
                  label="Reason"
                  hint="Minimum 5 characters"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={
                    modal.action === 'APPROVED' ? 'Reason for approval...' : 'Reason for rejection...'
                  }
                />
              </div>
              <div className="flex gap-2 justify-end shrink-0 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={fetcher.state === 'submitting' || fetcher.state === 'loading'}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </Button>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value={modal.action === 'APPROVED' ? 'approve' : 'reject'} />
                  <input type="hidden" name="requestId" value={modal.requestId} />
                  <input type="hidden" name="reason" value={reason} />
                  <Button
                    type="submit"
                    variant={modal.action === 'APPROVED' ? 'success' : 'danger'}
                    size="sm"
                    disabled={
                      reason.trim().length < 5 ||
                      fetcher.state === 'submitting' ||
                      fetcher.state === 'loading'
                    }
                    loading={fetcher.state === 'submitting' || fetcher.state === 'loading'}
                    loadingText="Processing..."
                  >
                    Confirm
                  </Button>
                </fetcher.Form>
              </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Payload renderers ──────────────────────────────────────────────────────
//
// Permission requests carry a JSON payload that varies per type. Earlier these
// were dumped via `JSON.stringify(payload, null, 2)` inside a <pre>, which was
// fast to ship but reads like a stack trace to a non-technical reviewer ("why
// am I seeing code?"). The components below render each type as a tidy
// description list / table so HoCS / SuperAdmin can review at a glance.

interface OrderLineItemPayload {
  productId: string;
  productName?: string | null;
  quantity: number;
  unitPrice: number;
}

interface OrderPayload {
  orderId?: string;
  items?: OrderLineItemPayload[];
  totalAmount?: number;
}

interface UserCreationPayload {
  name?: string;
  email?: string;
  role?: string;
  phone?: string;
  primaryBranchId?: string;
  branchIds?: string[];
  roleTemplateId?: string;
}

interface ProductArchivePayload {
  productId?: string;
  productName?: string;
  reason?: string;
}

function RequestPayloadView({
  request,
  branchNameById,
}: {
  request: PermissionRequest;
  /** From loader `branches.list`; unknown IDs fall back to a short UUID hint. */
  branchNameById: ReadonlyMap<string, string>;
}) {
  const payload = request.payload as Record<string, unknown> | null;
  if (!payload) return null;

  if (request.type === 'ORDER_LINE_PRICE_CHANGE' || request.type === 'ORDER_DELETION') {
    return <OrderPayloadView payload={payload as OrderPayload} kind={request.type} />;
  }
  if (request.type === 'USER_CREATION') {
    return (
      <UserCreationPayloadView payload={payload as UserCreationPayload} branchNameById={branchNameById} />
    );
  }
  if (request.type === 'PRODUCT_ARCHIVE') {
    return <ProductArchivePayloadView payload={payload as ProductArchivePayload} />;
  }
  return null;
}

function OrderPayloadView({ payload, kind }: { payload: OrderPayload; kind: 'ORDER_LINE_PRICE_CHANGE' | 'ORDER_DELETION' }) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const total =
    typeof payload.totalAmount === 'number'
      ? payload.totalAmount
      : items.reduce((acc, line) => acc + (Number(line.unitPrice) || 0), 0);

  const headerLabel =
    kind === 'ORDER_DELETION' ? 'Order to archive' : 'Proposed items & total';

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-app-fg-muted mb-1.5">{headerLabel}</p>
        {payload.orderId ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-app-fg-muted">Order:</span>
            <OrderIdBadge id={payload.orderId} linkTo={`/admin/orders/${payload.orderId}`} />
          </div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="rounded-md border border-app-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app-hover text-xs uppercase tracking-wider text-app-fg-muted">
                <th className="text-left font-medium px-3 py-2">Product</th>
                <th className="text-right font-medium px-3 py-2 w-16">Qty</th>
                <th className="text-right font-medium px-3 py-2 w-32">Unit price</th>
                <th className="text-right font-medium px-3 py-2 w-32">Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line, i) => {
                const qty = Number(line.quantity) || 0;
                const unit = Number(line.unitPrice) || 0;
                const lineTotal = unit;
                const productLabel =
                  line.productName?.trim() ||
                  (line.productId ? `Product · ${line.productId.slice(0, 8)}…` : '—');
                return (
                  <tr key={`${line.productId ?? 'p'}-${i}`} className="border-t border-app-border">
                    <td className="px-3 py-2">
                      {line.productId ? (
                        <Link
                          to={`/admin/products/${line.productId}`}
                          className="text-brand-500 hover:text-brand-600 hover:underline"
                        >
                          {productLabel}
                        </Link>
                      ) : (
                        productLabel
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <NairaPrice amount={unit} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      <NairaPrice amount={lineTotal} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-app-border bg-app-hover/50">
                <td className="px-3 py-2 text-app-fg-muted text-xs uppercase tracking-wider" colSpan={3}>
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-app-fg">
                  <NairaPrice amount={total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-xs text-app-fg-muted">No line items in payload.</p>
      )}
    </div>
  );
}

function userCreationBranchLabel(id: string, branchNameById: ReadonlyMap<string, string>): string {
  const name = branchNameById.get(id);
  if (name) return name;
  return id.length >= 8 ? `Branch · ${id.slice(0, 8)}…` : id;
}

function UserCreationPayloadView({
  payload,
  branchNameById,
}: {
  payload: UserCreationPayload;
  branchNameById: ReadonlyMap<string, string>;
}) {
  const branchIdsUnique = [
    ...new Set([...(payload.branchIds ?? []), ...(payload.primaryBranchId ? [payload.primaryBranchId] : [])]),
  ];
  const sortedBranchIds = [...branchIdsUnique].sort((a, b) => {
    const primary = payload.primaryBranchId;
    if (primary) {
      if (a === primary && b !== primary) return -1;
      if (b === primary && a !== primary) return 1;
    }
    return userCreationBranchLabel(a, branchNameById).localeCompare(
      userCreationBranchLabel(b, branchNameById),
    );
  });

  return (
    <div>
      <p className="text-xs font-medium text-app-fg-muted mb-1.5">User to create</p>
      <DescriptionList
        items={[
          { label: 'Name', value: payload.name ?? '—' },
          { label: 'Email', value: payload.email ?? '—' },
          { label: 'Role', value: payload.role ?? '—' },
          ...(payload.phone ? [{ label: 'Phone', value: payload.phone }] : []),
          ...(sortedBranchIds.length > 0
            ? [
                {
                  label: 'Branches',
                  value: (
                    <ul className="list-disc pl-4 text-sm text-app-fg space-y-0.5">
                      {sortedBranchIds.map((id) => (
                        <li key={id}>
                          {userCreationBranchLabel(id, branchNameById)}
                          {payload.primaryBranchId === id ? (
                            <span className="text-app-fg-muted font-normal"> (primary)</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function ProductArchivePayloadView({ payload }: { payload: ProductArchivePayload }) {
  return (
    <div>
      <p className="text-xs font-medium text-app-fg-muted mb-1.5">Product to archive</p>
      <DescriptionList
        items={[
          {
            label: 'Product',
            value: payload.productId ? (
              <Link
                to={`/admin/products/${payload.productId}`}
                className="text-brand-500 hover:text-brand-600 hover:underline"
              >
                {payload.productName ?? `Product · ${payload.productId.slice(0, 8)}…`}
              </Link>
            ) : (
              (payload.productName ?? '—')
            ),
          },
          ...(payload.reason ? [{ label: 'Reason', value: payload.reason }] : []),
        ]}
      />
    </div>
  );
}
