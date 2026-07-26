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
  sm: 'text-2xs gap-1',
  md: 'text-xs gap-1.5',
  lg: 'text-sm gap-1.5',
} as const;

const DOT_SIZE_CLASSES = {
  sm: 'w-1 h-1',
  md: 'w-1.5 h-1.5',
  lg: 'w-2 h-2',
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
      className={`inline-flex items-center font-medium text-purple-700 dark:text-purple-300 ${SIZE_CLASSES[size]} ${className}`}
      style={style}
      title={title}
    >
      <span className={`rounded-full shrink-0 bg-purple-500 ${DOT_SIZE_CLASSES[size]}`} />
      {label}
    </span>
  );
}
