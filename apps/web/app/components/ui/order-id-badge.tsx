import { useEffect, useRef, useState } from 'react';
import { Link } from '@remix-run/react';

export interface OrderIdBadgeProps {
  /**
   * Full UUID. Copied to clipboard verbatim and used as the source for the
   * truncated display text.
   */
  id: string;
  /** Visible characters from the start of the ID. Default 8. */
  length?: number;
  /** Uppercase the visible characters. Default false. */
  uppercase?: boolean;
  /**
   * Trailing ellipsis after the truncated text. Default `'...'`.
   * Pass an empty string to omit it (matches places that show only the prefix).
   */
  ellipsis?: string;
  /**
   * If set, wraps the display text in a Remix `<Link>` to this href.
   * Use when the badge stands alone in a table cell. When the badge sits
   * inside an outer `<Link>` (e.g. mobile cards), leave this undefined —
   * the copy button always stops propagation so it never triggers nav.
   */
  linkTo?: string;
  /** Open the link in a new tab. Only applies when `linkTo` is set. */
  newTab?: boolean;
  /** Class names for the display text element. */
  textClassName?: string;
  /** Class names for the outer wrapper. */
  className?: string;
  /** Hide the copy button (display-only). Default false. */
  hideCopy?: boolean;
}

/**
 * Renders a shortened order ID with a copy icon. The full UUID is copied to
 * clipboard on click — important for support flows where staff need the
 * complete ID to reference an order in the DB or audit trail.
 *
 * Safe to nest inside an outer `<Link>` — the copy button calls
 * `preventDefault()` + `stopPropagation()` so clicking it never triggers the
 * surrounding link's navigation. (HTML5 technically forbids `<button>` inside
 * `<a>`, but every browser handles it correctly and this is the simplest
 * pattern for our mobile order cards.)
 */
export function OrderIdBadge({
  id,
  length = 8,
  uppercase = false,
  ellipsis = '...',
  linkTo,
  newTab,
  textClassName,
  className,
  hideCopy = false,
}: OrderIdBadgeProps) {
  const display = `${id.slice(0, length)}${ellipsis}`;
  const visible = uppercase ? display.toUpperCase() : display;

  const text = linkTo ? (
    <Link
      to={linkTo}
      className={textClassName ?? 'text-brand-500 hover:text-brand-600 font-medium'}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {visible}
    </Link>
  ) : (
    <span className={textClassName ?? 'font-mono text-app-fg-muted'}>{visible}</span>
  );

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      {text}
      {!hideCopy && <CopyButton value={id} />}
    </span>
  );
}

/**
 * Tiny inline copy-to-clipboard button. Swaps icon to a checkmark for ~1.4s
 * after a successful copy. Falls back to `document.execCommand('copy')` on
 * older browsers / non-secure contexts where `navigator.clipboard` is unset.
 */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Crucial when nested inside <Link> or a clickable card: prevent the outer
    // navigation/handler so copying never doubles as a click-through.
    e.preventDefault();
    e.stopPropagation();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document !== 'undefined') {
        // Legacy / insecure-context fallback. Behaviour is good enough for
        // copying short IDs; we don't need full DOM-selection fidelity.
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Silent — UI just won't show the checkmark. Avoids a toast for a minor failure.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy order ID'}
      title={copied ? 'Copied!' : 'Copy order ID'}
      className={`inline-flex items-center justify-center rounded p-0.5 transition-colors ${
        copied
          ? 'text-success-600 dark:text-success-400'
          : 'text-app-fg-muted hover:text-app-fg hover:bg-app-hover'
      }`}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2" />
          <rect x="8" y="8" width="12" height="12" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
