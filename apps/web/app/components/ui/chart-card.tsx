import { useState, type ReactNode } from 'react';
import { Modal } from '~/components/ui/modal';

/**
 * A card wrapper for a chart, with a built-in "expand" icon (top-right) that opens
 * the same chart in a large modal for a closer look. Reusable across the app so
 * every chart gets a consistent expand affordance.
 *
 * The chart content is passed as `children` and rendered in BOTH the card and the
 * modal. Charts should use a height-defined wrapper (e.g. `<div style={{height:'100%'}}>`
 * + `<ResponsiveContainer height="100%">`) so they fill whichever container they're
 * in — the card gives ~300px, the modal gives a taller area.
 *
 * Set `expandable={false}` to render a plain chart card with no expand control.
 */
export function ChartCard({
  title,
  subtitle,
  children,
  expandable = true,
  cardHeight = 300,
  modalHeight = 460,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  expandable?: boolean;
  /** Chart area height inside the card (px). */
  cardHeight?: number;
  /** Chart area height inside the modal (px). */
  modalHeight?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-app-fg truncate">{title}</h3>
        {subtitle != null && <p className="text-xs text-app-fg-muted mt-0.5">{subtitle}</p>}
      </div>
      {expandable && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand chart"
          title="Expand"
          className="shrink-0 -mr-1 -mt-0.5 p-1.5 rounded-md text-app-fg-muted hover:text-app-fg hover:bg-app-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <ExpandIcon />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className={`card overflow-hidden ${className}`}>
        {header}
        <div className="mt-3" style={{ height: cardHeight }}>
          {children}
        </div>
      </div>

      {expandable && (
        <Modal
          open={expanded}
          onClose={() => setExpanded(false)}
          maxWidth="max-w-5xl"
          contentClassName="p-5 sm:p-6"
        >
          <div className="space-y-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-app-fg">{title}</h3>
              {subtitle != null && <p className="text-sm text-app-fg-muted mt-0.5">{subtitle}</p>}
            </div>
            {/* Small inner inset so the chart's axis labels + end points don't sit
                flush against the modal edge. */}
            <div className="px-1 sm:px-2" style={{ height: modalHeight }}>
              {children}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Corners-out "maximize" glyph. */
function ExpandIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  );
}
