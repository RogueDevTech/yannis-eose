import { useState } from 'react';
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
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="shrink-0 p-1.5 rounded text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200 hover:bg-warning-100 dark:hover:bg-warning-800/30 transition-colors"
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
          <div
            className="mt-2 flex flex-nowrap gap-2 overflow-x-auto pb-1 -mx-1 px-1"
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
