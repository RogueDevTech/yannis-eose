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
      <div className={`flex rounded-lg bg-surface-100 dark:bg-surface-800 p-1 ${className}`.trim()}>
        {tabs.map((tab) => {
          const isActive = value === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                isActive
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                  : 'text-surface-800 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'
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
    <div className={`border-b border-surface-200 dark:border-surface-700 ${className}`.trim()}>
      <nav className="flex gap-6 overflow-x-auto -mb-px" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = value === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              className={`whitespace-nowrap pb-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'
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
