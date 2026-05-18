/**
 * CountPill — neutral pill chrome with a colored leading dot + label + count chip.
 *
 * Use this for *bucket counts* / *tally* contexts: filter rows, tab badges with counts,
 * status roll-ups in summary headers. The colored dot carries the tone signal so the
 * pill body stays neutral — three pills next to each other read calmly instead of as
 * a wall of color.
 *
 * **NOT** a replacement for `<StatusBadge>` (single-record state — use the solid
 * variant there so rows in a long table can be scanned by color) or `<RoleBadge>`
 * (locked in CLAUDE.md, department colors).
 *
 * Example:
 *   <CountPill tone="warning" label="Pending" count={5} />
 *   <CountPill tone="success" label="Approved" count={4} />
 *   <CountPill tone="danger" label="Rejected" count={1} />
 */

export type CountPillTone = 'neutral' | 'brand' | 'info' | 'warning' | 'success' | 'danger';

interface CountPillProps {
  tone: CountPillTone;
  label: string;
  count: number;
  /** Optional click handler — when set, renders as a button (filter chip use case). */
  onClick?: () => void;
  /** Render the chip in a "selected" state (filter is currently active). Bumps the chrome. */
  active?: boolean;
  /** Hide the count chip when 0 — useful when rendering a fixed set of buckets. */
  hideZero?: boolean;
  className?: string;
  'aria-label'?: string;
}

const DOT_TONE: Record<CountPillTone, string> = {
  neutral: 'bg-app-fg-muted/60',
  brand: 'bg-brand-500 dark:bg-brand-400',
  info: 'bg-info-500 dark:bg-info-400',
  warning: 'bg-warning-500 dark:bg-warning-400',
  success: 'bg-success-500 dark:bg-success-400',
  danger: 'bg-danger-500 dark:bg-danger-400',
};

export function CountPill({
  tone,
  label,
  count,
  onClick,
  active = false,
  hideZero = false,
  className = '',
  'aria-label': ariaLabel,
}: CountPillProps) {
  if (hideZero && count === 0) return null;

  const baseChrome =
    'inline-flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-full border text-[11px] font-medium tabular-nums';
  const chromeIdle = 'border-app-border bg-app-elevated text-app-fg';
  const chromeActive =
    'border-brand-400 bg-brand-50 text-app-fg dark:border-brand-700 dark:bg-brand-900/30';
  const interactive = onClick
    ? 'cursor-pointer hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-colors'
    : '';

  const content = (
    <>
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_TONE[tone]}`} />
      <span>{label}</span>
      <span
        className={[
          'ml-0.5 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
          active
            ? 'bg-brand-100 text-brand-700 dark:bg-brand-800/60 dark:text-brand-200'
            : 'bg-app-hover text-app-fg-muted',
        ].join(' ')}
      >
        {count}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? `${label}: ${count}`}
        aria-pressed={active}
        className={[baseChrome, active ? chromeActive : chromeIdle, interactive, className].join(' ')}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      aria-label={ariaLabel}
      className={[baseChrome, active ? chromeActive : chromeIdle, className].join(' ')}
    >
      {content}
    </span>
  );
}
