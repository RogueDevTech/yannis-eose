/**
 * SortMenu — advanced sort picker.
 *
 * Trigger pill shows the active sort key + direction. Click opens a modal where the user
 * picks the sort key (radio list, optionally grouped) AND a direction toggle. The direction
 * labels are option-aware (e.g. "Lowest first / Highest first" vs "A → Z / Z → A") so the
 * affordance matches what the user is actually sorting.
 *
 * Used everywhere we want sort UX richer than a single dropdown — list pages with multiple
 * sortable columns, dashboards where direction has semantic meaning, etc. Pair with a Remix
 * loader that reads `sortBy` / `sortDir` from search params; this component is fully
 * controlled and never touches the URL itself.
 *
 * Component-first per CLAUDE.md "UI Component Reuse Rules" — register here, do not hand-roll
 * `<FormSelect value=sortBy /> + <FormSelect value=sortDir />` next to a list page.
 *
 *   <SortMenu
 *     value={{ sortBy, sortDir }}
 *     onChange={(next) => navigate(`?sortBy=${next.sortBy}&sortDir=${next.sortDir}`)}
 *     options={[
 *       { value: 'updatedAt', label: 'Last updated', defaultDir: 'desc' },
 *       { value: 'available', label: 'Available units',
 *         ascLabel: 'Lowest first', descLabel: 'Highest first', defaultDir: 'desc' },
 *     ]}
 *     defaultValue={{ sortBy: 'updatedAt', sortDir: 'desc' }}
 *   />
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from './modal';
import { Button } from './button';

export interface SortMenuOption {
  value: string;
  label: string;
  /** Optional one-line context shown under the label in the picker. */
  description?: string;
  /** Override "Ascending" label for this key — e.g. "Lowest first". */
  ascLabel?: string;
  /** Override "Descending" label for this key — e.g. "Highest first". */
  descLabel?: string;
  /** Direction the picker selects when the user switches TO this key. Default: 'asc'. */
  defaultDir?: 'asc' | 'desc';
  /** Optional group header shown above this option in the picker. */
  group?: string;
  /** Optional leading icon (small SVG). */
  icon?: ReactNode;
}

export interface SortMenuValue {
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

interface SortMenuProps {
  value: SortMenuValue;
  onChange: (next: SortMenuValue) => void;
  options: SortMenuOption[];
  /** Used by the Reset button. Required so the user can always recover the canonical sort. */
  defaultValue: SortMenuValue;
  className?: string;
  /** Override the trigger prefix; default "Sort". */
  triggerLabel?: string;
  /** Disable the trigger (e.g. while loading). */
  disabled?: boolean;
}

function dirLabel(option: SortMenuOption | undefined, dir: 'asc' | 'desc'): string {
  if (!option) return dir === 'asc' ? 'Ascending' : 'Descending';
  if (dir === 'asc') return option.ascLabel ?? 'Ascending';
  return option.descLabel ?? 'Descending';
}

export function SortMenu({
  value,
  onChange,
  options,
  defaultValue,
  className = '',
  triggerLabel = 'Sort',
  disabled = false,
}: SortMenuProps) {
  const [open, setOpen] = useState(false);

  // Local draft so flipping the radio doesn't refetch the loader on every click — only Apply does.
  const [draft, setDraft] = useState<SortMenuValue>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const activeOption = options.find((o) => o.value === value.sortBy);
  const draftOption = options.find((o) => o.value === draft.sortBy);

  const isDirty = draft.sortBy !== value.sortBy || draft.sortDir !== value.sortDir;
  const isDefault = value.sortBy === defaultValue.sortBy && value.sortDir === defaultValue.sortDir;

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, SortMenuOption[]>();
    for (const opt of options) {
      const key = opt.group ?? '';
      const existing = groups.get(key) ?? [];
      existing.push(opt);
      groups.set(key, existing);
    }
    return Array.from(groups.entries());
  }, [options]);

  const apply = () => {
    onChange(draft);
    setOpen(false);
  };

  const reset = () => {
    onChange(defaultValue);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={[
          'inline-flex items-center gap-1.5 rounded-md border bg-app-surface px-3 py-1.5 text-sm font-medium transition-colors',
          isDefault
            ? 'border-app-border text-app-fg-muted hover:bg-app-hover'
            : 'border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-200 hover:bg-brand-100 dark:hover:bg-brand-900/30',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="Open sort menu"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h5m13 4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span className="text-app-fg-muted">{triggerLabel}:</span>
        <span className="text-app-fg">{activeOption?.label ?? value.sortBy}</span>
        <span className="text-app-fg-muted">·</span>
        <span className="text-app-fg-muted">{dirLabel(activeOption, value.sortDir)}</span>
      </button>

      {open ? (
        <Modal open onClose={() => setOpen(false)} contentClassName="p-0" maxWidth="max-w-md">
          <div className="px-5 pt-5 pb-3 border-b border-app-border">
            <h2 className="text-base font-semibold text-app-fg">Sort</h2>
            <p className="mt-1 text-xs text-app-fg-muted">
              Pick what to sort by, then choose the direction.
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-4">
            {groupedOptions.map(([group, items], gi) => (
              <div key={group || `_${gi}`} className="space-y-1.5">
                {group ? (
                  <p className="text-mini font-semibold uppercase tracking-wider text-app-fg-muted">
                    {group}
                  </p>
                ) : null}
                <div className="space-y-1">
                  {items.map((opt) => {
                    const selected = draft.sortBy === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setDraft({
                            sortBy: opt.value,
                            sortDir: opt.defaultDir ?? 'asc',
                          })
                        }
                        className={[
                          'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                          selected
                            ? 'border-brand-300 dark:border-brand-600 bg-brand-50 dark:bg-brand-900/20'
                            : 'border-app-border hover:bg-app-hover',
                        ].join(' ')}
                      >
                        <span
                          aria-hidden
                          className={[
                            'w-4 h-4 rounded-full border-2 shrink-0',
                            selected
                              ? 'border-brand-500 bg-brand-500 ring-2 ring-brand-200 dark:ring-brand-900'
                              : 'border-app-border',
                          ].join(' ')}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 text-app-fg">
                            {opt.icon}
                            <span className="font-medium">{opt.label}</span>
                          </span>
                          {opt.description ? (
                            <span className="block text-xs text-app-fg-muted mt-0.5">
                              {opt.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-app-border px-5 py-4 space-y-3">
            <div>
              <p className="text-mini font-semibold uppercase tracking-wider text-app-fg-muted mb-1.5">
                Direction
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(['asc', 'desc'] as const).map((dir) => {
                  const selected = draft.sortDir === dir;
                  return (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, sortDir: dir }))}
                      className={[
                        'flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                        selected
                          ? 'border-brand-500 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-200'
                          : 'border-app-border text-app-fg-muted hover:bg-app-hover',
                      ].join(' ')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        {dir === 'asc' ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                        )}
                      </svg>
                      {dirLabel(draftOption, dir)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={reset}
                disabled={isDefault && !isDirty}
              >
                Reset
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" size="sm" onClick={apply} disabled={!isDirty}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
