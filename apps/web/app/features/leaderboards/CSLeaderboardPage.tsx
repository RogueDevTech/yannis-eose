import { Link } from '@remix-run/react';
import { DeferredSection } from '~/components/ui/deferred-section';
import type { CSLeaderboardEntry } from '~/features/cs/types';

interface CSLeaderboardPageProps {
  csLeaderboard: Promise<CSLeaderboardEntry[]>;
  leaderboardPeriod: 'this_month' | 'all_time';
}

export function CSLeaderboardPage({
  csLeaderboard,
  leaderboardPeriod,
}: CSLeaderboardPageProps) {
  const periodLabel = leaderboardPeriod === 'all_time' ? 'all time' : 'this month';
  const periodLinks = (
    <div className="flex gap-1 rounded-lg bg-surface-100 dark:bg-surface-800 p-1">
      <Link
        to="/admin/cs-leaderboard?period=this_month"
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          leaderboardPeriod === 'this_month'
            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
            : 'text-surface-700 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'
        }`}
      >
        This month
      </Link>
      <Link
        to="/admin/cs-leaderboard?period=all_time"
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
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">CS Leaderboard</h1>
        <p className="text-sm text-surface-800 dark:text-surface-400 mt-1">
          CS agent performance ranked by delivery rate ({periodLabel}).
        </p>
      </div>

      <DeferredSection resolve={csLeaderboard} skeleton="table">
        {(lb: CSLeaderboardEntry[]) => {
          if (lb.length === 0) {
            return (
              <div className="card p-8 text-center">
                <p className="text-sm text-surface-700 dark:text-surface-400">No CS agent data for {periodLabel}.</p>
              </div>
            );
          }
          return (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">CS Agent Performance</h2>
                    <p className="text-xs text-surface-700 dark:text-surface-500 mt-0.5">
                      Ranked by delivery rate ({periodLabel})
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
                      <th className="table-header">Agent</th>
                      <th className="table-header text-right">Engaged</th>
                      <th className="table-header text-right">Confirmed</th>
                      <th className="table-header text-right">Delivered</th>
                      <th className="table-header text-right">Calls</th>
                      <th className="table-header text-right">Conf. Rate</th>
                      <th className="table-header text-right">Del. Rate</th>
                      <th className="table-header text-right">Avg Call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lb.map((e, idx) => (
                      <tr key={e.agentId} className="table-row">
                        <td className="table-cell text-surface-700 dark:text-surface-500 font-mono text-sm">{idx + 1}</td>
                        <td className="table-cell">
                          <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{e.agentName}</p>
                        </td>
                        <td className="table-cell text-right text-sm">{e.ordersEngaged}</td>
                        <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">{e.ordersConfirmed}</td>
                        <td className="table-cell text-right text-sm font-medium text-brand-600 dark:text-brand-400">{e.ordersDelivered}</td>
                        <td className="table-cell text-right text-sm">{e.callsMade}</td>
                        <td className="table-cell text-right text-sm">{e.confirmationRate.toFixed(1)}%</td>
                        <td className="table-cell text-right">
                          <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-surface-900 dark:text-white'}`}>
                            {e.deliveryRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="table-cell text-right text-sm text-surface-700 dark:text-surface-500">
                          {e.avgCallDurationSeconds >= 60
                            ? `${Math.floor(e.avgCallDurationSeconds / 60)}m ${e.avgCallDurationSeconds % 60}s`
                            : `${e.avgCallDurationSeconds}s`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                {lb.map((e, idx) => (
                  <div key={e.agentId} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-surface-700 dark:text-surface-500">#{idx + 1}</span>
                        <span className="font-medium text-surface-900 dark:text-white text-sm">{e.agentName}</span>
                      </div>
                      <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-surface-900 dark:text-white'}`}>
                        {e.deliveryRate.toFixed(1)}% del.
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-surface-700 dark:text-surface-500">Confirmed</span>
                        <p className="font-medium text-surface-900 dark:text-white">{e.ordersConfirmed}</p>
                      </div>
                      <div>
                        <span className="text-surface-700 dark:text-surface-500">Calls</span>
                        <p className="font-medium text-surface-900 dark:text-white">{e.callsMade}</p>
                      </div>
                      <div>
                        <span className="text-surface-700 dark:text-surface-500">Delivered</span>
                        <p className="font-medium text-brand-600 dark:text-brand-400">{e.ordersDelivered}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }}
      </DeferredSection>
    </div>
  );
}
