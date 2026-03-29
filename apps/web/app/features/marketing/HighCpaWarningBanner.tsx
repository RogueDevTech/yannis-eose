import { useCallback, useRef, useState } from 'react';
import { Link } from '@remix-run/react';

export interface HighCpaBuyer {
  mediaBuyerId: string;
  name: string;
  cpa: number;
}

interface HighCpaWarningBannerProps {
  buyers: HighCpaBuyer[];
  threshold: number;
}

export function HighCpaWarningBanner({ buyers, threshold }: HighCpaWarningBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const chipsScrollRef = useRef<HTMLDivElement>(null);
  const scrollChips = useCallback((delta: number) => {
    chipsScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  if (buyers.length === 0 || dismissed) return null;

  const sorted = [...buyers].sort((a, b) => b.cpa - a.cpa);

  return (
    <div className="relative rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3">
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 text-warning-500 mt-0.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-warning-800 dark:text-warning-300">
                High CPA Warning
              </p>
              <p className="text-xs text-warning-600 dark:text-warning-400 mt-0.5">
                {buyers.length} media buyer{buyers.length !== 1 ? 's' : ''} exceed the threshold of
                ₦{threshold.toLocaleString()}. Review ad performance.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                onClick={() => scrollChips(-220)}
                className="p-1 sm:p-1.5 rounded border border-warning-300/70 dark:border-warning-600/60 text-warning-700 dark:text-warning-300 hover:bg-warning-100 dark:hover:bg-warning-800/40 transition-colors flex items-center justify-center"
                aria-label="Scroll buyers left"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scrollChips(220)}
                className="p-1 sm:p-1.5 rounded border border-warning-300/70 dark:border-warning-600/60 text-warning-700 dark:text-warning-300 hover:bg-warning-100 dark:hover:bg-warning-800/40 transition-colors flex items-center justify-center"
                aria-label="Scroll buyers right"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="p-1.5 rounded text-app-fg-muted hover:text-app-fg hover:bg-warning-100 dark:hover:bg-warning-800/30 transition-colors"
                aria-label="Dismiss"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div
            ref={chipsScrollRef}
            className="mt-2 flex flex-nowrap gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1"
            role="list"
          >
            {sorted.map((b) => (
              <Link
                key={b.mediaBuyerId}
                to={`/hr/users/${b.mediaBuyerId}`}
                prefetch="intent"
                className="shrink-0 min-w-[6.5rem] w-[7rem] rounded-md bg-warning-100/80 dark:bg-warning-800/30 border border-warning-200 dark:border-warning-600/50 px-2.5 py-2 text-xs block hover:bg-warning-200/80 dark:hover:bg-warning-700/40 transition-colors"
                role="listitem"
              >
                <p className="font-medium text-warning-800 dark:text-warning-200 truncate">
                  {b.name}
                </p>
                <p className="mt-0.5 font-mono tabular-nums text-warning-700 dark:text-warning-300">
                  ₦{Math.round(b.cpa).toLocaleString()}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
