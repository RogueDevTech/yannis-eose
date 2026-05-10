import { useState } from 'react';
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
  className = '',
}: SmartPickProps) {
  const [customValue, setCustomValue] = useState('');
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

  function handleCustomChange(raw: string) {
    setCustomValue(raw);
    if (raw === '') {
      // Empty input — leave selection alone; don't auto-clear caller state.
      return;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setLastPicked('custom');
    onPick(Math.min(n, total));
  }

  const visiblePresets = presets;
  const showAllAsLastBucket = total > 0 && !presets.includes(total) && total < Math.max(...presets);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
      <span className="text-xs font-medium text-app-fg-muted">Smart pick</span>
      <div className="inline-flex items-center gap-1 flex-wrap">
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
              className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variant}`}
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
              className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
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
        const customNum = customValue === '' ? null : Number.parseInt(customValue, 10);
        const customShortfall =
          customNum !== null && Number.isFinite(customNum) && customNum > total && total > 0;
        return (
          <input
            type="number"
            min={1}
            max={total || undefined}
            value={customValue}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="Custom"
            disabled={total === 0}
            aria-label={`Custom pick count (max ${total})`}
            title={customShortfall ? `Only ${total} ${itemNoun} available — picking all ${total}` : undefined}
            className={`w-24 h-8 px-2.5 text-xs rounded-md border bg-app-elevated text-app-fg placeholder:text-app-fg-muted focus:outline-none focus:ring-1 disabled:opacity-40 transition-colors ${
              customShortfall
                ? 'border-warning-500 focus:ring-warning-500 text-warning-700 dark:text-warning-400'
                : 'border-app-border focus:ring-brand-500'
            }`}
          />
        );
      })()}

      {selectedCount > 0 && (
        <>
          <span className="text-xs font-medium text-app-fg ml-1">
            {selectedCount} selected
          </span>
          {onClear && (
            <button
              type="button"
              onClick={() => {
                setLastPicked(null);
                onClear();
              }}
              className="text-xs text-app-fg-muted hover:text-app-fg underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </>
      )}
    </div>
  );
}
