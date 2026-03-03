import { useState } from 'react';
import { useSearchParams } from '@remix-run/react';

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
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (startDate === endDate) return s.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function getPresetRange(preset: 'today' | 'this_week' | 'this_month' | 'this_quarter'): { startDate: string; endDate: string } {
  const now = new Date();
  const today = toYMD(now);

  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'this_week': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { startDate: toYMD(monday), endDate: toYMD(sunday) };
    }
    case 'this_month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startDate: toYMD(first), endDate: toYMD(last) };
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3) + 1;
      const startMonth = (q - 1) * 3;
      const first = new Date(now.getFullYear(), startMonth, 1);
      const last = new Date(now.getFullYear(), startMonth + 3, 0);
      return { startDate: toYMD(first), endDate: toYMD(last) };
    }
    default:
      return { startDate: today, endDate: today };
  }
}

export function DateFilterBar({ startDate = '', endDate = '', periodAllTime = false }: DateFilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);

  const applyPreset = (preset: 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'all_time') => {
    const params = new URLSearchParams(searchParams);
    if (preset === 'all_time') {
      params.delete('startDate');
      params.delete('endDate');
      params.set('period', 'all_time');
    } else {
      params.delete('period');
      const { startDate: s, endDate: e } = getPresetRange(preset);
      params.set('startDate', s);
      params.set('endDate', e);
    }
    setSearchParams(params);
  };

  const handleCustomDate = (from: string, to: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete('period');
    if (from) params.set('startDate', from);
    else params.delete('startDate');
    if (to) params.set('endDate', to);
    else params.delete('endDate');
    setSearchParams(params);
  };

  const clearDates = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('startDate');
    params.delete('endDate');
    params.delete('period');
    setSearchParams(params);
  };

  const hasDates = Boolean(startDate || endDate) && !periodAllTime;
  const periodLabel = formatPeriodLabel(startDate, endDate, periodAllTime);

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span>{periodLabel}</span>
      </button>

      {modalOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
            <div
              className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-sm w-full p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Filter by date</h3>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 p-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['today', 'this_week', 'this_month', 'this_quarter', 'all_time'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="btn-secondary btn-sm text-xs"
                  >
                    {preset === 'all_time' ? 'All Time' : preset.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-surface-800 dark:text-surface-400 mb-1">From</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => handleCustomDate(e.target.value, endDate)}
                    className="input text-sm w-full"
                    disabled={periodAllTime}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-800 dark:text-surface-400 mb-1">To</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => handleCustomDate(startDate, e.target.value)}
                    className="input text-sm w-full"
                    disabled={periodAllTime}
                  />
                </div>
              </div>
              {(hasDates || periodAllTime) && (
                <button type="button" onClick={clearDates} className="btn-secondary btn-sm text-xs w-full">
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="btn-primary btn-sm w-full"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
