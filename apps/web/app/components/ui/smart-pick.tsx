import { useState } from 'react';
import { NumberInput } from '~/components/ui/number-input';
import { useToast } from '~/components/ui/toast';

export interface SmartPickProps {
  /** Total selectable items in the underlying list — drives preset disabled state and the "of N" labels. */
  total: number;
  /** Called with the chosen count. Caller decides the selection strategy (slice from top is the default contract). */
  onPick: (count: number) => void;
  /** Current selection size — when > 0 the component shows "N selected" + Clear. */
  selectedCount?: number;
  /** Called when the user clicks Clear. */
  onClear?: () => void;
  /** Override the preset buckets. */
  presets?: number[];
  /** Singular noun used in labels: "Pick 10 orders" / "20 orders selected". */
  itemNoun?: string;
  /** Hide the custom-input form. */
  hideCustom?: boolean;
  /** Compact mobile layout: icon label, tighter controls, no wrapping. */
  compactMobile?: boolean;
  className?: string;
}

const DEFAULT_PRESETS = [10, 20, 50, 100];

export function SmartPick({
  total,
  onPick,
  selectedCount = 0,
  onClear,
  presets = DEFAULT_PRESETS,
  itemNoun = 'orders',
  hideCustom = false,
  compactMobile = false,
  className = '',
}: SmartPickProps) {
  const [customValue, setCustomValue] = useState<number | null>(null);
  /** Tracks the most recently clicked preset (or 'custom') so we can highlight it
   *  even when the actual selection is clamped (e.g. user clicks 100, only 20 available). */
  const [lastPicked, setLastPicked] = useState<number | 'custom' | null>(null);
  const { toast } = useToast();

  function pickWithShortfallNotice(requested: number) {
    const effective = Math.min(requested, total);
    if (requested > total && total > 0) {
      toast.warning(
        `Only ${total} ${itemNoun} available`,
        `Picked all ${total} instead of ${requested}.`,
      );
    }
    onPick(effective);
  }

  const visiblePresets = presets;
  const showAllAsLastBucket = total > 0 && !presets.includes(total) && total < Math.max(...presets);
  const customShortfall = customValue !== null && customValue > total && total > 0;
  const compactIcon = (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M11.2 2.4a.75.75 0 0 1 1.2.86L10.8 5.5l2.5-.62a.75.75 0 1 1 .36 1.46l-2.5.62 1.55 2.24a.75.75 0 1 1-1.24.84L9.9 7.8l-1.56 2.24a.75.75 0 1 1-1.23-.84L8.65 6.96l-2.5-.62a.75.75 0 1 1 .36-1.46l2.5.62-1.6-2.24a.75.75 0 1 1 1.22-.86L9.9 4.66l1.3-2.26Z" />
      <path d="M15.5 11.75a.75.75 0 0 1 .73.56l.35 1.34 1.34.35a.75.75 0 1 1 0 1.45l-1.34.35-.35 1.34a.75.75 0 1 1-1.45 0l-.35-1.34-1.34-.35a.75.75 0 1 1 0-1.45l1.34-.35.35-1.34a.75.75 0 0 1 .72-.56Z" />
    </svg>
  );

  return (
    <div
      className={`flex items-center ${compactMobile ? 'min-w-max flex-nowrap gap-1.5 md:min-w-0 md:flex-wrap md:gap-2' : 'flex-wrap gap-2'} ${className}`.trim()}
    >
      <span
        className={`shrink-0 text-xs font-medium text-app-fg-muted ${compactMobile ? 'inline-flex items-center' : ''}`}
        aria-label={compactMobile ? 'Smart pick' : undefined}
        title="Smart pick"
      >
        {compactMobile ? (
          <>
            <span className="inline-flex rounded-md border border-app-border bg-app-hover p-1 md:hidden">{compactIcon}</span>
            <span className="hidden md:inline">Smart pick</span>
          </>
        ) : (
          'Smart pick'
        )}
      </span>
      <div className={`inline-flex items-center gap-1 ${compactMobile ? 'shrink-0 flex-nowrap' : 'flex-wrap'}`}>
        {visiblePresets.map((n) => {
          const isShortfall = n > total && total > 0;
          const wasLastPicked = lastPicked === n;
          const matchesSelection = selectedCount > 0 && selectedCount === Math.min(n, total);
          const isActive = wasLastPicked || (lastPicked === null && matchesSelection);
          const variant = isActive
            ? isShortfall && wasLastPicked
              ? 'border-warning-500 bg-warning-500 text-white hover:bg-warning-600'
              : 'border-brand-500 bg-brand-500 text-white hover:bg-brand-600'
            : 'border-app-border bg-app-elevated text-app-fg hover:bg-app-hover';
          return (
            <button
              key={n}
              type="button"
              onClick={() => {
                setLastPicked(n);
                pickWithShortfallNotice(n);
              }}
              disabled={total === 0}
              aria-pressed={isActive}
              className={`inline-flex items-center justify-center rounded-md border font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                compactMobile ? 'h-7 min-w-7 px-1.5 text-[10px] md:px-2 md:text-[11px]' : 'px-2 py-0.5 text-[11px]'
              } ${variant}`}
              title={
                isShortfall
                  ? `Only ${total} ${itemNoun} available — will pick all ${total}`
                  : `Pick first ${n} ${itemNoun}`
              }
            >
              {n}
            </button>
          );
        })}
        {showAllAsLastBucket && (() => {
          const wasLastPicked = lastPicked === total;
          const matchesSelection = selectedCount === total && total > 0;
          const isActive = wasLastPicked || (lastPicked === null && matchesSelection);
          return (
            <button
              type="button"
              onClick={() => {
                setLastPicked(total);
                onPick(total);
              }}
              aria-pressed={isActive}
              className={`inline-flex items-center justify-center rounded-md border font-semibold transition-colors ${
                compactMobile ? 'h-7 px-1.5 text-[10px] md:px-2 md:text-[11px]' : 'px-2 py-0.5 text-[11px]'
              } ${
                isActive
                  ? 'border-brand-500 bg-brand-500 text-white hover:bg-brand-600'
                  : 'border-app-border bg-app-elevated text-app-fg hover:bg-app-hover'
              }`}
              title={`Pick all ${total} ${itemNoun}`}
            >
              All ({total})
            </button>
          );
        })()}
      </div>

      {!hideCustom && (() => {
        return (
          <NumberInput
            min={1}
            max={total || undefined}
            value={customValue}
            commitOnChange
            onValueChange={(value) => {
              setCustomValue(value);
              setLastPicked('custom');
              onPick(Math.min(value, total));
            }}
            onValueCleared={() => setCustomValue(null)}
            allowEmpty
            placeholder="Custom"
            disabled={total === 0}
            aria-label={`Custom pick count (max ${total})`}
            title={customShortfall ? `Only ${total} ${itemNoun} available — picking all ${total}` : undefined}
            controlSize="sm"
            wrapperClassName={compactMobile ? 'w-14 shrink-0 md:w-24' : 'w-24 shrink-0'}
            className={`rounded-md ${
              customShortfall
                ? 'border-warning-500 text-warning-700 focus:border-warning-500 focus:ring-warning-500 dark:text-warning-400'
                : ''
            }`}
          />
        );
      })()}

      {selectedCount > 0 && (
        <>
          <span className={`text-xs font-medium text-app-fg ${compactMobile ? 'ml-0 hidden md:inline' : 'ml-1'}`}>
            {selectedCount} selected
          </span>
          {onClear && (
            <button
              type="button"
              onClick={() => {
                setLastPicked(null);
                onClear();
              }}
              className={`shrink-0 text-app-fg-muted hover:text-app-fg ${
                compactMobile
                  ? 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-app-border bg-app-elevated text-[11px] md:h-auto md:w-auto md:border-0 md:bg-transparent md:text-xs md:underline-offset-2 md:hover:underline'
                  : 'text-xs underline-offset-2 hover:underline'
              }`}
              aria-label="Clear smart pick selection"
              title="Clear"
            >
              {compactMobile ? (
                <>
                  <svg className="h-3.5 w-3.5 md:hidden" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 1 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="hidden md:inline">Clear</span>
                </>
              ) : (
                'Clear'
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
