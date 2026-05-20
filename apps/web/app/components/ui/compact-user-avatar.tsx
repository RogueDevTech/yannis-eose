/**
 * Compact 2-letter initials avatar — same treatment as the Closer Workload
 * cards on `/admin/sales/queue` (soft brand surface, brand-coloured glyphs,
 * tight 24px footprint by default).
 *
 * Used anywhere a user / member name appears in a list cell or compact card
 * row so the visual signature stays consistent across HR Users, Marketing
 * Team, Sales Closer Workloads, etc.
 *
 * Falls back to '—' for blank names so the chip is never empty.
 */
export interface CompactUserAvatarProps {
  /** Full name; we split on whitespace and take up to two leading initials. */
  name: string;
  /** Tailwind size pair — defaults to `'w-6 h-6'` (matches the Closer cards). */
  sizeClassName?: string;
  /** Tailwind text-size — defaults to `'text-micro'`. */
  textClassName?: string;
  /** Optional extra classes for the wrapper. */
  className?: string;
}

export function CompactUserAvatar({
  name,
  sizeClassName = 'w-6 h-6',
  textClassName = 'text-micro',
  className = '',
}: CompactUserAvatarProps) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '—';
  return (
    <div
      className={[
        sizeClassName,
        'rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <span className={`${textClassName} font-bold text-brand-600 dark:text-brand-400`}>{initials}</span>
    </div>
  );
}
