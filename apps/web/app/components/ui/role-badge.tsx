/**
 * RoleBadge — single source of truth for user role colors across the UI.
 *
 * Roles are grouped by department so the colors carry semantic meaning:
 *   admin tier  → red    (top authority, draws the eye)
 *   CS          → blue   (Customer Service — the "talk to humans" team)
 *   Marketing   → amber  (Media spend / campaign work)
 *   Logistics   → green  (delivery / inventory / 3PL)
 *   Finance     → indigo (money handling)
 *   HR          → purple (people management)
 *   default     → slate  (catch-all for unknown / generic strings)
 *
 * Heads carry the same hue as their team but bolder weight; reports use the lighter shade.
 *
 * Use this everywhere a `user.role` string is rendered as a chip — the previous patchwork of
 * `badge-info` produced an "everything looks the same" effect that made tables hard to scan.
 */

import type { CSSProperties } from 'react';

export type RoleColor = 'red' | 'blue' | 'amber' | 'green' | 'indigo' | 'purple' | 'slate';

const ROLE_COLOR_MAP: Record<string, RoleColor> = {
  // Admin tier
  SUPER_ADMIN: 'red',
  ADMIN: 'red',
  BRANCH_ADMIN: 'red',
  // CS
  HEAD_OF_CS: 'blue',
  CS_CLOSER: 'blue',
  // Marketing
  HEAD_OF_MARKETING: 'amber',
  MEDIA_BUYER: 'amber',
  // Logistics
  HEAD_OF_LOGISTICS: 'green',
  LOGISTICS_MANAGER: 'green',
  TPL_MANAGER: 'green',
  TPL_RIDER: 'green',
  STOCK_MANAGER: 'green',
  // Finance
  FINANCE_OFFICER: 'indigo',
  // HR
  HR_MANAGER: 'purple',
  // Tech support (read-only admin visibility)
  SUPPORT: 'slate',
};

/** Returns the canonical color for a role string. Unknown roles fall back to slate. */
export function getRoleColor(role: string): RoleColor {
  return ROLE_COLOR_MAP[role] ?? 'slate';
}

/**
 * Tailwind classes for each color — kept inline (not via @apply) so the bundler tree-shakes
 * unused variants and we don't add new tokens to tailwind.css. Heads are bold-weight; everyone
 * else is medium-weight via the `bold` flag.
 */
const COLOR_CLASSES: Record<RoleColor, { bg: string; text: string; border: string; dot: string }> = {
  red:    { bg: 'bg-red-50 dark:bg-red-900/20',       text: 'text-red-700 dark:text-red-300',       border: 'border-red-200 dark:border-red-800',       dot: 'bg-red-500' },
  blue:   { bg: 'bg-sky-50 dark:bg-sky-900/20',       text: 'text-sky-700 dark:text-sky-300',       border: 'border-sky-200 dark:border-sky-800',       dot: 'bg-sky-500' },
  amber:  { bg: 'bg-amber-50 dark:bg-amber-900/20',   text: 'text-amber-700 dark:text-amber-300',   border: 'border-amber-200 dark:border-amber-800',   dot: 'bg-amber-500' },
  green:  { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-800', dot: 'bg-indigo-500' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800', dot: 'bg-purple-500' },
  slate:  { bg: 'bg-slate-100 dark:bg-slate-800',     text: 'text-slate-700 dark:text-slate-300',   border: 'border-slate-200 dark:border-slate-700',   dot: 'bg-slate-500' },
};

const SIZE_CLASSES = {
  sm: 'text-2xs px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
  lg: 'text-sm px-2.5 py-1 gap-1.5',
} as const;

/** Typography-only sizes when `variant="text"` (no pill padding). */
const TEXT_VARIANT_SIZE_CLASSES = {
  sm: 'text-2xs gap-1',
  md: 'text-xs gap-1.5',
  lg: 'text-sm gap-1.5',
} as const;

interface RoleBadgeProps {
  role: string;
  /** Override the rendered text — defaults to role with underscores → spaces. */
  label?: string;
  size?: keyof typeof SIZE_CLASSES;
  /**
   * `chip` — filled pill with border (default).
   * `text` — role hue as foreground color only (no background or border).
   */
  variant?: 'chip' | 'text';
  /** Show a colored dot before the label. Useful in dense tables. */
  showDot?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Per-word overrides so role labels keep acronyms uppercase (CS / TPL / HR /
 * 3PL) and small connector words lowercase ("of"). Without this a plain
 * title-case turns `HEAD_OF_CS` into "Head Of Cs".
 */
const ROLE_WORD_OVERRIDES: Record<string, string> = {
  CS: 'CS',
  TPL: 'TPL',
  '3PL': '3PL',
  HR: 'HR',
  OF: 'of',
  AND: 'and',
};

/** Turn a role enum (`HEAD_OF_CS`) into a display label (`Head of CS`). */
export function formatRoleLabel(role: string): string {
  return role
    .split('_')
    .map((word) => {
      const override = ROLE_WORD_OVERRIDES[word.toUpperCase()];
      if (override) return override;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function RoleBadge({
  role,
  label,
  size = 'md',
  variant = 'chip',
  showDot = false,
  className = '',
  style,
}: RoleBadgeProps) {
  const color = getRoleColor(role);
  const c = COLOR_CLASSES[color];
  const chipClasses =
    variant === 'chip'
      ? `rounded-full font-medium border ${c.bg} ${c.text} ${c.border} ${SIZE_CLASSES[size]}`
      : `font-medium ${c.text} ${TEXT_VARIANT_SIZE_CLASSES[size]}`;
  return (
    <span className={`inline-flex items-center ${chipClasses} ${className}`} style={style} title={role}>
      {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />}
      {label ?? formatRoleLabel(role)}
    </span>
  );
}
