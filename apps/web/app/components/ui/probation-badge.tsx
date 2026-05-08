/**
 * ProbationBadge — amber chip used wherever a probation user is identified.
 *
 * Rendered next to (or just under) the RoleBadge so it doesn't replace role identity
 * — a user is still "CS Agent", they're just CS Agent on probation. The amber palette
 * is chosen to be distinct from the dept-color RoleBadge palette (red/blue/amber/green/...)
 * — even though Marketing roles are amber, the dot + label "Probation" is unambiguous.
 *
 * Usage:
 *   <RoleBadge role={user.role} />
 *   {user.isProbation && <ProbationBadge until={user.probationUntil} />}
 */

import type { CSSProperties } from 'react';

interface ProbationBadgeProps {
  /** ISO timestamp string for the probation review window — when present, badge shows days remaining. */
  until?: string | Date | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
  /** Show the days-remaining count after the label. Default true. */
  showDaysRemaining?: boolean;
}

const SIZE_CLASSES = {
  sm: 'text-2xs px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
  lg: 'text-sm px-2.5 py-1 gap-1.5',
} as const;

function daysUntil(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const target = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(target.getTime())) return null;
  const ms = target.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function ProbationBadge({
  until,
  size = 'md',
  className = '',
  style,
  showDaysRemaining = true,
}: ProbationBadgeProps) {
  const days = showDaysRemaining ? daysUntil(until) : null;
  const label =
    days === null
      ? 'Probation'
      : days < 0
        ? `Probation · ${Math.abs(days)}d overdue`
        : days === 0
          ? 'Probation · ends today'
          : `Probation · ${days}d left`;

  // Overdue review uses a stronger danger tint so HR notices.
  const palette =
    days !== null && days < 0
      ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
      : 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium border ${palette} ${SIZE_CLASSES[size]} ${className}`}
      style={style}
      title={
        until
          ? `On probation. Review window ends ${
              typeof until === 'string' ? until.slice(0, 10) : until.toISOString().slice(0, 10)
            }.`
          : 'On probation.'
      }
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          days !== null && days < 0 ? 'bg-red-500' : 'bg-amber-500'
        }`}
      />
      {label}
    </span>
  );
}
