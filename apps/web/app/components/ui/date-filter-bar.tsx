import { useState, useEffect, useRef } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DateInput } from '~/components/ui/date-input';
import { useSearchParams, useNavigation, useLocation } from '@remix-run/react';

export interface DateFilterBarProps {
  startDate?: string;
  endDate?: string;
  /**
   * Optional `HH:MM` portion of the start cutoff. When present, paired with
   * `startDate` it represents a precise moment instead of whole-day "00:00".
   * Loaders that want time precision read `startTime` from search params and
   * concatenate `${startDate}T${startTime}` into a Date. Loaders that don't
   * care simply ignore this param — the start-of-day default still works.
   */
  startTime?: string;
  /** Same as `startTime`, but for the end cutoff. */
  endTime?: string;
  periodAllTime?: boolean;
  /**
   * `inline` — compact text control (default).
   * `blockCenter` — full-width row with icon + label centered (e.g. mobile sheet next to full-width buttons).
   */
  triggerLayout?: 'inline' | 'blockCenter';
}

/** Stable fingerprint of date-related query params (ignores page, sort, etc.). */
function dateFilterSearchSignature(sp: URLSearchParams): string {
  if (sp.get('period') === 'all_time') return 'all_time';
  return `range:${sp.get('startDate') ?? ''}:${sp.get('endDate') ?? ''}:${sp.get('startTime') ?? ''}:${sp.get('endTime') ?? ''}`;
}

/** HH:MM regex — accepts "00:00" through "23:59" (both 1-digit and 2-digit). */
function isValidHHMM(t: string): boolean {
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(t);
}

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function formatPeriodLabel(
  startDate: string,
  endDate: string,
  periodAllTime: boolean,
  startTime: string = '',
  endTime: string = '',
): string {
  if (periodAllTime) return 'All time';
  if (!startDate || !endDate) return 'This month';
  const hasTime = !!startTime || !!endTime;
  // When time is part of the filter, presets ("Today", "This month") no longer
  // describe what the user actually picked — fall through to the explicit
  // "from–to" rendering below.
  const now = new Date();
  const today = toYMD(now);
  if (!hasTime && startDate === endDate) {
    if (startDate === today) return 'Today';
    const yesterday = toYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    if (startDate === yesterday) return 'Yesterday';
    return new Date(startDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Preset matching only applies to whole-day ranges (no time refinement).
  if (!hasTime) {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() + mondayOffset);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    const lastWeekStart = toYMD(lastMonday);
    const lastWeekEnd = toYMD(lastSunday);
    if (startDate === lastWeekStart && endDate === lastWeekEnd) return 'Last week';
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (startDate === toYMD(firstOfMonth) && endDate === toYMD(lastOfMonth)) return 'This month';
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    if (startDate === toYMD(firstOfLastMonth) && endDate === toYMD(lastOfLastMonth)) return 'Last month';
  }
  const s = new Date(startDate);
  const e = new Date(endDate);
  const startBit = `${s.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}${startTime ? ` ${startTime}` : ''}`;
  const endBit = `${e.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}${endTime ? ` ${endTime}` : ''}`;
  return `${startBit} – ${endBit}`;
}

type DatePreset = 'today' | 'yesterday' | 'last_week' | 'this_month' | 'last_month';

type DraftSelectionId = DatePreset | 'all_time' | 'custom' | null;

/** Which preset (if any) matches the current modal draft — drives active highlighting. */
function getActiveDraftSelectionId(
  draftStart: string,
  draftEnd: string,
  draftPeriodAllTime: boolean
): DraftSelectionId {
  if (draftPeriodAllTime) return 'all_time';
  if (!draftStart && !draftEnd) return null;
  if (!draftStart || !draftEnd) return 'custom';
  const presets: DatePreset[] = ['today', 'yesterday', 'last_week', 'this_month', 'last_month'];
  for (const p of presets) {
    const { startDate, endDate } = getPresetRange(p);
    if (draftStart === startDate && draftEnd === endDate) return p;
  }
  return 'custom';
}

function getPresetRange(preset: DatePreset): { startDate: string; endDate: string } {
  const now = new Date();
  const today = toYMD(now);

  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'yesterday': {
      const d = new Date(now);
      d.setDate(now.getDate() - 1);
      const ymd = toYMD(d);
      return { startDate: ymd, endDate: ymd };
    }
    case 'last_week': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() + mondayOffset);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      return { startDate: toYMD(lastMonday), endDate: toYMD(lastSunday) };
    }
    case 'this_month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startDate: toYMD(first), endDate: toYMD(last) };
    }
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: toYMD(first), endDate: toYMD(last) };
    }
    default:
      return { startDate: today, endDate: today };
  }
}

export function DateFilterBar({
  startDate = '',
  endDate = '',
  startTime = '',
  endTime = '',
  periodAllTime = false,
  triggerLayout = 'inline',
}: DateFilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Signature we expect in `location.search` after `setSearchParams` commits (avoids closing on premature `idle` with ancestor `defer`). */
  const pendingSignatureRef = useRef<string | null>(null);

  // Draft state used only inside the modal; applied to URL only on Done
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [draftStartTime, setDraftStartTime] = useState(startTime);
  const [draftEndTime, setDraftEndTime] = useState(endTime);
  const [draftPeriodAllTime, setDraftPeriodAllTime] = useState(periodAllTime);

  // When modal opens, init draft from current props (URL state)
  useEffect(() => {
    if (modalOpen) {
      setDraftStart(startDate);
      setDraftEnd(endDate);
      setDraftStartTime(startTime);
      setDraftEndTime(endTime);
      setDraftPeriodAllTime(periodAllTime);
    }
  }, [modalOpen, startDate, endDate, startTime, endTime, periodAllTime]);

  // Close only once the URL reflects the applied filter and Remix has finished this transition.
  // Do not key off `navigation.state === 'idle'` alone: layouts using `defer()` can go idle before
  // the child route loader / page data the user cares about has settled.
  useEffect(() => {
    const pending = pendingSignatureRef.current;
    if (!isSubmitting || !pending || navigation.state !== 'idle') return;
    const actual = dateFilterSearchSignature(new URLSearchParams(location.search));
    if (actual !== pending) return;
    pendingSignatureRef.current = null;
    setIsSubmitting(false);
    setModalOpen(false);
  }, [isSubmitting, navigation.state, location.search]);

  const applyDraftToUrl = () => {
    const params = new URLSearchParams(searchParams);
    // Time is always allowed when a date range is set; the URL only carries it if
    // the user actually typed a valid HH:MM. All-time period strips it entirely.
    const includeTime = !draftPeriodAllTime;
    const safeStartTime = includeTime && draftStartTime && isValidHHMM(draftStartTime) ? draftStartTime : '';
    const safeEndTime = includeTime && draftEndTime && isValidHHMM(draftEndTime) ? draftEndTime : '';
    if (draftPeriodAllTime) {
      params.delete('startDate');
      params.delete('endDate');
      params.delete('startTime');
      params.delete('endTime');
      params.set('period', 'all_time');
      pendingSignatureRef.current = 'all_time';
    } else {
      params.delete('period');
      if (draftStart) params.set('startDate', draftStart);
      else params.delete('startDate');
      if (draftEnd) params.set('endDate', draftEnd);
      else params.delete('endDate');
      if (safeStartTime) params.set('startTime', safeStartTime);
      else params.delete('startTime');
      if (safeEndTime) params.set('endTime', safeEndTime);
      else params.delete('endTime');
      pendingSignatureRef.current = `range:${draftStart}:${draftEnd}:${safeStartTime}:${safeEndTime}`;
    }
    params.set('page', '1');
    params.set('eligiblePage', '1');
    setSearchParams(params);
    setIsSubmitting(true);
  };

  const setDraftPreset = (preset: DatePreset | 'all_time') => {
    // Presets are whole-day by definition — clearing time keeps the displayed
    // label consistent ("Today" vs "Today 09:00–17:00").
    setDraftStartTime('');
    setDraftEndTime('');
    if (preset === 'all_time') {
      setDraftStart('');
      setDraftEnd('');
      setDraftPeriodAllTime(true);
    } else {
      const { startDate: s, endDate: e } = getPresetRange(preset);
      setDraftStart(s);
      setDraftEnd(e);
      setDraftPeriodAllTime(false);
    }
  };

  const setDraftCustomDate = (from: string, to: string) => {
    setDraftStart(from);
    setDraftEnd(to);
    setDraftPeriodAllTime(false);
  };

  const clearDraft = () => {
    setDraftStart('');
    setDraftEnd('');
    setDraftStartTime('');
    setDraftEndTime('');
    setDraftPeriodAllTime(false);
  };

  const closeModal = () => {
    if (!isSubmitting) setModalOpen(false);
  };

  const hasDraftDates = Boolean(draftStart || draftEnd || draftStartTime || draftEndTime) && !draftPeriodAllTime;
  const periodLabel = formatPeriodLabel(startDate, endDate, periodAllTime, startTime, endTime);
  const activeDraftId = getActiveDraftSelectionId(draftStart, draftEnd, draftPeriodAllTime);
  /** Custom date inputs are hidden by default. They auto-open if the current draft is
   *  already a non-preset range (e.g. user reopens the modal after picking custom dates),
   *  and they open when the user explicitly clicks the Custom preset button. */
  const [customOpen, setCustomOpen] = useState(false);
  useEffect(() => {
    if (modalOpen) {
      setCustomOpen(activeDraftId === 'custom');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  const triggerClassName =
    triggerLayout === 'blockCenter'
      ? 'flex w-full min-w-0 items-center justify-center gap-1.5 text-xs text-app-fg-muted hover:text-app-fg transition-colors'
      : 'inline-flex items-center gap-1.5 text-xs text-app-fg-muted hover:text-app-fg-muted hover:text-app-fg transition-colors';

  return (
    <>
      <button type="button" onClick={() => setModalOpen(true)} className={triggerClassName}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span>{periodLabel}</span>
      </button>

      {modalOpen && (
        <Modal open onClose={closeModal} maxWidth="max-w-sm" backdropBlur contentClassName="flex flex-col gap-4 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-app-fg">Filter by date</h3>
                <button
                  type="button"
                  onClick={closeModal}
                  className="text-app-fg-muted hover:text-app-fg p-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'today' as const, label: 'Today' },
                    { id: 'yesterday' as const, label: 'Yesterday' },
                    { id: 'last_week' as const, label: 'Last week' },
                    { id: 'this_month' as const, label: 'This month' },
                    { id: 'last_month' as const, label: 'Last month' },
                    { id: 'all_time' as const, label: 'All time' },
                  ] as const
                ).map(({ id, label }) => {
                  const isActive = id === 'all_time' ? activeDraftId === 'all_time' : activeDraftId === id;
                  return (
                    <Button
                      key={id}
                      type="button"
                      variant="secondary"
                      size="md"
                      aria-pressed={isActive}
                      className={
                        isActive
                          ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-app-canvas bg-brand-500/10 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                          : ''
                      }
                      onClick={() => {
                        setDraftPreset(id);
                        setCustomOpen(false);
                      }}
                    >
                      {label}
                    </Button>
                  );
                })}
                {/* Custom — toggles the calendar/date inputs below. Hidden by default
                    so the modal opens compact (presets only); the calendar appears
                    only after the user explicitly initiates it. */}
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  aria-pressed={customOpen || activeDraftId === 'custom'}
                  className={
                    customOpen || activeDraftId === 'custom'
                      ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-app-canvas bg-brand-500/10 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                      : ''
                  }
                  onClick={() => setCustomOpen((v) => !v)}
                >
                  Custom…
                </Button>
              </div>
              {customOpen && (
                <div className="flex flex-col gap-3 p-1">
                  <h4 className="text-xs font-medium text-app-fg-muted">Custom date</h4>
                  <div>
                    <label className="block text-xs font-medium text-app-fg-muted mb-1">From</label>
                    <div className="flex gap-2">
                      <DateInput
                        kind="date"
                        value={draftStart}
                        onChange={(e) => setDraftCustomDate(e.target.value, draftEnd)}
                        wrapperClassName="flex-1 min-w-0"
                        disabled={draftPeriodAllTime}
                      />
                      <DateInput
                        kind="time"
                        value={draftStartTime}
                        onChange={(e) => setDraftStartTime(e.target.value)}
                        wrapperClassName="w-28"
                        disabled={draftPeriodAllTime}
                        aria-label="Start time"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-fg-muted mb-1">To</label>
                    <div className="flex gap-2">
                      <DateInput
                        kind="date"
                        value={draftEnd}
                        onChange={(e) => setDraftCustomDate(draftStart, e.target.value)}
                        wrapperClassName="flex-1 min-w-0"
                        disabled={draftPeriodAllTime}
                      />
                      <DateInput
                        kind="time"
                        value={draftEndTime}
                        onChange={(e) => setDraftEndTime(e.target.value)}
                        wrapperClassName="w-28"
                        disabled={draftPeriodAllTime}
                        aria-label="End time"
                      />
                    </div>
                  </div>
                  <p className="text-mini text-app-fg-muted">
                    Time is optional. Leave blank for whole-day filters; pages that read time narrow to the exact window.
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2">
                {(hasDraftDates || draftPeriodAllTime) && (
                  <Button type="button" variant="secondary" size="md" className="flex-1" onClick={clearDraft}>
                    Clear
                  </Button>
                )}
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  className="flex-1"
                  onClick={applyDraftToUrl}
                  loading={isSubmitting}
                  loadingText="Applying..."
                >
                  Done
                </Button>
              </div>
        </Modal>
      )}
    </>
  );
}
