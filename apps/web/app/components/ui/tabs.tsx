import type { ReactNode } from 'react';

export interface TabItem {
  value: string;
  label: string;
  badge?: ReactNode;
}

export interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  tabs: TabItem[];
  variant?: 'underline' | 'pill';
  className?: string;
}

export function Tabs({ value, onChange, tabs, variant = 'underline', className = '' }: TabsProps) {
  if (variant === 'pill') {
    return (
      <div className={`flex rounded-lg bg-app-hover border border-app-border p-1 ${className}`.trim()}>
        {tabs.map((tab) => {
          const isActive = value === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                isActive
                  ? 'bg-white dark:bg-transparent text-app-fg shadow-sm border border-app-border'
                  : 'text-app-fg-muted hover:text-app-fg'
              }`}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`-mx-1 border-b border-app-border px-1 sm:mx-0 sm:px-0 ${className}`.trim()}>
      <nav
        className="-mb-px flex gap-4 overflow-x-auto pb-px [-webkit-overflow-scrolling:touch] scroll-pl-1 scroll-pr-1 sm:gap-6 sm:scroll-pl-0 sm:scroll-pr-0"
        aria-label="Tabs"
      >
        {tabs.map((tab) => {
          const isActive = value === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-app-fg-muted hover:text-app-fg'
              }`}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
