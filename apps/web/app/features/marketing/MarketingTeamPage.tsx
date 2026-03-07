import { Link } from '@remix-run/react';
import { MediaBuyerBalanceCard } from './MediaBuyerBalanceCard';
import type { FundingBalanceRow } from './types';

export interface MarketingTeamPageProps {
  teamMembers: FundingBalanceRow[];
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
}

export function MarketingTeamPage({ teamMembers, fundingSummary }: MarketingTeamPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Team</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Media buyers and funding balance — same cards as Live Activities
        </p>
      </div>

      {/* Funding Summary */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Funding Summary</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total Sent</p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              ₦{parseFloat(fundingSummary.totalSent).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Completed</p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">
              ₦{parseFloat(fundingSummary.totalCompleted).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Disputed</p>
            <p className={`text-xl font-bold mt-1 ${parseFloat(fundingSummary.totalDisputed) > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-surface-900 dark:text-white'}`}>
              ₦{parseFloat(fundingSummary.totalDisputed).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Team members as cards — same as Live Activities */}
      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">Team members</h2>
        <p className="text-sm text-surface-700 dark:text-surface-300 mb-4">
          Funding received (confirmed) minus approved ad spend
        </p>
        {teamMembers.length === 0 ? (
          <div className="card text-center py-12 text-surface-500 dark:text-surface-400">
            No team members yet. Manage staff from HR → Users.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {teamMembers.map((m) => (
              <MediaBuyerBalanceCard key={m.userId} row={m} />
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p className="text-sm text-surface-700 dark:text-surface-300">
          <Link to="/admin/marketing/overview" prefetch="intent" className="text-brand-500 hover:text-brand-600">
            Live Activities
          </Link>
          {' — '}dashboard with performance metrics.
        </p>
      </div>
    </div>
  );
}
