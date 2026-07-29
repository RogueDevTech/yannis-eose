import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Truncates long table-cell text to `chars` and reveals the full value in a
 * portal popup (same pattern as compact branch badges).
 */
export function TruncatedTextWithPopup({
  value,
  chars = 20,
  label = 'Full value',
  className = '',
  textClassName = 'text-app-fg-muted',
  copyable = false,
}: {
  value: string | null | undefined;
  chars?: number;
  /** Accessible label for the popup region. */
  label?: string;
  className?: string;
  textClassName?: string;
  /** When true, popup includes a copy action (used for emails). */
  copyable?: boolean;
}) {
  const text = value ?? '';
  const truncated = text.length > chars;
  const display = truncated ? `${text.slice(0, chars)}…` : text || '—';

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const updatePanelPosition = useCallback(() => {
    if (typeof window === 'undefined' || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(320, window.innerWidth - margin * 2);
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const top = rect.bottom + margin;
    setPanelPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    updatePanelPosition();
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', updatePanelPosition, true);
    window.addEventListener('resize', updatePanelPosition);
    return () => {
      window.removeEventListener('scroll', updatePanelPosition, true);
      window.removeEventListener('resize', updatePanelPosition);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Silent — avoid a toast for a minor clipboard failure.
    }
  };

  const portal =
    open && panelPos && truncated && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="region"
            aria-label={label}
            className="pointer-events-auto rounded-lg border border-app-border-strong bg-app-elevated px-3 py-2.5 text-left shadow-lg z-[300]"
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
            }}
          >
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-all text-sm text-app-fg">{text}</p>
              {copyable ? (
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={copied ? 'Copied' : 'Copy'}
                  title={copied ? 'Copied!' : 'Copy'}
                  className={`inline-flex shrink-0 items-center justify-center rounded p-1 transition-colors ${
                    copied
                      ? 'text-success-500 dark:text-success-400'
                      : 'text-app-fg-muted hover:text-app-fg hover:bg-app-hover'
                  }`}
                >
                  {copied ? (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                </button>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={wrapRef} className={`inline-flex items-center gap-1 min-w-0 max-w-full ${className}`}>
        <span className={`min-w-0 truncate ${textClassName}`}>{display}</span>
        {truncated ? (
          <button
            ref={triggerRef}
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-app-fg-muted hover:bg-app-hover hover:text-app-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app-canvas"
            aria-expanded={open}
            aria-controls={panelId}
            aria-haspopup="true"
            aria-label={`Show full ${label.toLowerCase()}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        ) : null}
      </div>
      {portal}
    </>
  );
}
