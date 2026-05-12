import type { ReactNode } from 'react';
import { Link } from '@remix-run/react';

export interface TabItem {
  value: string;
  label: string;
  badge?: ReactNode;
  /** When provided, tab renders as a Link (route navigation) instead of a button (in-page tab switch). */
  to?: string;
}

export interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  /** When only one tab applies (e.g. role-gated views), the nav strip is omitted — callers still drive content from `value`. */
  tabs: TabItem[];
  variant?: 'underline' | 'pill';
  /** 'md' (default) — text-sm/pb-2.5/gap-6. 'sm' — text-xs/pb-1.5/gap-4 for dense pages. */
  size?: 'sm' | 'md';
  className?: string;
}

export function Tabs({ value, onChange, tabs, variant = 'underline', size = 'md', className = '' }: TabsProps) {
  if (tabs.length <= 1) {
    return null;
  }

  if (variant === 'pill') {
    return (
      <div className={`min-w-0 w-full ${className}`.trim()}>
        <div className="-mx-1 overflow-x-auto overflow-y-hidden scrollbar-hide px-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0">
          <div className="flex min-w-full w-max rounded-lg border border-app-border bg-app-hover p-1">
            {tabs.map((tab) => {
              const isActive = value === tab.value;
              const content = (
                <>
                  {tab.label}
                  {tab.badge}
                </>
              );
              return tab.to ? (
                <Link
                  key={tab.value}
                  to={tab.to}
                  prefetch="intent"
                  className={`flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors sm:flex-1 ${
                    isActive
                      ? 'bg-white dark:bg-transparent text-app-fg shadow-sm border border-app-border'
                      : 'text-app-fg-muted hover:text-app-fg'
                  }`}
                >
                  {content}
                </Link>
              ) : (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => onChange(tab.value)}
                  className={`flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors sm:flex-1 ${
                    isActive
                      ? 'bg-white dark:bg-transparent text-app-fg shadow-sm border border-app-border'
                      : 'text-app-fg-muted hover:text-app-fg'
                  }`}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const navGap = size === 'sm' ? 'gap-3 sm:gap-4' : 'gap-4 sm:gap-6';
  const tabClass =
    size === 'sm'
      ? 'flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 pb-1.5 text-xs font-medium transition-colors'
      : 'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium transition-colors';

  return (
    <div className={`min-w-0 w-full -mx-1 border-b border-app-border px-1 sm:mx-0 sm:px-0 ${className}`.trim()}>
      <nav
        className={`-mb-px flex ${navGap} overflow-x-auto overflow-y-hidden scrollbar-hide pb-px [-webkit-overflow-scrolling:touch] scroll-pl-1 scroll-pr-1 sm:scroll-pl-0 sm:scroll-pr-0`}
        aria-label="Tabs"
      >
        {tabs.map((tab) => {
          const isActive = value === tab.value;
          const content = (
            <>
              {tab.label}
              {tab.badge}
            </>
          );
          return (
            tab.to ? (
              <Link
                key={tab.value}
                to={tab.to}
                prefetch="intent"
                className={`${tabClass} ${
                  isActive
                    ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                    : 'border-transparent text-app-fg-muted hover:text-app-fg'
                }`}
              >
                {content}
              </Link>
            ) : (
              <button
                key={tab.value}
                type="button"
                onClick={() => onChange(tab.value)}
                className={`${tabClass} ${
                  isActive
                    ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                    : 'border-transparent text-app-fg-muted hover:text-app-fg'
                }`}
              >
                {content}
              </button>
            )
          );
        })}
      </nav>
    </div>
  );
}
