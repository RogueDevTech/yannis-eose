import { Link } from '@remix-run/react';
import type { LeaderboardEntry, Metrics } from './types';

const HIGH_CPA_THRESHOLD = 5000;

export interface MarketingOverviewPageProps {
  metrics: Metrics;
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
  leaderboard: LeaderboardEntry[];
  leaderboardPeriod: 'this_month' | 'all_time';
}

export function MarketingOverviewPage({
  metrics,
  fundingSummary,
  leaderboard,
  leaderboardPeriod = 'this_month',
}: MarketingOverviewPageProps) {
  const periodLabel = leaderboardPeriod === 'all_time' ? 'all time' : 'this month';
  const avgCpa = leaderboard.length > 0
    ? leaderboard.reduce((sum, b) => sum + b.cpa, 0) / leaderboard.length
    : 0;

  const highCpaBuyers = leaderboard.filter(
    (b) => b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0,
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Team Overview</h1>
        <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
          Manage media buyers, monitor team performance, and track funding
        </p>
      </div>

      {/* High CPA Alert Banner */}
      {highCpaBuyers.length > 0 && (
        <div className="rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-warning-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-warning-800 dark:text-warning-300">High CPA Warning</p>
              <p className="text-xs text-warning-600 dark:text-warning-400 mt-0.5">
                {highCpaBuyers.map((b) => `${b.name} (CPA: ₦${Math.round(b.cpa).toLocaleString()})`).join(', ')}
                {' '}— exceeds threshold of ₦{HIGH_CPA_THRESHOLD.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Media Buyers</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{leaderboard.length}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Total Spend</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
            ₦{Math.round(metrics.totalSpend).toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Total Orders</p>
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">{metrics.totalOrders}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Avg CPA</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
            ₦{Math.round(avgCpa).toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Delivery Rate</p>
          <p className={`text-2xl font-bold mt-1 ${metrics.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
            {metrics.deliveryRate.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Funding summary */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Funding Summary</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Total Sent</p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              ₦{parseFloat(fundingSummary.totalSent).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Completed</p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">
              ₦{parseFloat(fundingSummary.totalCompleted).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Disputed</p>
            <p className={`text-xl font-bold mt-1 ${parseFloat(fundingSummary.totalDisputed) > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-surface-900 dark:text-white'}`}>
              ₦{parseFloat(fundingSummary.totalDisputed).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Media Buyer cards */}
      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Media Buyer Performance</h2>
        {leaderboard.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-surface-700 dark:text-surface-500">No media buyer data for {periodLabel}.</p>
            <Link to="/admin/users/new" className="btn-primary inline-block mt-3">Add Media Buyer</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {leaderboard.map((buyer) => {
              const isHighCpa = buyer.cpa > HIGH_CPA_THRESHOLD && buyer.totalOrders > 0;
              const roasColor = buyer.trueRoas >= 2
                ? 'text-success-600 dark:text-success-400'
                : buyer.trueRoas >= 1
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-danger-600 dark:text-danger-400';

              return (
                <div
                  key={buyer.mediaBuyerId}
                  className={`card ${isHighCpa ? 'ring-2 ring-warning-400 dark:ring-warning-500' : ''}`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                      <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
                        {buyer.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                        {buyer.name}
                      </p>
                      <p className="text-xs text-surface-800 dark:text-surface-400 truncate">
                        {buyer.email}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-surface-700 dark:text-surface-500">Spend</span>
                      <span className="font-medium">₦{Math.round(buyer.totalSpend).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700 dark:text-surface-500">Orders</span>
                      <span>{buyer.totalOrders}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700 dark:text-surface-500">Delivered</span>
                      <span className="text-success-600 dark:text-success-400">{buyer.deliveredOrders}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700 dark:text-surface-500">CPA</span>
                      <span className={isHighCpa ? 'font-medium text-danger-600 dark:text-danger-400' : ''}>
                        ₦{Math.round(buyer.cpa).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700 dark:text-surface-500">ROAS</span>
                      <span className={`font-bold ${roasColor}`}>{buyer.trueRoas.toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-700 dark:text-surface-500">Del. Rate</span>
                      <span>{buyer.deliveryRate.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Team Management / Quick links */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">Team Management</h2>
        <p className="text-sm text-surface-800 dark:text-surface-400 mb-4">
          Send funding, manage campaigns, and view detailed performance.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/marketing" prefetch="intent" className="btn-primary btn-sm">
            Funding & Ad Spend
          </Link>
          <Link to="/admin/marketing-leaderboard" prefetch="intent" className="btn-secondary btn-sm">
            Marketing Leaderboard
          </Link>
          <Link to="/admin/campaigns" prefetch="intent" className="btn-secondary btn-sm">
            Campaigns
          </Link>
        </div>
      </div>
    </div>
  );
}
