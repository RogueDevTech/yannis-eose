import { Link } from '@remix-run/react';

export interface CSTeamMember {
  id: string;
  name: string;
  role: string;
}

export interface CSTeamPageProps {
  teamMembers: CSTeamMember[];
}

function CSTeamMemberCard({ member }: { member: CSTeamMember }) {
  const initials = member.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
            {member.name}
          </p>
          <p className="text-xs text-surface-800 dark:text-surface-200 truncate">
            {member.role.replace(/_/g, ' ')}
          </p>
        </div>
      </div>
      <Link
        to={`/hr/users/${member.id}`}
        prefetch="intent"
        className="block text-center text-xs font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
      >
        View profile
      </Link>
    </div>
  );
}

export function CSTeamPage({ teamMembers }: CSTeamPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Team</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Sales & CS team members — same cards as Live Activities. View profile for orders and payroll.
        </p>
      </div>

      {teamMembers.length === 0 ? (
        <div className="card text-center py-12 text-surface-500 dark:text-surface-400">
          No team members yet. Manage staff from HR → Users.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {teamMembers.map((m) => (
            <CSTeamMemberCard key={m.id} member={m} />
          ))}
        </div>
      )}

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
