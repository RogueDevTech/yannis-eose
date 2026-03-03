import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { FileUpload } from '~/components/ui/file-upload';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import { S3_FOLDERS } from '~/lib/s3-upload';
import type {
  MarketingStreamData,
  FundingRecord,
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
}: MarketingStreamData) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'metrics' | 'funding' | 'adspend'>('metrics');
  const [showFundingForm, setShowFundingForm] = useState(false);
  const [showAdSpendForm, setShowAdSpendForm] = useState(false);
  const [disputingFundingId, setDisputingFundingId] = useState<string | null>(null);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  if (actionSuccess && showFundingForm) setShowFundingForm(false);
  if (actionSuccess && showAdSpendForm) setShowAdSpendForm(false);
  if (actionSuccess && disputingFundingId) setDisputingFundingId(null);

  /** Truncated ID fallback — used when users list hasn't streamed yet */
  const truncateId = (id: string) => id.slice(0, 8) + '...';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Marketing</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Funding ledger, ad spend tracking, and performance metrics
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => { setShowFundingForm(!showFundingForm); setActiveTab('funding'); }}>
            + Send Funding
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { setShowAdSpendForm(!showAdSpendForm); setActiveTab('adspend'); }}>
            + Log Ad Spend
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      {/* High CPA Alert Banner — deferred because it depends on leaderboard */}
      <DeferredSection resolve={leaderboard} skeleton="inline">
        {(lb) => {
          const highCpaBuyers = lb.filter((b: LeaderboardEntry) => b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0);
          if (highCpaBuyers.length === 0) return null;
          return (
            <div className="rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-warning-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-warning-800 dark:text-warning-300">High CPA Warning</p>
                  <p className="text-xs text-warning-600 dark:text-warning-400 mt-0.5">
                    {highCpaBuyers.map((b: LeaderboardEntry) => `${b.name} (CPA: \u20A6${Math.round(b.cpa).toLocaleString()})`).join(', ')} — exceeds threshold of {'\u20A6'}{HIGH_CPA_THRESHOLD.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
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
          { value: 'adspend', label: `Ad Spend (${totalAdSpend})` },
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

            {/* Funding Overview — deferred fundingSummary */}
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
                          to="/admin/marketing?period=this_month"
                          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                            leaderboardPeriod === 'this_month'
                              ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                              : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                          }`}
                        >
                          This month
                        </Link>
                        <Link
                          to="/admin/marketing?period=all_time"
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
                          <th className="table-header text-right">Revenue</th>
                          <th className="table-header text-right">CPA</th>
                          <th className="table-header text-right">ROAS</th>
                          <th className="table-header text-right">Del. Rate</th>
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
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile leaderboard */}
                  <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                    {lb.map((b: LeaderboardEntry, idx: number) => {
                      const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                      return (
                        <div key={b.mediaBuyerId} className={`p-4 space-y-2 ${isHighCpa ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-surface-700 dark:text-surface-300">#{idx + 1}</span>
                              <span className="font-medium text-surface-900 dark:text-white text-sm">{b.name}</span>
                            </div>
                            <span className={`text-sm font-bold ${b.trueRoas >= 2 ? 'text-success-600 dark:text-success-400' : b.trueRoas >= 1 ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400'}`}>
                              {b.trueRoas.toFixed(2)}x ROAS
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-surface-700 dark:text-surface-300">Spend</span>
                              <p className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Math.round(b.totalSpend).toLocaleString()}</p>
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
          {/* Create Funding Form */}
          {showFundingForm && (
            <fetcher.Form method="post" className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Send Funding to Media Buyer</h3>
                <button type="button" onClick={() => setShowFundingForm(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <input type="hidden" name="intent" value="createFunding" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Media Buyer</label>
                  <DeferredSection resolve={users} skeleton="inline">
                    {(resolvedUsers: User[]) => {
                      const mediaBuyers = resolvedUsers.filter((u: User) => u.role === 'MEDIA_BUYER');
                      return (
                        <select name="receiverId" required className="input">
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
                  <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input" />
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
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Sending...">
                  Send Funding
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowFundingForm(false)}>
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
          )}

          {/* Dispute modal */}
          {disputingFundingId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/50" onClick={() => setDisputingFundingId(null)} />
              <div className="relative bg-white dark:bg-surface-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
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
                        {f.status === 'SENT' && (
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
            <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
              {funding.map((f: FundingRecord) => (
                <div key={f.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Number(f.amount).toLocaleString()}</span>
                    <span className={FUNDING_COLORS[f.status] ?? 'badge'}>{f.status}</span>
                  </div>
                  <p className="text-xs text-surface-800 dark:text-surface-200">
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
                  {f.status === 'SENT' && (
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

      {/* Ad Spend Tab */}
      {activeTab === 'adspend' && (
        <>
          {/* Create Ad Spend Form */}
          {showAdSpendForm && (
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
          )}

          <div className="card p-0 overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Date</th>
                    <th className="table-header">Media Buyer</th>
                    <th className="table-header text-right">Amount</th>
                    <th className="table-header">Screenshot</th>
                    <th className="table-header">Product</th>
                    <th className="table-header">Campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {adSpend.map((s: AdSpendRecord) => (
                    <tr key={s.id} className="table-row">
                      <td className="table-cell text-surface-800 dark:text-surface-200">
                        {new Date(s.spendDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="table-cell text-sm text-surface-900 dark:text-surface-100">
                        <DeferredSection resolve={users} skeleton="inline">
                          {(resolvedUsers: User[]) => <>{resolvedUsers.find((u) => u.id === s.mediaBuyerId)?.name ?? truncateId(s.mediaBuyerId)}</>}
                        </DeferredSection>
                      </td>
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
                    </tr>
                  ))}
                  {adSpend.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No ad spend records yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
              {adSpend.map((s: AdSpendRecord) => (
                <div key={s.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Number(s.spendAmount).toLocaleString()}</span>
                    <a href={s.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-brand-500 text-xs">Screenshot</a>
                  </div>
                  <p className="text-xs text-surface-800 dark:text-surface-200">
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
