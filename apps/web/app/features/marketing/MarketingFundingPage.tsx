import { useState, useEffect } from 'react';
import { Link, useFetcher, useRevalidator, useNavigation, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { HighCpaWarningBanner } from '~/features/marketing/HighCpaWarningBanner';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Spinner } from '~/components/ui/spinner';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { PageHeader } from '~/components/ui/page-header';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Pagination } from '~/components/ui/pagination';
import { Textarea } from '~/components/ui/textarea';
import type {
  MarketingFundingLoaderData,
  FundingRecord,
  FundingRequestRecord,
  FundingActivityFeed,
  FundingRequestStatusCounts,
  LeaderboardEntry,
  Metrics,
  User,
} from './types';

const FUNDING_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All funding' },
  { value: 'SENT', label: 'Pending (sent)' },
  { value: 'COMPLETED', label: 'Received' },
  { value: 'DISPUTED', label: 'Disputed' },
];

const REQUEST_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All requests' },
  { value: 'PENDING', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

// Configurable CPA threshold for high-CPA alerts (in Naira)
const HIGH_CPA_THRESHOLD = 5000;

export function MarketingFundingPage({
  funding,
  totalFunding,
  page,
  totalPages,
  statusFilter,
  searchFilter,
  statusCounts,
  metrics,
  users,
  leaderboard,
  filters,
  viewMode = 'admin',
  canSendFunding = true,
  canRequestFunding = viewMode === 'media_buyer',
  fundingRequests = [],
  currentUserId = '',
  feed = 'ledger',
  showFundingRequestsFeed = false,
  requestStatusFilter,
  requestSearchFilter,
  requestStatusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 } satisfies FundingRequestStatusCounts,
  totalFundingRequests = 0,
  totalPagesRequests = 1,
}: MarketingFundingLoaderData) {
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';

  // Optimistic tab — switches immediately on click, cleared when server data arrives
  const [pendingFeed, setPendingFeed] = useState<FundingActivityFeed | null>(null);
  const activeFeed = pendingFeed ?? feed;
  useEffect(() => {
    // Server confirmed the new feed — clear optimistic state
    setPendingFeed(null);
  }, [feed]);

  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [selectedRequestStatus, setSelectedRequestStatus] = useState(requestStatusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [requestSearchQuery, setRequestSearchQuery] = useState(requestSearchFilter || '');

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  useEffect(() => {
    setSelectedRequestStatus(requestStatusFilter || 'ALL');
    setRequestSearchQuery(requestSearchFilter || '');
  }, [requestStatusFilter, requestSearchFilter]);

  const getActivityParams = (overrides: {
    page?: number;
    status?: string;
    search?: string;
    feed?: FundingActivityFeed;
    requestStatus?: string;
  }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.feed !== undefined) {
      if (overrides.feed === 'requests') params.delete('feed'); // 'requests' is the default — clean URL
      else params.set('feed', overrides.feed);
    }
    if (overrides.page !== undefined) params.set('page', String(overrides.page));
    if (overrides.status !== undefined) {
      if (overrides.status === 'ALL' || !overrides.status) params.delete('status');
      else params.set('status', overrides.status);
    }
    if (overrides.search !== undefined) {
      if (overrides.search) params.set('search', overrides.search);
      else params.delete('search');
    }
    if (overrides.requestStatus !== undefined) {
      if (overrides.requestStatus === 'ALL' || !overrides.requestStatus) params.delete('requestStatus');
      else params.set('requestStatus', overrides.requestStatus);
    }
    return params;
  };

  const buildActivityQueryString = (overrides: Parameters<typeof getActivityParams>[0]) => {
    const qs = getActivityParams(overrides).toString();
    return qs ? `?${qs}` : '?';
  };

  const handleFeedChange = (next: FundingActivityFeed) => {
    setPendingFeed(next); // optimistic — tab switches immediately
    const params = new URLSearchParams(searchParams);
    params.set('page', '1');
    if (next === 'ledger') {
      params.set('feed', 'ledger');
      params.delete('requestStatus');
      params.delete('requestSearch');
    } else {
      params.delete('feed'); // 'requests' is the default — clean URL
      params.delete('status');
      params.delete('search');
    }
    setSearchParams(params);
  };

  const handleFundingStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSearchParams(getActivityParams({ status: status === 'ALL' ? 'ALL' : status, page: 1 }));
  };

  const handleRequestStatusChange = (status: string) => {
    setSelectedRequestStatus(status);
    setSearchParams(getActivityParams({ requestStatus: status === 'ALL' ? 'ALL' : status, page: 1 }));
  };

  const handleLedgerJumpToRequests = (status: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete('feed'); // 'requests' is the default
    params.set('page', '1');
    params.delete('status');
    params.delete('search');
    if (status === 'ALL' || !status) params.delete('requestStatus');
    else params.set('requestStatus', status);
    setSearchParams(params);
    setSelectedRequestStatus(status === 'ALL' || !status ? 'ALL' : status);
  };

  const handleFundingSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(getActivityParams({ search: searchQuery.trim() || undefined, page: 1 }));
  };

  const handleRequestSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    params.set('page', '1');
    const q = requestSearchQuery.trim();
    if (q) params.set('requestSearch', q);
    else params.delete('requestSearch');
    setSearchParams(params);
  };
  const [showFundingForm, setShowFundingForm] = useState(false);
  const [showRequestFundingForm, setShowRequestFundingForm] = useState(false);
  const [disputingFundingId, setDisputingFundingId] = useState<string | null>(null);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [previewingRequestId, setPreviewingRequestId] = useState<string | null>(null);
  const [fundingReceiptModal, setFundingReceiptModal] = useState<FundingRecord | null>(null);

  const previewingRequest = previewingRequestId
    ? fundingRequests.find((r) => r.id === previewingRequestId) ?? null
    : null;

  useEffect(() => {
    if (previewingRequestId && !previewingRequest) {
      setPreviewingRequestId(null);
    }
  }, [previewingRequestId, previewingRequest]);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  if (actionSuccess && showFundingForm) setShowFundingForm(false);
  if (actionSuccess && showRequestFundingForm) setShowRequestFundingForm(false);
  if (actionSuccess && disputingFundingId) setDisputingFundingId(null);
  if (actionSuccess && approvingRequestId) setApprovingRequestId(null);
  if (actionSuccess && rejectingRequestId) setRejectingRequestId(null);

  useEffect(() => {
    if (actionSuccess && revalidator.state === 'idle') {
      revalidator.revalidate();
    }
  }, [actionSuccess, revalidator.state, revalidator]);

  /** Truncated ID fallback — used when users list hasn't streamed yet */
  const truncateId = (id: string) => id.slice(0, 8) + '...';
  const isMediaBuyerView = viewMode === 'media_buyer';
  const activeTotalPages = activeFeed === 'ledger' ? totalPages : totalPagesRequests;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding"
        description={
          <>
            {isMediaBuyerView ? 'Funding sent to you.' : 'Funding ledger and performance metrics.'}{' '}
            <Link
              to="/admin/marketing/ad-spend"
              className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
            >
              Ad spend logging
            </Link>
          </>
        }
        actions={
          <>
            <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
              <DateFilterBar
                startDate={dateFilters.startDate}
                endDate={dateFilters.endDate}
                periodAllTime={dateFilters.periodAllTime}
              />
            </div>
            {isFilterLoading && (
              <span className="flex items-center text-app-fg-muted" aria-hidden>
                <Spinner size="sm" className="shrink-0" />
              </span>
            )}
            {canSendFunding && (
              <Button variant="primary" size="sm" onClick={() => setShowFundingForm(!showFundingForm)}>
                {showFundingForm ? 'Close' : '+ Send Funding'}
              </Button>
            )}
            {canRequestFunding && (
              <Button variant="secondary" size="sm" onClick={() => setShowRequestFundingForm(!showRequestFundingForm)}>
                {showRequestFundingForm ? 'Close' : '+ Request Funds'}
              </Button>
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

      <DeferredSection resolve={metrics} fallback={<OverviewStatStripSkeleton count={5} />}>
        {(m: Metrics) => (
          <OverviewStatStrip
            items={[
              {
                label: 'CPA',
                value: <>{'\u20A6'}{Math.round(m.cpa).toLocaleString()}</>,
                valueClassName: 'text-app-fg',
                title: 'Spend / All Orders',
              },
              {
                label: 'True ROAS',
                value: <>{m.trueRoas.toFixed(2)}x</>,
                valueClassName: 'text-brand-600 dark:text-brand-400',
                title: 'Delivered Revenue / Spend',
              },
              {
                label: 'Delivery Rate',
                value: <>{m.deliveryRate.toFixed(1)}%</>,
                valueClassName: 'text-success-600 dark:text-success-400',
                title: 'Delivered / Total Orders',
              },
              {
                label: 'Confirmation Rate',
                value: <>{m.confirmationRate.toFixed(1)}%</>,
                valueClassName: 'text-success-600 dark:text-success-400',
                title: 'Confirmed (CS scheduled) / Total Orders',
              },
              {
                label: 'Total Spend',
                value: <>{'\u20A6'}{Math.round(m.totalSpend).toLocaleString()}</>,
                valueClassName: 'text-app-fg',
                title: `${m.totalOrders} orders, ${m.deliveredOrders} delivered`,
              },
            ]}
          />
        )}
      </DeferredSection>

      {/* High CPA Alert Banner — admin only, not shown to media buyers */}
      {!isMediaBuyerView && (
        <DeferredSection resolve={leaderboard} skeleton="inline">
          {(lb) => {
            const highCpaBuyers = lb.filter((b: LeaderboardEntry) => b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0);
            return (
              <HighCpaWarningBanner
                buyers={highCpaBuyers.map((b: LeaderboardEntry) => ({ mediaBuyerId: b.mediaBuyerId, name: b.name, cpa: b.cpa }))}
                threshold={HIGH_CPA_THRESHOLD}
              />
            );
          }}
        </DeferredSection>
      )}

      <>
          {/* Request Funding Modal — Media Buyer or Head of Marketing */}
          {canRequestFunding && showRequestFundingForm && (
            <Modal open onClose={() => setShowRequestFundingForm(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
                <h3 className="text-lg font-semibold text-app-fg">Request Funding</h3>
                <p className="text-sm text-app-fg-muted">
                  {viewMode === 'admin'
                    ? 'Finance will be notified and can disburse to you via Finance → Disbursements once approved.'
                    : 'Head of Marketing will be notified and can disburse to you once approved.'}
                </p>
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="requestFunding" />
                  <div>
                    <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount ({'\u20A6'})</label>
                    <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input" />
                  </div>
                  <div>
                    <Textarea label="Reason (optional)" name="reason" rows={2} maxLength={500} placeholder="What do you need the funds for?" />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Submitting...">
                      Submit Request
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setShowRequestFundingForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </fetcher.Form>
            </Modal>
          )}

          {/* Dispute modal */}
          {disputingFundingId && (
            <Modal open onClose={() => setDisputingFundingId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
                <h3 className="text-lg font-semibold text-app-fg">Dispute Funding</h3>
                <p className="text-sm text-app-fg-muted">
                  This will alert the CEO and Head of Marketing.
                </p>
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="verifyFunding" />
                  <input type="hidden" name="fundingId" value={disputingFundingId} />
                  <input type="hidden" name="action" value="DISPUTED" />
                  <div>
                    <Textarea label="Dispute Reason" name="disputeReason" required minLength={10} rows={3} placeholder="Explain why (min 10 chars)..." />
                  </div>
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

          <div id="funding-activity" className="card p-0 overflow-hidden scroll-mt-4">
            {/* Tab bar */}
            {showFundingRequestsFeed && (
              <div className="flex items-center gap-0 border-b border-app-border px-4">
                {(['requests', 'ledger'] as FundingActivityFeed[]).map((tab) => {
                  const label = tab === 'requests' ? 'Requests' : 'Transfers';
                  const count = tab === 'requests' ? requestStatusCounts.ALL : statusCounts.ALL;
                  const isActive = activeFeed === tab;
                  const isPending = pendingFeed === tab && isFilterLoading;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => handleFeedChange(tab)}
                      disabled={isPending}
                      className={[
                        'relative -mb-px inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors focus:outline-none',
                        isActive
                          ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-600 dark:border-brand-400'
                          : 'text-app-fg-muted hover:text-app-fg border-b-2 border-transparent',
                      ].join(' ')}
                    >
                      {isPending ? (
                        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : null}
                      {label}
                      {count > 0 && (
                        <span className={[
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                          isActive
                            ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                            : 'bg-app-hover text-app-fg-muted',
                        ].join(' ')}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Per-tab filter bar */}
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-stretch sm:items-center px-4 py-3 border-b border-app-border">
              {activeFeed === 'ledger' && (
                <>
                  <form onSubmit={handleFundingSearchSubmit} className="flex gap-2 flex-1 min-w-0">
                    <SearchInput
                      value={searchQuery}
                      onChange={(val) => setSearchQuery(val)}
                      placeholder="Search by sender, receiver, or funding ID..."
                      wrapperClassName="flex-1 min-w-0"
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      Search
                    </Button>
                  </form>
                  <FormSelect
                    value={selectedStatus}
                    onChange={(e) => handleFundingStatusChange(e.target.value)}
                    options={FUNDING_STATUS_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: `${opt.label}${opt.value === 'ALL' ? ` (${statusCounts.ALL})` : opt.value === 'SENT' ? ` (${statusCounts.SENT})` : opt.value === 'COMPLETED' ? ` (${statusCounts.COMPLETED})` : opt.value === 'DISPUTED' ? ` (${statusCounts.DISPUTED})` : ''}`,
                    }))}
                    wrapperClassName="w-auto min-w-[11rem]"
                  />
                </>
              )}
              {activeFeed === 'requests' && (
                <>
                  <form onSubmit={handleRequestSearchSubmit} className="flex gap-2 flex-1 min-w-0">
                    <SearchInput
                      value={requestSearchQuery}
                      onChange={(val) => setRequestSearchQuery(val)}
                      placeholder="Search by requester or reason..."
                      wrapperClassName="flex-1 min-w-0"
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      Search
                    </Button>
                  </form>
                  <FormSelect
                    value={selectedRequestStatus}
                    onChange={(e) => handleRequestStatusChange(e.target.value)}
                    options={REQUEST_STATUS_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: `${opt.label}${opt.value === 'ALL' ? ` (${requestStatusCounts.ALL})` : opt.value === 'PENDING' ? ` (${requestStatusCounts.PENDING})` : opt.value === 'APPROVED' ? ` (${requestStatusCounts.APPROVED})` : opt.value === 'REJECTED' ? ` (${requestStatusCounts.REJECTED})` : ''}`,
                    }))}
                    wrapperClassName="w-auto min-w-[11rem]"
                  />
                </>
              )}
              {!showFundingRequestsFeed && isFilterLoading && (
                <span className="flex items-center text-app-fg-muted" aria-hidden>
                  <Spinner size="sm" className="shrink-0" />
                </span>
              )}
            </div>
            {activeFeed === 'ledger' ? (
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
                      {funding.map((f: FundingRecord) => (
                        <tr key={f.id} className="table-row">
                          <td className="table-cell text-app-fg text-sm">
                            <DeferredSection resolve={users} skeleton="inline">
                              {(resolvedUsers: User[]) => (
                                <>{f.senderName ?? resolvedUsers.find((u) => u.id === f.senderId)?.name ?? truncateId(f.senderId)}</>
                              )}
                            </DeferredSection>
                          </td>
                          <td className="table-cell text-app-fg text-sm">
                            <DeferredSection resolve={users} skeleton="inline">
                              {(resolvedUsers: User[]) => (
                                <>{f.receiverName ?? resolvedUsers.find((u) => u.id === f.receiverId)?.name ?? truncateId(f.receiverId)}</>
                              )}
                            </DeferredSection>
                          </td>
                          <td className="table-cell text-right font-medium"><NairaPrice amount={Number(f.amount)} /></td>
                          <td className="table-cell">
                            {f.receiptUrl ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-xs text-brand-500 hover:text-brand-600"
                                onClick={() => setFundingReceiptModal(f)}
                              >
                                View
                              </Button>
                            ) : (
                              '\u2014'
                            )}
                          </td>
                          <td className="table-cell">
                            <StatusBadge status={f.status} />
                          </td>
                          <td className="table-cell text-app-fg-muted text-sm">
                            {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td className="table-cell">
                            {f.status === 'SENT' && f.receiverId === currentUserId ? (
                              <div className="flex flex-wrap gap-1.5">
                                <fetcher.Form method="post" className="inline">
                                  <input type="hidden" name="intent" value="verifyFunding" />
                                  <input type="hidden" name="fundingId" value={f.id} />
                                  <input type="hidden" name="action" value="COMPLETED" />
                                  <Button
                                    type="submit"
                                    variant="success"
                                    size="sm"
                                    className="text-xs"
                                    loading={fetcher.state === 'submitting'}
                                    loadingText="Processing..."
                                  >
                                    Received
                                  </Button>
                                </fetcher.Form>
                                <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => setDisputingFundingId(f.id)}>
                                  Not Received
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-app-fg-muted">{'\u2014'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {funding.length === 0 && (
                        <tr>
                          <td colSpan={7}>
                            <EmptyState title="No funding records match your filters" />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden space-y-3 px-1 py-3">
                  {funding.map((f: FundingRecord) => (
                    <div key={f.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-app-fg"><NairaPrice amount={Number(f.amount)} /></span>
                        <StatusBadge status={f.status} />
                      </div>
                      <p className="text-sm text-app-fg-muted">
                        <DeferredSection resolve={users} skeleton="inline">
                          {(resolvedUsers: User[]) => (
                            <>
                              {f.senderName ?? resolvedUsers.find((u) => u.id === f.senderId)?.name ?? truncateId(f.senderId)}
                              {' \u2192 '}
                              {f.receiverName ?? resolvedUsers.find((u) => u.id === f.receiverId)?.name ?? truncateId(f.receiverId)}
                            </>
                          )}
                        </DeferredSection>
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
                          onClick={() => setFundingReceiptModal(f)}
                        >
                          View receipt
                        </Button>
                      )}
                      {f.status === 'SENT' && f.receiverId === currentUserId && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <fetcher.Form method="post" className="inline">
                            <input type="hidden" name="intent" value="verifyFunding" />
                            <input type="hidden" name="fundingId" value={f.id} />
                            <input type="hidden" name="action" value="COMPLETED" />
                            <Button type="submit" variant="success" size="sm" className="text-xs">
                              Received
                            </Button>
                          </fetcher.Form>
                          <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => setDisputingFundingId(f.id)}>
                            Not Received
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {funding.length === 0 && (
                    <EmptyState title="No funding records match your filters" />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">Requester</th>
                        <th className="table-header text-right">Amount</th>
                        <th className="table-header">Reason</th>
                        <th className="table-header">Status</th>
                        <th className="table-header">Requested</th>
                        <th className="table-header">Resolved</th>
                        <th className="table-header">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fundingRequests.map((r: FundingRequestRecord) => (
                        <tr key={r.id} className="table-row">
                          <td className="table-cell text-app-fg text-sm">
                            <DeferredSection resolve={users} skeleton="inline">
                              {(resolvedUsers: User[]) => (
                                <>
                                  {r.requesterName ??
                                    resolvedUsers.find((u) => u.id === r.requesterId)?.name ??
                                    truncateId(r.requesterId)}
                                </>
                              )}
                            </DeferredSection>
                          </td>
                          <td className="table-cell text-right font-medium"><NairaPrice amount={Number(r.amount)} /></td>
                          <td className="table-cell text-app-fg-muted text-sm max-w-[200px] truncate" title={r.reason ?? undefined}>
                            {r.reason ?? '\u2014'}
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
                              : '\u2014'}
                          </td>
                          <td className="table-cell">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="text-xs"
                              onClick={() => setPreviewingRequestId(r.id)}
                            >
                              Preview
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {fundingRequests.length === 0 && (
                        <tr>
                          <td colSpan={7}>
                            <EmptyState title="No funding requests match your filters" />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden space-y-3 px-1 py-3">
                  {fundingRequests.map((r: FundingRequestRecord) => (
                    <div key={r.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <DeferredSection resolve={users} skeleton="inline">
                          {(resolvedUsers: User[]) => (
                            <span className="font-medium text-app-fg text-sm">
                              {r.requesterName ??
                                resolvedUsers.find((u) => u.id === r.requesterId)?.name ??
                                truncateId(r.requesterId)}
                            </span>
                          )}
                        </DeferredSection>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-sm text-app-fg-muted"><NairaPrice amount={Number(r.amount)} /></p>
                      {r.reason && <p className="text-sm text-app-fg-muted">{r.reason}</p>}
                      <p className="text-xs text-app-fg-muted">
                        Requested{' '}
                        {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="text-xs w-full sm:w-auto"
                        onClick={() => setPreviewingRequestId(r.id)}
                      >
                        Preview
                      </Button>
                    </div>
                  ))}
                  {fundingRequests.length === 0 && (
                    <EmptyState title="No funding requests match your filters" />
                  )}
                </div>
              </>
            )}

            {activeTotalPages > 1 && (
              <div className="border-t border-app-border px-4 py-3">
                <Pagination page={page} totalPages={activeTotalPages} pageParam="page" />
              </div>
            )}
          </div>
      </>

      {/* Send Funding Modal — Admin / HoM only */}
      {canSendFunding && showFundingForm && (
        <Modal open onClose={() => setShowFundingForm(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
            <h3 className="text-lg font-semibold text-app-fg">Send Funding to Media Buyer</h3>
            <p className="text-sm text-app-fg-muted">
              Select the recipient, amount, and upload the receipt. The Media Buyer will be notified and can mark as received.
            </p>
            <fetcher.Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="createFunding" />
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Media Buyer</label>
                <DeferredSection resolve={users} skeleton="inline">
                  {(resolvedUsers: User[]) => {
                    const mediaBuyers = resolvedUsers.filter((u: User) => u.role === 'MEDIA_BUYER');
                    return (
                      <FormSelect
                        name="receiverId"
                        required
                        placeholder="Select recipient..."
                        options={mediaBuyers.map((u: User) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
                        wrapperClassName="w-full"
                      />
                    );
                  }}
                </DeferredSection>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount ({'\u20A6'})</label>
                <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input w-full" />
              </div>
              <div>
                <FileUpload
                  folder={S3_FOLDERS.RECEIPTS}
                  name="receiptUrl"
                  label="Receipt Upload"
                  required
                  onUpload={() => {}}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Sending...">
                  Send Funding
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowFundingForm(false)}>
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

      {/* Approve funding request modal — HoM: attach receipt after sending money manually */}
      {approvingRequestId && (
        <Modal open onClose={() => setApprovingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
            <h3 className="text-lg font-semibold text-app-fg">Approve funding request</h3>
            <p className="text-sm text-app-fg-muted">
              Send the money to the Media Buyer manually (e.g. bank transfer), then attach the receipt image below. They will be notified and can preview the receipt.
            </p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="approveFundingRequest" />
              <input type="hidden" name="requestId" value={approvingRequestId} />
              <FileUpload
                folder={S3_FOLDERS.RECEIPTS}
                name="receiptUrl"
                label="Receipt image"
                required
                onUpload={() => {}}
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Approving...">
                  Approve & notify
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setApprovingRequestId(null)}>
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

      {/* Reject funding request modal */}
      {rejectingRequestId && (
        <Modal open onClose={() => setRejectingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
            <h3 className="text-lg font-semibold text-app-fg">Reject funding request</h3>
            <p className="text-sm text-app-fg-muted">
              The Media Buyer will be notified that their request was not approved.
            </p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="rejectFundingRequest" />
              <input type="hidden" name="requestId" value={rejectingRequestId} />
              <div>
                <Textarea label="Reason (optional)" name="reason" rows={2} maxLength={500} placeholder="Optional note for records..." />
              </div>
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

      {/* Funding request preview — full detail + Approve/Reject for approvers */}
      {previewingRequest && (
        <Modal
          open
          onClose={() => setPreviewingRequestId(null)}
          maxWidth="max-w-lg"
          role="dialog"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh] bg-app-elevated"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Funding request</h3>
            <button
              type="button"
              onClick={() => setPreviewingRequestId(null)}
              className="text-app-fg-muted hover:text-app-fg"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="sm:col-span-2">
                <dt className="text-app-fg-muted font-medium">Requester</dt>
                <dd className="text-app-fg mt-0.5">
                  {previewingRequest.requesterName ??
                    users.find((u) => u.id === previewingRequest.requesterId)?.name ??
                    truncateId(previewingRequest.requesterId)}
                </dd>
              </div>
              <div>
                <dt className="text-app-fg-muted font-medium">Amount</dt>
                <dd className="text-app-fg font-semibold mt-0.5">
                  <NairaPrice amount={Number(previewingRequest.amount)} />
                </dd>
              </div>
              <div>
                <dt className="text-app-fg-muted font-medium">Status</dt>
                <dd className="mt-0.5">
                  <StatusBadge status={previewingRequest.status} />
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-app-fg-muted font-medium">Reason</dt>
                <dd className="text-app-fg mt-0.5 whitespace-pre-wrap break-words">{previewingRequest.reason ?? '\u2014'}</dd>
              </div>
              <div>
                <dt className="text-app-fg-muted font-medium">Requested</dt>
                <dd className="text-app-fg mt-0.5">
                  {new Date(previewingRequest.createdAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-app-fg-muted font-medium">Resolved</dt>
                <dd className="text-app-fg mt-0.5">
                  {previewingRequest.resolvedAt
                    ? new Date(previewingRequest.resolvedAt).toLocaleDateString('en-NG', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '\u2014'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-app-fg-muted font-medium">Resolved by</dt>
                <dd className="text-app-fg mt-0.5">
                  {(() => {
                    const resolverId = previewingRequest.resolvedBy;
                    if (!resolverId) return '\u2014';
                    return users.find((u) => u.id === resolverId)?.name ?? truncateId(resolverId);
                  })()}
                </dd>
              </div>
            </dl>
            {previewingRequest.receiptUrl && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Receipt</p>
                <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
                  <img
                    src={previewingRequest.receiptUrl}
                    alt="Funding request receipt"
                    className="w-full max-h-[320px] object-contain"
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
                <a
                  href={previewingRequest.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                >
                  Open in new tab
                </a>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-4">
            {previewingRequest.status === 'PENDING' && previewingRequest.requesterId !== currentUserId && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const id = previewingRequest.id;
                    setPreviewingRequestId(null);
                    setApprovingRequestId(id);
                  }}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    const id = previewingRequest.id;
                    setPreviewingRequestId(null);
                    setRejectingRequestId(id);
                  }}
                >
                  Reject
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={() => setPreviewingRequestId(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {/* Funding receipt modal */}
      {fundingReceiptModal?.receiptUrl && (
        <Modal open onClose={() => setFundingReceiptModal(null)} maxWidth="max-w-lg" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Funding receipt</h3>
            <button type="button" onClick={() => setFundingReceiptModal(null)} className="text-app-fg-muted hover:text-app-fg">
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
              <div className="flex items-center gap-2 mt-2 text-xs text-brand-500 dark:text-brand-400">
                <span>
                  {fundingReceiptModal.senderName ??
                    users.find((u) => u.id === fundingReceiptModal.senderId)?.name ??
                    truncateId(fundingReceiptModal.senderId)}{' '}
                  →{' '}
                  {fundingReceiptModal.receiverName ??
                    users.find((u) => u.id === fundingReceiptModal.receiverId)?.name ??
                    truncateId(fundingReceiptModal.receiverId)}
                </span>
                <span>·</span>
                <span>{new Date(fundingReceiptModal.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span>·</span>
                <StatusBadge status={fundingReceiptModal.status} />
              </div>
            </div>
            <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
              <img
                src={fundingReceiptModal.receiptUrl}
                alt="Funding receipt"
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
            <a href={fundingReceiptModal.receiptUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              Open in new tab
            </a>
            <Button variant="secondary" size="sm" onClick={() => setFundingReceiptModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

    </div>
  );
}
