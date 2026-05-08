import { Spinner } from '~/components/ui/spinner';

export interface TableLoadingOverlayProps {
  show: boolean;
  children: React.ReactNode;
  /** Override default min-height for short panels */
  minHeightClassName?: string;
}

/**
 * Wraps a table or card list so URL-driven loader refetches show a subtle dim + spinner
 * placed ~35% from the top of the panel without unmounting content (no layout jump). Used
 * by `CompactTable` `loadingVariant="overlay"` and list pages that wrap tables manually.
 */
export function TableLoadingOverlay({ show, children, minHeightClassName = 'min-h-[12rem]' }: TableLoadingOverlayProps) {
  return (
    <div className={['relative', minHeightClassName].filter(Boolean).join(' ')}>
      {children}
      {show ? (
        <div
          className="absolute inset-0 z-10 rounded-[inherit] bg-black/36 backdrop-blur-[0.5px] dark:bg-black/52"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="pointer-events-none absolute left-1/2 top-[35%] -translate-x-1/2">
            <Spinner size="lg" className="text-white/85" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
