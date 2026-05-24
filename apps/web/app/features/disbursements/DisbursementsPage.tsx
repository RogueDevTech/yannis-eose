import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFetcher, useSearchParams, useNavigation, useLocation, Link } from '@remix-run/react';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { createFundingSchema, approveFundingRequestSchema } from '@yannis/shared/validators';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { AmountInput } from '~/components/ui/amount-input';
import { formatNaira } from '~/lib/format-amount';
import { Button } from '~/components/ui/button';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { ExportModal } from '~/components/ui/export-modal';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { formatRole } from '~/features/users/types';
import { PageHeader } from '~/components/ui/page-header';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTable, CompactTableActions, type CompactTableColumn } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { Tabs } from '~/components/ui/tabs';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import type { FileUploadUploadState } from '~/components/ui/file-upload';

const STATUS_OPTIONS = ['ALL', 'SENT', 'COMPLETED', 'DISPUTED'] as const;

const STATUS_LABELS: Record<string, string> = {
  ALL: 'All',
  SENT: 'Pending',
  COMPLETED: 'Received',
  DISPUTED: 'Disputed',
};

/** Top-level route views — switched by URL `tab` param. */
type MainTab = 'disbursements' | 'requests' | 'balances';

function mainTabFromSearchParams(sp: URLSearchParams): MainTab {
  const t = sp.get('tab');
  if (t === 'requests') return 'requests';
  if (t === 'balances') return 'balances';
  // Legacy: ?tab=activity&type=REQUESTS|DISBURSEMENTS
  if (t === 'activity') {
    const type = sp.get('type');
    if (type === 'REQUESTS') return 'requests';
    return 'disbursements';
  }
  return 'disbursements';
}

export interface DisbursementRecord {
  id: string;
  senderId: string;
  receiverId: string;
  amount: string;
  receiptUrl: string | null;
  status: string;
  sentAt: string;
  verifiedAt: string | null;
  senderName?: string | null;
  receiverName?: string | null;
}

export interface FundingRequestRecord {
  id: string;
  requesterId: string;
  amount: string;
  reason: string | null;
  status: string;
  receiptUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Set by API when listing (join with users); fallback to lookup by requesterId */
  requesterName?: string | null;
}

export interface DisbursementsPageData {
  funding: DisbursementRecord[];
  totalFunding: number;
  totalPages: number;
  page: number;
  /** URL-driven page size for the funding table (`perPage` param). */
  perPage?: number;
  users: Array<{ id: string; name: string; email: string; role: string }>;
  canDisburseToHoM: boolean;
  canDisburseToMediaBuyers: boolean;
  preselectedReceiverId?: string | null;
  filters?: {
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
    status: string;
    receiver: string;
    /** Free-text search — matches sender name, receiver name, or row ID server-side. */
    search: string;
    balancesSearch?: string;
    balancesRole?: string;
    balancesStatus?: string;
  };
  recipientBalances?: Array<{
    userId: string;
    name: string;
    role: string;
    totalReceived: string;
    totalSpend: string;
    balance: string;
  }>;
  recipientBalancesTotal?: number;
  balancesPage?: number;
  balancesTotalPages?: number;
  /** URL-driven page size for the recipient balances table (`balancesPerPage` param). */
  balancesPerPage?: number;
  summary?: {
    totalSent: string;
    totalCompleted: string;
    totalDisputed: string;
  };
  fundingRequests?: FundingRequestRecord[];
  fundingRequestsTotal?: number;
  /** Status counts across ALL funding requests (org-wide; period scope is the
   * loader's date range when applied to the count endpoint). Used by the
   * overview strip to surface "Pending Requests: N" so Finance / SuperAdmin
   * can see at-a-glance there are HoM-originated asks awaiting their action
   * without first switching the View dropdown to "Funding requests". */
  fundingRequestStatusCounts?: { PENDING: number; APPROVED: number; REJECTED: number; ALL: number };
  requestsPage?: number;
  requestsTotalPages?: number;
  /** URL-driven page size for the funding requests table (`requestsPerPage` param). */
  requestsPerPage?: number;
  requestersList?: Array<{ id: string; name: string; email: string; role: string }>;
}

/** Receipt preview modal — shows image inline with disbursement amount */
function ReceiptModal({
  open,
  onClose,
  receiptUrl,
  amount,
  senderName,
  receiverName,
  sentAt,
  status,
}: {
  open: boolean;
  onClose: () => void;
  receiptUrl: string;
  amount: string;
  senderName: string;
  receiverName: string;
  sentAt: string;
  status: string;
}) {
  if (!open) return null;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
          <h3 className="text-lg font-semibold text-app-fg">Disbursement receipt</h3>
          <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
          {/* Amount highlight */}
          <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
            <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Disbursement amount</p>
            <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
              <NairaPrice amount={Number(amount)} />
            </p>
            <div className="flex items-center gap-2 mt-2 text-xs text-brand-500 dark:text-brand-400">
              <span>{senderName} &rarr; {receiverName}</span>
              <span>&middot;</span>
              <span>{new Date(sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span>&middot;</span>
              <StatusBadge status={status} />
            </div>
          </div>

          {/* Receipt image */}
          <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
            <img
              src={receiptUrl}
              alt="Payment receipt"
              className="w-full max-h-[400px] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = (e.target as HTMLImageElement).nextElementSibling;
                if (fallback) (fallback as HTMLElement).style.display = 'flex';
              }}
            />
            <div className="items-center justify-center gap-2 p-8 hidden">
              <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="text-sm text-app-fg-muted">Receipt is not an image file</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Open in new tab
          </a>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
    </Modal>
  );
}

/** Create disbursement modal */
function CreateDisbursementModal({
  open,
  onClose,
  recipients,
  recipientBalances,
  preselectedReceiverId,
}: {
  open: boolean;
  onClose: () => void;
  recipients: Array<{ id: string; name: string; role?: string }>;
  recipientBalances: Array<{ userId: string; balance: string }>;
  preselectedReceiverId: string | null;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const { toast } = useToast();
  const [receiptUrl, setReceiptUrl] = useState('');
  const [uploadState, setUploadState] = useState<FileUploadUploadState>('idle');
  const [receiverId, setReceiverId] = useState(preselectedReceiverId ?? '');

  useFetcherToast(fetcher.data, {
    successMessage: 'Disbursement sent successfully',
    skipErrorToast: open,
  });

  useCloseOnFetcherSuccess(fetcher, onClose);

  useEffect(() => {
    if (!open) {
      setReceiptUrl('');
      setUploadState('idle');
      setReceiverId(preselectedReceiverId ?? '');
    }
  }, [open, preselectedReceiverId]);

  const handleCreateDisbursementSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fdRead = new FormData(formEl);
    const parsed = createFundingSchema.safeParse({
      receiverId: fdRead.get('receiverId')?.toString() ?? '',
      amount: fdRead.get('amount')?.toString() ?? '',
      receiptUrl: receiptUrl.trim(),
    });
    if (!parsed.success) {
      toast.error('Cannot send disbursement', parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    const fd = new FormData(formEl);
    fd.set('receiptUrl', parsed.data.receiptUrl ?? '');
    fetcher.submit(fd, { method: 'post' });
  };

  const submitDisabled = uploadState === 'uploading' || !receiptUrl.trim();

  if (!open) return null;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
          <h3 className="text-lg font-semibold text-app-fg">New disbursement</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={fetcher.state === 'submitting'}
            className="text-app-fg-muted hover:text-app-fg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <fetcher.Form
          method="post"
          className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          onSubmit={handleCreateDisbursementSubmit}
          noValidate
        >
          <input type="hidden" name="intent" value="createFunding" />
          <input type="hidden" name="receiverId" value={receiverId} />

          <SearchableSelect
            id="disbursement-create-receiver"
            label="Recipient"
            value={receiverId}
            onChange={setReceiverId}
            placeholder="Select recipient..."
            searchPlaceholder="Search recipients..."
            options={recipients.map((u) => {
              const bal = recipientBalances.find((b) => b.userId === u.id);
              const balanceLabel = bal != null ? ` — Balance: ${formatNaira(Number(bal.balance))}` : '';
              return {
                value: u.id,
                label: `${u.name}${u.role ? ` (${formatRole(u.role)})` : ''}${balanceLabel}`,
              };
            })}
          />

          <div>
            <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount (&#8358;)</label>
            <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input w-full" />
          </div>

          <div>
            <FileUpload
              folder={ASSET_FOLDERS.RECEIPTS}
              name="receiptUrl"
              label="Payment receipt"
              onUpload={(url) => setReceiptUrl(url)}
              onUploadStateChange={setUploadState}
            />
          </div>

          <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('createFunding')} />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={fetcher.state === 'submitting'}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={fetcher.state === 'submitting'}
              loadingText="Sending..."
              disabled={submitDisabled}
            >
              Send disbursement
            </Button>
          </div>
        </fetcher.Form>
    </Modal>
  );
}

export function DisbursementsPage({
  funding,
  totalFunding,
  totalPages,
  page,
  perPage = 20,
  users,
  canDisburseToHoM,
  preselectedReceiverId = null,
  filters = {
    startDate: '',
    endDate: '',
    periodAllTime: false,
    status: '',
    receiver: '',
    search: '',
    balancesSearch: '',
    balancesRole: '',
    balancesStatus: '',
  },
  recipientBalances = [],
  recipientBalancesTotal = 0,
  balancesPage = 1,
  balancesTotalPages = 1,
  balancesPerPage = 20,
  summary = { totalSent: '0', totalCompleted: '0', totalDisputed: '0' },
  fundingRequests = [],
  fundingRequestsTotal = 0,
  fundingRequestStatusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 },
  requestsPage = 1,
  requestsTotalPages = 1,
  requestsPerPage = 20,
  requestersList = [],
}: DisbursementsPageData) {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const [showForm, setShowForm] = useState(!!preselectedReceiverId);
  // Read the pending URL while the loader revalidates — same pattern as the
  // marketing funding page. Without this, `mainTab` only flips when the loader
  // resolves (100–500ms) and the click feels laggy. Reading from
  // `navigation.location.search` lets the active tab flip on the same tick the
  // user clicks; the table loading overlay covers the data fetch.
  const navigation = useNavigation();
  const location = useLocation();
  const pendingTabParams = useMemo(() => {
    const isPendingHere =
      navigation.state === 'loading' &&
      navigation.location?.pathname.includes('/admin/finance/disbursements');
    const search = isPendingHere && navigation.location ? navigation.location.search : location.search;
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  }, [navigation.state, navigation.location, location.search]);
  const mainTab = mainTabFromSearchParams(pendingTabParams);
  const [receiptModal, setReceiptModal] = useState<DisbursementRecord | null>(null);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [requestReceiptModal, setRequestReceiptModal] = useState<FundingRequestRecord | null>(null);
  const [approveRequestReceiptUrl, setApproveRequestReceiptUrl] = useState('');
  const [approveRequestUploadState, setApproveRequestUploadState] = useState<FileUploadUploadState>('idle');

  const requestActionFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const requestActionSurface = useFetcherActionSurface(requestActionFetcher);
  const RequestActionForm = requestActionFetcher.Form;
  const requestApproveRejectModalOpen = !!approvingRequestId || !!rejectingRequestId;
  useFetcherToast(requestActionFetcher.data, {
    successMessage: 'Request updated',
    skipErrorToast: requestApproveRejectModalOpen,
  });

  // Close approve / reject modal the same tick the toast fires; revalidation
  // is handled inside the close hook.
  const handleRequestActionSuccess = useCallback(() => {
    setApprovingRequestId(null);
    setRejectingRequestId(null);
  }, []);
  useCloseOnFetcherSuccess(requestActionFetcher, handleRequestActionSuccess);

  useEffect(() => {
    if (!approvingRequestId) {
      setApproveRequestReceiptUrl('');
      setApproveRequestUploadState('idle');
    }
  }, [approvingRequestId]);

  const approvingRequestRow = useMemo(
    () => (approvingRequestId ? fundingRequests.find((r) => r.id === approvingRequestId) : undefined),
    [approvingRequestId, fundingRequests],
  );

  const handleApproveFundingRequestSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!approvingRequestId || !approvingRequestRow) return;
    const formEl = e.currentTarget;
    const fdRead = new FormData(formEl);
    const approvedAmt = Number(fdRead.get('amount')?.toString() ?? '');
    const requestedAmt = Number(approvingRequestRow.amount);
    if (!Number.isFinite(approvedAmt) || approvedAmt <= 0) {
      toast.error('Cannot approve request', 'Enter a valid approved amount.');
      return;
    }
    if (Math.round(approvedAmt * 100) > Math.round(requestedAmt * 100)) {
      toast.error('Cannot approve request', 'Approved amount cannot exceed the requested amount.');
      return;
    }
    const parsed = approveFundingRequestSchema.safeParse({
      requestId: approvingRequestId,
      amount: approvedAmt,
      receiptUrl: approveRequestReceiptUrl.trim(),
    });
    if (!parsed.success) {
      toast.error('Cannot approve request', parsed.error.issues[0]?.message ?? 'Attach a valid receipt image.');
      return;
    }
    const fd = new FormData(formEl);
    fd.set('receiptUrl', parsed.data.receiptUrl ?? '');
    fd.set('amount', String(parsed.data.amount));
    requestActionFetcher.submit(fd, { method: 'post' });
  };

  const approveRequestSubmitDisabled =
    approveRequestUploadState === 'uploading' || !approveRequestReceiptUrl.trim();

  const getRequesterName = useCallback(
    (requesterId: string) => requestersList.find((u) => u.id === requesterId)?.name ?? 'Unknown user',
    [requestersList],
  );

  // Optimistic filter state: switch tab/filter immediately, then fetch in background
  const [optimisticStatus, setOptimisticStatus] = useState(filters.status || 'ALL');
  const [optimisticReceiver, setOptimisticReceiver] = useState(filters.receiver || 'ALL');
  // Search input is intentionally NOT optimistic — we only fire on submit so the user gets a
  // single, debounce-free query against the server. Prefilled from the URL on mount/back-nav.
  const [searchQuery, setSearchQuery] = useState(filters.search || '');
  const [showExportModal, setShowExportModal] = useState(false);
  const [balancesSearchQuery, setBalancesSearchQuery] = useState(filters.balancesSearch || '');
  const [balancesRoleFilter, setBalancesRoleFilter] = useState(filters.balancesRole || 'ALL');
  const [balancesStatusFilter, setBalancesStatusFilter] = useState(filters.balancesStatus || 'ALL');
  useEffect(() => {
    setOptimisticStatus(filters.status || 'ALL');
    setOptimisticReceiver(filters.receiver || 'ALL');
    setSearchQuery(filters.search || '');
    setBalancesSearchQuery(filters.balancesSearch || '');
    setBalancesRoleFilter(filters.balancesRole || 'ALL');
    setBalancesStatusFilter(filters.balancesStatus || 'ALL');
  }, [
    filters.status,
    filters.receiver,
    filters.search,
    filters.balancesSearch,
    filters.balancesRole,
    filters.balancesStatus,
  ]);

  const setMainTab = useCallback((tab: MainTab) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('tab', tab);
      next.delete('type');
      return next;
    });
  }, [setSearchParams]);

  const canCreate = canDisburseToHoM;
  const recipients = canDisburseToHoM ? users : [];

  // Active filter badge count for mobile kebab dot
  const disbursementsFilterBadge =
    (optimisticStatus !== 'ALL' ? 1 : 0) +
    (optimisticReceiver !== 'ALL' ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);
  const balancesFilterBadge =
    (balancesRoleFilter !== 'ALL' ? 1 : 0) +
    (balancesStatusFilter !== 'ALL' ? 1 : 0) +
    (balancesSearchQuery.trim() ? 1 : 0);
  const activeFilterBadge =
    mainTab === 'disbursements' ? disbursementsFilterBadge
    : mainTab === 'balances' ? balancesFilterBadge
    : 0;

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of recipientBalances) {
      map.set(b.userId, b.name);
    }
    for (const f of funding) {
      if (f.senderName != null && f.senderName !== '') map.set(f.senderId, f.senderName);
      if (f.receiverName != null && f.receiverName !== '') map.set(f.receiverId, f.receiverName);
    }
    return map;
  }, [recipientBalances, funding]);

  const getName = useCallback((id: string) => nameMap.get(id) ?? 'Unknown user', [nameMap]);

  const selectedStatus = optimisticStatus;
  const selectedReceiver = optimisticReceiver;

  const handleStatusChange = (status: string) => {
    setOptimisticStatus(status);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (status === 'ALL') next.delete('status');
      else next.set('status', status);
      return next;
    });
  };

  const handleReceiverChange = (receiverId: string) => {
    setOptimisticReceiver(receiverId);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (receiverId === 'ALL') next.delete('receiver');
      else next.set('receiver', receiverId);
      return next;
    });
  };

  /** Submit handler — fires on form submit so we don't hit the server on every keystroke.
   * Server-side search matches against sender name, receiver name, or row ID. */
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      const q = searchQuery.trim();
      if (q) next.set('search', q);
      else next.delete('search');
      return next;
    });
  };

  const handleBalancesSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('balancesPage', '1');
      const q = balancesSearchQuery.trim();
      if (q) next.set('balancesSearch', q);
      else next.delete('balancesSearch');
      return next;
    });
  };

  const handleBalancesRoleChange = (role: string) => {
    setBalancesRoleFilter(role);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('balancesPage', '1');
      if (role === 'ALL') next.delete('balancesRole');
      else next.set('balancesRole', role);
      return next;
    });
  };

  const handleBalancesStatusChange = (status: string) => {
    setBalancesStatusFilter(status);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('balancesPage', '1');
      if (status === 'ALL') next.delete('balancesStatus');
      else next.set('balancesStatus', status);
      return next;
    });
  };

  const totalSentAmt = Number(summary.totalSent) || 0;
  const totalReceivedAmt = Number(summary.totalCompleted) || 0;
  const totalDisputedAmt = Number(summary.totalDisputed) || 0;
  const totalAllAmt = totalSentAmt + totalReceivedAmt + totalDisputedAmt;

  const handleCloseCreateModal = useCallback(() => setShowForm(false), []);

  type RecipientBalanceRow = (typeof recipientBalances)[number];

  const fundingLedgerColumns = useMemo((): CompactTableColumn<DisbursementRecord>[] => {
    return [
      {
        key: 'reference',
        header: 'Reference',
        render: (f) => (
          <span className="text-sm text-app-fg-muted">
            {getName(f.receiverId)} · {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        ),
      },
      {
        key: 'sender',
        header: 'Sender',
        render: (f) => (
          <Link
            to={`/admin/finance/staff-accounts/${f.senderId}`}
            className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {getName(f.senderId)}
          </Link>
        ),
      },
      {
        key: 'receiver',
        header: 'Receiver',
        render: (f) => (
          <Link
            to={`/admin/finance/staff-accounts/${f.receiverId}`}
            className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {getName(f.receiverId)}
          </Link>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        headerClassName: 'text-right',
        render: (f) => (
          <span className="font-medium text-app-fg">
            <NairaPrice amount={Number(f.amount)} />
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (f) => <StatusBadge status={f.status} />,
      },
      {
        key: 'sent',
        header: 'Sent',
        render: (f) => (
          <span className="text-sm text-app-fg-muted">
            {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        ),
      },
      {
        key: 'verified',
        header: 'Verified',
        render: (f) => (
          <span className="text-sm text-app-fg-muted">
            {f.verifiedAt
              ? new Date(f.verifiedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })
              : '—'}
          </span>
        ),
      },
      {
        key: 'receipt',
        header: 'Receipt',
        align: 'center',
        headerClassName: 'text-center',
        render: (f) =>
          f.receiptUrl ? (
            <TableActionButton type="button" variant="primary" title="View" onClick={() => setReceiptModal(f)}>
              View
            </TableActionButton>
          ) : (
            <span className="text-xs text-surface-400">—</span>
          ),
      },
    ];
  }, [getName]);

  const fundingRequestColumns = useMemo((): CompactTableColumn<FundingRequestRecord>[] => {
    return [
      {
        key: 'requester',
        header: 'Requester',
        render: (r) => (
          <Link
            to={`/admin/finance/staff-accounts/${r.requesterId}`}
            className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
          >
            {r.requesterName ?? getRequesterName(r.requesterId)}
          </Link>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        headerClassName: 'text-right',
        render: (r) => (
          <span className="font-medium">
            <NairaPrice amount={Number(r.amount)} />
          </span>
        ),
      },
      {
        key: 'reason',
        header: 'Reason',
        cellTitle: (r) => r.reason ?? undefined,
        render: (r) => (
          <span className="max-w-[200px] truncate text-sm text-app-fg-muted">{r.reason ?? '—'}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        key: 'requested',
        header: 'Requested',
        render: (r) => (
          <span className="text-sm text-app-fg-muted">
            {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        ),
      },
      {
        key: 'resolved',
        header: 'Resolved',
        render: (r) => (
          <span className="text-sm text-app-fg-muted">
            {r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          </span>
        ),
      },
      {
        key: 'receipt',
        header: 'Receipt',
        render: (r) =>
          r.receiptUrl ? (
            <TableActionButton type="button" variant="primary" title="View" onClick={() => setRequestReceiptModal(r)}>
              View
            </TableActionButton>
          ) : (
            <span className="text-app-fg-muted">—</span>
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        tight: true,
        nowrap: true,
        align: 'right',
        headerClassName: 'text-right',
        mobileShowLabel: false,
        render: (r) =>
          r.status === 'PENDING' ? (
            <CompactTableActions className="inline-flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
              <TableActionButton variant="primary" onClick={() => setApprovingRequestId(r.id)}>
                Approve
              </TableActionButton>
              <TableActionButton variant="danger" onClick={() => setRejectingRequestId(r.id)}>
                Reject
              </TableActionButton>
            </CompactTableActions>
          ) : null,
      },
    ];
  }, [getRequesterName]);

  const recipientBalanceColumns = useMemo((): CompactTableColumn<RecipientBalanceRow>[] => {
    return [
      {
        key: 'recipient',
        header: 'Recipient',
        render: (b) => (
          <Link
            to={`/admin/finance/staff-accounts/${b.userId}`}
            className="text-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
          >
            {b.name}
          </Link>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        render: (b) => (
          <span className="text-sm text-app-fg-muted">
            {b.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : b.role === 'MEDIA_BUYER' ? 'Media Buyer' : b.role}
          </span>
        ),
      },
      {
        key: 'received',
        header: 'Received',
        align: 'right',
        headerClassName: 'text-right',
        render: (b) => (
          <span className="text-sm">
            <NairaPrice amount={Number(b.totalReceived)} />
          </span>
        ),
      },
      {
        key: 'spent',
        header: 'Spent',
        align: 'right',
        headerClassName: 'text-right',
        render: (b) => (
          <span className="text-sm">
            <NairaPrice amount={Number(b.totalSpend)} />
          </span>
        ),
      },
      {
        key: 'balance',
        header: 'Balance',
        align: 'right',
        headerClassName: 'text-right',
        render: (b) => {
          const balance = Number(b.balance);
          return (
            <span className={`font-medium ${balance < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-brand-600 dark:text-brand-400'}`}>
              {formatNaira(balance)}
            </span>
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'center',
        headerClassName: 'text-center',
        tight: true,
        mobileShowLabel: false,
        render: (b) => {
          const canSendFundsToRecipient = canCreate && b.role === 'HEAD_OF_MARKETING';
          return canSendFundsToRecipient ? (
            <TableActionButton
              variant="primary"
              onClick={() => {
                setSearchParams((p) => {
                  const next = new URLSearchParams(p);
                  next.set('receiverId', b.userId);
                  next.set('tab', 'disbursements');
                  next.delete('type');
                  return next;
                });
                setShowForm(true);
              }}
            >
              Send funds
            </TableActionButton>
          ) : (
            <span className="text-xs text-surface-400">&mdash;</span>
          );
        },
      },
    ];
  }, [canCreate, setSearchParams, setShowForm]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title="Disbursements"
        mobileInlineActions
        description="Send and track marketing disbursements."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Disbursement tools"
            sheetSubtitle={<span>Date range and actions</span>}
            triggerAriaLabel="Disbursement toolbar"
            filtersBadgeCount={activeFilterBadge}
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime} chrome="pill" />
                <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                  Generate report
                </Button>
                {canCreate && (
                  <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
                    + New disbursement
                  </Button>
                )}
              </div>
            }
            filters={
              mainTab === 'disbursements' ? (
                <>
                  <FormSelect
                    id="disbursement-status-filter-sheet"
                    value={selectedStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
                    controlSize="lg"
                    className="!bg-app-hover text-center"
                    wrapperClassName="w-full"
                    aria-label="Filter by status"
                  />
                  <SearchableSelect
                    id="disbursement-recipient-filter-sheet"
                    value={selectedReceiver}
                    onChange={handleReceiverChange}
                    options={[
                      { value: 'ALL', label: 'All recipients' },
                      ...recipients.map((u) => ({ value: u.id, label: u.name })),
                    ]}
                    controlSize="lg"
                    triggerClassName="!bg-app-hover text-center"
                    wrapperClassName="w-full"
                    placeholder="All recipients"
                    searchPlaceholder="Search recipients..."
                  />
                </>
              ) : mainTab === 'balances' ? (
                <>
                  <FormSelect
                    id="balances-role-filter-sheet"
                    value={balancesRoleFilter}
                    onChange={(e) => handleBalancesRoleChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All roles' },
                      { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
                      { value: 'MEDIA_BUYER', label: 'Media Buyer' },
                    ]}
                    controlSize="lg"
                    className="!bg-app-hover text-center"
                    wrapperClassName="w-full"
                    aria-label="Filter balances by role"
                  />
                  <FormSelect
                    id="balances-status-filter-sheet"
                    value={balancesStatusFilter}
                    onChange={(e) => handleBalancesStatusChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All balances' },
                      { value: 'POSITIVE', label: 'Positive' },
                      { value: 'ZERO', label: 'Zero' },
                      { value: 'NEGATIVE', label: 'Negative' },
                    ]}
                    controlSize="lg"
                    className="!bg-app-hover text-center"
                    wrapperClassName="w-full"
                    aria-label="Filter by balance status"
                  />
                </>
              ) : undefined
            }
            sheet={({ closeSheet }) => (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowExportModal(true);
                  }}
                >
                  Generate report
                </Button>
                {canCreate ? (
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowForm(true);
                    }}
                  >
                    + New disbursement
                  </Button>
                ) : null}
              </>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.disbursements}
        picklists={{
          recipients: recipients.map((r) => ({ id: r.id, name: r.name })),
        }}
        initialFilters={{
          status: optimisticStatus !== 'ALL' ? optimisticStatus : undefined,
          receiverId: optimisticReceiver !== 'ALL' ? optimisticReceiver : undefined,
          search: searchQuery || undefined,
        }}
      />

      {/* Create disbursement modal */}
      <CreateDisbursementModal
        open={showForm}
        onClose={handleCloseCreateModal}
        recipients={recipients}
        recipientBalances={recipientBalances}
        preselectedReceiverId={preselectedReceiverId}
      />

      {/* Receipt preview modal */}
      {receiptModal?.receiptUrl && (
        <ReceiptModal
          open={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          receiptUrl={receiptModal.receiptUrl}
          amount={receiptModal.amount}
          senderName={getName(receiptModal.senderId)}
          receiverName={getName(receiptModal.receiverId)}
          sentAt={receiptModal.sentAt}
          status={receiptModal.status}
        />
      )}

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total disbursed', value: formatNaira(totalAllAmt), valueClassName: 'text-app-fg tabular-nums' },
          { label: 'Pending', value: formatNaira(totalSentAmt), valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums' },
          {
            label: 'Pending Requests',
            value: fundingRequestStatusCounts.PENDING.toString(),
            valueClassName:
              fundingRequestStatusCounts.PENDING > 0
                ? 'text-warning-600 dark:text-warning-400 tabular-nums'
                : 'text-app-fg tabular-nums',
            title: 'Funding requests awaiting your approval — switch the View dropdown to "Funding requests" to action them',
          },
          { label: 'Received', value: formatNaira(totalReceivedAmt), valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: 'Disputed', value: formatNaira(totalDisputedAmt), valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums' },
        ]}
      />

      <div className="card p-0">
        <div className="px-4 pt-2">
          <Tabs
            variant="underline"
            value={mainTab}
            onChange={(v) => setMainTab(v as MainTab)}
            tabs={[
              {
                value: 'disbursements',
                label: 'Disbursements',
                badge: totalFunding > 0 ? <CountPill active={mainTab === 'disbursements'}>{totalFunding}</CountPill> : undefined,
              },
              {
                value: 'requests',
                label: 'Funding requests',
                badge:
                  fundingRequestStatusCounts.PENDING > 0 ? (
                    <CountPill active={mainTab === 'requests'} tone="warning">{fundingRequestStatusCounts.PENDING}</CountPill>
                  ) : fundingRequestsTotal > 0 ? (
                    <CountPill active={mainTab === 'requests'}>{fundingRequestsTotal}</CountPill>
                  ) : undefined,
              },
              {
                value: 'balances',
                label: 'Recipient balances',
                badge: recipientBalancesTotal > 0 ? <CountPill active={mainTab === 'balances'}>{recipientBalancesTotal}</CountPill> : undefined,
              },
            ]}
          />
        </div>
      </div>

      {/* Disbursements ledger */}
      {mainTab === 'disbursements' && (
        <>
          <div className="list-panel rounded-xl">
            <ToolbarFiltersCollapsible
              hideMobileSheet
              badgeCount={disbursementsFilterBadge}
              searchRow={
                <form onSubmit={handleSearchSubmit} className="flex min-w-0 flex-1 gap-2">
                  <SearchInput
                    type="search"
                    value={searchQuery}
                    onChange={(v) => setSearchQuery(v)}
                    placeholder="Search by sender, receiver, or ID..."
                    controlSize="sm"
                    clearable
                    withSubmitButton
                    wrapperClassName="flex-1 min-w-0"
                    aria-label="Search disbursements"
                  />
                </form>
              }
              desktopInlineFilters={
                <>
                  <FormSelect
                    id="disbursement-status-filter"
                    value={selectedStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
                    controlSize="sm"
                    wrapperClassName="w-full md:w-44"
                    aria-label="Filter by status"
                  />
                  <SearchableSelect
                    id="disbursement-recipient-filter"
                    value={selectedReceiver}
                    onChange={handleReceiverChange}
                    options={[
                      { value: 'ALL', label: 'All recipients' },
                      ...recipients.map((u) => ({ value: u.id, label: u.name })),
                    ]}
                    controlSize="sm"
                    wrapperClassName="w-full md:w-52"
                    searchPlaceholder="Search recipients..."
                  />
                </>
              }
              sheetFilterBody={
                <>
                  <FormSelect
                    id="disbursement-status-filter-sheet-inner"
                    value={selectedStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
                    controlSize="lg"
                    wrapperClassName="w-full"
                    aria-label="Filter by status"
                  />
                  <SearchableSelect
                    id="disbursement-recipient-filter-sheet-inner"
                    value={selectedReceiver}
                    onChange={handleReceiverChange}
                    options={[
                      { value: 'ALL', label: 'All recipients' },
                      ...recipients.map((u) => ({ value: u.id, label: u.name })),
                    ]}
                    controlSize="lg"
                    wrapperClassName="w-full"
                    searchPlaceholder="Search recipients..."
                  />
                </>
              }
            />

            <TableLoadingOverlay show={isFilterLoading}>
              <CompactTable<DisbursementRecord>
                withCard={false}
                columns={fundingLedgerColumns}
                rows={funding}
                rowKey={(f) => f.id}
                emptyTitle="No disbursements found"
                emptyDescription={
                  selectedStatus !== 'ALL' || selectedReceiver !== 'ALL'
                    ? 'Try adjusting your filters'
                    : 'Create your first disbursement to get started'
                }
                renderMobileCard={(f) => (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-app-fg-muted">
                        {getName(f.receiverId)} · {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <StatusBadge status={f.status} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-app-fg-muted">
                        {getName(f.senderId)} &rarr; {getName(f.receiverId)}
                      </div>
                      <span className="font-medium text-app-fg">
                        <NairaPrice amount={Number(f.amount)} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                      <span>{new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      {f.receiptUrl ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setReceiptModal(f)}>
                          View receipt
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              />
            </TableLoadingOverlay>
          </div>

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={perPage} pageSizeParam="perPage" />
          )}
        </>
      )}

      {mainTab === 'requests' && (
        <>
              <TableLoadingOverlay show={isFilterLoading}>
                <div className="list-panel rounded-xl">
                  <div className="border-b border-app-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-app-fg">Funding requests</h2>
                    <p className="mt-0.5 text-xs text-app-fg-muted">
                      Send the money to the requester manually, then approve with a receipt image. They will be notified.
                    </p>
                  </div>
                  <CompactTable<FundingRequestRecord>
                    withCard={false}
                    columns={fundingRequestColumns}
                    rows={fundingRequests}
                    rowKey={(r) => r.id}
                    emptyTitle="No funding requests"
                    renderMobileCard={(r) => (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Link to={`/admin/finance/staff-accounts/${r.requesterId}`} className="text-sm font-medium text-app-fg">
                            {r.requesterName ?? getRequesterName(r.requesterId)}
                          </Link>
                          <StatusBadge status={r.status} />
                        </div>
                        <p className="text-sm text-app-fg-muted">
                          <NairaPrice amount={Number(r.amount)} />
                        </p>
                        {r.reason ? <p className="text-sm text-app-fg-muted">{r.reason}</p> : null}
                        <p className="text-xs text-app-fg-muted">
                          {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {r.resolvedAt
                            ? ` — Resolved ${new Date(r.resolvedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}`
                            : null}
                        </p>
                        {r.receiptUrl ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-sm text-brand-500 hover:text-brand-600"
                            onClick={() => setRequestReceiptModal(r)}
                          >
                            View receipt
                          </Button>
                        ) : null}
                        {r.status === 'PENDING' ? (
                          <div className="inline-flex gap-1.5 pt-1">
                            <TableActionButton variant="primary" onClick={() => setApprovingRequestId(r.id)}>
                              Approve
                            </TableActionButton>
                            <TableActionButton variant="danger" onClick={() => setRejectingRequestId(r.id)}>
                              Reject
                            </TableActionButton>
                          </div>
                        ) : null}
                      </div>
                    )}
                  />
                </div>
              </TableLoadingOverlay>
              {requestsTotalPages > 1 && (
                <Pagination page={requestsPage} totalPages={requestsTotalPages} pageParam="requestsPage" pageSize={requestsPerPage} pageSizeParam="requestsPerPage" />
              )}
        </>
      )}

      {mainTab === 'balances' && (
        <>
          <div className="list-panel rounded-xl">
            <ToolbarFiltersCollapsible
              hideMobileSheet
              badgeCount={balancesFilterBadge}
              searchRow={
                <form onSubmit={handleBalancesSearchSubmit} className="flex min-w-0 flex-1 gap-2">
                  <SearchInput
                    type="search"
                    value={balancesSearchQuery}
                    onChange={(v) => setBalancesSearchQuery(v)}
                    placeholder="Search recipient name..."
                    controlSize="sm"
                    clearable
                    withSubmitButton
                    wrapperClassName="flex-1 min-w-0"
                    aria-label="Search recipient balances"
                  />
                </form>
              }
              desktopInlineFilters={
                <>
                  <FormSelect
                    id="balances-role-filter"
                    value={balancesRoleFilter}
                    onChange={(e) => handleBalancesRoleChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All roles' },
                      { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
                      { value: 'MEDIA_BUYER', label: 'Media Buyer' },
                    ]}
                    controlSize="sm"
                    wrapperClassName="w-full md:w-52"
                    aria-label="Filter balances by role"
                  />
                  <FormSelect
                    id="balances-status-filter"
                    value={balancesStatusFilter}
                    onChange={(e) => handleBalancesStatusChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All balances' },
                      { value: 'POSITIVE', label: 'Positive' },
                      { value: 'ZERO', label: 'Zero' },
                      { value: 'NEGATIVE', label: 'Negative' },
                    ]}
                    controlSize="sm"
                    wrapperClassName="w-full md:w-48"
                    aria-label="Filter by balance status"
                  />
                </>
              }
              sheetFilterBody={
                <>
                  <FormSelect
                    id="balances-role-filter-sheet-inner"
                    value={balancesRoleFilter}
                    onChange={(e) => handleBalancesRoleChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All roles' },
                      { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
                      { value: 'MEDIA_BUYER', label: 'Media Buyer' },
                    ]}
                    controlSize="lg"
                    wrapperClassName="w-full"
                    aria-label="Filter balances by role"
                  />
                  <FormSelect
                    id="balances-status-filter-sheet-inner"
                    value={balancesStatusFilter}
                    onChange={(e) => handleBalancesStatusChange(e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All balances' },
                      { value: 'POSITIVE', label: 'Positive' },
                      { value: 'ZERO', label: 'Zero' },
                      { value: 'NEGATIVE', label: 'Negative' },
                    ]}
                    controlSize="lg"
                    wrapperClassName="w-full"
                    aria-label="Filter by balance status"
                  />
                </>
              }
            />

            <TableLoadingOverlay show={isFilterLoading}>
              <CompactTable<RecipientBalanceRow>
                withCard={false}
                columns={recipientBalanceColumns}
                rows={recipientBalances}
                rowKey={(b) => b.userId}
                emptyTitle="No recipient balances available"
                emptyDescription="Try adjusting your search or role filter."
                renderMobileCard={(b) => {
                  const balance = Number(b.balance);
                  const canSendFundsToRecipient = canCreate && b.role === 'HEAD_OF_MARKETING';
                  return (
                    <div className="space-y-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <Link
                          to={`/admin/finance/staff-accounts/${b.userId}`}
                          className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
                        >
                          {b.name}
                        </Link>
                        <span
                          className={`text-sm font-medium ${
                            balance < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-brand-600 dark:text-brand-400'
                          }`}
                        >
                          {formatNaira(balance)}
                        </span>
                      </div>
                      <div className="mb-2 space-y-0.5 text-sm text-app-fg-muted">
                        <div>
                          Role: {b.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : b.role === 'MEDIA_BUYER' ? 'Media Buyer' : b.role}
                        </div>
                        <div>
                          Received: <NairaPrice amount={Number(b.totalReceived)} />
                        </div>
                        <div>
                          Spent: <NairaPrice amount={Number(b.totalSpend)} />
                        </div>
                      </div>
                      {canSendFundsToRecipient ? (
                        <TableActionButton
                          variant="primary"
                          onClick={() => {
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.set('receiverId', b.userId);
                              next.set('tab', 'disbursements');
                              next.delete('type');
                              return next;
                            });
                            setShowForm(true);
                          }}
                        >
                          Send funds
                        </TableActionButton>
                      ) : null}
                    </div>
                  );
                }}
              />
            </TableLoadingOverlay>
          </div>
          {balancesTotalPages > 1 && (
            <Pagination page={balancesPage} totalPages={balancesTotalPages} pageParam="balancesPage" pageSize={balancesPerPage} pageSizeParam="balancesPerPage" />
          )}
        </>
      )}

      {/* Funding request receipt modal */}
      {requestReceiptModal?.receiptUrl && (
        <Modal open onClose={() => setRequestReceiptModal(null)} maxWidth="max-w-lg" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Funding request receipt</h3>
            <button type="button" onClick={() => setRequestReceiptModal(null)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
              <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Amount</p>
              <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
                <NairaPrice amount={Number(requestReceiptModal.amount)} />
              </p>
              <div className="flex items-center gap-2 mt-2 text-xs text-brand-500 dark:text-brand-400">
                <span>{requestReceiptModal.requesterName ?? getRequesterName(requestReceiptModal.requesterId)}</span>
                <span>&middot;</span>
                <span>{new Date(requestReceiptModal.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span>&middot;</span>
                <StatusBadge status={requestReceiptModal.status} />
              </div>
            </div>
            <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
              <img
                src={requestReceiptModal.receiptUrl}
                alt="Funding request receipt"
                className="w-full max-h-[400px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  const fallback = (e.target as HTMLImageElement).nextElementSibling;
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
              <div className="items-center justify-center gap-2 p-8 hidden">
                <span className="text-sm text-app-fg-muted">Receipt image could not be loaded</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-4">
            <a
              href={requestReceiptModal.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary btn-sm inline-flex items-center gap-1.5"
            >
              Open in new tab
            </a>
            <Button variant="secondary" size="sm" onClick={() => setRequestReceiptModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {/* Approve funding request modal */}
      {approvingRequestId && approvingRequestRow && (
        <Modal open onClose={() => setApprovingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <ModalFetcherInlineError message={requestActionSurface.errorMatchingIntent('approveFundingRequest')} />
          <h3 className="text-lg font-semibold text-app-fg">Approve funding request</h3>
          <p className="text-sm text-app-fg-muted">
            Send the money to the requester manually (e.g. bank transfer), then attach the receipt image below. They will be notified and can preview the receipt.
          </p>
          <RequestActionForm
            method="post"
            className="space-y-3"
            onSubmit={handleApproveFundingRequestSubmit}
            noValidate
          >
            <input type="hidden" name="intent" value="approveFundingRequest" />
            <input type="hidden" name="requestId" value={approvingRequestId} />
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Amount (₦)
                <span className="text-app-fg-muted/70">
                  {' '}
                  — requested ₦{Number(approvingRequestRow.amount).toLocaleString('en-NG')}
                </span>
              </label>
              <AmountInput
                name="amount"
                defaultValue={String(approvingRequestRow.amount)}
                className="input w-full"
              />
            </div>
            <FileUpload
              folder={ASSET_FOLDERS.RECEIPTS}
              name="receiptUrl"
              label="Receipt image"
              onUpload={(url) => setApproveRequestReceiptUrl(url)}
              onUploadStateChange={setApproveRequestUploadState}
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={requestActionFetcher.state === 'submitting'}
                loadingText="Approving..."
                disabled={approveRequestSubmitDisabled}
              >
                Approve & notify
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setApprovingRequestId(null)}>
                Cancel
              </Button>
            </div>
          </RequestActionForm>
        </Modal>
      )}

      {/* Reject funding request modal */}
      {rejectingRequestId && (
        <Modal open onClose={() => setRejectingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <ModalFetcherInlineError message={requestActionSurface.errorMatchingIntent('rejectFundingRequest')} />
          <h3 className="text-lg font-semibold text-app-fg">Reject funding request</h3>
          <p className="text-sm text-app-fg-muted">
            The requester will be notified that their request was not approved.
          </p>
          <RequestActionForm method="post" className="space-y-3">
            <input type="hidden" name="intent" value="rejectFundingRequest" />
            <input type="hidden" name="requestId" value={rejectingRequestId} />
            <Textarea
              label="Reason (optional)"
              name="reason"
              rows={2}
              maxLength={500}
              placeholder="Optional note for records..."
            />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" loading={requestActionFetcher.state === 'submitting'} loadingText="Rejecting...">
                Reject
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setRejectingRequestId(null)}>
                Cancel
              </Button>
            </div>
          </RequestActionForm>
        </Modal>
      )}
    </div>
  );
}

/** Compact count badge for tab labels — neutral by default, warning-amber when
 *  used for pending action items (e.g. PENDING funding requests). Matches the
 *  pill used on `MarketingFundingPage.tsx`. */
function CountPill({
  active,
  tone = 'neutral',
  children,
}: {
  active: boolean;
  tone?: 'neutral' | 'warning';
  children: React.ReactNode;
}) {
  const toneClasses =
    tone === 'warning'
      ? active
        ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
        : 'bg-warning-50 text-warning-600 dark:bg-warning-900/20 dark:text-warning-400'
      : active
        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
        : 'bg-app-hover text-app-fg-muted';
  return (
    <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-micro font-semibold tabular-nums ${toneClasses}`}>
      {children}
    </span>
  );
}
