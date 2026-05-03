import { useState, useEffect, useMemo } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
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
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Textarea } from '~/components/ui/textarea';
import { Tabs } from '~/components/ui/tabs';
import { DescriptionList } from '~/components/ui/description-list';
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
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
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
  if (req.requestedRole) return req.requestedRole.replace(/_/g, ' ');
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

export function PermissionRequestsPage({
  requests,
  canApprove = false,
  canApproveProductArchive = false,
  canApproveOrderLinePriceChange = false,
  viewerId = '',
  activeStatus = 'PENDING',
}: {
  requests: PermissionRequest[];
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
  const [viewing, setViewing] = useState<PermissionRequest | null>(null);
  const [modal, setModal] = useState<{ requestId: string; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reason, setReason] = useState('');
  const fetcherError = (fetcher.data as { error?: string })?.error;
  const [dismissedError, setDismissedError] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useFetcherToast(fetcher.data, { successMessage: 'Request processed' });

  useEffect(() => {
    if (fetcherError) setDismissedError(false);
  }, [fetcherError]);

  const handleStatusChange = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'PENDING') {
      params.delete('status');
    } else {
      params.set('status', next);
    }
    setSearchParams(params, { replace: true });
  };

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
        render: (req) => (
          <CompactTableActionButton onClick={() => setViewing(req)}>View</CompactTableActionButton>
        ),
      },
    ],
    [],
  );

  const emptyTitle =
    activeStatus === 'PENDING' ? 'No pending permission requests' : `No ${activeStatus.toLowerCase()} permission requests`;
  const emptyDescription =
    activeStatus === 'PENDING'
      ? 'New requests from HR will appear here for your review.'
      : 'Try switching the tab to see requests in other states.';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Permission Requests"
        description="Sensitive changes (including admin-level staff and product archive) may require Super Admin approval. Approved and rejected requests are preserved for audit."
        actions={<PageRefreshButton />}
      />

      {fetcherError && !dismissedError && (
        <PageNotification
          variant="error"
          message={fetcherError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <Tabs
        value={activeStatus}
        onChange={handleStatusChange}
        tabs={STATUS_TABS.map((t) => ({ value: t.value, label: t.label }))}
      />

      <div className="card p-0 flex flex-col max-h-[min(70vh,24rem)] md:max-h-[min(60vh,22rem)] overflow-y-auto overscroll-contain min-h-0">
        <CompactTable<PermissionRequest>
          withCard={false}
          className="min-h-0 min-w-0"
          columns={requestColumns}
          rows={requests}
          rowKey={(r) => r.id}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        />
      </div>

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
            {viewing.type === 'USER_CREATION' && viewing.payload ? (
              <div>
                <p className="text-xs font-medium text-app-fg-muted mb-1.5">Creation payload</p>
                <pre className="text-xs font-mono bg-app-hover rounded-md p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words border border-app-border">
                  {JSON.stringify(viewing.payload, null, 2)}
                </pre>
              </div>
            ) : viewing.type === 'PRODUCT_ARCHIVE' && viewing.payload ? (
              <div>
                <p className="text-xs font-medium text-app-fg-muted mb-1.5">Product</p>
                <pre className="text-xs font-mono bg-app-hover rounded-md p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words border border-app-border">
                  {JSON.stringify(viewing.payload, null, 2)}
                </pre>
              </div>
            ) : viewing.type === 'ORDER_LINE_PRICE_CHANGE' && viewing.payload ? (
              <div>
                <p className="text-xs font-medium text-app-fg-muted mb-1.5">Proposed items & total</p>
                <pre className="text-xs font-mono bg-app-hover rounded-md p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words border border-app-border">
                  {JSON.stringify(viewing.payload, null, 2)}
                </pre>
              </div>
            ) : viewing.type === 'ORDER_DELETION' && viewing.payload ? (
              <div>
                <p className="text-xs font-medium text-app-fg-muted mb-1.5">Order to archive</p>
                <pre className="text-xs font-mono bg-app-hover rounded-md p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words border border-app-border">
                  {JSON.stringify(viewing.payload, null, 2)}
                </pre>
              </div>
            ) : null}
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
        <Modal open onClose={() => setModal(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-6 flex flex-col max-h-[80dvh] overflow-hidden border border-app-border bg-app-elevated">
              <h3 className="text-lg font-semibold text-app-fg shrink-0">
                {modal.action === 'APPROVED' ? 'Approve Request' : 'Reject Request'}
              </h3>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
                <Textarea
                  label="Reason"
                  hint="Minimum 10 characters"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={
                    modal.action === 'APPROVED' ? 'Reason for approval...' : 'Reason for rejection...'
                  }
                />
              </div>
              <div className="flex gap-2 justify-end shrink-0 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Button type="button" variant="secondary" size="sm" onClick={() => setModal(null)}>
                  Cancel
                </Button>
                <fetcher.Form method="post" onSubmit={() => setModal(null)}>
                  <input type="hidden" name="intent" value={modal.action === 'APPROVED' ? 'approve' : 'reject'} />
                  <input type="hidden" name="requestId" value={modal.requestId} />
                  <input type="hidden" name="reason" value={reason} />
                  <Button
                    type="submit"
                    variant={modal.action === 'APPROVED' ? 'success' : 'danger'}
                    size="sm"
                    disabled={reason.length < 10 || fetcher.state === 'submitting'}
                    loading={fetcher.state === 'submitting'}
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
