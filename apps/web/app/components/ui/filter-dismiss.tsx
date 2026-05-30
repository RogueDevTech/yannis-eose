/**
 * Floating dismiss badge for an active filter control.
 *
 * Usage:
 *   <div className="relative">
 *     {isActive && <FilterDismiss onClear={() => clearThisFilter()} />}
 *     <SearchableSelect ... />
 *   </div>
 *
 * The badge is absolutely positioned at the top-right corner of the wrapper
 * (-top-1.5 -right-1.5). It calls `e.stopPropagation()` before `onClear` so a
 * click on the badge doesn't open the underlying dropdown. This is the
 * platform-wide pattern that replaces the old single "Clear filters" button.
 */
export function FilterDismiss({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-danger-500 text-white shadow-sm transition-colors hover:bg-danger-600 dark:bg-danger-600 dark:hover:bg-danger-500"
      title="Clear filter"
      aria-label="Clear filter"
    >
      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
