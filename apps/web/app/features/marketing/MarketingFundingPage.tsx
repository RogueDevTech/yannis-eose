import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Link, useFetcher, useRevalidator, useNavigation, useSearchParams, useLocation } from '@remix-run/react';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { createFundingSchema, approveFundingRequestSchema } from '@yannis/shared/validators';
import { PageNotification } from '~/components/ui/page-notification';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Spinner } from '~/components/ui/spinner';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { PageHeader } from '~/components/ui/page-header';
import { Tabs } from '~/components/ui/tabs';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Pagination } from '~/components/ui/pagination';
import { Textarea } from '~/components/ui/textarea';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import type {
  DistributingFundingEntry,
  FundingRecord,
  FundingRequestRecord,
  FundingSection,
  FundingTab,
  FundingSliceData,
  FundingRequestsSliceData,
  MarketingFundingLoaderData,
  User,
} from './types';

const FUNDING_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'SENT', label: 'Pending (sent)' },
  { value: 'COMPLETED', label: 'Received' },
  { value: 'DISPUTED', label: 'Disputed' },
];

const REQUEST_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const DISTRIBUTING_TYPE_OPTIONS: { value: 'all' | 'transfer' | 'request'; label: string }[] = [
  { value: 'all', label: 'All items' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'request', label: 'Requests' },
];

function parseSectionTab(
  search: string,
  canDistribute: boolean,
): { section: FundingSection; tab: FundingTab } {
  const u = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sectionParam = u.get('section');
  const section: FundingSection =
    sectionParam === 'distributing' && canDistribute ? 'distributing' : 'received';
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
  } = props;

  const isMediaBuyer = viewMode === 'media_buyer';
  const fetcher = useFetcher();
  const { toast } = useToast();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  /** Loader revalidation for this route (date range, section/tab, filters, pagination). */
  const isFundingRouteLoading =
    navigation.state === 'loading' &&
    (navigation.location?.pathname ?? '').includes('/admin/marketing/funding');

  const { section: displaySection, tab: displayTab } = useMemo(() => {
    const pending =
      navigation.state === 'loading' && navigation.location?.pathname.includes('/admin/marketing/funding');
    const search = (pending && navigation.location ? navigation.location.search : location.search) || '';
    return parseSectionTab(search, canDistribute);
  }, [navigation.state, navigation.location, location.search, canDistribute]);

  // ── Modal state ─────────────────────────────────────────
  const [showSendForm, setShowSendForm] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [disputingFundingId, setDisputingFundingId] = useState<string | null>(null);
  const [markReceivedTarget, setMarkReceivedTarget] = useState<FundingRecord | null>(null);
  const [notReceivedTarget, setNotReceivedTarget] = useState<FundingRecord | null>(null);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [fundingReceiptModal, setFundingReceiptModal] = useState<FundingRecord | null>(null);
  const [requestDetailsEntry, setRequestDetailsEntry] = useState<DistributingFundingEntry | null>(null);

  // The request being approved — looked up across both Section 1 (mine) and Section 2 (MBs')
  // so the Approve modal can pre-fill amount and show requester reason regardless of section.
  const approvingRequest = useMemo(() => {
    if (!approvingRequestId) return null;
    const all = [...myRequests.records, ...(mbRequests?.records ?? [])];
    return all.find((r) => r.id === approvingRequestId) ?? null;
  }, [approvingRequestId, myRequests.records, mbRequests?.records]);

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
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  useEffect(() => {
    if (actionSuccess && showSendForm) setShowSendForm(false);
  }, [actionSuccess, showSendForm]);
  useEffect(() => {
    if (actionSuccess && showRequestForm) setShowRequestForm(false);
  }, [actionSuccess, showRequestForm]);
  useEffect(() => {
    if (actionSuccess && disputingFundingId) setDisputingFundingId(null);
  }, [actionSuccess, disputingFundingId]);
  useEffect(() => {
    if (actionSuccess && approvingRequestId) setApprovingRequestId(null);
  }, [actionSuccess, approvingRequestId]);
  useEffect(() => {
    if (actionSuccess && rejectingRequestId) setRejectingRequestId(null);
  }, [actionSuccess, rejectingRequestId]);

  useEffect(() => {
    if (actionSuccess && revalidator.state === 'idle') revalidator.revalidate();
  }, [actionSuccess, revalidator.state, revalidator]);

  useEffect(() => {
    if (fetcher.state === 'idle' && (fetcher.data as { success?: boolean } | undefined)?.success && markReceivedTarget) {
      setMarkReceivedTarget(null);
    }
  }, [fetcher.state, fetcher.data, markReceivedTarget]);

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
  const receivedDescription = isMediaBuyer
    ? 'Funding sent to you by Head of Marketing. Mark each as Received once you confirm the transfer.'
    : currentUserRole === 'HEAD_OF_MARKETING'
      ? 'Funding sent to you by Finance, plus your outbound requests for more funds.'
      : 'Funding sent to your account, plus your outbound requests.';
  const distributingDescription =
    currentUserRole === 'HEAD_OF_MARKETING'
      ? 'Funding you have disbursed to Media Buyers and pending requests from your team.'
      : 'Funding disbursed downstream and pending requests awaiting your approval.';

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
    fd.set('receiptUrl', parsed.data.receiptUrl);
    fetcher.submit(fd, { method: 'post' });
  };

  const handleApproveFundingRequestSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!approvingRequest) return;
    const parsed = approveFundingRequestSchema.safeParse({
      requestId: approvingRequest.id,
      receiptUrl: approveFundingReceiptUrl.trim(),
    });
    if (!parsed.success) {
      toast.error('Cannot approve request', parsed.error.issues[0]?.message ?? 'Attach a valid receipt image.');
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set('receiptUrl', parsed.data.receiptUrl);
    fetcher.submit(fd, { method: 'post' });
  };

  const createFundingSubmitDisabled =
    createFundingUploadState === 'uploading' || !createFundingReceiptUrl.trim();
  const approveFundingSubmitDisabled =
    approveFundingUploadState === 'uploading' || !approveFundingReceiptUrl.trim();

  const transfersSlice: FundingSliceData =
    activeSection === 'distributing' && outgoingTransfers ? outgoingTransfers : receivedTransfers;
  const requestsSlice: FundingRequestsSliceData =
    activeSection === 'distributing' && mbRequests ? mbRequests : myRequests;
  const unifiedDistributingSlice = distributingEntries;
  const sectionDescriptionDisplay = displaySection === 'received' ? receivedDescription : distributingDescription;
  const requestsSubLabel = 'My Requests';
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding"
        description={
          <>
            {isMediaBuyer ? 'Funding sent to you.' : 'Track funds received and distributed.'}{' '}
            <Link to="/admin/marketing/ad-spend" className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
              Ad spend logging
            </Link>
          </>
        }
        actions={
          <>
            <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
              <DateFilterBar
                startDate={filters.startDate}
                endDate={filters.endDate}
                periodAllTime={filters.periodAllTime}
              />
            </div>
            {isFundingRouteLoading && (
              <span className="flex items-center text-app-fg-muted" aria-hidden>
                <Spinner size="sm" className="shrink-0" />
              </span>
            )}
          </>
        }
      />

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Top metric strip — funding-relevant numbers (replaces the old marketing-perf strip
          of CPA / ROAS / Delivery Rate / Confirmation Rate which didn't speak to funding). */}
      <FundingMetricsStrip summary={directionSummary} canDistribute={canDistribute} fundingBalance={fundingBalance} />

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
      <div className="card p-0 overflow-hidden" id="funding-ledger">
        {canDistribute && (
          <div className="px-4 pt-2">
            <Tabs
              variant="underline"
              value={displaySection}
              onChange={(v) => navigateToSlice(v as FundingSection, 'transfers')}
              tabs={[
                { value: 'received', label: receivedTitle },
                { value: 'distributing', label: 'Funds I Distribute' },
              ]}
            />
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 py-4 border-b border-app-border">
          <div className="min-w-0">
            {!canDistribute && <h2 className="text-base font-semibold text-app-fg">{receivedTitle}</h2>}
            <p className={`text-xs text-app-fg-muted leading-relaxed ${!canDistribute ? 'mt-0.5' : ''}`}>
              {sectionDescriptionDisplay}
            </p>
          </div>
          <div className="shrink-0 flex flex-wrap gap-2 justify-end">
            {displaySection === 'received' && canRequestFunding && (
              <Button variant="primary" size="sm" onClick={() => setShowRequestForm(true)}>
                + Request Funds
              </Button>
            )}
            {displaySection === 'distributing' && canSendFunding && (
              <Button variant="primary" size="sm" onClick={() => setShowSendForm(true)}>
                + Send Funding
              </Button>
            )}
          </div>
        </div>

        {displaySection === 'received' && (
          <div className="px-4">
            <Tabs
              value={displayTab}
              onChange={(v) => navigateToSlice(displaySection, v as FundingTab)}
              tabs={[
                {
                  value: 'transfers',
                  label: 'Transfers',
                  badge:
                    transfersSlice.statusCounts.ALL > 0 ? (
                      <CountPill active={displayTab === 'transfers'}>{transfersSlice.statusCounts.ALL}</CountPill>
                    ) : undefined,
                },
                {
                  value: 'requests',
                  label: requestsSubLabel,
                  badge:
                    requestsSlice.statusCounts.ALL > 0 ? (
                      <CountPill active={displayTab === 'requests'}>{requestsSlice.statusCounts.ALL}</CountPill>
                    ) : undefined,
                },
              ]}
            />
          </div>
        )}

        <div className="relative min-h-[14rem]" aria-busy={isFundingRouteLoading} aria-live="polite">
          {isFundingRouteLoading ? (
            <div
              className="flex min-h-[14rem] items-center justify-center py-10 px-4"
              role="status"
              aria-label="Loading funding data"
            >
              <div className="flex items-center gap-2.5 rounded-lg border border-app-border bg-app-elevated px-4 py-3 shadow-sm">
                <Spinner size="md" className="shrink-0 text-brand-500" />
                <span className="text-sm font-medium text-app-fg-muted">Loading this tab…</span>
              </div>
            </div>
          ) : (
            <>
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
              />
            </>
          ) : (
            <>
              <SliceFilterBar
                tab={activeTab}
                transfers={transfersSlice}
                requests={requestsSlice}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSearchSubmit={submitSearch}
                onStatusChange={(v) => updateSliceParam('status', v)}
                onRequestStatusChange={(v) => updateSliceParam('requestStatus', v)}
              />

              {activeTab === 'transfers' && (
                <TransfersTable
                  slice={transfersSlice}
                  users={users}
                  currentUserId={currentUserId}
                  direction={activeSection === 'received' ? 'incoming' : 'outgoing'}
                  onViewReceipt={setFundingReceiptModal}
                  onOpenMarkReceived={setMarkReceivedTarget}
                  onOpenNotReceived={setNotReceivedTarget}
                  emptyMessage={transferEmptyMessage}
                />
              )}
              {activeTab === 'requests' && (
                <RequestsTable
                  slice={requestsSlice}
                  users={users}
                  currentUserId={currentUserId}
                  mode="my-requests"
                  fetcher={fetcher}
                  onApprove={() => {}}
                  onReject={() => {}}
                  emptyMessage={requestsEmptyMessage}
                />
              )}
            </>
          )}
            </>
          )}
        </div>
      </div>

      {/* ─── Modals ───────────────────────────────────────────────────────────────── */}

      {/* Request Funding — MB asking HoM, or HoM asking Finance */}
      {canRequestFunding && showRequestForm && (
        <Modal open onClose={() => setShowRequestForm(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Request Funding</h3>
          <p className="text-sm text-app-fg-muted">
            {viewMode === 'admin'
              ? 'Finance will be notified and can disburse to you via Finance → Disbursements once approved.'
              : 'Head of Marketing will be notified and can disburse to you once approved.'}
          </p>
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="requestFunding" />
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
              defaultValue={viewMode === 'admin' ? '' : 'Ads spend'}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Submitting...">
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
          <fetcher.Form method="post" className="space-y-4" onSubmit={handleCreateFundingSubmit} noValidate>
            <input type="hidden" name="intent" value="createFunding" />
            <input type="hidden" name="receiverId" value={createFundingReceiverId} />
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Media Buyer</label>
              <SearchableSelect
                id="marketing-funding-receiver"
                required
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
              folder={S3_FOLDERS.RECEIPTS}
              name="receiptUrl"
              label="Receipt Upload"
              required
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
                fetcher.submit(fd, { method: 'post' });
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
          <fetcher.Form method="post" className="space-y-3" onSubmit={handleApproveFundingRequestSubmit} noValidate>
            <input type="hidden" name="intent" value="approveFundingRequest" />
            <input type="hidden" name="requestId" value={approvingRequest.id} />
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Amount ({'₦'})<span className="text-app-fg-muted/70"> — requested {'₦'}{Number(approvingRequest.amount).toLocaleString()}</span>
              </label>
              <AmountInput
                name="amount"
                required
                defaultValue={String(approvingRequest.amount)}
                className="input w-full"
              />
            </div>
            <FileUpload
              folder={S3_FOLDERS.RECEIPTS}
              name="receiptUrl"
              label="Receipt image"
              required
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

      {requestDetailsEntry && requestDetailsEntry.entryType === 'request' && (
        <Modal
          open
          onClose={() => setRequestDetailsEntry(null)}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <h3 className="text-lg font-semibold text-app-fg">Request details</h3>
          <div className="space-y-2 text-sm">
            <p className="text-app-fg">
              <span className="font-medium">Amount:</span> <NairaPrice amount={Number(requestDetailsEntry.amount)} />
            </p>
            <p className="text-app-fg">
              <span className="font-medium">Requester:</span> {requestDetailsEntry.requesterName ?? userNameById(requestDetailsEntry.requesterId)}
            </p>
            <p className="text-app-fg">
              <span className="font-medium">Status:</span> <StatusBadge status={requestDetailsEntry.status} />
            </p>
            <p className="text-app-fg">
              <span className="font-medium">Reason:</span> {requestDetailsEntry.reason ?? '—'}
            </p>
            <p className="text-app-fg">
              <span className="font-medium">Requested:</span>{' '}
              {new Date(requestDetailsEntry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <p className="text-app-fg">
              <span className="font-medium">Resolved:</span>{' '}
              {requestDetailsEntry.resolvedAt
                ? new Date(requestDetailsEntry.resolvedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—'}
            </p>
          </div>
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
        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
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
}: {
  summary: MarketingFundingLoaderData['directionSummary'];
  canDistribute: boolean;
  fundingBalance?: MarketingFundingLoaderData['fundingBalance'];
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
          wrapperClassName="flex-1 min-w-0"
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
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
  const statusOptions = [
    { value: 'ALL', label: `All (${slice.statusCounts.ALL})` },
    { value: 'SENT', label: `Sent (${slice.statusCounts.SENT})` },
    { value: 'COMPLETED', label: `Received (${slice.statusCounts.COMPLETED})` },
    { value: 'DISPUTED', label: `Disputed (${slice.statusCounts.DISPUTED})` },
    { value: 'PENDING', label: `Pending requests (${slice.statusCounts.PENDING})` },
    { value: 'APPROVED', label: `Approved requests (${slice.statusCounts.APPROVED})` },
    { value: 'REJECTED', label: `Rejected requests (${slice.statusCounts.REJECTED})` },
  ];

  return (
    <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-stretch sm:items-center px-4 py-3 border-b border-app-border">
      <form onSubmit={onSearchSubmit} className="flex gap-2 flex-1 min-w-0">
        <SearchInput
          value={searchQuery}
          onChange={(val) => onSearchChange(val)}
          placeholder="Search by requester, sender, receiver, or reason..."
          wrapperClassName="flex-1 min-w-0"
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>
      <FormSelect
        value={slice.typeFilter}
        onChange={(e) => onTypeChange(e.target.value)}
        options={DISTRIBUTING_TYPE_OPTIONS.map((opt) => ({
          value: opt.value,
          label:
            opt.value === 'all'
              ? `${opt.label} (${slice.typeCounts.all})`
              : opt.value === 'transfer'
                ? `${opt.label} (${slice.typeCounts.transfer})`
                : `${opt.label} (${slice.typeCounts.request})`,
        }))}
        wrapperClassName="w-auto min-w-[10rem]"
      />
      <FormSelect
        value={slice.statusFilter ?? 'ALL'}
        onChange={(e) => onStatusChange(e.target.value)}
        options={statusOptions}
        wrapperClassName="w-auto min-w-[13rem]"
      />
    </div>
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
}: {
  slice: NonNullable<MarketingFundingLoaderData['distributingEntries']>;
  users: User[];
  onViewReceipt: (rec: FundingRecord) => void;
  onOpenDetails: (entry: DistributingFundingEntry) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  emptyMessage: string;
}) {
  const userNameById = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown user';
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Type</th>
              <th className="table-header">From</th>
              <th className="table-header">To</th>
              <th className="table-header text-right">Amount</th>
              <th className="table-header">Status</th>
              <th className="table-header">Date</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slice.records.map((entry) => {
              const leftName =
                entry.entryType === 'request'
                  ? (entry.requesterName ?? userNameById(entry.requesterId))
                  : (entry.senderName ?? userNameById(entry.senderId));
              const rightName =
                entry.entryType === 'request'
                  ? '—'
                  : (entry.receiverName ?? userNameById(entry.receiverId));
              const isPendingRequest = entry.entryType === 'request' && entry.status === 'PENDING';
              return (
                <tr key={`${entry.entryType}-${entry.id}`} className="table-row">
                  <td className="table-cell text-app-fg-muted text-xs uppercase tracking-wide">
                    {entry.entryType === 'request' ? 'Request' : 'Transfer'}
                  </td>
                  <td className="table-cell text-app-fg text-sm">{leftName}</td>
                  <td className="table-cell text-app-fg text-sm">{rightName}</td>
                  <td className="table-cell text-right font-medium"><NairaPrice amount={Number(entry.amount)} /></td>
                  <td className="table-cell"><StatusBadge status={entry.status} /></td>
                  <td className="table-cell text-app-fg-muted text-sm">
                    {new Date(entry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      {entry.entryType === 'request' ? (
                        <>
                          <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => onOpenDetails(entry)}>
                            View
                          </Button>
                          {isPendingRequest && (
                            <>
                              <Button type="button" variant="primary" size="sm" className="text-xs" onClick={() => onApprove(entry.id)}>
                                Approve
                              </Button>
                              <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => onReject(entry.id)}>
                                Reject
                              </Button>
                            </>
                          )}
                        </>
                      ) : entry.receiptUrl ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-brand-500 hover:text-brand-600"
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
                        </Button>
                      ) : (
                        <span className="text-xs text-app-fg-muted">{'—'}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {slice.records.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No entries" description={emptyMessage} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3 px-1 py-3">
        {slice.records.map((entry) => (
          <div key={`${entry.entryType}-${entry.id}`} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-app-fg"><NairaPrice amount={Number(entry.amount)} /></span>
              <StatusBadge status={entry.status} />
            </div>
            <p className="text-xs text-app-fg-muted uppercase tracking-wide">
              {entry.entryType === 'request' ? 'Request' : 'Transfer'}
            </p>
            <p className="text-xs text-app-fg-muted">
              {new Date(entry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <div className="flex items-center gap-2">
              {entry.entryType === 'request' ? (
                <>
                  <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => onOpenDetails(entry)}>
                    View
                  </Button>
                  {entry.status === 'PENDING' && (
                    <>
                      <Button type="button" variant="primary" size="sm" className="text-xs" onClick={() => onApprove(entry.id)}>
                        Approve
                      </Button>
                      <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => onReject(entry.id)}>
                        Reject
                      </Button>
                    </>
                  )}
                </>
              ) : entry.receiptUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-brand-500 hover:text-brand-600"
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
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {slice.records.length === 0 && <EmptyState title="No entries" description={emptyMessage} />}
      </div>

      {slice.totalPages > 1 && (
        <div className="border-t border-app-border px-4 py-3">
          <Pagination page={slice.page} totalPages={slice.totalPages} pageParam="page" />
        </div>
      )}
    </>
  );
}

/**
 * Transfers table — used for both incoming (Section 1) and outgoing (Section 2) ledgers.
 * The Action column adapts: incoming + SENT + receiver=me → Mark Received / Not Received;
 * otherwise read-only.
 */
function TransfersTable({
  slice,
  users,
  currentUserId,
  direction,
  onViewReceipt,
  onOpenMarkReceived,
  onOpenNotReceived,
  emptyMessage,
}: {
  slice: FundingSliceData;
  users: User[];
  currentUserId: string;
  direction: 'incoming' | 'outgoing';
  onViewReceipt: (rec: FundingRecord) => void;
  onOpenMarkReceived: (rec: FundingRecord) => void;
  onOpenNotReceived: (rec: FundingRecord) => void;
  emptyMessage: string;
}) {
  const nameOf = (id: string) =>
    users.find((u: User) => u.id === id)?.name ?? 'Unknown user';

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Sender</th>
              <th className="table-header">Receiver</th>
              <th className="table-header text-right">Amount</th>
              <th className="table-header">Receipt</th>
              <th className="table-header">Status</th>
              <th className="table-header">Date</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slice.records.map((f: FundingRecord) => (
              <tr key={f.id} className="table-row">
                <td className="table-cell text-app-fg text-sm">{f.senderName ?? nameOf(f.senderId)}</td>
                <td className="table-cell text-app-fg text-sm">{f.receiverName ?? nameOf(f.receiverId)}</td>
                <td className="table-cell text-right font-medium"><NairaPrice amount={Number(f.amount)} /></td>
                <td className="table-cell">
                  {f.receiptUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-brand-500 hover:text-brand-600"
                      onClick={() => onViewReceipt(f)}
                    >
                      View
                    </Button>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="table-cell">
                  <StatusBadge status={f.status} />
                </td>
                <td className="table-cell text-app-fg-muted text-sm">
                  {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
                <td className="table-cell">
                  {direction === 'incoming' && f.status === 'SENT' && f.receiverId === currentUserId ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        className="text-xs"
                        onClick={() => onOpenMarkReceived(f)}
                      >
                        Received
                      </Button>
                      <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => onOpenNotReceived(f)}>
                        Not Received
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-app-fg-muted">{'—'}</span>
                  )}
                </td>
              </tr>
            ))}
            {slice.records.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No transfers" description={emptyMessage} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3 px-1 py-3">
        {slice.records.map((f: FundingRecord) => (
          <div key={f.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-app-fg"><NairaPrice amount={Number(f.amount)} /></span>
              <StatusBadge status={f.status} />
            </div>
            <p className="text-sm text-app-fg-muted">
              {f.senderName ?? nameOf(f.senderId)} {' → '} {f.receiverName ?? nameOf(f.receiverId)}
            </p>
            <p className="text-xs text-app-fg-muted">
              {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            {f.receiptUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-brand-500 hover:text-brand-600 text-sm"
                onClick={() => onViewReceipt(f)}
              >
                View receipt
              </Button>
            )}
            {direction === 'incoming' && f.status === 'SENT' && f.receiverId === currentUserId && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="success" size="sm" className="text-xs" onClick={() => onOpenMarkReceived(f)}>
                  Received
                </Button>
                <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => onOpenNotReceived(f)}>
                  Not Received
                </Button>
              </div>
            )}
          </div>
        ))}
        {slice.records.length === 0 && (
          <EmptyState title="No transfers" description={emptyMessage} />
        )}
      </div>

      {slice.totalPages > 1 && (
        <div className="border-t border-app-border px-4 py-3">
          <Pagination page={slice.page} totalPages={slice.totalPages} pageParam="page" />
        </div>
      )}
    </>
  );
}

/**
 * Requests table — used for both "My Requests" (Section 1) and "MB Requests" (Section 2).
 * The Action column adapts: pending + not-mine → Approve / Reject (mb-requests mode);
 * pending + mine → Resend reminder (my-requests mode); otherwise nothing.
 */
function RequestsTable({
  slice,
  users,
  currentUserId,
  mode,
  fetcher,
  onApprove,
  onReject,
  emptyMessage,
}: {
  slice: FundingRequestsSliceData;
  users: User[];
  currentUserId: string;
  mode: 'my-requests' | 'mb-requests';
  fetcher: ReturnType<typeof useFetcher>;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  emptyMessage: string;
}) {
  const showRequester = mode === 'mb-requests';

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {showRequester && <th className="table-header">Requester</th>}
              <th className="table-header text-right">Amount</th>
              <th className="table-header">Reason</th>
              <th className="table-header">Status</th>
              <th className="table-header">Requested</th>
              <th className="table-header">Resolved</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slice.records.map((r: FundingRequestRecord) => {
              const canResend =
                mode === 'my-requests' && r.requesterId === currentUserId && r.status === 'PENDING';
              const canApprove =
                mode === 'mb-requests' && r.status === 'PENDING' && r.requesterId !== currentUserId;
              return (
                <tr key={r.id} className="table-row">
                  {showRequester && (
                    <td className="table-cell text-app-fg text-sm">
                      {r.requesterName ??
                        users.find((u) => u.id === r.requesterId)?.name ??
                        'Unknown user'}
                    </td>
                  )}
                  <td className="table-cell text-right font-medium"><NairaPrice amount={Number(r.amount)} /></td>
                  <td className="table-cell text-app-fg-muted text-sm max-w-[200px] truncate" title={r.reason ?? undefined}>
                    {r.reason ?? '—'}
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="table-cell text-app-fg-muted text-sm">
                    {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="table-cell text-app-fg-muted text-sm">
                    {r.resolvedAt
                      ? new Date(r.resolvedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center justify-end gap-2">
                      {canResend && (
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="resendFundingRequest" />
                          <input type="hidden" name="requestId" value={r.id} />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            className="text-xs"
                            title="Send a reminder (once every 30 minutes)"
                          >
                            Resend
                          </Button>
                        </fetcher.Form>
                      )}
                      {canApprove && (
                        <>
                          <Button type="button" variant="primary" size="sm" className="text-xs" onClick={() => onApprove(r.id)}>
                            Approve
                          </Button>
                          <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => onReject(r.id)}>
                            Reject
                          </Button>
                        </>
                      )}
                      {!canResend && !canApprove && <span className="text-xs text-app-fg-muted">{'—'}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {slice.records.length === 0 && (
              <tr>
                <td colSpan={showRequester ? 7 : 6}>
                  <EmptyState title="No requests" description={emptyMessage} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3 px-1 py-3">
        {slice.records.map((r: FundingRequestRecord) => {
          const canResend =
            mode === 'my-requests' && r.requesterId === currentUserId && r.status === 'PENDING';
          const canApprove =
            mode === 'mb-requests' && r.status === 'PENDING' && r.requesterId !== currentUserId;
          return (
            <div key={r.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                {showRequester ? (
                  <span className="font-medium text-app-fg text-sm">
                    {r.requesterName ?? users.find((u) => u.id === r.requesterId)?.name ?? 'Unknown user'}
                  </span>
                ) : (
                  <span className="font-medium text-app-fg text-sm">
                    <NairaPrice amount={Number(r.amount)} />
                  </span>
                )}
                <StatusBadge status={r.status} />
              </div>
              {showRequester && (
                <p className="text-sm text-app-fg-muted"><NairaPrice amount={Number(r.amount)} /></p>
              )}
              {r.reason && <p className="text-sm text-app-fg-muted">{r.reason}</p>}
              <p className="text-xs text-app-fg-muted">
                Requested {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {canResend && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="resendFundingRequest" />
                    <input type="hidden" name="requestId" value={r.id} />
                    <Button type="submit" variant="secondary" size="sm" className="text-xs">
                      Resend
                    </Button>
                  </fetcher.Form>
                )}
                {canApprove && (
                  <>
                    <Button type="button" variant="primary" size="sm" className="text-xs flex-1 sm:flex-initial" onClick={() => onApprove(r.id)}>
                      Approve
                    </Button>
                    <Button type="button" variant="danger" size="sm" className="text-xs flex-1 sm:flex-initial" onClick={() => onReject(r.id)}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {slice.records.length === 0 && (
          <EmptyState title="No requests" description={emptyMessage} />
        )}
      </div>

      {slice.totalPages > 1 && (
        <div className="border-t border-app-border px-4 py-3">
          <Pagination page={slice.page} totalPages={slice.totalPages} pageParam="page" />
        </div>
      )}
    </>
  );
}
