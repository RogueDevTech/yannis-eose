import { Link } from '@remix-run/react';
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
          Disbursement recipients and their funding balance
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

      <div className="card p-0 overflow-hidden">
        {teamMembers.length === 0 ? (
          <div className="px-4 py-12 text-center text-surface-500 dark:text-surface-400">
            No team members yet
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Team members</h2>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
                Funding received (confirmed) minus approved ad spend
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Name</th>
                    <th className="table-header text-right">Received</th>
                    <th className="table-header text-right">Spent</th>
                    <th className="table-header text-right">Balance</th>
                    <th className="table-header w-24">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((m) => (
                    <tr key={m.userId} className="table-row">
                      <td className="table-cell">
                        <Link
                          to={`/hr/users/${m.userId}`}
                          prefetch="intent"
                          className="font-medium text-surface-900 dark:text-surface-100 hover:text-brand-600 dark:hover:text-brand-400"
                        >
                          {m.name}
                        </Link>
                      </td>
                      <td className="table-cell text-right text-sm">
                        ₦{Number(m.totalReceived).toLocaleString()}
                      </td>
                      <td className="table-cell text-right text-sm">
                        ₦{Number(m.totalSpend).toLocaleString()}
                      </td>
                      <td className="table-cell text-right font-medium text-brand-600 dark:text-brand-400">
                        ₦{Number(m.balance).toLocaleString()}
                      </td>
                      <td className="table-cell">
                        <Link
                          to={`/hr/users/${m.userId}`}
                          prefetch="intent"
                          className="text-xs font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                        >
                          View profile
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
