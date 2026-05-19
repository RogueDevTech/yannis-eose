import { useMemo } from 'react';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';

export type ScheduleHeatDay = {
  date: string;
  callbackCount: number;
  deliveryCount: number;
  /** Orders on this preferred date already delivered (or remitted / partial). */
  deliveredCount: number;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function parseYearMonth(ym: string): { year: number; month: number } {
  const [ys, ms] = ym.split('-');
  return { year: parseInt(ys ?? '0', 10), month: parseInt(ms ?? '0', 10) };
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

const HEAT_STEPS = [
  '',
  'bg-brand-500/10 dark:bg-brand-400/15',
  'bg-brand-500/20 dark:bg-brand-400/25',
  'bg-brand-500/30 dark:bg-brand-400/35',
  'bg-brand-500/45 dark:bg-brand-400/45',
  'bg-brand-500/60 dark:bg-brand-400/55',
] as const;

/** Preferred-date days with at least one completed delivery — distinct from in-flight load (brand). */
const DELIVERED_HEAT_STEPS = [
  '',
  'bg-success-500/12 dark:bg-success-400/18',
  'bg-success-500/22 dark:bg-success-400/28',
  'bg-success-500/32 dark:bg-success-400/38',
  'bg-success-500/45 dark:bg-success-400/48',
  'bg-success-500/58 dark:bg-success-400/55',
] as const;

export interface ScheduleHeatCalendarProps {
  yearMonth: string;
  heat: ScheduleHeatDay[];
  selectedDate: string | null;
  /** Only used when `onClickModeChange` is set (inline click-mode dropdown). */
  clickMode?: 'delivery' | 'callback';
  /** Optional. When omitted, the click-mode dropdown is hidden — the parent has
   *  already pinned the mode (e.g. via a page-level Deliveries / Callbacks selector). */
  onClickModeChange?: (mode: 'delivery' | 'callback') => void;
  onSelectDay: (isoDate: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export function ScheduleHeatCalendar({
  yearMonth,
  heat,
  selectedDate,
  clickMode = 'delivery',
  onClickModeChange,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
}: ScheduleHeatCalendarProps) {
  const { year, month } = parseYearMonth(yearMonth);
  const heatMap = useMemo(() => {
    const m = new Map<
      string,
      { callbackCount: number; deliveryCount: number; deliveredCount: number }
    >();
    for (const row of heat) {
      m.set(row.date, {
        callbackCount: row.callbackCount,
        deliveryCount: row.deliveryCount,
        deliveredCount: row.deliveredCount ?? 0,
      });
    }
    return m;
  }, [heat]);

  const maxTotal = useMemo(() => {
    let mx = 0;
    for (const row of heat) mx = Math.max(mx, row.callbackCount + row.deliveryCount);
    return mx > 0 ? mx : 1;
  }, [heat]);

  const maxDeliveredOnPreferred = useMemo(() => {
    let mx = 0;
    for (const row of heat) mx = Math.max(mx, row.deliveredCount ?? 0);
    return mx > 0 ? mx : 1;
  }, [heat]);

  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const startDow = first.getDay();
  const label = first.toLocaleString('en-NG', { month: 'long', year: 'numeric' });

  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < startDow; i++) cells.push({ day: null });
  for (let d = 1; d <= lastDay; d++) cells.push({ day: d });

  const toIso = (d: number) => `${yearMonth}-${pad2(d)}`;

  return (
    <div className="rounded-lg border border-app-border bg-app-elevated p-3 sm:p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onPrevMonth} aria-label="Previous month">
            ←
          </Button>
          <h3 className="text-sm font-semibold text-app-fg tabular-nums">{label}</h3>
          <Button type="button" variant="secondary" size="sm" onClick={onNextMonth} aria-label="Next month">
            →
          </Button>
        </div>
        {onClickModeChange ? (
          <div className="flex flex-col gap-1 sm:max-w-xs sm:flex-1">
            <span className="text-xs text-app-fg-muted">Click day applies to</span>
            <FormSelect
              aria-label="Calendar click mode"
              value={clickMode}
              onChange={(e) => onClickModeChange(e.target.value === 'callback' ? 'callback' : 'delivery')}
              options={[
                { value: 'delivery', label: 'Deliveries (preferred date)' },
                { value: 'callback', label: 'Callbacks (Lagos day)' },
              ]}
              wrapperClassName="w-full"
            />
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-micro font-medium uppercase tracking-wide text-app-fg-muted sm:text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (cell.day == null) {
            return <div key={`e-${idx}`} className="aspect-square min-h-[2rem]" />;
          }
          const iso = toIso(cell.day);
          const counts = heatMap.get(iso);
          const cb = counts?.callbackCount ?? 0;
          const del = counts?.deliveryCount ?? 0;
          const deliveredOnPreferred = counts?.deliveredCount ?? 0;
          const total = cb + del;
          const step = total <= 0 ? 0 : Math.min(5, Math.ceil((total / maxTotal) * 5));
          const deliveredStep =
            deliveredOnPreferred <= 0
              ? 0
              : Math.min(5, Math.ceil((deliveredOnPreferred / maxDeliveredOnPreferred) * 5));
          const heatClass =
            deliveredOnPreferred > 0 ? DELIVERED_HEAT_STEPS[deliveredStep] : HEAT_STEPS[step];
          const isSelected = selectedDate === iso;
          const title =
            deliveredOnPreferred > 0
              ? `Callbacks: ${cb} · Deliveries: ${del} (${deliveredOnPreferred} delivered on preferred date)${
                  total ? '' : ' (no scheduled load)'
                }`
              : `Callbacks: ${cb} · Deliveries: ${del}${total ? '' : ' (no scheduled load)'}`;
          return (
            <button
              key={iso}
              type="button"
              title={title}
              aria-label={`${iso}: ${title}`}
              onClick={() => onSelectDay(iso)}
              className={[
                'flex aspect-square min-h-[2rem] flex-col items-center justify-center gap-0.5 rounded-md border text-xs font-medium leading-none transition-colors',
                'border-app-border hover:border-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500',
                heatClass || 'bg-app-hover/40 dark:bg-app-hover/25',
                isSelected ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-app-elevated' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="tabular-nums text-app-fg">{cell.day}</span>
              {total > 0 ? (
                <span className="tabular-nums text-2xs font-normal text-app-fg-muted sm:text-micro" aria-hidden>
                  {total}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
