import { useState, useEffect, useRef } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useSearchParams, useNavigation } from '@remix-run/react';

export interface DateFilterBarProps {
  startDate?: string;
  endDate?: string;
  periodAllTime?: boolean;
}

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function formatPeriodLabel(startDate: string, endDate: string, periodAllTime: boolean): string {
  if (periodAllTime) return 'All time';
  if (!startDate || !endDate) return 'This month';
  const now = new Date();
  const today = toYMD(now);
  if (startDate === endDate) {
    if (startDate === today) return 'Today';
    const yesterday = toYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    if (startDate === yesterday) return 'Yesterday';
    return new Date(startDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Check if range is "last week" (Mon–Sun of previous week)
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
  const s = new Date(startDate);
  const e = new Date(endDate);
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (startDate === toYMD(firstOfMonth) && endDate === toYMD(lastOfMonth)) return 'This month';
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  if (startDate === toYMD(firstOfLastMonth) && endDate === toYMD(lastOfLastMonth)) return 'Last month';
  return `${s.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

type DatePreset = 'today' | 'yesterday' | 'last_week' | 'this_month' | 'last_month';

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

export function DateFilterBar({ startDate = '', endDate = '', periodAllTime = false }: DateFilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [modalOpen, setModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasBeenLoadingRef = useRef(false);

  // Draft state used only inside the modal; applied to URL only on Done
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [draftPeriodAllTime, setDraftPeriodAllTime] = useState(periodAllTime);

  // When modal opens, init draft from current props (URL state)
  useEffect(() => {
    if (modalOpen) {
      setDraftStart(startDate);
      setDraftEnd(endDate);
      setDraftPeriodAllTime(periodAllTime);
    }
  }, [modalOpen, startDate, endDate, periodAllTime]);

  // When we submitted and navigation has finished (loading -> idle), close modal and clear loading
  useEffect(() => {
    if (navigation.state === 'loading') {
      hasBeenLoadingRef.current = true;
    }
    if (isSubmitting && hasBeenLoadingRef.current && navigation.state === 'idle') {
      hasBeenLoadingRef.current = false;
      setIsSubmitting(false);
      setModalOpen(false);
    }
  }, [isSubmitting, navigation.state]);

  // Fallback: if loader resolved before we saw 'loading' (e.g. cached), close after a short delay
  useEffect(() => {
    if (!isSubmitting) return;
    const t = setTimeout(() => {
      if (navigation.state === 'idle') {
        hasBeenLoadingRef.current = false;
        setIsSubmitting(false);
        setModalOpen(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [isSubmitting, navigation.state]);

  const applyDraftToUrl = () => {
    const params = new URLSearchParams(searchParams);
    if (draftPeriodAllTime) {
      params.delete('startDate');
      params.delete('endDate');
      params.set('period', 'all_time');
    } else {
      params.delete('period');
      if (draftStart) params.set('startDate', draftStart);
      else params.delete('startDate');
      if (draftEnd) params.set('endDate', draftEnd);
      else params.delete('endDate');
    }
    setSearchParams(params);
    setIsSubmitting(true);
  };

  const setDraftPreset = (preset: DatePreset | 'all_time') => {
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
    setDraftPeriodAllTime(false);
  };

  const closeModal = () => {
    if (!isSubmitting) setModalOpen(false);
  };

  const hasDraftDates = Boolean(draftStart || draftEnd) && !draftPeriodAllTime;
  const periodLabel = formatPeriodLabel(startDate, endDate, periodAllTime);

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-app-fg-muted hover:text-app-fg-muted hover:text-app-fg transition-colors"
      >
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
                ).map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => setDraftPreset(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-medium text-app-fg-muted">Custom date</h4>
                <div>
                  <label className="block text-xs font-medium text-app-fg-muted mb-1">From</label>
                  <input
                    type="date"
                    value={draftStart}
                    onChange={(e) => setDraftCustomDate(e.target.value, draftEnd)}
                    className="input text-sm w-full"
                    disabled={draftPeriodAllTime}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-app-fg-muted mb-1">To</label>
                  <input
                    type="date"
                    value={draftEnd}
                    onChange={(e) => setDraftCustomDate(draftStart, e.target.value)}
                    className="input text-sm w-full"
                    disabled={draftPeriodAllTime}
                  />
                </div>
              </div>
              {(hasDraftDates || draftPeriodAllTime) && (
                <Button type="button" variant="secondary" size="md" className="w-full" onClick={clearDraft}>
                  Clear
                </Button>
              )}
              <Button
                type="button"
                variant="primary"
                size="md"
                className="w-full"
                onClick={applyDraftToUrl}
                loading={isSubmitting}
                loadingText="Applying..."
              >
                Done
              </Button>
        </Modal>
      )}
    </>
  );
}
