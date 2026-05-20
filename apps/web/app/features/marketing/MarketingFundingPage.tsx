import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFetcher, useNavigation, useSearchParams, useLocation } from '@remix-run/react';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import {
  applyOptimisticPatches,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';
import { createFundingSchema, approveFundingRequestSchema } from '@yannis/shared/validators';
import { PageNotification } from '~/components/ui/page-notification';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { Tabs } from '~/components/ui/tabs';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Textarea } from '~/components/ui/textarea';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import type {
  DistributingFundingEntry,
  DistributingFundingRequestEntry,
  DistributingFundingTransferEntry,
  FundingRecord,
  FundingRequestRecord,
  FundingSection,
  FundingTab,
  FundingSliceData,
  FundingRequestsSliceData,
  MarketingFundingLoaderData,
  User,
} from './types';
import { FundingFlowTimeline } from './FundingFlowTimeline';

const FUNDING_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All Status' },
  { value: 'SENT', label: 'Pending (sent)' },
  { value: 'COMPLETED', label: 'Received' },
  { value: 'DISPUTED', label: 'Disputed' },
];

const REQUEST_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All Status' },
  { value: 'PENDING', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const DISTRIBUTING_TYPE_OPTIONS: { value: 'all' | 'transfer' | 'request'; label: string }[] = [
  { value: 'all', label: 'All Type' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'request', label: 'Requests' },
];

/** Non-default type/status picks — shown as a count badge on the mobile Filters control. */
function ledgerFilterBadgeCount(typeFilter: string, statusFilter: string | undefined): number {
  let n = 0;
  if (typeFilter !== 'all') n += 1;
  if (statusFilter && statusFilter !== 'ALL') n += 1;
  return n;
}

function FundingFiltersFunnelIcon({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M8 12h8M10 18h4" />
    </svg>
  );
}

function parseSectionTab(
  search: string,
  canDistribute: boolean,
): { section: FundingSection; tab: FundingTab } {
  const u = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sectionParam = u.get('section');
  // Default section is `distributing` for users who can distribute (HoM / Admin)
  // — that's their primary working surface. MBs (no canDistribute) still
  // default to `received`. Explicit `?section=received` always wins.
  const section: FundingSection =
    sectionParam === 'received'
      ? 'received'
      : canDistribute
        ? 'distributing'
        : 'received';
  if (section === 'distributing') {
    return { section, tab: 'transfers' };
  }
  const tabParam = u.get('tab');
  const tab: FundingTab = tabParam === 'requests' ? 'requests' : 'transfers';
  return { section, tab };
}

/**
 * `/admin/marketing/funding` — two-tier funding model as **primary tabs** + **sub-tabs**:
 *
 *   Primary — "Funds I've Received" / "Incoming Funding" | "Funds I Distribute" (HoM/Admin)
 *   Sub — Transfers | My Requests (received) or MB Requests (distribute)
 *
 * URL: `?section=received|distributing&tab=transfers|requests` — loader revalidates on change.
 * Tabs read the **pending** URL from `navigation.location` so they update immediately; the ledger
 * table area shows an inline loading state until the new slice data is ready.
 */
export function MarketingFundingPage(props: MarketingFundingLoaderData) {
  const {
    viewMode,
    currentUserId,
    currentUserRole,
    canSendFunding,
    canRequestFunding,
    canDistribute,
    activeSection,
    activeTab,
    filters,
    receivedTransfers,
    myRequests,
    outgoingTransfers,
    mbRequests,
    distributingEntries,
    directionSummary,
    fundingBalance,
    users,
    activeBranchName,
    fundingRequestRecipients = [],
  } = props;

  const isMediaBuyer = viewMode === 'media_buyer';
  const fetcher = useFetcher();
  const { toast } = useToast();
  const { ensureBranchForAction, requiresBranchSelection } = useBranchScopeActionGuard();
  const navigation = useNavigation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  /** Loader revalidation for this route (date range, section/tab, filters, pagination). */
  const isFundingRouteLoading = useLoaderRefetchBusy().busy;

  const { section: displaySection, tab: displayTab } = useMemo(() => {
    const pending =
      navigation.state === 'loading' && navigation.location?.pathname.includes('/admin/marketing/funding');
    const search = (pending && navigation.location ? navigation.location.search : location.search) || '';
    return parseSectionTab(search, canDistribute);
  }, [navigation.state, navigation.location, location.search, canDistribute]);

  // ── Modal state ─────────────────────────────────────────
  const [showSendForm, setShowSendForm] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  // Migration 0106 — chosen recipient for the Request Funding modal. Defaulted
  // from the loader's `fundingRequestRecipients` (HoM in branch is preferred for
  // MBs; first Finance Officer for HoMs). Re-syncs when the modal opens so the
  // preselect is always fresh.
  const preferredRequestRecipient = useMemo(() => {
    const preferred = fundingRequestRecipients.find((r) => r.isPreferred);
    if (preferred) return preferred.id;
    return fundingRequestRecipients[0]?.id ?? '';
  }, [fundingRequestRecipients]);
  const [requestTargetUserId, setRequestTargetUserId] = useState<string>('');
  useEffect(() => {
    if (showRequestForm) setRequestTargetUserId(preferredRequestRecipient);
  }, [showRequestForm, preferredRequestRecipient]);
  const [disputingFundingId, setDisputingFundingId] = useState<string | null>(null);
  const [markReceivedTarget, setMarkReceivedTarget] = useState<FundingRecord | null>(null);
  const [notReceivedTarget, setNotReceivedTarget] = useState<FundingRecord | null>(null);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [fundingReceiptModal, setFundingReceiptModal] = useState<FundingRecord | null>(null);
  const [requestDetailsEntry, setRequestDetailsEntry] = useState<DistributingFundingEntry | null>(null);

  // The request being approved — looked up across Section 1 (mine), Section 2 (MBs'),
  // AND the unified distributing slice so the Approve modal can pre-fill amount /
  // requester reason regardless of which feed the row was clicked from. Without
  // distributingEntries here the lookup returns null on the distributing tab and
  // the auto-reset effect below silently clears `approvingRequestId`, making
  // the Approve button look broken.
  const approvingRequest = useMemo(() => {
    if (!approvingRequestId) return null;
    const fromMyRequests = myRequests.records.find((r) => r.id === approvingRequestId);
    if (fromMyRequests) return fromMyRequests;
    const fromMbRequests = mbRequests?.records.find((r) => r.id === approvingRequestId);
    if (fromMbRequests) return fromMbRequests;
    const fromDistributing = distributingEntries?.records.find(
      (entry): entry is DistributingFundingRequestEntry =>
        entry.entryType === 'request' && entry.id === approvingRequestId,
    );
    if (fromDistributing) {
      return {
        id: fromDistributing.id,
        requesterId: fromDistributing.requesterId,
        amount: fromDistributing.amount,
        reason: fromDistributing.reason,
        status: fromDistributing.status,
        receiptUrl: fromDistributing.receiptUrl,
        createdAt: fromDistributing.createdAt,
        resolvedAt: fromDistributing.resolvedAt,
        resolvedBy: fromDistributing.resolvedBy,
        requesterName: fromDistributing.requesterName,
      } satisfies FundingRequestRecord;
    }
    return null;
  }, [approvingRequestId, myRequests.records, mbRequests?.records, distributingEntries?.records]);

  useEffect(() => {
    if (approvingRequestId && !approvingRequest) setApprovingRequestId(null);
  }, [approvingRequestId, approvingRequest]);

  const [createFundingReceiptUrl, setCreateFundingReceiptUrl] = useState('');
  const [createFundingUploadState, setCreateFundingUploadState] = useState<FileUploadUploadState>('idle');
  const [createFundingReceiverId, setCreateFundingReceiverId] = useState('');
  const [approveFundingReceiptUrl, setApproveFundingReceiptUrl] = useState('');
  const [approveFundingUploadState, setApproveFundingUploadState] = useState<FileUploadUploadState>('idle');

  useEffect(() => {
    if (!showSendForm) {
      setCreateFundingReceiptUrl('');
      setCreateFundingUploadState('idle');
    }
  }, [showSendForm]);

  useEffect(() => {
    if (!approvingRequestId) {
      setApproveFundingReceiptUrl('');
      setApproveFundingUploadState('idle');
    }
  }, [approvingRequestId]);

  // ── Action results ──────────────────────────────────────
  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const fundingSurface = useFetcherActionSurface(fetcher);
  const fundingFetcherModalOpen =
    showRequestForm ||
    showSendForm ||
    markReceivedTarget != null ||
    disputingFundingId != null ||
    approvingRequest != null ||
    rejectingRequestId != null;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, {
    successMessage: 'Action completed',
    skipErrorToast: fundingFetcherModalOpen,
  });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);
  useEffect(() => {
    if (!actionError) return;
    if (!requiresBranchSelection) return;
    if (!actionError.toLowerCase().includes('branch context required')) return;
    ensureBranchForAction({ actionLabel: 'this funding action' });
  }, [actionError, requiresBranchSelection, ensureBranchForAction]);

  // Captures the intent of the most recent fetcher submission so the
  // success handler can do intent-specific follow-up (e.g. switch tabs to the
  // "My Requests" slice after a `requestFunding` submission so the new row is
  // visible in the same tick the modal closes).
  const lastSubmittedIntentRef = useRef<string | null>(null);

  // Edge-triggered close-on-success — see CLAUDE.md → "Modal + Optimistic UI Pattern".
  // One callback resets every modal/sheet on this page in one go; React skips
  // state updates whose value already matches (so calling setShowSendForm(false)
  // when it's already false is a no-op). The hook revalidates the loader.
  const handleFundingFetcherSuccess = useCallback(() => {
    setShowSendForm(false);
    setShowRequestForm(false);
    setDisputingFundingId(null);
    setApprovingRequestId(null);
    setRejectingRequestId(null);
    setMarkReceivedTarget(null);
    // After a successful funding REQUEST, jump to the tab where the new row
    // lives (Received → My Requests) so the user sees their submission land
    // immediately instead of a blank "Transfers" tab. Inlined (rather than
    // calling `navigateToSlice`) to avoid a TDZ reference — `navigateToSlice`
    // is declared further down in the file.
    if (lastSubmittedIntentRef.current === 'requestFunding') {
      const params = new URLSearchParams(searchParams);
      params.set('section', 'received');
      params.set('tab', 'requests');
      params.delete('page');
      params.delete('status');
      params.delete('requestStatus');
      params.delete('search');
      setSearchParams(params, { preventScrollReset: true });
    }
    lastSubmittedIntentRef.current = null;
  }, [searchParams, setSearchParams]);
  useCloseOnFetcherSuccess(fetcher, handleFundingFetcherSuccess);

  /** Optimistic-edit overlay for the funding LEDGER (FundingRecord rows).
   *  - verifyFunding: SENT → COMPLETED (mark received) or DISPUTED (not received).
   *  Status badge flips the same tick as the toast; revalidation drops the
   *  overlay; failures snap back via `useFetcherToast`. */
  const buildFundingPatches = useCallback<
    (fd: FormData, intent: string) => { id: string; patch: Partial<FundingRecord> }[] | null
  >((fd, intent) => {
    if (intent !== 'verifyFunding') return null;
    const fundingId = fd.get('fundingId')?.toString();
    const action = fd.get('action')?.toString();
    if (!fundingId || !action) return null;
    const status = action === 'received' ? 'COMPLETED' : action === 'not_received' ? 'DISPUTED' : null;
    if (!status) return null;
    return [{ id: fundingId, patch: { status } }];
  }, []);
  const fundingPatches = useOptimisticListPatches<FundingRecord>(fetcher, buildFundingPatches);

  /** Optimistic-edit overlay for funding REQUESTS (FundingRequestRecord rows).
   *  - approveFundingRequest: PENDING → APPROVED.
   *  - rejectFundingRequest: PENDING → REJECTED. */
  const buildFundingRequestPatches = useCallback<
    (fd: FormData, intent: string) => { id: string; patch: Partial<FundingRequestRecord> }[] | null
  >((fd, intent) => {
    if (intent === 'approveFundingRequest') {
      const id = fd.get('requestId')?.toString();
      if (!id) return null;
      const amt = Number(fd.get('amount')?.toString() ?? '');
      const patch: Partial<FundingRequestRecord> = { status: 'APPROVED' };
      if (Number.isFinite(amt) && amt > 0) {
        patch.amount = String(amt);
      }
      return [{ id, patch }];
    }
    if (intent === 'rejectFundingRequest') {
      const id = fd.get('requestId')?.toString();
      if (!id) return null;
      return [{ id, patch: { status: 'REJECTED' } }];
    }
    return null;
  }, []);
  const fundingRequestPatches = useOptimisticListPatches<FundingRequestRecord>(
    fetcher,
    buildFundingRequestPatches,
  );

  // ── URL helpers ─────────────────────────────────────────
  /**
   * Switch active section + tab. Drops `page` / `status` / `requestStatus` / `search` because
   * those are scoped per (section, tab) — keeping them around when switching context applies a
   * filter that doesn't make sense in the new slice.
   */
  const navigateToSlice = (nextSection: FundingSection, nextTab: FundingTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', nextSection);
    params.set('tab', nextTab);
    params.delete('page');
    params.delete('status');
    params.delete('requestStatus');
    params.delete('search');
    // Drop unified type/status filters too — defaults are "All" on every fresh slice so
    // a stale "Transfers only" filter from another tab doesn't quietly hide rows here.
    params.delete('entryType');
    params.delete('entryStatus');
    setSearchParams(params, { preventScrollReset: true });
  };

  const updateSliceParam = (
    key: 'status' | 'requestStatus' | 'search' | 'entryType' | 'entryStatus',
    value: string | undefined,
  ) => {
    const params = new URLSearchParams(searchParams);
    if (!value || value === 'ALL') params.delete(key);
    else params.set(key, value);
    params.delete('page');
    setSearchParams(params, { preventScrollReset: true });
  };

  // ── Role-aware copy ─────────────────────────────────────
  const receivedTitle = isMediaBuyer ? 'Incoming Funding' : "Funds I've Received";

  // ── Disputed totals + search local state ────────────────
  const totalDisputed = directionSummary.disputedAsReceiver + directionSummary.disputedAsSender;

  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') ?? '');
  const userNameById = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown user';
  useEffect(() => {
    setSearchQuery(searchParams.get('search') ?? '');
  }, [searchParams]);
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateSliceParam('search', searchQuery.trim() || undefined);
  };

  const handleCreateFundingSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fdRead = new FormData(formEl);
    const parsed = createFundingSchema.safeParse({
      receiverId: fdRead.get('receiverId')?.toString() ?? '',
      amount: fdRead.get('amount')?.toString() ?? '',
      receiptUrl: createFundingReceiptUrl.trim(),
    });
    if (!parsed.success) {
      toast.error('Cannot send funding', parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    const fd = new FormData(formEl);
    fd.set('receiptUrl', parsed.data.receiptUrl ?? '');
    ensureBranchForAction({
      actionLabel: 'sending funding',
      onProceed: () => fetcher.submit(fd, { method: 'post' }),
    });
  };

  const handleApproveFundingRequestSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!approvingRequest) return;
    const formEl = e.currentTarget;
    const fdRead = new FormData(formEl);
    const approvedAmt = Number(fdRead.get('amount')?.toString() ?? '');
    const requestedAmt = Number(approvingRequest.amount);
    if (!Number.isFinite(approvedAmt) || approvedAmt <= 0) {
      toast.error('Cannot approve request', 'Enter a valid approved amount.');
      return;
    }
    if (Math.round(approvedAmt * 100) > Math.round(requestedAmt * 100)) {
      toast.error('Cannot approve request', 'Approved amount cannot exceed the requested amount.');
      return;
    }
    const parsed = approveFundingRequestSchema.safeParse({
      requestId: approvingRequest.id,
      amount: approvedAmt,
      receiptUrl: approveFundingReceiptUrl.trim(),
    });
    if (!parsed.success) {
      toast.error('Cannot approve request', parsed.error.issues[0]?.message ?? 'Attach a valid receipt image.');
      return;
    }
    const fd = new FormData(formEl);
    fd.set('receiptUrl', parsed.data.receiptUrl ?? '');
    fd.set('amount', String(parsed.data.amount));
    ensureBranchForAction({
      actionLabel: 'approving funding request',
      onProceed: () => fetcher.submit(fd, { method: 'post' }),
    });
  };

  const createFundingSubmitDisabled =
    createFundingUploadState === 'uploading' || !createFundingReceiptUrl.trim();
  const approveFundingSubmitDisabled =
    approveFundingUploadState === 'uploading' || !approveFundingReceiptUrl.trim();

  const rawTransfersSlice: FundingSliceData =
    activeSection === 'distributing' && outgoingTransfers ? outgoingTransfers : receivedTransfers;
  const rawRequestsSlice: FundingRequestsSliceData =
    activeSection === 'distributing' && mbRequests ? mbRequests : myRequests;

  // Apply optimistic status overlays to the visible slices so verify / approve /
  // reject actions flip the badge instantly while the server processes.
  const transfersSlice: FundingSliceData = useMemo(
    () =>
      fundingPatches.length === 0
        ? rawTransfersSlice
        : { ...rawTransfersSlice, records: applyOptimisticPatches(rawTransfersSlice.records, fundingPatches) },
    [rawTransfersSlice, fundingPatches],
  );
  const requestsSlice: FundingRequestsSliceData = useMemo(
    () =>
      fundingRequestPatches.length === 0
        ? rawRequestsSlice
        : { ...rawRequestsSlice, records: applyOptimisticPatches(rawRequestsSlice.records, fundingRequestPatches) },
    [rawRequestsSlice, fundingRequestPatches],
  );
  const unifiedDistributingSlice = distributingEntries;

  /**
   * Section 1 ("Funds I've Received") merged slice — incoming transfers plus
   * my outbound requests in one feed. Mirrors the shape of
   * `unifiedDistributingSlice` so it can drive the same filter-bar component
   * and a sister table component. URL filter keys (`entryType`, `entryStatus`,
   * `search`) are reused — only one section is visible at a time so they don't
   * conflict.
   */
  const unifiedReceivedSlice = useMemo(() => {
    // Default both filters to "All" when the URL param is missing OR carries a value
    // we don't recognise. This keeps fresh / deep-linked navigations on a clean slate.
    const rawType = searchParams.get('entryType');
    const typeFilter: 'all' | 'transfer' | 'request' =
      rawType === 'transfer' || rawType === 'request' ? rawType : 'all';
    const rawStatus = searchParams.get('entryStatus');
    const VALID_STATUSES = ['SENT', 'COMPLETED', 'DISPUTED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
    const statusFilter = (VALID_STATUSES as readonly string[]).includes(rawStatus ?? '') ? rawStatus! : 'ALL';
    const searchTerm = (searchParams.get('search') ?? '').trim().toLowerCase();

    // Source from the optimistically-patched slices so verify / approve / reject
    // flips status badges in real time, just like the distributing variant.
    const patchedTransfers =
      activeSection === 'received'
        ? applyOptimisticPatches(receivedTransfers.records, fundingPatches)
        : receivedTransfers.records;
    const patchedRequests =
      activeSection === 'received'
        ? applyOptimisticPatches(myRequests.records, fundingRequestPatches)
        : myRequests.records;

    // Pre-build a request-id → requester name lookup so the "from request" chip on a
    // dedup'd transfer can show who originally asked, even though we drop the request row.
    const requestById = new Map(patchedRequests.map((r) => [r.id, r] as const));

    const transferEntries: DistributingFundingTransferEntry[] = patchedTransfers.map((t) => ({
      id: t.id,
      entryType: 'transfer' as const,
      status: t.status as 'SENT' | 'COMPLETED' | 'DISPUTED',
      amount: t.amount,
      createdAt: t.sentAt,
      senderId: t.senderId,
      senderName: t.senderName ?? null,
      receiverId: t.receiverId,
      receiverName: t.receiverName ?? null,
      receiptUrl: t.receiptUrl,
      sourceFundingRequestId: t.sourceFundingRequestId ?? null,
      sourceRequesterName: t.sourceFundingRequestId
        ? requestById.get(t.sourceFundingRequestId)?.requesterName ?? null
        : null,
    }));

    // Deduplicate: any request that has been approved INTO a transfer (i.e. the transfer
    // carries `sourceFundingRequestId = request.id`) is now represented by that transfer
    // in the unified feed. Drop the request row so we don't double-render the same money.
    // Pending / rejected requests have no matching transfer and pass through unchanged.
    const linkedRequestIds = new Set(
      patchedTransfers
        .map((t) => t.sourceFundingRequestId)
        .filter((id): id is string => Boolean(id)),
    );

    const requestEntries: DistributingFundingRequestEntry[] = patchedRequests
      .filter((r) => !linkedRequestIds.has(r.id))
      .map((r) => ({
        id: r.id,
        entryType: 'request' as const,
        status: r.status as 'PENDING' | 'APPROVED' | 'REJECTED',
        amount: r.amount,
        createdAt: r.createdAt,
        requesterId: r.requesterId,
        requesterName: r.requesterName ?? null,
        reason: r.reason,
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy,
        receiptUrl: r.receiptUrl,
      }));

    const allEntries: DistributingFundingEntry[] = [...transferEntries, ...requestEntries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const passesType = (entry: DistributingFundingEntry) =>
      typeFilter === 'all' || entry.entryType === typeFilter;
    const passesStatus = (entry: DistributingFundingEntry) =>
      statusFilter === 'ALL' || entry.status === statusFilter;
    const passesSearch = (entry: DistributingFundingEntry) => {
      if (!searchTerm) return true;
      const haystack: string[] = [];
      if (entry.entryType === 'transfer') {
        haystack.push(entry.senderName ?? '', entry.receiverName ?? '');
      } else {
        haystack.push(entry.requesterName ?? '', entry.reason ?? '');
      }
      return haystack.some((s) => s.toLowerCase().includes(searchTerm));
    };

    const filtered = allEntries.filter((e) => passesType(e) && passesStatus(e) && passesSearch(e));

    const typeCounts = {
      all: allEntries.length,
      transfer: transferEntries.length,
      request: requestEntries.length,
    };
    const statusCounts = {
      ALL: allEntries.length,
      SENT: transferEntries.filter((t) => t.status === 'SENT').length,
      COMPLETED: transferEntries.filter((t) => t.status === 'COMPLETED').length,
      DISPUTED: transferEntries.filter((t) => t.status === 'DISPUTED').length,
      PENDING: requestEntries.filter((r) => r.status === 'PENDING').length,
      APPROVED: requestEntries.filter((r) => r.status === 'APPROVED').length,
      REJECTED: requestEntries.filter((r) => r.status === 'REJECTED').length,
    };

    return {
      records: filtered,
      total: filtered.length,
      page: 1,
      totalPages: 1,
      typeFilter,
      statusFilter,
      searchFilter: searchTerm || undefined,
      typeCounts,
      statusCounts,
    };
  }, [
    activeSection,
    receivedTransfers.records,
    myRequests.records,
    fundingPatches,
    fundingRequestPatches,
    searchParams,
  ]);
  const transferEmptyMessage =
    activeSection === 'received'
      ? isMediaBuyer
        ? 'Head of Marketing has not sent funding to you yet.'
        : 'Finance has not sent funding to you in this period — tap "+ Request Funds" to ask.'
      : 'You have not disbursed funding to any Media Buyer in this period — tap "+ Send Funding" to start.';
  const requestsEmptyMessage =
    activeSection === 'received'
      ? canRequestFunding
        ? 'No outbound funding requests yet — tap "+ Request Funds" to start one.'
        : 'No outbound funding requests.'
      : 'No pending requests from your Media Buyers.';

  const renderFundingHeaderToolbar = (
    closeMobileSheet: () => void,
    opts?: { showRefresh?: boolean; dateTriggerLayout?: 'inline' | 'blockCenter' },
  ) => {
    const showRefresh = opts?.showRefresh !== false;
    const dateTriggerLayout = opts?.dateTriggerLayout ?? 'inline';
    return (
      <>
        {canRequestFunding && (
          <Button
            variant={canSendFunding ? 'secondary' : 'primary'}
            size="sm"
            className="md:inline-flex w-full justify-center md:w-auto"
            onClick={() => {
              closeMobileSheet();
              setShowRequestForm(true);
            }}
          >
            + Request Funds
          </Button>
        )}
        {canSendFunding && (
          <Button
            variant="primary"
            size="sm"
            className="md:inline-flex w-full justify-center md:w-auto"
            onClick={() => {
              closeMobileSheet();
              setShowSendForm(true);
            }}
          >
            + Send Funding
          </Button>
        )}
        <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2 md:min-h-[2rem] md:w-auto md:flex-row md:items-center md:justify-start md:py-1 md:pl-2.5 md:pr-2">
          <DateFilterBar
            startDate={filters.startDate}
            endDate={filters.endDate}
            periodAllTime={filters.periodAllTime}
            triggerLayout={dateTriggerLayout}
          />
        </div>
        {showRefresh && (
          <div className="flex w-full justify-center md:inline-flex md:w-auto">
            <PageRefreshButton className="justify-center py-2 md:py-1" />
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding"
        mobileInlineActions
        description="Track funds received and sent."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Funding tools"
            sheetSubtitle={<span>Filters, request, send, and date range</span>}
            triggerAriaLabel="Filters and funding actions"
            filtersBadgeCount={(() => {
              const s =
                displaySection === 'distributing' ? unifiedDistributingSlice : unifiedReceivedSlice;
              return s ? ledgerFilterBadgeCount(s.typeFilter, s.statusFilter) : 0;
            })()}
            filters={(() => {
              const s =
                displaySection === 'distributing' ? unifiedDistributingSlice : unifiedReceivedSlice;
              if (!s) return undefined;
              return (
                <FundingFilterControls
                  slice={s}
                  sentLabel={displaySection === 'distributing' ? 'Sent' : 'Pending mark-received'}
                  onTypeChange={(v) => updateSliceParam('entryType', v)}
                  onStatusChange={(v) => updateSliceParam('entryStatus', v)}
                />
              );
            })()}
            desktop={renderFundingHeaderToolbar(() => undefined)}
            sheet={({ closeSheet }) =>
              renderFundingHeaderToolbar(closeSheet, {
                showRefresh: false,
                dateTriggerLayout: 'blockCenter',
              })
            }
          />
        }
      />

      {actionError && !dismissedError && !fundingFetcherModalOpen && (
        <PageNotification
          variant="error"
          message={fundingSurface.friendlyError || actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Top metric strip — funding-relevant numbers (replaces the old marketing-perf strip
          of CPA / ROAS / Delivery Rate / Confirmation Rate which didn't speak to funding). */}
      <FundingMetricsStrip
        summary={directionSummary}
        canDistribute={canDistribute}
        fundingBalance={fundingBalance}
        pendingRequestsByMe={myRequests.statusCounts.PENDING}
        pendingRequestsToMe={mbRequests?.statusCounts.PENDING ?? 0}
      />

      {/* Disputed surfacing — visible whenever the user has anything in DISPUTED status. */}
      {totalDisputed > 0 && (
        <div className="rounded-lg border border-danger-300 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/20 px-4 py-3 flex items-start gap-3">
          <svg className="w-5 h-5 text-danger-600 dark:text-danger-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 17.25h.008v.008H12v-.008z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-danger-700 dark:text-danger-300">
              {totalDisputed} disputed {totalDisputed === 1 ? 'transfer' : 'transfers'} need{totalDisputed === 1 ? 's' : ''} review
            </p>
            <p className="text-xs text-danger-600 dark:text-danger-400 mt-0.5">
              {directionSummary.disputedAsReceiver > 0 && (
                <>
                  {directionSummary.disputedAsReceiver} you flagged as Not Received
                  {directionSummary.disputedAsSender > 0 ? ' · ' : ''}
                </>
              )}
              {directionSummary.disputedAsSender > 0 && (
                <>{directionSummary.disputedAsSender} flagged on funding you sent</>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="text-xs"
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              const targetSection: FundingSection =
                directionSummary.disputedAsSender > directionSummary.disputedAsReceiver && canDistribute
                  ? 'distributing'
                  : 'received';
              params.set('section', targetSection);
              params.set('tab', 'transfers');
              params.set('status', 'DISPUTED');
              params.delete('page');
              params.delete('requestStatus');
              params.delete('search');
              setSearchParams(params, { preventScrollReset: true });
            }}
          >
            Review
          </Button>
        </div>
      )}

      {/* ─── Ledger: primary tabs (received | distribute) ─ */}
      <div className="list-panel" id="funding-ledger">
        {canDistribute && (
          <div className="px-4 pt-2">
            <Tabs
              variant="underline"
              value={displaySection}
              onChange={(v) => navigateToSlice(v as FundingSection, 'transfers')}
              tabs={[
                { value: 'distributing', label: 'Funds I Distribute' },
                { value: 'received', label: receivedTitle },
              ]}
            />
          </div>
        )}

        {!canDistribute ? (
          <div className="border-b border-app-border px-4 py-3">
            <h2 className="text-base font-semibold text-app-fg">{receivedTitle}</h2>
          </div>
        ) : null}

        {displaySection === 'distributing' && unifiedDistributingSlice ? (
          <>
            <UnifiedDistributingFilterBar
              slice={unifiedDistributingSlice}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSearchSubmit={submitSearch}
              onTypeChange={(v) => updateSliceParam('entryType', v)}
              onStatusChange={(v) => updateSliceParam('entryStatus', v)}
            />
            <UnifiedDistributingTable
              slice={unifiedDistributingSlice}
              users={users}
              onViewReceipt={setFundingReceiptModal}
              onOpenDetails={setRequestDetailsEntry}
              onApprove={setApprovingRequestId}
              onReject={setRejectingRequestId}
              emptyMessage={transferEmptyMessage}
              canApproveFunding={canSendFunding}
              loading={isFundingRouteLoading}
            />
          </>
        ) : (
          <>
            <UnifiedReceivedFilterBar
              slice={unifiedReceivedSlice}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSearchSubmit={submitSearch}
              onTypeChange={(v) => updateSliceParam('entryType', v)}
              onStatusChange={(v) => updateSliceParam('entryStatus', v)}
            />
            <UnifiedReceivedTable
              slice={unifiedReceivedSlice}
              users={users}
              currentUserId={currentUserId}
              fetcher={fetcher}
              onViewReceipt={setFundingReceiptModal}
              onOpenMarkReceived={setMarkReceivedTarget}
              onOpenNotReceived={setNotReceivedTarget}
              onOpenDetails={setRequestDetailsEntry}
              emptyMessage={
                unifiedReceivedSlice.typeFilter === 'request'
                  ? requestsEmptyMessage
                  : transferEmptyMessage
              }
              emptyAction={
                canRequestFunding ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setShowRequestForm(true)}>
                    + Request Funds
                  </Button>
                ) : undefined
              }
              loading={isFundingRouteLoading}
            />
          </>
        )}
      </div>

      {/* ─── Modals ───────────────────────────────────────────────────────────────── */}

      {/* Request Funding — MB / branch supervisor → HoM, or HoM → Finance (accounts) */}
      {canRequestFunding && showRequestForm && (
        <Modal open onClose={() => setShowRequestForm(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Request Funding</h3>
          <p className="text-sm text-app-fg-muted">
            Pick the person you want to ask. Only that recipient sees and can act on this request.
          </p>
          <ModalFetcherInlineError message={fundingSurface.errorMatchingIntent('requestFunding')} />
          <fetcher.Form
            method="post"
            className="space-y-3"
            onSubmit={() => { lastSubmittedIntentRef.current = 'requestFunding'; }}
          >
            <input type="hidden" name="intent" value="requestFunding" />
            <input type="hidden" name="targetUserId" value={requestTargetUserId} />
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Request from</label>
              <SearchableSelect
                value={requestTargetUserId}
                onChange={setRequestTargetUserId}
                options={fundingRequestRecipients.map((r) => {
                  // Label maps to role / supervisor relationship — supervisor
                  // takes precedence over the underlying MEDIA_BUYER role so
                  // the picker reads "Jane Doe — Team supervisor (default)"
                  // instead of "Jane Doe — Media Buyer".
                  const roleLabel = r.isSupervisor
                    ? 'Team supervisor'
                    : r.isFinance
                      ? 'Finance'
                      : 'Head of Marketing';
                  return {
                    value: r.id,
                    label: `${r.name} — ${roleLabel}${r.isPreferred ? ' (default)' : ''}`,
                  };
                })}
                placeholder={fundingRequestRecipients.length === 0 ? 'No recipients available' : 'Select recipient'}
                searchPlaceholder="Search recipients..."
              />
              {fundingRequestRecipients.length === 0 && (
                <p className="mt-1 text-xs text-warning-600 dark:text-warning-400">
                  No Head of Marketing or Finance Officer is set up to receive your request. Contact an admin.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount ({'₦'})</label>
              <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input" />
            </div>
            <Textarea
              label="Reason (optional)"
              name="reason"
              rows={2}
              maxLength={500}
              placeholder="What do you need the funds for?"
              defaultValue="Ads spend"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={fetcher.state === 'submitting'}
                loadingText="Submitting..."
                disabled={!requestTargetUserId}
              >
                Submit Request
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowRequestForm(false)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Send Funding — HoM/Admin disbursing to MB */}
      {canSendFunding && showSendForm && (
        <Modal open onClose={() => setShowSendForm(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Send Funding to Media Buyer</h3>
          <p className="text-sm text-app-fg-muted">
            Select the recipient, amount, and upload the receipt. The Media Buyer will be notified and can mark as received.
          </p>
          <ModalFetcherInlineError message={fundingSurface.errorMatchingIntent('createFunding')} />
          <fetcher.Form method="post" className="space-y-4" onSubmit={handleCreateFundingSubmit} noValidate>
            <input type="hidden" name="intent" value="createFunding" />
            <input type="hidden" name="receiverId" value={createFundingReceiverId} />
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Media Buyer</label>
              <SearchableSelect
                id="marketing-funding-receiver"
                value={createFundingReceiverId}
                onChange={setCreateFundingReceiverId}
                placeholder="Select recipient..."
                searchPlaceholder="Search media buyers..."
                options={users
                  .filter((u: User) => u.role === 'MEDIA_BUYER')
                  .map((u: User) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
              />
              {activeBranchName && (
                <p className="mt-1 text-xs text-app-fg-muted">
                  Showing Media Buyers in <span className="font-medium text-app-fg">{activeBranchName}</span>.
                  Switch branches in the header to send to a buyer in another branch.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount ({'₦'})</label>
              <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input w-full" />
            </div>
            <FileUpload
              folder={ASSET_FOLDERS.RECEIPTS}
              name="receiptUrl"
              label="Receipt Upload"
              onUpload={(url) => setCreateFundingReceiptUrl(url)}
              onUploadStateChange={setCreateFundingUploadState}
            />
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={fetcher.state === 'submitting'}
                loadingText="Sending..."
                disabled={createFundingSubmitDisabled}
              >
                Send Funding
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowSendForm(false)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Confirm mark as received (transfer tab, incoming SENT) */}
      {markReceivedTarget && (
        <Modal
          open
          onClose={() => setMarkReceivedTarget(null)}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <h3 className="text-lg font-semibold text-app-fg">Mark as received?</h3>
          <p className="text-sm text-app-fg-muted">
            This confirms the funds arrived. You can only do this once for this transfer.
          </p>
          <ModalFetcherInlineError message={fundingSurface.errorMatchingIntent('verifyFunding')} />
          <div className="rounded-lg border border-app-border bg-app-hover p-3 text-sm">
            <p className="font-medium text-app-fg">
              <NairaPrice amount={Number(markReceivedTarget.amount)} />
            </p>
            <p className="text-app-fg-muted text-xs mt-1">
              {markReceivedTarget.senderName ?? userNameById(markReceivedTarget.senderId)}
              {' → '}
              {markReceivedTarget.receiverName ?? userNameById(markReceivedTarget.receiverId)}
            </p>
            <p className="text-xs text-app-fg-muted mt-1">
              {new Date(markReceivedTarget.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          {markReceivedTarget.receiptUrl ? (
            <div>
              <p className="text-xs font-medium text-app-fg-muted mb-1">Receipt</p>
              <div className="rounded-lg border border-app-border overflow-hidden bg-app-canvas max-h-48">
                <img
                  src={markReceivedTarget.receiptUrl}
                  alt="Transfer receipt"
                  className="w-full h-full max-h-48 object-contain"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-app-fg-muted">No receipt image on file for this transfer.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setMarkReceivedTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="success"
              size="sm"
              loading={fetcher.state === 'submitting' && markReceivedTarget !== null}
              loadingText="Submitting…"
              onClick={() => {
                if (!markReceivedTarget) return;
                const fd = new FormData();
                fd.set('intent', 'verifyFunding');
                fd.set('fundingId', markReceivedTarget.id);
                fd.set('action', 'COMPLETED');
                ensureBranchForAction({
                  actionLabel: 'marking funding as received',
                  onProceed: () => fetcher.submit(fd, { method: 'post' }),
                });
              }}
            >
              Mark as received
            </Button>
          </div>
        </Modal>
      )}

      {/* Confirm not received — then dispute reason (transfer tab) */}
      {notReceivedTarget && (
        <Modal
          open
          onClose={() => setNotReceivedTarget(null)}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <h3 className="text-lg font-semibold text-app-fg">Not received?</h3>
          <p className="text-sm text-app-fg-muted">
            You are about to flag this transfer as not received. The CEO and Head of Marketing will be notified. You will be asked for a short reason next.
          </p>
          <div className="rounded-lg border border-app-border bg-app-hover p-3 text-sm">
            <p className="font-medium text-app-fg">
              <NairaPrice amount={Number(notReceivedTarget.amount)} />
            </p>
            <p className="text-app-fg-muted text-xs mt-1">
              {notReceivedTarget.senderName ?? userNameById(notReceivedTarget.senderId)}
              {' → '}
              {notReceivedTarget.receiverName ?? userNameById(notReceivedTarget.receiverId)}
            </p>
          </div>
          {notReceivedTarget.receiptUrl ? (
            <div>
              <p className="text-xs font-medium text-app-fg-muted mb-1">Sender receipt (reference)</p>
              <div className="rounded-lg border border-app-border overflow-hidden bg-app-canvas max-h-48">
                <img
                  src={notReceivedTarget.receiptUrl}
                  alt="Transfer receipt"
                  className="w-full h-full max-h-48 object-contain"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-app-fg-muted">No receipt image on file.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setNotReceivedTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => {
                const id = notReceivedTarget.id;
                setNotReceivedTarget(null);
                setDisputingFundingId(id);
              }}
            >
              Continue
            </Button>
          </div>
        </Modal>
      )}

      {/* Dispute funding (mark Not Received) */}
      {disputingFundingId && (
        <Modal open onClose={() => setDisputingFundingId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Dispute Funding</h3>
          <p className="text-sm text-app-fg-muted">This will alert the CEO and Head of Marketing.</p>
          <ModalFetcherInlineError message={fundingSurface.errorMatchingIntent('verifyFunding')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="verifyFunding" />
            <input type="hidden" name="fundingId" value={disputingFundingId} />
            <input type="hidden" name="action" value="DISPUTED" />
            <Textarea label="Dispute Reason" name="disputeReason" required minLength={10} rows={3} placeholder="Explain why (min 10 chars)..." />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'} loadingText="Submitting...">
                Submit Dispute
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setDisputingFundingId(null)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Approve a funding request */}
      {approvingRequest && (
        <Modal open onClose={() => setApprovingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Approve funding request</h3>
          <p className="text-sm text-app-fg-muted">
            Send the money manually (e.g. bank transfer), then attach the receipt below. The requester will be notified and can preview the receipt.
          </p>
          <ModalFetcherInlineError message={fundingSurface.errorMatchingIntent('approveFundingRequest')} />
          <fetcher.Form method="post" className="space-y-3" onSubmit={handleApproveFundingRequestSubmit} noValidate>
            <input type="hidden" name="intent" value="approveFundingRequest" />
            <input type="hidden" name="requestId" value={approvingRequest.id} />
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Amount ({'₦'})<span className="text-app-fg-muted/70"> — requested {'₦'}{Number(approvingRequest.amount).toLocaleString()}</span>
              </label>
              <AmountInput
                name="amount"
                defaultValue={String(approvingRequest.amount)}
                className="input w-full"
              />
            </div>
            <FileUpload
              folder={ASSET_FOLDERS.RECEIPTS}
              name="receiptUrl"
              label="Receipt image"
              onUpload={(url) => setApproveFundingReceiptUrl(url)}
              onUploadStateChange={setApproveFundingUploadState}
            />
            <Textarea
              label="Reason (optional)"
              name="reason"
              rows={2}
              maxLength={500}
              placeholder="Optional note for the requester (e.g. why the amount was adjusted)"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={fetcher.state === 'submitting'}
                loadingText="Approving..."
                disabled={approveFundingSubmitDisabled}
              >
                Approve & notify
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setApprovingRequestId(null)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Reject a funding request */}
      {rejectingRequestId && (
        <Modal open onClose={() => setRejectingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Reject funding request</h3>
          <p className="text-sm text-app-fg-muted">The requester will be notified that their request was not approved.</p>
          <ModalFetcherInlineError message={fundingSurface.errorMatchingIntent('rejectFundingRequest')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="rejectFundingRequest" />
            <input type="hidden" name="requestId" value={rejectingRequestId} />
            <Textarea label="Reason (optional)" name="reason" rows={2} maxLength={500} placeholder="Optional note for records..." />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'} loadingText="Rejecting...">
                Reject
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setRejectingRequestId(null)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Receipt preview for a transfer */}
      {fundingReceiptModal?.receiptUrl && (
        <Modal
          open
          onClose={() => setFundingReceiptModal(null)}
          maxWidth="max-w-lg"
          role="dialog"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Funding receipt</h3>
            <button type="button" onClick={() => setFundingReceiptModal(null)} className="text-app-fg-muted hover:text-app-fg" aria-label="Close">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
              <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Amount</p>
              <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
                <NairaPrice amount={Number(fundingReceiptModal.amount)} />
              </p>
              <div className="flex items-center gap-2 mt-2 text-xs text-brand-500 dark:text-brand-400 flex-wrap">
                <span>
                  {fundingReceiptModal.senderName ?? userNameById(fundingReceiptModal.senderId)}
                  {' → '}
                  {fundingReceiptModal.receiverName ?? userNameById(fundingReceiptModal.receiverId)}
                </span>
                <span>·</span>
                <span>{new Date(fundingReceiptModal.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span>·</span>
                <StatusBadge status={fundingReceiptModal.status} />
              </div>
            </div>
            <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
              <img src={fundingReceiptModal.receiptUrl} alt="Funding receipt" className="w-full max-h-[400px] object-contain" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-4">
            <a href={fundingReceiptModal.receiptUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              Open in new tab
            </a>
            <Button variant="secondary" size="sm" onClick={() => setFundingReceiptModal(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {requestDetailsEntry && (
        <Modal
          open
          onClose={() => setRequestDetailsEntry(null)}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <h3 className="text-lg font-semibold text-app-fg">
            {requestDetailsEntry.entryType === 'request' ? 'Funding flow' : 'Transfer flow'}
          </h3>
          <FundingFlowTimeline
            {...(requestDetailsEntry.entryType === 'request'
              ? { requestId: requestDetailsEntry.id }
              : { transferId: requestDetailsEntry.id })}
          />
          <div className="flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setRequestDetailsEntry(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Reusable internals ───────────────────────────────────────────────────────────────

function CountPill({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={[
        'rounded-full px-1.5 py-0.5 text-micro font-semibold',
        active ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' : 'bg-app-hover text-app-fg-muted',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/**
 * Top metric strip — funding-relevant numbers. Replaces the old marketing-perf strip
 * (CPA / ROAS / Delivery Rate / Confirmation Rate) which didn't speak to funding.
 * MBs don't see "Distributed" since they never disburse downstream.
 */
function FundingMetricsStrip({
  summary,
  canDistribute,
  fundingBalance,
  pendingRequestsByMe,
  pendingRequestsToMe,
}: {
  summary: MarketingFundingLoaderData['directionSummary'];
  canDistribute: boolean;
  fundingBalance?: MarketingFundingLoaderData['fundingBalance'];
  /** PENDING funding requests I sent upstream that haven't been resolved yet. */
  pendingRequestsByMe: number;
  /** PENDING funding requests from my downstream waiting for my approval. Always 0 for non-distributors. */
  pendingRequestsToMe: number;
}) {
  const items = [
    ...(fundingBalance
      ? [
          {
            label: 'Current balance',
            value: <NairaPrice amount={Number(fundingBalance.balance)} />,
            valueClassName: 'text-success-600 dark:text-success-400',
            title:
              'COMPLETED funding received (all time) minus APPROVED ad spend on your campaigns. Can be lower than Total Received until you mark incoming transfers as Received.',
          },
        ]
      : []),
    {
      label: 'Total Received',
      value: <NairaPrice amount={Number(summary.totalReceived)} />,
      valueClassName: 'text-app-fg',
      title: 'Sum of incoming ledger transfers (any status) in the selected period — same data as the Transfers tab',
    },
    ...(canDistribute
      ? [
          {
            label: 'Total Distributed',
            value: <NairaPrice amount={Number(summary.totalDistributed)} />,
            valueClassName: 'text-app-fg',
            title: 'Sum of transfers you have sent in the selected period',
          },
        ]
      : []),
    {
      label: 'Pending Mark-Received',
      value: summary.pendingMarkReceived.toString(),
      valueClassName:
        summary.pendingMarkReceived > 0
          ? 'text-warning-600 dark:text-warning-400'
          : 'text-app-fg',
      title: 'Incoming transfers awaiting your confirmation',
    },
    // Pending request counts — for distributors we surface BOTH directions
    // (asks waiting on me + my own asks waiting upstream); for MBs only their
    // own outbound asks are relevant.
    ...(canDistribute
      ? [
          {
            label: 'Pending Requests',
            value: pendingRequestsToMe.toString(),
            valueClassName:
              pendingRequestsToMe > 0
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-app-fg',
            title: 'Funding requests from your team waiting for your approval',
          },
        ]
      : []),
    {
      label: canDistribute ? 'My Pending Asks' : 'Pending Requests',
      value: pendingRequestsByMe.toString(),
      valueClassName:
        pendingRequestsByMe > 0
          ? 'text-warning-600 dark:text-warning-400'
          : 'text-app-fg',
      title: canDistribute
        ? 'Your outbound funding requests (e.g. to Finance) still awaiting approval'
        : 'Your funding requests still awaiting approval from Head of Marketing',
    },
    {
      label: 'Disputed',
      value: (summary.disputedAsReceiver + summary.disputedAsSender).toString(),
      valueClassName:
        summary.disputedAsReceiver + summary.disputedAsSender > 0
          ? 'text-danger-600 dark:text-danger-400'
          : 'text-app-fg',
      title: 'Transfers flagged as Not Received (you or counterparty)',
    },
  ];
  return <OverviewStatStrip items={items} />;
}

/**
 * Per-slice filter bar — search + status dropdown. Identical layout for transfers/requests;
 * only the dropdown options + active value differ.
 */
function SliceFilterBar({
  tab,
  transfers,
  requests,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onStatusChange,
  onRequestStatusChange,
}: {
  tab: FundingTab;
  transfers: FundingSliceData;
  requests: FundingRequestsSliceData;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onStatusChange: (val: string) => void;
  onRequestStatusChange: (val: string) => void;
}) {
  const isTransfers = tab === 'transfers';
  const placeholder = isTransfers
    ? 'Search by sender, receiver, or funding ID...'
    : 'Search by requester or reason...';

  return (
    <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-stretch sm:items-center px-4 py-3 border-b border-app-border">
      <form onSubmit={onSearchSubmit} className="flex gap-2 flex-1 min-w-0">
        <SearchInput
          value={searchQuery}
          onChange={(val) => onSearchChange(val)}
          placeholder={placeholder}
          withSubmitButton
          wrapperClassName="flex-1 min-w-0"
        />
      </form>
      {isTransfers ? (
        <FormSelect
          value={transfers.statusFilter ?? 'ALL'}
          onChange={(e) => onStatusChange(e.target.value)}
          options={FUNDING_STATUS_OPTIONS.map((opt) => ({
            value: opt.value,
            label: `${opt.label}${opt.value === 'ALL' ? ` (${transfers.statusCounts.ALL})` : opt.value === 'SENT' ? ` (${transfers.statusCounts.SENT})` : opt.value === 'COMPLETED' ? ` (${transfers.statusCounts.COMPLETED})` : opt.value === 'DISPUTED' ? ` (${transfers.statusCounts.DISPUTED})` : ''}`,
          }))}
          wrapperClassName="w-auto min-w-[11rem]"
        />
      ) : (
        <FormSelect
          value={requests.statusFilter ?? 'ALL'}
          onChange={(e) => onRequestStatusChange(e.target.value)}
          options={REQUEST_STATUS_OPTIONS.map((opt) => ({
            value: opt.value,
            label: `${opt.label}${opt.value === 'ALL' ? ` (${requests.statusCounts.ALL})` : opt.value === 'PENDING' ? ` (${requests.statusCounts.PENDING})` : opt.value === 'APPROVED' ? ` (${requests.statusCounts.APPROVED})` : opt.value === 'REJECTED' ? ` (${requests.statusCounts.REJECTED})` : ''}`,
          }))}
          wrapperClassName="w-auto min-w-[11rem]"
        />
      )}
    </div>
  );
}

/**
 * Type + Status selects for funding ledger filters. Shared by the two filter
 * bars (desktop inline) and the page-header kebab (mobile actions group), so
 * the same controls render in one place no matter the viewport.
 */
function FundingFilterControls({
  slice,
  sentLabel,
  onTypeChange,
  onStatusChange,
}: {
  slice: {
    typeFilter: string;
    statusFilter?: string | null;
    typeCounts: { all: number; transfer: number; request: number };
    statusCounts: {
      ALL: number;
      SENT: number;
      COMPLETED: number;
      DISPUTED: number;
      PENDING: number;
      APPROVED: number;
      REJECTED: number;
    };
  };
  /** Label for the SENT bucket — "Sent" (distributing) vs "Pending mark-received" (received). */
  sentLabel: string;
  onTypeChange: (val: string) => void;
  onStatusChange: (val: string) => void;
}) {
  const typeOptions = DISTRIBUTING_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label:
      opt.value === 'all'
        ? `${opt.label} (${slice.typeCounts.all})`
        : opt.value === 'transfer'
          ? `${opt.label} (${slice.typeCounts.transfer})`
          : `${opt.label} (${slice.typeCounts.request})`,
  }));
  const statusOptions = [
    { value: 'ALL', label: `All Status (${slice.statusCounts.ALL})` },
    { value: 'SENT', label: `${sentLabel} (${slice.statusCounts.SENT})` },
    { value: 'COMPLETED', label: `Received (${slice.statusCounts.COMPLETED})` },
    { value: 'DISPUTED', label: `Disputed (${slice.statusCounts.DISPUTED})` },
    { value: 'PENDING', label: `Pending requests (${slice.statusCounts.PENDING})` },
    { value: 'APPROVED', label: `Approved requests (${slice.statusCounts.APPROVED})` },
    { value: 'REJECTED', label: `Rejected requests (${slice.statusCounts.REJECTED})` },
  ];
  return (
    <>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-app-fg-muted">Type</span>
        <FormSelect
          value={slice.typeFilter}
          onChange={(e) => onTypeChange(e.target.value)}
          options={typeOptions}
          wrapperClassName="w-full"
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-app-fg-muted">Status</span>
        <FormSelect
          value={slice.statusFilter ?? 'ALL'}
          onChange={(e) => onStatusChange(e.target.value)}
          options={statusOptions}
          wrapperClassName="w-full"
        />
      </div>
    </>
  );
}

function UnifiedDistributingFilterBar({
  slice,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onTypeChange,
  onStatusChange,
}: {
  slice: NonNullable<MarketingFundingLoaderData['distributingEntries']>;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onTypeChange: (val: string) => void;
  onStatusChange: (val: string) => void;
}) {
  const filterBadge = ledgerFilterBadgeCount(slice.typeFilter, slice.statusFilter);

  const statusOptions = [
    { value: 'ALL', label: `All Status (${slice.statusCounts.ALL})` },
    { value: 'SENT', label: `Sent (${slice.statusCounts.SENT})` },
    { value: 'COMPLETED', label: `Received (${slice.statusCounts.COMPLETED})` },
    { value: 'DISPUTED', label: `Disputed (${slice.statusCounts.DISPUTED})` },
    { value: 'PENDING', label: `Pending requests (${slice.statusCounts.PENDING})` },
    { value: 'APPROVED', label: `Approved requests (${slice.statusCounts.APPROVED})` },
    { value: 'REJECTED', label: `Rejected requests (${slice.statusCounts.REJECTED})` },
  ];

  const typeOptions = DISTRIBUTING_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label:
      opt.value === 'all'
        ? `${opt.label} (${slice.typeCounts.all})`
        : opt.value === 'transfer'
          ? `${opt.label} (${slice.typeCounts.transfer})`
          : `${opt.label} (${slice.typeCounts.request})`,
  }));

  return (
    <ToolbarFiltersCollapsible
      hideMobileSheet
      badgeCount={filterBadge}
      sheetSubtitle={<span>Type and status apply immediately</span>}
      searchRow={
        <form onSubmit={onSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
          <SearchInput
            value={searchQuery}
            onChange={(val) => onSearchChange(val)}
            placeholder="Search by requester, sender, receiver, or reason..."
            withSubmitButton
            wrapperClassName="min-w-0 flex-1"
          />
        </form>
      }
      desktopInlineFilters={
        <>
          <FormSelect
            value={slice.typeFilter}
            onChange={(e) => onTypeChange(e.target.value)}
            options={typeOptions}
            wrapperClassName="w-auto min-w-[10rem]"
          />
          <FormSelect
            value={slice.statusFilter ?? 'ALL'}
            onChange={(e) => onStatusChange(e.target.value)}
            options={statusOptions}
            wrapperClassName="w-auto min-w-[13rem]"
          />
        </>
      }
      sheetFilterBody={null}
    />
  );
}

function UnifiedDistributingTable({
  slice,
  users,
  onViewReceipt,
  onOpenDetails,
  onApprove,
  onReject,
  emptyMessage,
  canApproveFunding,
  loading = false,
}: {
  slice: NonNullable<MarketingFundingLoaderData['distributingEntries']>;
  users: User[];
  onViewReceipt: (rec: FundingRecord) => void;
  onOpenDetails: (entry: DistributingFundingEntry) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  emptyMessage: string;
  /** Phase 21 — gate Approve/Reject on `marketing.funding.approve` or legacy admin/HoM/Finance role. */
  canApproveFunding: boolean;
  loading?: boolean;
}) {
  const userNameById = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown user';

  const columns = useMemo<CompactTableColumn<DistributingFundingEntry>[]>(
    () => [
      {
        key: 'type',
        header: 'Type',
        render: (entry) => {
          const fromRequestChip =
            entry.entryType === 'transfer' && entry.sourceFundingRequestId ? (
              <span
                className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-app-hover px-1.5 py-0.5 text-micro font-medium text-app-fg-muted normal-case"
                title={
                  entry.sourceRequesterName
                    ? `Created from a request by ${entry.sourceRequesterName}`
                    : 'Created from an approved funding request'
                }
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l-4-4 4-4M5 10h11a4 4 0 014 4v3" />
                </svg>
                from request
              </span>
            ) : null;
          return (
            <span className="text-app-fg-muted text-xs uppercase tracking-wide">
              {entry.entryType === 'request' ? 'Request' : 'Transfer'}
              {fromRequestChip}
            </span>
          );
        },
      },
      {
        key: 'from',
        header: 'From',
        render: (entry) => (
          <span className="text-app-fg text-sm">
            {entry.entryType === 'request'
              ? (entry.requesterName ?? userNameById(entry.requesterId))
              : (entry.senderName ?? userNameById(entry.senderId))}
          </span>
        ),
      },
      {
        key: 'to',
        header: 'To',
        render: (entry) => (
          <span className="text-app-fg text-sm">
            {entry.entryType === 'request' ? '—' : (entry.receiverName ?? userNameById(entry.receiverId))}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (entry) => (
          <span className="font-medium">
            <NairaPrice amount={Number(entry.amount)} />
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (entry) => <StatusBadge status={entry.status} />,
      },
      {
        key: 'date',
        header: 'Date',
        render: (entry) => (
          <span className="text-app-fg-muted text-sm">
            {new Date(entry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (entry) => {
          const isPendingRequest = entry.entryType === 'request' && entry.status === 'PENDING';
          if (entry.entryType === 'request') {
            return (
              <div className="inline-flex flex-nowrap items-center justify-start gap-x-2 md:justify-end">
                <TableActionButton variant="primary" type="button" onClick={() => onOpenDetails(entry)}>
                  View
                </TableActionButton>
                {isPendingRequest && canApproveFunding ? (
                  <>
                    <TableActionButton variant="primary" type="button" onClick={() => onApprove(entry.id)}>
                      Approve
                    </TableActionButton>
                    <TableActionButton variant="danger" type="button" onClick={() => onReject(entry.id)}>
                      Reject
                    </TableActionButton>
                  </>
                ) : null}
              </div>
            );
          }
          return (
            <div className="inline-flex flex-nowrap items-center justify-start gap-x-2 md:justify-end">
              <TableActionButton variant="primary" type="button" onClick={() => onOpenDetails(entry)}>
                View flow
              </TableActionButton>
              {entry.receiptUrl ? (
                <TableActionButton
                  variant="primary"
                  type="button"
                  onClick={() =>
                    onViewReceipt({
                      id: entry.id,
                      senderId: entry.senderId,
                      receiverId: entry.receiverId,
                      amount: entry.amount,
                      receiptUrl: entry.receiptUrl,
                      status: entry.status,
                      sentAt: entry.createdAt,
                      verifiedAt: null,
                      senderName: entry.senderName,
                      receiverName: entry.receiverName,
                    })
                  }
                >
                  Receipt
                </TableActionButton>
              ) : null}
            </div>
          );
        },
      },
    ],
    [users, canApproveFunding, onViewReceipt, onOpenDetails, onApprove, onReject],
  );

  return (
    <CompactTable
      withCard={false}
      columns={columns}
      rows={slice.records}
      rowKey={(entry) => `${entry.entryType}-${entry.id}`}
      loading={loading}
      loadingVariant="overlay"
      emptyTitle="No entries"
      emptyDescription={emptyMessage}
      pagination={
        slice.totalPages > 1
          ? { page: slice.page, totalPages: slice.totalPages, pageParam: 'page' }
          : undefined
      }
    />
  );
}

/** Slice shape produced by the inline `unifiedReceivedSlice` useMemo. */
type UnifiedReceivedSlice = {
  records: DistributingFundingEntry[];
  total: number;
  page: number;
  totalPages: number;
  typeFilter: 'all' | 'transfer' | 'request';
  statusFilter: string;
  searchFilter?: string;
  typeCounts: { all: number; transfer: number; request: number };
  statusCounts: {
    ALL: number;
    SENT: number;
    COMPLETED: number;
    DISPUTED: number;
    PENDING: number;
    APPROVED: number;
    REJECTED: number;
  };
};

/**
 * Section-1 unified filter bar — mirrors `UnifiedDistributingFilterBar` but
 * frames the status options around the **incoming** direction (received,
 * pending mark-received, etc.) so the dropdown reads naturally.
 */
function UnifiedReceivedFilterBar({
  slice,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onTypeChange,
  onStatusChange,
}: {
  slice: UnifiedReceivedSlice;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onTypeChange: (val: string) => void;
  onStatusChange: (val: string) => void;
}) {
  const filterBadge = ledgerFilterBadgeCount(slice.typeFilter, slice.statusFilter);

  const statusOptions = [
    { value: 'ALL', label: `All Status (${slice.statusCounts.ALL})` },
    { value: 'SENT', label: `Pending mark-received (${slice.statusCounts.SENT})` },
    { value: 'COMPLETED', label: `Received (${slice.statusCounts.COMPLETED})` },
    { value: 'DISPUTED', label: `Disputed (${slice.statusCounts.DISPUTED})` },
    { value: 'PENDING', label: `Pending requests (${slice.statusCounts.PENDING})` },
    { value: 'APPROVED', label: `Approved requests (${slice.statusCounts.APPROVED})` },
    { value: 'REJECTED', label: `Rejected requests (${slice.statusCounts.REJECTED})` },
  ];

  const typeOptions = DISTRIBUTING_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label:
      opt.value === 'all'
        ? `${opt.label} (${slice.typeCounts.all})`
        : opt.value === 'transfer'
          ? `${opt.label} (${slice.typeCounts.transfer})`
          : `${opt.label} (${slice.typeCounts.request})`,
  }));

  return (
    <ToolbarFiltersCollapsible
      hideMobileSheet
      badgeCount={filterBadge}
      sheetSubtitle={<span>Type and status apply immediately</span>}
      searchRow={
        <form onSubmit={onSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
          <SearchInput
            value={searchQuery}
            onChange={(val) => onSearchChange(val)}
            placeholder="Search by sender, requester, or reason..."
            withSubmitButton
            wrapperClassName="min-w-0 flex-1"
          />
        </form>
      }
      desktopInlineFilters={
        <>
          <FormSelect
            value={slice.typeFilter}
            onChange={(e) => onTypeChange(e.target.value)}
            options={typeOptions}
            wrapperClassName="w-auto min-w-[10rem]"
          />
          <FormSelect
            value={slice.statusFilter ?? 'ALL'}
            onChange={(e) => onStatusChange(e.target.value)}
            options={statusOptions}
            wrapperClassName="w-auto min-w-[13rem]"
          />
        </>
      }
      sheetFilterBody={null}
    />
  );
}

/**
 * Section-1 unified table — incoming transfers + my outbound requests in one
 * feed. Action column is incoming-direction:
 *   - SENT transfer where receiver=me → Mark Received / Not Received
 *   - PENDING request where requester=me → Resend reminder
 *   - Receipt-bearing transfer → View receipt; pending request → View details
 */
function UnifiedReceivedTable({
  slice,
  users,
  currentUserId,
  fetcher,
  onViewReceipt,
  onOpenMarkReceived,
  onOpenNotReceived,
  onOpenDetails,
  emptyMessage,
  emptyAction,
  loading = false,
}: {
  slice: UnifiedReceivedSlice;
  users: User[];
  currentUserId: string;
  fetcher: ReturnType<typeof useFetcher>;
  onViewReceipt: (rec: FundingRecord) => void;
  onOpenMarkReceived: (rec: FundingRecord) => void;
  onOpenNotReceived: (rec: FundingRecord) => void;
  onOpenDetails: (entry: DistributingFundingEntry) => void;
  emptyMessage: string;
  emptyAction?: ReactNode;
  loading?: boolean;
}) {
  const userNameById = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown user';

  const transferToFundingRecord = (entry: DistributingFundingTransferEntry): FundingRecord => ({
    id: entry.id,
    senderId: entry.senderId,
    receiverId: entry.receiverId,
    amount: entry.amount,
    receiptUrl: entry.receiptUrl,
    status: entry.status,
    sentAt: entry.createdAt,
    verifiedAt: null,
    senderName: entry.senderName,
    receiverName: entry.receiverName,
  });

  const columns = useMemo<CompactTableColumn<DistributingFundingEntry>[]>(
    () => [
      {
        key: 'type',
        header: 'Type',
        render: (entry) => {
          const isTransfer = entry.entryType === 'transfer';
          const fromRequestChip =
            isTransfer && entry.sourceFundingRequestId ? (
              <span
                className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-app-hover px-1.5 py-0.5 text-micro font-medium text-app-fg-muted normal-case"
                title={
                  entry.sourceRequesterName
                    ? `Created from a request by ${entry.sourceRequesterName}`
                    : 'Created from an approved funding request'
                }
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l-4-4 4-4M5 10h11a4 4 0 014 4v3" />
                </svg>
                from request
              </span>
            ) : null;
          return (
            <span className="text-app-fg-muted text-xs uppercase tracking-wide">
              {isTransfer ? 'Transfer' : 'Request'}
              {fromRequestChip}
            </span>
          );
        },
      },
      {
        key: 'from',
        header: 'From',
        render: (entry) => (
          <span className="text-app-fg text-sm">
            {entry.entryType === 'transfer'
              ? (entry.senderName ?? userNameById(entry.senderId))
              : (entry.requesterName ?? userNameById(entry.requesterId))}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (entry) => (
          <span className="font-medium">
            <NairaPrice amount={Number(entry.amount)} />
          </span>
        ),
      },
      {
        key: 'reason',
        header: 'Reason / Receipt',
        render: (entry) => {
          if (entry.entryType === 'transfer') {
            return entry.receiptUrl ? (
              <button
                type="button"
                className="text-brand-500 hover:text-brand-600 text-xs"
                onClick={() => onViewReceipt(transferToFundingRecord(entry))}
              >
                View receipt
              </button>
            ) : (
              '—'
            );
          }
          return (
            <span className="text-app-fg-muted text-sm max-w-[220px] truncate block" title={entry.reason ?? undefined}>
              {entry.reason ?? '—'}
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (entry) => <StatusBadge status={entry.status} />,
      },
      {
        key: 'date',
        header: 'Date',
        render: (entry) => (
          <span className="text-app-fg-muted text-sm">
            {new Date(entry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (entry) => {
          const isTransfer = entry.entryType === 'transfer';
          const canMarkReceived =
            isTransfer && entry.status === 'SENT' && entry.receiverId === currentUserId;
          const canResend =
            !isTransfer && entry.status === 'PENDING' && entry.requesterId === currentUserId;

          return (
            <div className="flex flex-wrap items-center justify-start gap-x-2 gap-y-1 md:justify-end">
              <TableActionButton variant="primary" type="button" onClick={() => onOpenDetails(entry)}>
                View flow
              </TableActionButton>
              {canMarkReceived ? (
                <>
                  <TableActionButton
                    variant="primary"
                    type="button"
                    onClick={() => onOpenMarkReceived(transferToFundingRecord(entry))}
                  >
                    Received
                  </TableActionButton>
                  <TableActionButton
                    variant="danger"
                    type="button"
                    onClick={() => onOpenNotReceived(transferToFundingRecord(entry))}
                  >
                    Not Received
                  </TableActionButton>
                </>
              ) : canResend ? (
                <fetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="resendFundingRequest" />
                  <input type="hidden" name="requestId" value={entry.id} />
                  <TableActionButton
                    type="submit"
                    variant="neutral"
                    title="Send a reminder (once every 30 minutes)"
                  >
                    Resend
                  </TableActionButton>
                </fetcher.Form>
              ) : null}
            </div>
          );
        },
      },
    ],
    [users, currentUserId, fetcher, onViewReceipt, onOpenMarkReceived, onOpenNotReceived, onOpenDetails],
  );

  return (
    <CompactTable
      withCard={false}
      columns={columns}
      rows={slice.records}
      rowKey={(entry) => `${entry.entryType}-${entry.id}`}
      loading={loading}
      loadingVariant="overlay"
      emptyTitle="No entries"
      emptyDescription={emptyMessage}
      emptyAction={emptyAction}
      pagination={
        slice.totalPages > 1
          ? { page: slice.page, totalPages: slice.totalPages, pageParam: 'page' }
          : undefined
      }
    />
  );
}
