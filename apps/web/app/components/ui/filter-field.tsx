import type { ReactNode } from 'react';

/**
 * The consistent visual shell for a single filter control in the Filters sheet
 * (and the desktop Filters modal). Every filter dropdown/select renders inside
 * this box so they all look identical: a full-width `h-12` card with a centered
 * label and the control's inline chevron on the right.
 *
 * Wrap a `FormSelect`/`SearchableSelect` (with the standard transparent, centered
 * trigger classes) so the box owns the border/background and the control owns the
 * label + chevron. Pass `onClear` to show the small dismiss ✕ when a non-default
 * value is selected.
 *
 * ```tsx
 * <FilterField onClear={value !== 'ALL' ? () => df.set('productId', null) : undefined}>
 *   <SearchableSelect
 *     value={df.get('productId') ?? 'ALL'}
 *     onChange={(v) => df.set('productId', v === 'ALL' ? null : v)}
 *     options={productOptions}
 *     triggerClassName="!bg-transparent !border-transparent !text-center"
 *     inlineChevron
 *     wrapperClassName="w-full"
 *   />
 * </FilterField>
 * ```
 */
export interface FilterFieldProps {
  children: ReactNode;
  /** When provided, renders a dismiss ✕ that clears this filter back to default. */
  onClear?: () => void;
  className?: string;
}

/** The canonical filter-box classes — reuse anywhere a bespoke filter shell is built. */
export const FILTER_FIELD_BOX_CLASS =
  'relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5';

function FilterDismissX({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      aria-label="Clear filter"
      className="absolute -right-1.5 -top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-app-border bg-app-elevated text-app-fg-muted shadow-sm transition-colors hover:text-danger-500"
    >
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 011.414-1.414L10 8.586z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

export function FilterField({ children, onClear, className }: FilterFieldProps) {
  const content = (
    <div className={[FILTER_FIELD_BOX_CLASS, className].filter(Boolean).join(' ')}>{children}</div>
  );
  if (!onClear) return content;
  return (
    <div className="relative">
      <FilterDismissX onClear={onClear} />
      {content}
    </div>
  );
}
