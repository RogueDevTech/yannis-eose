import { useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { getCompareMetricOptions } from './compare-metrics';

/**
 * Reusable "Compare" entry point. Drop into any page's header actions:
 *
 *   <CompareButton source="marketing-analytics" />
 *
 * Opens a picker (granularity + two points) and navigates to
 * /admin/compare?source=<source>&granularity=<g>&a=<tokenA>&b=<tokenB>.
 * The compare page (source-agnostic) fetches + renders the comparison.
 *
 * Client-only by design — it holds NO server imports, so the source is passed as
 * a plain key string that the compare route resolves against the registry.
 */

type Granularity = 'day' | 'month';

const GRANULARITY_OPTIONS = [
  { value: 'month', label: 'Month vs month' },
  { value: 'day', label: 'Day vs day' },
];

/** Current YYYY-MM-DD and YYYY-MM defaults for the initial picker state. */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function thisMonthToken(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function CompareButton({
  source,
  label = 'Compare',
  variant = 'secondary',
  size = 'sm',
}: {
  source: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [pointA, setPointA] = useState(thisMonthToken());
  const [pointB, setPointB] = useState(thisMonthToken());
  // Optional per-period time window (HH:MM). Blank = full day/month (00:00–23:59).
  // Applies to both granularities: for month, it's the time on the 1st/last day.
  const [timeAFrom, setTimeAFrom] = useState('');
  const [timeATo, setTimeATo] = useState('');
  const [timeBFrom, setTimeBFrom] = useState('');
  const [timeBTo, setTimeBTo] = useState('');

  // Which metrics to include — all on by default. Empty selection = compare all.
  const metricOptions = getCompareMetricOptions(source);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(
    () => new Set(metricOptions.map((m) => m.key)),
  );

  function toggleMetric(key: string) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // When granularity flips, reset the two points to sensible defaults for that
  // kind so the native inputs stay valid (month token vs full date).
  function changeGranularity(next: Granularity) {
    setGranularity(next);
    if (next === 'day') {
      setPointA(todayYmd());
      setPointB(todayYmd());
    } else {
      setPointA(thisMonthToken());
      setPointB(thisMonthToken());
    }
  }

  const bothChosen = !!pointA && !!pointB;
  // Two periods are "the same" only when BOTH the date token AND the time window
  // match — so yesterday-morning vs yesterday-afternoon is a valid comparison.
  const sameChoice =
    pointA === pointB && timeAFrom === timeBFrom && timeATo === timeBTo;
  const noMetrics = metricOptions.length > 0 && selectedMetrics.size === 0;
  const allMetrics = selectedMetrics.size === metricOptions.length;
  // A time window is invalid if only one end is set, or from >= to.
  const badTime = (from: string, to: string) =>
    (!!from !== !!to) || (!!from && !!to && from >= to);
  const timeInvalid = badTime(timeAFrom, timeATo) || badTime(timeBFrom, timeBTo);

  function submit() {
    if (!bothChosen || sameChoice || noMetrics || timeInvalid) return;
    const params = new URLSearchParams({
      source,
      granularity,
      a: pointA,
      b: pointB,
    });
    // Per-period time window (HH:MM). Only sent when both ends are set.
    if (timeAFrom && timeATo) { params.set('aFrom', timeAFrom); params.set('aTo', timeATo); }
    if (timeBFrom && timeBTo) { params.set('bFrom', timeBFrom); params.set('bTo', timeBTo); }
    // Only send `metrics` when it's a real subset — omit when all are selected so
    // the URL stays clean and the compare page defaults to every metric.
    if (metricOptions.length > 0 && !allMetrics) {
      params.set(
        'metrics',
        metricOptions.filter((m) => selectedMetrics.has(m.key)).map((m) => m.key).join(','),
      );
    }
    setOpen(false);
    navigate(`/admin/compare?${params.toString()}`);
  }

  const inputType = granularity === 'day' ? 'date' : 'month';

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidth="max-w-md" contentClassName="p-5">
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-app-fg">Compare periods</h3>
            <p className="mt-0.5 text-xs text-app-fg-muted">
              Pick what to compare, then choose the two periods.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg-muted">Compare by</label>
            <FormSelect
              value={granularity}
              onChange={(e) => changeGranularity(e.target.value as Granularity)}
              options={GRANULARITY_OPTIONS}
              openAs="modal"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-app-fg-muted">
                {granularity === 'day' ? 'First day' : 'First month'}
              </label>
              <TextInput
                type={inputType}
                value={pointA}
                onChange={(e) => setPointA(e.target.value)}
                max={pointB || undefined}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-app-fg-muted">
                {granularity === 'day' ? 'Second day' : 'Second month'}
              </label>
              <TextInput
                type={inputType}
                value={pointB}
                onChange={(e) => setPointB(e.target.value)}
              />
            </div>
          </div>

          {/* Optional time window per period. Blank = full day/month. Applies to
              both granularities (for month, it's the time on the 1st / last day). */}
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg-muted">
              Time window <span className="text-2xs font-normal text-app-fg-muted">(optional; leave blank for full day)</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-1.5">
                <TextInput type="time" value={timeAFrom} onChange={(e) => setTimeAFrom(e.target.value)} aria-label="First period from time" />
                <span className="text-xs text-app-fg-muted">to</span>
                <TextInput type="time" value={timeATo} onChange={(e) => setTimeATo(e.target.value)} aria-label="First period to time" />
              </div>
              <div className="flex items-center gap-1.5">
                <TextInput type="time" value={timeBFrom} onChange={(e) => setTimeBFrom(e.target.value)} aria-label="Second period from time" />
                <span className="text-xs text-app-fg-muted">to</span>
                <TextInput type="time" value={timeBTo} onChange={(e) => setTimeBTo(e.target.value)} aria-label="Second period to time" />
              </div>
            </div>
          </div>

          {metricOptions.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium text-app-fg-muted">Metrics to compare</label>
                <button
                  type="button"
                  className="text-2xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  onClick={() =>
                    setSelectedMetrics(
                      allMetrics ? new Set() : new Set(metricOptions.map((m) => m.key)),
                    )
                  }
                >
                  {allMetrics ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-app-border p-2 max-h-44 overflow-y-auto">
                {metricOptions.map((m) => (
                  <label
                    key={m.key}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-app-hover cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMetrics.has(m.key)}
                      onChange={() => toggleMetric(m.key)}
                      className="rounded border-app-border"
                    />
                    <span className="text-app-fg truncate">{m.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {sameChoice && bothChosen ? (
            <p className="text-2xs text-warning-700 dark:text-warning-300">
              Pick two different {granularity === 'day' ? 'days' : 'months'} to compare.
            </p>
          ) : null}
          {noMetrics ? (
            <p className="text-2xs text-warning-700 dark:text-warning-300">
              Select at least one metric to compare.
            </p>
          ) : null}
          {timeInvalid ? (
            <p className="text-2xs text-warning-700 dark:text-warning-300">
              Set both a start and end time for a period, with the end after the start.
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={!bothChosen || sameChoice || noMetrics || timeInvalid}
            >
              Compare
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
