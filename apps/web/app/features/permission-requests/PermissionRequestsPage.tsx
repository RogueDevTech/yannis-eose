import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Link } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import type { PermissionRequest } from './types';

const REQUEST_TYPE_LABELS: Record<string, string> = {
  USER_CREATION: 'User Creation',
  ROLE_CHANGE: 'Role Change',
  PERMISSION_GRANT: 'Permission Grant',
};

export function PermissionRequestsPage({ requests }: { requests: PermissionRequest[] }) {
  const fetcher = useFetcher();
  const [modal, setModal] = useState<{ requestId: string; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reason, setReason] = useState('');

  useFetcherToast(fetcher.data, { successMessage: 'Request processed' });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Permission Requests</h1>
        <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
          HR requests for sensitive roles (Super Admin, Finance Officer) require your approval.
        </p>
      </div>

      {(fetcher.data as { error?: string })?.error && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{(fetcher.data as { error?: string }).error}</p>
        </div>
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
                <th className="table-header">Actions</th>
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
                    <span className="block text-xs text-surface-600 dark:text-surface-400">{req.requesterEmail}</span>
                  </td>
                  <td className="table-cell text-sm">
                    {req.type === 'USER_CREATION' && req.payload ? (
                      <span>
                        {(req.payload as { name?: string }).name ?? '—'}
                        <span className="block text-xs text-surface-600 dark:text-surface-400">
                          {(req.payload as { email?: string }).email ?? ''}
                        </span>
                      </span>
                    ) : req.targetUserName ? (
                      <span>
                        {req.targetUserName}
                        <span className="block text-xs text-surface-600 dark:text-surface-400">{req.targetUserEmail ?? ''}</span>
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
                      <span className="font-mono text-xs text-surface-600 dark:text-surface-400">{req.permissionCode}</span>
                    )}
                    {!req.requestedRole && !req.permissionCode && '—'}
                  </td>
                  <td className="table-cell text-sm text-surface-800 dark:text-surface-400 max-w-xs truncate">
                    {req.reason}
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-400 text-sm">
                    {new Date(req.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => { setModal({ requestId: req.id, action: 'APPROVED' }); setReason(''); }}
                        className="btn-success btn-sm text-xs"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => { setModal({ requestId: req.id, action: 'REJECTED' }); setReason(''); }}
                        className="btn-danger btn-sm text-xs"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">
                    No pending permission requests
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {requests.map((req) => (
            <div key={req.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                  {REQUEST_TYPE_LABELS[req.type] ?? req.type}
                </span>
              </div>
              <p className="text-sm font-medium text-surface-900 dark:text-white">
                {req.requesterName} → {req.requestedRole?.replace(/_/g, ' ') ?? req.permissionCode ?? '—'}
              </p>
              <p className="text-xs text-surface-600 dark:text-surface-400">{req.reason}</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setModal({ requestId: req.id, action: 'APPROVED' }); setReason(''); }}
                  className="btn-success btn-sm text-xs flex-1"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => { setModal({ requestId: req.id, action: 'REJECTED' }); setReason(''); }}
                  className="btn-danger btn-sm text-xs flex-1"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {requests.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-500">No pending permission requests</div>
          )}
        </div>
      </div>

      {/* Approve/Reject Modal */}
      {modal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div className="fixed inset-x-0 top-[20vh] z-50 mx-auto max-w-md px-4">
            <div className="rounded-xl bg-white dark:bg-surface-800 shadow-2xl border border-surface-200 dark:border-surface-700 p-6 space-y-4">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
                {modal.action === 'APPROVED' ? 'Approve Request' : 'Reject Request'}
              </h3>
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
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setModal(null)} className="btn-secondary btn-sm">
                  Cancel
                </button>
                <fetcher.Form method="post" onSubmit={() => setModal(null)}>
                  <input type="hidden" name="intent" value={modal.action === 'APPROVED' ? 'approve' : 'reject'} />
                  <input type="hidden" name="requestId" value={modal.requestId} />
                  <input type="hidden" name="reason" value={reason} />
                  <button
                    type="submit"
                    disabled={reason.length < 10 || fetcher.state === 'submitting'}
                    className={`btn-sm ${modal.action === 'APPROVED' ? 'btn-success' : 'btn-danger'}`}
                  >
                    {fetcher.state === 'submitting' ? 'Processing...' : 'Confirm'}
                  </button>
                </fetcher.Form>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
