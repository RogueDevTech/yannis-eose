/**
 * SupervisorBadge — purple chip used wherever a team supervisor needs to be
 * identified at a glance: header role chip area, user-detail page, Staff
 * Accounts list, mirror-mode pill, etc.
 *
 * Rendered next to (or just under) the RoleBadge — a user is still "Media
 * Buyer", they're a Media Buyer who is also a team supervisor. Purple is
 * chosen to be distinct from both the dept-color RoleBadge palette
 * (red/blue/amber/green) AND the amber ProbationBadge.
 *
 * Source of truth is `users.is_team_supervisor` (denormalised from
 * `branch_team_members.isSupervisor` rows by `BranchTeamsService.syncUserSupervisorFlag`).
 *
 * Usage:
 *   <RoleBadge role={user.role} />
 *   {user.isTeamSupervisor && <SupervisorBadge />}
 */

import type { CSSProperties } from 'react';

interface SupervisorBadgeProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
  /** Override the default "Supervisor" label (e.g. "Marketing Supervisor"). */
  label?: string;
  title?: string;
}

const SIZE_CLASSES = {
  sm: 'text-2xs px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
  lg: 'text-sm px-2.5 py-1 gap-1.5',
} as const;

export function SupervisorBadge({
  size = 'md',
  className = '',
  style,
  label = 'Supervisor',
  title = 'Team supervisor on at least one branch.',
}: SupervisorBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium border bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 ${SIZE_CLASSES[size]} ${className}`}
      style={style}
      title={title}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-purple-500" />
      {label}
    </span>
  );
}
