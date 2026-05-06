import { Spinner } from '~/components/ui/spinner';

export interface TableLoadingOverlayProps {
  show: boolean;
  children: React.ReactNode;
  /** Override default min-height for short panels */
  minHeightClassName?: string;
}

/**
 * Wraps a table or card list so URL-driven loader refetches show a centered spinner
 * without unmounting content (no layout jump). Matches Finance → Disbursements UX.
 */
export function TableLoadingOverlay({ show, children, minHeightClassName = 'min-h-[12rem]' }: TableLoadingOverlayProps) {
  return (
    <div className={['relative', minHeightClassName].filter(Boolean).join(' ')}>
      {children}
      {show ? (
        <div
          className="absolute inset-0 z-10 rounded-[inherit] bg-app-elevated/70 backdrop-blur-[1px]"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="absolute left-1/2 top-[20%] -translate-x-1/2">
            <Spinner size="lg" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
