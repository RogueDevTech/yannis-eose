import { useState, useEffect } from 'react';
import { Link, useFetcher, useRevalidator, useNavigation } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { HighCpaWarningBanner } from '~/features/marketing/HighCpaWarningBanner';
import { InlineNotification } from '~/components/ui/inline-notification';
import { AmountInput } from '~/components/ui/amount-input';
import { formatNaira } from '~/lib/format-amount';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { DeferredSection } from '~/components/ui/deferred-section';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { Tabs } from '~/components/ui/tabs';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Spinner } from '~/components/ui/spinner';
import { S3_FOLDERS } from '~/lib/s3-upload';
import type {
  MarketingStreamData,
  FundingRecord,
  FundingRequestRecord,
  AdSpendRecord,
  LeaderboardEntry,
  Metrics,
  User,
  Product,
  Campaign,
} from './types';

const FUNDING_COLORS: Record<string, string> = {
  SENT: 'badge-warning',
  COMPLETED: 'badge-success',
  DISPUTED: 'badge-danger',
};

const REQUEST_STATUS_COLORS: Record<string, string> = {
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
};

const AD_SPEND_STATUS_COLORS: Record<string, string> = {
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
};

// Configurable CPA threshold for high-CPA alerts (in Naira)
const HIGH_CPA_THRESHOLD = 5000;

export function MarketingPage({
  funding,
  totalFunding,
  adSpend,
  totalAdSpend,
  adSpendTotal: _adSpendTotal,
  metrics,
  fundingSummary,
  users,
  products,
  campaigns,
  leaderboard,
  leaderboardPeriod = 'this_month',
  filters,
  viewMode = 'admin',
  canSendFunding = true,
  fundingRequests = [],
  myBalance,
  balancesList,
  currentUserId = '',
}: MarketingStreamData) {
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [activeTab, setActiveTab] = useState<'metrics' | 'funding' | 'requests' | 'adspend'>(viewMode === 'media_buyer' ? 'funding' : 'metrics');
  const [showFundingForm, setShowFundingForm] = useState(false);
  const [showRequestFundingForm, setShowRequestFundingForm] = useState(false);
  const [showAdSpendForm, setShowAdSpendForm] = useState(false);
  const [disputingFundingId, setDisputingFundingId] = useState<string | null>(null);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  if (actionSuccess && showFundingForm) setShowFundingForm(false);
  if (actionSuccess && showRequestFundingForm) setShowRequestFundingForm(false);
  if (actionSuccess && showAdSpendForm) setShowAdSpendForm(false);
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
  const pendingRequestCount = fundingRequests.filter((r: FundingRequestRecord) => r.status === 'PENDING').length;
  const showPendingFundingBanner = viewMode !== 'media_buyer' && pendingRequestCount > 0;

  return (
    <div className="space-y-4">
      {showPendingFundingBanner && (
        <InlineNotification
          variant="info"
          message={
            pendingRequestCount === 1
              ? 'You have 1 pending funding request waiting for your review.'
              : `You have ${pendingRequestCount} pending funding requests waiting for your review.`
          }
          action={{ label: 'Review requests', onClick: () => setActiveTab('requests') }}
        />
      )}
      {/* Media Buyer: Your balance card */}
      {viewMode === 'media_buyer' && myBalance && (
        <DeferredSection resolve={myBalance} skeleton="card">
          {(balance: { totalReceived: string; totalSpend: string; balance: string }) => (
            <div className="card border-brand-200 dark:border-brand-700/50 bg-brand-50/30 dark:bg-brand-900/20">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Your funding balance</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-surface-600 dark:text-surface-400">Total received</p>
                  <p className="text-lg font-medium text-surface-900 dark:text-white">{'\u20A6'}{Number(balance.totalReceived).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-600 dark:text-surface-400">Total spent</p>
                  <p className="text-lg font-medium text-surface-900 dark:text-white">{'\u20A6'}{Number(balance.totalSpend).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-600 dark:text-surface-400">Balance</p>
                  <p className="text-xl font-bold text-brand-600 dark:text-brand-400">{formatNaira(Number(balance.balance))}</p>
                </div>
              </div>
            </div>
          )}
        </DeferredSection>
      )}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Marketing</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Funding ledger, ad spend tracking, and performance metrics
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center min-h-[2rem] rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 pl-2.5 pr-2 py-1">
            <DateFilterBar
              startDate={dateFilters.startDate}
              endDate={dateFilters.endDate}
              periodAllTime={dateFilters.periodAllTime}
            />
          </div>
          {isFilterLoading && (
            <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
          <div className="flex items-center gap-2">
            {canSendFunding && (
              <Button variant="primary" size="sm" onClick={() => { setShowFundingForm(!showFundingForm); setActiveTab('funding'); }}>
                {showFundingForm ? 'Close' : '+ Send Funding'}
              </Button>
            )}
            {viewMode === 'media_buyer' && (
              <Button variant="secondary" size="sm" onClick={() => { setShowRequestFundingForm(!showRequestFundingForm); setActiveTab('funding'); }}>
                {showRequestFundingForm ? 'Close' : '+ Request Funds'}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => { setShowAdSpendForm(!showAdSpendForm); setActiveTab('adspend'); }}>
              {showAdSpendForm ? 'Close' : '+ Log Ad Spend'}
            </Button>
          </div>
        </div>
      </div>

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* High CPA Alert Banner — deferred because it depends on leaderboard */}
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

      {/* KPI Cards — streamed via metrics promise */}
      <DeferredSection resolve={metrics} skeleton="stat">
        {(m: Metrics) => (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">CPA</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
                {'\u20A6'}{Math.round(m.cpa).toLocaleString()}
              </p>
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                Spend / All Orders
              </p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">True ROAS</p>
              <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">
                {m.trueRoas.toFixed(2)}x
              </p>
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                Delivered Revenue / Spend
              </p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Delivery Rate</p>
              <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">
                {m.deliveryRate.toFixed(1)}%
              </p>
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                Delivered / Total Orders
              </p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Confirmation Rate</p>
              <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">
                {m.confirmationRate.toFixed(1)}%
              </p>
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                Confirmed (CS scheduled) / Total Orders
              </p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total Spend</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
                {'\u20A6'}{Math.round(m.totalSpend).toLocaleString()}
              </p>
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                {m.totalOrders} orders, {m.deliveredOrders} delivered
              </p>
            </div>
          </div>
        )}
      </DeferredSection>

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'metrics', label: 'Performance' },
          { value: 'funding', label: `Funding (${totalFunding})` },
          ...(viewMode !== 'media_buyer'
            ? [{ value: 'requests' as const, label: `Requests (${fundingRequests.filter((r: FundingRequestRecord) => r.status === 'PENDING').length})` }]
            : []),
          { value: 'adspend', label: `Ads spend logging (${totalAdSpend})` },
        ]}
      />

      {/* Performance Tab */}
      {activeTab === 'metrics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Campaign Performance — deferred metrics */}
            <DeferredSection resolve={metrics} skeleton="card">
              {(m: Metrics) => (
                <div className="card">
                  <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Campaign Performance</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-surface-800 dark:text-surface-200">Total Orders</span>
                      <span className="text-sm font-medium text-surface-900 dark:text-white">{m.totalOrders}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-surface-800 dark:text-surface-200">Delivered Orders</span>
                      <span className="text-sm font-medium text-success-600 dark:text-success-400">{m.deliveredOrders}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-surface-800 dark:text-surface-200">Confirmed Orders</span>
                      <span className="text-sm font-medium text-success-600 dark:text-success-400">{m.confirmedOrders}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-surface-800 dark:text-surface-200">Confirmation Rate</span>
                      <span className="text-sm font-medium text-surface-900 dark:text-white">{m.confirmationRate.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-surface-800 dark:text-surface-200">Delivered Revenue</span>
                      <span className="text-sm font-medium text-surface-900 dark:text-white">{'\u20A6'}{Math.round(m.deliveredRevenue).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-surface-800 dark:text-surface-200">Cost Per Acquisition</span>
                      <span className="text-sm font-medium text-surface-900 dark:text-white">{'\u20A6'}{Math.round(m.cpa).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </DeferredSection>

            {/* Funding Overview — deferred fundingSummary (Admin only) */}
            {viewMode !== 'media_buyer' && (
              <DeferredSection resolve={fundingSummary} skeleton="card">
                {(summary) => (
                  <div className="card">
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Funding Overview</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-surface-800 dark:text-surface-200">Pending</span>
                        <span className="text-sm font-medium text-warning-600 dark:text-warning-400">{'\u20A6'}{Number(summary.totalSent).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-surface-800 dark:text-surface-200">Confirmed</span>
                        <span className="text-sm font-medium text-success-600 dark:text-success-400">{'\u20A6'}{Number(summary.totalCompleted).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-surface-800 dark:text-surface-200">Disputed</span>
                        <span className="text-sm font-medium text-danger-600 dark:text-danger-400">{'\u20A6'}{Number(summary.totalDisputed).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                )}
              </DeferredSection>
            )}

            {/* Recipient balances — Admin only (full width) */}
            {viewMode !== 'media_buyer' && balancesList && (
              <div className="w-full lg:col-span-2">
                <DeferredSection resolve={balancesList} skeleton="card">
                  {(rows: Array<{ userId: string; name: string; role: string; totalReceived: string; totalSpend: string; balance: string }>) => (
                    <div className="card p-0 overflow-hidden">
                      <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                        <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Recipient balances</h3>
                        <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">Funding received (confirmed) minus approved ad spend</p>
                      </div>
                      {rows.length === 0 ? (
                        <div className="px-4 py-6 text-center text-surface-500 text-sm">No recipients yet</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr>
                                <th className="table-header">User</th>
                                <th className="table-header">Role</th>
                                <th className="table-header text-right">Received</th>
                                <th className="table-header text-right">Spent</th>
                                <th className="table-header text-right">Balance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={r.userId} className="table-row">
                                  <td className="table-cell">
                                    <Link to={`/hr/users/${r.userId}`} className="text-brand-500 hover:text-brand-600 font-medium text-sm">
                                      {r.name}
                                    </Link>
                                  </td>
                                  <td className="table-cell text-sm text-surface-700 dark:text-surface-300">
                                    {r.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : r.role === 'MEDIA_BUYER' ? 'Media Buyer' : r.role}
                                  </td>
                                  <td className="table-cell text-right text-sm">{'\u20A6'}{Number(r.totalReceived).toLocaleString()}</td>
                                  <td className="table-cell text-right text-sm">{'\u20A6'}{Number(r.totalSpend).toLocaleString()}</td>
                                  <td className="table-cell text-right font-medium text-brand-600 dark:text-brand-400">{formatNaira(Number(r.balance))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </DeferredSection>
              </div>
            )}
          </div>

          {/* Media Buyer Leaderboard — deferred */}
          <DeferredSection resolve={leaderboard} skeleton="table">
            {(lb: LeaderboardEntry[]) => {
              if (lb.length === 0) return null;
              return (
                <div className="card p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Media Buyer Performance</h3>
                        <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                          Ranked by True ROAS ({leaderboardPeriod === 'all_time' ? 'all time' : 'this month'})
                        </p>
                      </div>
                      <div className="flex gap-1 rounded-lg bg-surface-100 dark:bg-surface-800 p-1">
                        <Link
                          to="/admin/marketing/funding"
                          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                            leaderboardPeriod === 'this_month'
                              ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                              : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                          }`}
                        >
                          This month
                        </Link>
                        <Link
                          to="/admin/marketing/funding?period=all_time"
                          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                            leaderboardPeriod === 'all_time'
                              ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                              : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                          }`}
                        >
                          All time
                        </Link>
                      </div>
                    </div>
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="table-header">#</th>
                          <th className="table-header">Media Buyer</th>
                          <th className="table-header text-right">Spend</th>
                          <th className="table-header text-right">Orders</th>
                          <th className="table-header text-right">Delivered</th>
                          <th className="table-header text-right">Confirmed</th>
                          <th className="table-header text-right">Revenue</th>
                          <th className="table-header text-right">CPA</th>
                          <th className="table-header text-right">ROAS</th>
                          <th className="table-header text-right">Del. Rate</th>
                          <th className="table-header text-right">Conf. Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lb.map((b: LeaderboardEntry, idx: number) => {
                          const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                          return (
                            <tr key={b.mediaBuyerId} className={`table-row ${isHighCpa ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''}`}>
                              <td className="table-cell text-surface-700 dark:text-surface-300 font-mono text-sm">{idx + 1}</td>
                              <td className="table-cell">
                                <div>
                                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{b.name}</p>
                                  <p className="text-xs text-surface-700 dark:text-surface-300">{b.email}</p>
                                </div>
                              </td>
                              <td className="table-cell text-right text-sm font-medium">{'\u20A6'}{Math.round(b.totalSpend).toLocaleString()}</td>
                              <td className="table-cell text-right text-sm">{b.totalOrders}</td>
                              <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">{b.deliveredOrders}</td>
                              <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">{b.confirmedOrders}</td>
                              <td className="table-cell text-right text-sm font-medium">{'\u20A6'}{Math.round(b.deliveredRevenue).toLocaleString()}</td>
                              <td className="table-cell text-right">
                                <span className={`text-sm font-medium ${isHighCpa ? 'text-danger-600 dark:text-danger-400' : 'text-surface-900 dark:text-white'}`}>
                                  {'\u20A6'}{Math.round(b.cpa).toLocaleString()}
                                </span>
                                {isHighCpa && (
                                  <svg className="w-4 h-4 text-danger-500 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                                  </svg>
                                )}
                              </td>
                              <td className="table-cell text-right">
                                <span className={`text-sm font-bold ${b.trueRoas >= 2 ? 'text-success-600 dark:text-success-400' : b.trueRoas >= 1 ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400'}`}>
                                  {b.trueRoas.toFixed(2)}x
                                </span>
                              </td>
                              <td className="table-cell text-right text-sm">{b.deliveryRate.toFixed(1)}%</td>
                              <td className="table-cell text-right text-sm">{b.confirmationRate.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile leaderboard */}
                  <div className="md:hidden space-y-3 px-1">
                    {lb.map((b: LeaderboardEntry, idx: number) => {
                      const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                      return (
                        <div key={b.mediaBuyerId} className={`rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3 ${isHighCpa ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-surface-700 dark:text-surface-300">#{idx + 1}</span>
                              <span className="font-medium text-surface-900 dark:text-white text-sm">{b.name}</span>
                            </div>
                            <span className={`text-sm font-bold ${b.trueRoas >= 2 ? 'text-success-600 dark:text-success-400' : b.trueRoas >= 1 ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400'}`}>
                              {b.trueRoas.toFixed(2)}x ROAS
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                            <div>
                              <span className="text-surface-700 dark:text-surface-300">Spend</span>
                              <p className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Math.round(b.totalSpend).toLocaleString()}</p>
                            </div>
                            <div>
                              <span className="text-surface-700 dark:text-surface-300">Delivered</span>
                              <p className="font-medium text-success-600 dark:text-success-400">{b.deliveredOrders}</p>
                            </div>
                            <div>
                              <span className="text-surface-700 dark:text-surface-300">Confirmed</span>
                              <p className="font-medium text-success-600 dark:text-success-400">{b.confirmedOrders}</p>
                            </div>
                            <div>
                              <span className="text-surface-700 dark:text-surface-300">CPA</span>
                              <p className={`font-medium ${isHighCpa ? 'text-danger-600 dark:text-danger-400' : 'text-surface-900 dark:text-white'}`}>
                                {'\u20A6'}{Math.round(b.cpa).toLocaleString()}
                              </p>
                            </div>
                            <div>
                              <span className="text-surface-700 dark:text-surface-300">Del. Rate</span>
                              <p className="font-medium text-surface-900 dark:text-white">{b.deliveryRate.toFixed(1)}%</p>
                            </div>
                            <div>
                              <span className="text-surface-700 dark:text-surface-300">Conf. Rate</span>
                              <p className="font-medium text-surface-900 dark:text-white">{b.confirmationRate.toFixed(1)}%</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          </DeferredSection>
        </div>
      )}

      {/* Funding Tab */}
      {activeTab === 'funding' && (
        <>
          {/* Request Funding Modal — Media Buyer only */}
          {viewMode === 'media_buyer' && showRequestFundingForm && (
            <Modal open onClose={() => setShowRequestFundingForm(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-white dark:bg-surface-800">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Request Funding</h3>
                <p className="text-sm text-surface-800 dark:text-surface-200">
                  Head of Marketing will be notified and can disburse to you once approved.
                </p>
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="requestFunding" />
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Amount ({'\u20A6'})</label>
                    <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Reason (optional)</label>
                    <textarea name="reason" rows={2} maxLength={500} placeholder="What do you need the funds for?" className="input" />
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
            <Modal open onClose={() => setDisputingFundingId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-white dark:bg-surface-800">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Dispute Funding</h3>
                <p className="text-sm text-surface-800 dark:text-surface-200">
                  This will alert the CEO and Head of Marketing.
                </p>
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="verifyFunding" />
                  <input type="hidden" name="fundingId" value={disputingFundingId} />
                  <input type="hidden" name="action" value="DISPUTED" />
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                      Dispute Reason <span className="text-danger-500">*</span>
                    </label>
                    <textarea name="disputeReason" required minLength={10} rows={3} placeholder="Explain why (min 10 chars)..." className="input" />
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

          {/* Your funding requests — Media Buyer only */}
          {viewMode === 'media_buyer' && fundingRequests.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                Your funding requests
              </h3>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header text-right">Amount</th>
                      <th className="table-header">Reason</th>
                      <th className="table-header">Status</th>
                      <th className="table-header">Receipt</th>
                      <th className="table-header">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fundingRequests.map((r: FundingRequestRecord) => (
                      <tr key={r.id} className="table-row">
                        <td className="table-cell text-right font-medium">{'\u20A6'}{Number(r.amount).toLocaleString()}</td>
                        <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">{r.reason ?? '\u2014'}</td>
                        <td className="table-cell">
                          <span className={REQUEST_STATUS_COLORS[r.status] ?? 'badge'}>{r.status}</span>
                        </td>
                        <td className="table-cell">
                          {r.status === 'APPROVED' && r.receiptUrl ? (
                            <>
                              <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:text-brand-600 text-sm mr-2">View</a>
                              <button type="button" onClick={() => setReceiptPreviewUrl(r.receiptUrl!)} className="text-brand-500 hover:text-brand-600 text-sm">Preview</button>
                            </>
                          ) : '\u2014'}
                        </td>
                        <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                          {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-3 px-1">
                {fundingRequests.map((r: FundingRequestRecord) => (
                  <div key={r.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Number(r.amount).toLocaleString()}</span>
                      <span className={REQUEST_STATUS_COLORS[r.status] ?? 'badge'}>{r.status}</span>
                    </div>
                    {r.reason && <p className="text-sm text-surface-700 dark:text-surface-300">{r.reason}</p>}
                    {r.status === 'APPROVED' && r.receiptUrl && (
                      <div className="flex gap-2 mt-1">
                        <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-brand-500 text-xs">View receipt</a>
                        <button type="button" onClick={() => setReceiptPreviewUrl(r.receiptUrl!)} className="text-brand-500 text-xs">Preview</button>
                      </div>
                    )}
                    <p className="text-xs text-surface-600 dark:text-surface-400">
                      {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Funding table — renders immediately (critical data) */}
          <div className="card p-0 overflow-hidden">
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
                      <td className="table-cell text-surface-900 dark:text-surface-100 text-sm">
                        <DeferredSection resolve={users} skeleton="inline">
                          {(resolvedUsers: User[]) => <>{resolvedUsers.find((u) => u.id === f.senderId)?.name ?? truncateId(f.senderId)}</>}
                        </DeferredSection>
                      </td>
                      <td className="table-cell text-surface-900 dark:text-surface-100 text-sm">
                        <DeferredSection resolve={users} skeleton="inline">
                          {(resolvedUsers: User[]) => <>{resolvedUsers.find((u) => u.id === f.receiverId)?.name ?? truncateId(f.receiverId)}</>}
                        </DeferredSection>
                      </td>
                      <td className="table-cell text-right font-medium">{'\u20A6'}{Number(f.amount).toLocaleString()}</td>
                      <td className="table-cell">
                        {f.receiptUrl ? (
                          <a href={f.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:text-brand-600 text-sm">View</a>
                        ) : '\u2014'}
                      </td>
                      <td className="table-cell">
                        <span className={FUNDING_COLORS[f.status] ?? 'badge'}>{f.status}</span>
                      </td>
                      <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                        {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="table-cell">
                        {f.status === 'SENT' && f.receiverId === currentUserId && (
                          <div className="flex gap-1.5">
                            <fetcher.Form method="post" className="inline">
                              <input type="hidden" name="intent" value="verifyFunding" />
                              <input type="hidden" name="fundingId" value={f.id} />
                              <input type="hidden" name="action" value="COMPLETED" />
                              <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing...">
                                Received
                              </Button>
                            </fetcher.Form>
                            <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => setDisputingFundingId(f.id)}>
                              Not Received
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {funding.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No funding records yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-3 px-1">
              {funding.map((f: FundingRecord) => (
                <div key={f.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Number(f.amount).toLocaleString()}</span>
                    <span className={FUNDING_COLORS[f.status] ?? 'badge'}>{f.status}</span>
                  </div>
                  <p className="text-sm text-surface-800 dark:text-surface-200">
                    <DeferredSection resolve={users} skeleton="inline">
                      {(resolvedUsers: User[]) => (
                        <>
                          {resolvedUsers.find((u) => u.id === f.senderId)?.name ?? truncateId(f.senderId)}
                          {' \u2192 '}
                          {resolvedUsers.find((u) => u.id === f.receiverId)?.name ?? truncateId(f.receiverId)}
                        </>
                      )}
                    </DeferredSection>
                  </p>
                  {f.status === 'SENT' && f.receiverId === currentUserId && (
                    <div className="flex gap-2 pt-1">
                      <fetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="verifyFunding" />
                        <input type="hidden" name="fundingId" value={f.id} />
                        <input type="hidden" name="action" value="COMPLETED" />
                        <Button type="submit" variant="success" size="sm" className="text-xs">Received</Button>
                      </fetcher.Form>
                      <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => setDisputingFundingId(f.id)}>
                        Not Received
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {funding.length === 0 && (
                <div className="p-8 text-center text-surface-700 dark:text-surface-300">No funding records</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Requests Tab — Head of Marketing: all funding requests, approve (with receipt) or reject */}
      {activeTab === 'requests' && viewMode !== 'media_buyer' && (
        <div id="funding-requests" className="card p-0 overflow-hidden scroll-mt-4">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white px-4 py-3 border-b border-surface-100 dark:border-surface-800">
            Funding requests
          </h3>
          <p className="text-sm text-surface-700 dark:text-surface-300 px-4 py-2">
            Send the money to the Media Buyer manually, then approve with a receipt image. They will get a notification and can preview the receipt.
          </p>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Requester</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Reason</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Resolved</th>
                  <th className="table-header">Receipt</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {fundingRequests.map((r: FundingRequestRecord) => (
                  <tr key={r.id} className="table-row">
                    <td className="table-cell text-surface-900 dark:text-surface-100 text-sm">
                      <DeferredSection resolve={users} skeleton="inline">
                        {(resolvedUsers: User[]) => <>{resolvedUsers.find((u) => u.id === r.requesterId)?.name ?? truncateId(r.requesterId)}</>}
                      </DeferredSection>
                    </td>
                    <td className="table-cell text-right font-medium">{'\u20A6'}{Number(r.amount).toLocaleString()}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-200 text-sm max-w-[200px] truncate" title={r.reason ?? undefined}>{r.reason ?? '\u2014'}</td>
                    <td className="table-cell">
                      <span className={REQUEST_STATUS_COLORS[r.status] ?? 'badge'}>{r.status}</span>
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                      {r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014'}
                    </td>
                    <td className="table-cell">
                      {r.receiptUrl ? (
                        <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:text-brand-600 text-sm">View</a>
                      ) : '\u2014'}
                    </td>
                    <td className="table-cell">
                      {r.status === 'PENDING' && (
                        <div className="flex gap-1.5">
                          <Button type="button" variant="primary" size="sm" className="text-xs" onClick={() => setApprovingRequestId(r.id)}>
                            Approve
                          </Button>
                          <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => setRejectingRequestId(r.id)}>
                            Reject
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 px-1">
            {fundingRequests.map((r: FundingRequestRecord) => (
              <div key={r.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <DeferredSection resolve={users} skeleton="inline">
                    {(resolvedUsers: User[]) => <span className="font-medium text-surface-900 dark:text-white text-sm">{resolvedUsers.find((u) => u.id === r.requesterId)?.name ?? truncateId(r.requesterId)}</span>}
                  </DeferredSection>
                  <span className={REQUEST_STATUS_COLORS[r.status] ?? 'badge'}>{r.status}</span>
                </div>
                <p className="text-sm text-surface-800 dark:text-surface-200">{'\u20A6'}{Number(r.amount).toLocaleString()}</p>
                {r.reason && <p className="text-sm text-surface-700 dark:text-surface-300">{r.reason}</p>}
                {r.status === 'PENDING' && (
                  <div className="flex gap-2 pt-1">
                    <Button type="button" variant="primary" size="sm" className="text-xs" onClick={() => setApprovingRequestId(r.id)}>Approve</Button>
                    <Button type="button" variant="danger" size="sm" className="text-xs" onClick={() => setRejectingRequestId(r.id)}>Reject</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {fundingRequests.length === 0 && (
            <div className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No funding requests yet</div>
          )}
        </div>
      )}

      {/* Send Funding Modal — Admin / HoM only */}
      {canSendFunding && showFundingForm && (
        <Modal open onClose={() => setShowFundingForm(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-white dark:bg-surface-800">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Send Funding to Media Buyer</h3>
            <p className="text-sm text-surface-800 dark:text-surface-200">
              Select the recipient, amount, and upload the receipt. The Media Buyer will be notified and can mark as received.
            </p>
            <fetcher.Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="createFunding" />
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Media Buyer</label>
                <DeferredSection resolve={users} skeleton="inline">
                  {(resolvedUsers: User[]) => {
                    const mediaBuyers = resolvedUsers.filter((u: User) => u.role === 'MEDIA_BUYER');
                    return (
                      <select name="receiverId" required className="input w-full">
                        <option value="">Select recipient...</option>
                        {mediaBuyers.map((u: User) => (
                          <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                        ))}
                      </select>
                    );
                  }}
                </DeferredSection>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Amount ({'\u20A6'})</label>
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
        <Modal open onClose={() => setApprovingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-white dark:bg-surface-800">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Approve funding request</h3>
            <p className="text-sm text-surface-800 dark:text-surface-200">
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
        <Modal open onClose={() => setRejectingRequestId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-white dark:bg-surface-800">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Reject funding request</h3>
            <p className="text-sm text-surface-800 dark:text-surface-200">
              The Media Buyer will be notified that their request was not approved.
            </p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="rejectFundingRequest" />
              <input type="hidden" name="requestId" value={rejectingRequestId} />
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Reason (optional)</label>
                <textarea name="reason" rows={2} maxLength={500} placeholder="Optional note for records..." className="input" />
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

      {/* Receipt preview modal — Media Buyer */}
      {receiptPreviewUrl && (
        <Modal open onClose={() => setReceiptPreviewUrl(null)} maxWidth="max-w-2xl" contentClassName="p-0 bg-transparent shadow-none max-h-[90dvh]">
            <div className="flex justify-end mb-2">
              <button type="button" onClick={() => setReceiptPreviewUrl(null)} className="text-surface-100 hover:text-white p-1 rounded">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <img src={receiptPreviewUrl} alt="Receipt" className="w-full h-auto max-h-[85dvh] object-contain rounded-lg bg-white shadow-xl" />
        </Modal>
      )}

      {/* Ad Spend Tab */}
      {activeTab === 'adspend' && (
        <>
          {/* Create Ad Spend Form */}
          <ResponsiveFormPanel open={showAdSpendForm} onClose={() => setShowAdSpendForm(false)}>
            <fetcher.Form method="post" className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Log Ad Spend</h3>
                <button type="button" onClick={() => setShowAdSpendForm(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <input type="hidden" name="intent" value="createAdSpend" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Campaign</label>
                  <select name="campaignId" className="input">
                    <option value="">Select campaign...</option>
                    {campaigns.filter((c: Campaign) => c.status === 'ACTIVE').map((c: Campaign) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Product</label>
                  <DeferredSection resolve={products} skeleton="inline">
                    {(resolvedProducts: Product[]) => (
                      <select name="productId" className="input">
                        <option value="">Select product...</option>
                        {resolvedProducts.map((p: Product) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )}
                  </DeferredSection>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Spend Amount ({'\u20A6'})</label>
                  <AmountInput name="spendAmount" required placeholder="e.g. 15,000.00" className="input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Spend Date</label>
                  <input name="spendDate" type="date" required className="input" />
                </div>
                <div className="sm:col-span-2">
                  <FileUpload
                    folder={S3_FOLDERS.SCREENSHOTS}
                    name="screenshotUrl"
                    label="Ads Manager Screenshot"
                    required
                    onUpload={() => {}}
                  />
                  <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                    Mandatory — no screenshot, no log entry accepted
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Logging...">
                  Log Ad Spend
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAdSpendForm(false)}>
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
          </ResponsiveFormPanel>

          <div className="card p-0 overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Date</th>
                    {viewMode !== 'media_buyer' && <th className="table-header">Media Buyer</th>}
                    <th className="table-header text-right">Amount</th>
                    <th className="table-header">Screenshot</th>
                    <th className="table-header">Product</th>
                    <th className="table-header">Campaign</th>
                    <th className="table-header">Status</th>
                    {viewMode !== 'media_buyer' && <th className="table-header">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {adSpend.map((s: AdSpendRecord) => (
                    <tr key={s.id} className="table-row">
                      <td className="table-cell text-surface-800 dark:text-surface-200">
                        {new Date(s.spendDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      {viewMode !== 'media_buyer' && (
                        <td className="table-cell text-sm text-surface-900 dark:text-surface-100">
                          <DeferredSection resolve={users} skeleton="inline">
                            {(resolvedUsers: User[]) => <>{resolvedUsers.find((u) => u.id === s.mediaBuyerId)?.name ?? truncateId(s.mediaBuyerId)}</>}
                          </DeferredSection>
                        </td>
                      )}
                      <td className="table-cell text-right font-medium">{'\u20A6'}{Number(s.spendAmount).toLocaleString()}</td>
                      <td className="table-cell">
                        <a href={s.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:text-brand-600 text-sm">
                          View
                        </a>
                      </td>
                      <td className="table-cell text-sm text-surface-800 dark:text-surface-200">
                        {s.productId ? (
                          <DeferredSection resolve={products} skeleton="inline">
                            {(resolvedProducts: Product[]) => <>{resolvedProducts.find((p) => p.id === s.productId)?.name ?? truncateId(s.productId)}</>}
                          </DeferredSection>
                        ) : '\u2014'}
                      </td>
                      <td className="table-cell text-sm text-surface-800 dark:text-surface-200">
                        {s.campaignId ? (campaigns.find((c: Campaign) => c.id === s.campaignId)?.name ?? truncateId(s.campaignId)) : '\u2014'}
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${AD_SPEND_STATUS_COLORS[s.status ?? 'PENDING'] ?? 'badge-default'}`}>
                          {s.status ?? 'PENDING'}
                        </span>
                      </td>
                      {viewMode !== 'media_buyer' && (
                        <td className="table-cell">
                          {(s.status ?? 'PENDING') === 'PENDING' ? (
                            <fetcher.Form method="post" className="inline">
                              <input type="hidden" name="intent" value="approveAdSpend" />
                              <input type="hidden" name="adSpendId" value={s.id} />
                              <Button
                                type="submit"
                                variant="secondary"
                                size="sm"
                                loading={fetcher.state === 'submitting' && fetcher.formData?.get('adSpendId') === s.id}
                                disabled={fetcher.state !== 'idle'}
                              >
                                Approve
                              </Button>
                            </fetcher.Form>
                          ) : (
                            <span className="text-xs text-surface-500 dark:text-surface-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {adSpend.length === 0 && (
                    <tr>
                      <td colSpan={viewMode !== 'media_buyer' ? 8 : 6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                        No ad spend records yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-3 px-1">
              {adSpend.map((s: AdSpendRecord) => (
                <div key={s.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Number(s.spendAmount).toLocaleString()}</span>
                    <span className={`badge badge-sm ${AD_SPEND_STATUS_COLORS[s.status ?? 'PENDING'] ?? 'badge-default'}`}>
                      {s.status ?? 'PENDING'}
                    </span>
                  </div>
                  <p className="text-sm text-surface-800 dark:text-surface-200">
                    <DeferredSection resolve={users} skeleton="inline">
                      {(resolvedUsers: User[]) => (
                        <>
                          {resolvedUsers.find((u) => u.id === s.mediaBuyerId)?.name ?? truncateId(s.mediaBuyerId)}
                          {' \u2014 '}
                          {new Date(s.spendDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </>
                      )}
                    </DeferredSection>
                  </p>
                  {viewMode !== 'media_buyer' && (s.status ?? 'PENDING') === 'PENDING' && (
                    <fetcher.Form method="post" className="mt-2">
                      <input type="hidden" name="intent" value="approveAdSpend" />
                      <input type="hidden" name="adSpendId" value={s.id} />
                      <Button type="submit" variant="secondary" size="sm" loading={fetcher.state === 'submitting' && fetcher.formData?.get('adSpendId') === s.id} disabled={fetcher.state !== 'idle'}>
                        Approve
                      </Button>
                    </fetcher.Form>
                  )}
                </div>
              ))}
              {adSpend.length === 0 && (
                <div className="p-8 text-center text-surface-700 dark:text-surface-300">No ad spend records</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
