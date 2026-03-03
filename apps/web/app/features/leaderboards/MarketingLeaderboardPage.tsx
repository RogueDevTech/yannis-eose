import { Link } from '@remix-run/react';
import { DeferredSection } from '~/components/ui/deferred-section';
import type { LeaderboardEntry } from '~/features/marketing/types';

const HIGH_CPA_THRESHOLD = 5000;

interface MarketingLeaderboardPageProps {
  mediaBuyerLeaderboard: Promise<LeaderboardEntry[]>;
  leaderboardPeriod: 'this_month' | 'all_time';
}

export function MarketingLeaderboardPage({
  mediaBuyerLeaderboard,
  leaderboardPeriod,
}: MarketingLeaderboardPageProps) {
  const periodLabel = leaderboardPeriod === 'all_time' ? 'all time' : 'this month';
  const periodLinks = (
    <div className="flex gap-1 rounded-lg bg-surface-100 dark:bg-surface-800 p-1">
      <Link
        to="/admin/marketing-leaderboard?period=this_month"
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          leaderboardPeriod === 'this_month'
            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
            : 'text-surface-700 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'
        }`}
      >
        This month
      </Link>
      <Link
        to="/admin/marketing-leaderboard?period=all_time"
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          leaderboardPeriod === 'all_time'
            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
            : 'text-surface-700 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'
        }`}
      >
        All time
      </Link>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Marketing Leaderboard</h1>
        <p className="text-sm text-surface-800 dark:text-surface-400 mt-1">
          Media buyer performance ranked by True ROAS ({periodLabel}).
        </p>
      </div>

      <DeferredSection resolve={mediaBuyerLeaderboard} skeleton="table">
        {(lb: LeaderboardEntry[]) => {
          if (lb.length === 0) {
            return (
              <div className="card p-8 text-center">
                <p className="text-sm text-surface-700 dark:text-surface-400">No media buyer data for {periodLabel}.</p>
              </div>
            );
          }
          return (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Media Buyer Performance</h2>
                    <p className="text-xs text-surface-700 dark:text-surface-500 mt-0.5">
                      Ranked by True ROAS ({periodLabel})
                    </p>
                  </div>
                  {periodLinks}
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
                    {lb.map((b, idx) => {
                      const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                      return (
                        <tr key={b.mediaBuyerId} className={`table-row ${isHighCpa ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''}`}>
                          <td className="table-cell text-surface-700 dark:text-surface-500 font-mono text-sm">{idx + 1}</td>
                          <td className="table-cell">
                            <div>
                              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{b.name}</p>
                              <p className="text-xs text-surface-700 dark:text-surface-500">{b.email}</p>
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
              <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                {lb.map((b, idx) => {
                  const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                  return (
                    <div key={b.mediaBuyerId} className={`p-4 space-y-2 ${isHighCpa ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-surface-700 dark:text-surface-500">#{idx + 1}</span>
                          <span className="font-medium text-surface-900 dark:text-white text-sm">{b.name}</span>
                        </div>
                        <span className={`text-sm font-bold ${b.trueRoas >= 2 ? 'text-success-600 dark:text-success-400' : b.trueRoas >= 1 ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400'}`}>
                          {b.trueRoas.toFixed(2)}x ROAS
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-surface-700 dark:text-surface-500">Spend</span>
                          <p className="font-medium text-surface-900 dark:text-white">{'\u20A6'}{Math.round(b.totalSpend).toLocaleString()}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-500">Delivered</span>
                          <p className="font-medium text-surface-900 dark:text-white">{b.deliveredOrders}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-500">CPA</span>
                          <p className={`font-medium ${isHighCpa ? 'text-danger-600 dark:text-danger-400' : 'text-surface-900 dark:text-white'}`}>
                            {'\u20A6'}{Math.round(b.cpa).toLocaleString()}
                          </p>
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
  );
}
