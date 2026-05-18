import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type CompactTableTruncatedDetailTrigger = 'always' | 'when-overflow';

export interface CompactTableTruncatedValueProps {
  /** Visible cell content — keep to a single line; parent column should allow shrink (`min-w-0`, optional `max-w-*`). */
  children: ReactNode;
  /**
   * Full value shown in the popover (multiline supported). When missing or empty, no info control is rendered
   * and only the truncated line appears.
   */
  fullText?: string;
  /**
   * When `fullText` is set: show the info control always vs only when the label visually overflows.
   * Default `when-overflow` avoids clutter for short values.
   */
  detailTrigger?: CompactTableTruncatedDetailTrigger;
  /** `aria-label` for the popover region */
  popoverLabel?: string;
  className?: string;
}

const INFO_BUTTON_CLASS =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-app-fg-muted hover:bg-app-hover hover:text-app-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app-canvas';

function InfoIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/**
 * Canonical pattern for long / variable text inside **CompactTable** cells: one horizontal line with
 * ellipsis, optional info control to read the full string in a fixed popover (same interaction model as
 * compact [`UserBranchBadges`](./user-branch-badges.tsx)). Do not use `flex-wrap` in the cell — pair with
 * column `nowrap` when needed.
 */
export function CompactTableTruncatedValue({
  children,
  fullText,
  detailTrigger = 'when-overflow',
  popoverLabel = 'Full value',
  className = '',
}: CompactTableTruncatedValueProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const trimmedFull = fullText?.trim() ?? '';
  const hasDetail = trimmedFull.length > 0;

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

  const measureOverflow = useCallback(() => {
    const el = labelRef.current;
    if (!el) return;
    setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    measureOverflow();
  }, [children, measureOverflow]);

  useEffect(() => {
    const el = labelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureOverflow());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureOverflow]);

  const showInfoButton =
    hasDetail &&
    (detailTrigger === 'always' || (detailTrigger === 'when-overflow' && overflowing));

  const portal =
    open && panelPos && showInfoButton && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="region"
            aria-label={popoverLabel}
            className="pointer-events-auto max-h-48 overflow-y-auto rounded-lg border border-app-border-strong bg-app-elevated py-2 pl-3 pr-2 text-left text-sm leading-snug text-app-fg shadow-lg z-[300]"
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
            }}
          >
            <div className="whitespace-pre-wrap break-words pr-1">{trimmedFull}</div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={wrapRef} className={['flex min-w-0 max-w-full items-center gap-1', className].filter(Boolean).join(' ')}>
        <span ref={labelRef} className="block min-w-0 flex-1 truncate whitespace-nowrap">
          {children}
        </span>
        {showInfoButton ? (
          <button
            ref={triggerRef}
            type="button"
            className={INFO_BUTTON_CLASS}
            aria-expanded={open}
            aria-controls={panelId}
            aria-haspopup="true"
            aria-label="View full value"
            onClick={() => setOpen((v) => !v)}
          >
            <InfoIcon />
          </button>
        ) : null}
      </div>
      {portal}
    </>
  );
}
