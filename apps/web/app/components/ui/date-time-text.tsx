import { formatDateOnly, formatOrderTimestamp } from '~/lib/format-date';

/**
 * Date in primary fg; time dimmed (`text-app-fg-muted`) like JE # / code columns.
 * Prefer a wall-clock timestamp (`at`); fall back to a business calendar date.
 */
export function DateTimeText({
  at,
  dateOnly,
  className = '',
}: {
  at?: string | Date | null;
  dateOnly?: string | Date | null;
  className?: string;
}) {
  if (at) {
    const full = formatOrderTimestamp(at);
    const comma = full.lastIndexOf(',');
    if (comma < 0) {
      return <span className={`tabular-nums whitespace-nowrap text-app-fg ${className}`.trim()}>{full}</span>;
    }
    const datePart = full.slice(0, comma);
    const timePart = full.slice(comma + 1).trim();
    return (
      <span className={`tabular-nums whitespace-nowrap text-app-fg ${className}`.trim()}>
        {datePart}
        {timePart ? (
          <>
            , <span className="text-app-fg-muted">{timePart}</span>
          </>
        ) : null}
      </span>
    );
  }
  if (dateOnly) {
    return (
      <span className={`tabular-nums whitespace-nowrap text-app-fg ${className}`.trim()}>
        {formatDateOnly(dateOnly)}
      </span>
    );
  }
  return <span className={`text-app-fg-muted ${className}`.trim()}>—</span>;
}
