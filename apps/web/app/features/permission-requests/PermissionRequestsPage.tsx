import { useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { Link } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import type { PermissionRequest } from './types';

const REQUEST_TYPE_LABELS: Record<string, string> = {
  USER_CREATION: 'User Creation',
  ROLE_CHANGE: 'Role Change',
  PERMISSION_GRANT: 'Permission Grant',
};

export function PermissionRequestsPage({ requests, canApprove = false }: { requests: PermissionRequest[]; canApprove?: boolean }) {
  const fetcher = useFetcher();
  const [modal, setModal] = useState<{ requestId: string; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reason, setReason] = useState('');
  const fetcherError = (fetcher.data as { error?: string })?.error;
  const [dismissedError, setDismissedError] = useState(false);

  useFetcherToast(fetcher.data, { successMessage: 'Request processed' });

  useEffect(() => {
    if (fetcherError) setDismissedError(false);
  }, [fetcherError]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Permission Requests</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          HR requests for sensitive roles (Super Admin, Finance Officer) require your approval.
        </p>
      </div>

      {fetcherError && !dismissedError && (
        <PageNotification
          variant="error"
          message={fetcherError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Type</th>
                <th className="table-header">Requester</th>
                <th className="table-header">Target</th>
                <th className="table-header">Requested</th>
                <th className="table-header">Reason</th>
                <th className="table-header">Date</th>
                {canApprove && <th className="table-header">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} className="table-row">
                  <td className="table-cell">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                      {REQUEST_TYPE_LABELS[req.type] ?? req.type}
                    </span>
                  </td>
                  <td className="table-cell text-sm">
                    <span className="font-medium text-surface-900 dark:text-white">{req.requesterName}</span>
                    <span className="block text-xs text-surface-600 dark:text-surface-200">{req.requesterEmail}</span>
                  </td>
                  <td className="table-cell text-sm">
                    {req.type === 'USER_CREATION' && req.payload ? (
                      <span>
                        {(req.payload as { name?: string }).name ?? '—'}
                        <span className="block text-xs text-surface-600 dark:text-surface-200">
                          {(req.payload as { email?: string }).email ?? ''}
                        </span>
                      </span>
                    ) : req.targetUserName ? (
                      <span>
                        {req.targetUserName}
                        <span className="block text-xs text-surface-600 dark:text-surface-200">{req.targetUserEmail ?? ''}</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="table-cell text-sm">
                    {req.requestedRole && (
                      <span className="font-medium text-surface-900 dark:text-white">{req.requestedRole.replace(/_/g, ' ')}</span>
                    )}
                    {req.permissionCode && (
                      <span className="font-mono text-xs text-surface-600 dark:text-surface-200">{req.permissionCode}</span>
                    )}
                    {!req.requestedRole && !req.permissionCode && '—'}
                  </td>
                  <td className="table-cell text-sm text-surface-800 dark:text-surface-200 max-w-xs truncate">
                    {req.reason}
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                    {new Date(req.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  {canApprove && (
                    <td className="table-cell">
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          variant="success"
                          size="sm"
                          className="text-xs"
                          onClick={() => { setModal({ requestId: req.id, action: 'APPROVED' }); setReason(''); }}
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          className="text-xs"
                          onClick={() => { setModal({ requestId: req.id, action: 'REJECTED' }); setReason(''); }}
                        >
                          Reject
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={canApprove ? 7 : 6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                    No pending permission requests
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden space-y-3 px-1">
          {requests.map((req) => (
            <div key={req.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                  {REQUEST_TYPE_LABELS[req.type] ?? req.type}
                </span>
              </div>
              <p className="text-sm font-medium text-surface-900 dark:text-white">
                {req.requesterName} → {req.requestedRole?.replace(/_/g, ' ') ?? req.permissionCode ?? '—'}
              </p>
              <p className="text-sm text-surface-600 dark:text-surface-200">{req.reason}</p>
              {canApprove && (
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="success"
                    size="sm"
                    className="text-xs flex-1"
                    onClick={() => { setModal({ requestId: req.id, action: 'APPROVED' }); setReason(''); }}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="text-xs flex-1"
                    onClick={() => { setModal({ requestId: req.id, action: 'REJECTED' }); setReason(''); }}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
          {requests.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-300">No pending permission requests</div>
          )}
        </div>
      </div>

      {/* Approve/Reject Modal */}
      {modal && (
        <Modal open onClose={() => setModal(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-6 flex flex-col max-h-[80dvh] overflow-hidden border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white shrink-0">
                {modal.action === 'APPROVED' ? 'Approve Request' : 'Reject Request'}
              </h3>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Reason <span className="text-surface-700">(min 10 characters)</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="input min-h-[80px]"
                    placeholder={
                      modal.action === 'APPROVED' ? 'Reason for approval...' : 'Reason for rejection...'
                    }
                  />
                </div>
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
