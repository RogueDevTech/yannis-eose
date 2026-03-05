import { Link } from '@remix-run/react';

export interface CSTeamMember {
  id: string;
  name: string;
  role: string;
}

export interface CSTeamPageProps {
  teamMembers: CSTeamMember[];
}

export function CSTeamPage({ teamMembers }: CSTeamPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Team</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Sales & CS team members and links to their profiles
        </p>
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
                Head of CS and CS agents — view profile for orders and payroll
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Name</th>
                    <th className="table-header w-24">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((m) => (
                    <tr key={m.id} className="table-row">
                      <td className="table-cell">
                        <Link
                          to={`/hr/users/${m.id}`}
                          prefetch="intent"
                          className="font-medium text-surface-900 dark:text-surface-100 hover:text-brand-600 dark:hover:text-brand-400"
                        >
                          {m.name}
                        </Link>
                      </td>
                      <td className="table-cell">
                        <Link
                          to={`/hr/users/${m.id}`}
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
          <Link to="/admin/cs/queue" prefetch="intent" className="text-brand-500 hover:text-brand-600">
            Live activities
          </Link>
          {' — '}dashboard with workloads, unassigned orders, and leaderboard.
        </p>
      </div>
    </div>
  );
}
