/**
 * FilterPills — a row of toggle buttons for filtering.
 * Supports single-select and multi-select modes.
 *
 * Usage (single):
 *   <FilterPills options={[...]} value={status} onChange={setStatus} />
 *
 * Usage (multi):
 *   <FilterPills options={[...]} value={statuses} onChange={setStatuses} multiple />
 */

export interface FilterPillOption {
  value: string;
  label: string;
  count?: number;
  /** Dot color class (e.g. 'bg-success-500') */
  dotColor?: string;
}

interface FilterPillsSingleProps {
  options: FilterPillOption[];
  value: string;
  onChange: (value: string) => void;
  multiple?: false;
  /** 'pill' = rounded-full; 'tab' = underline style */
  variant?: 'pill' | 'tab';
  size?: 'sm' | 'md';
  name?: string;
  className?: string;
}

interface FilterPillsMultiProps {
  options: FilterPillOption[];
  value: string[];
  onChange: (value: string[]) => void;
  multiple: true;
  variant?: 'pill' | 'tab';
  size?: 'sm' | 'md';
  name?: string;
  className?: string;
}

type FilterPillsProps = FilterPillsSingleProps | FilterPillsMultiProps;

export function FilterPills(props: FilterPillsProps) {
  const { options, variant = 'pill', size = 'md', name, className = '' } = props;

  const sizeClass = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1' : 'h-8 px-3 text-sm gap-1.5';

  function isActive(val: string): boolean {
    if (props.multiple) return (props.value as string[]).includes(val);
    return (props.value as string) === val;
  }

  function handleClick(val: string) {
    if (props.multiple) {
      const current = props.value as string[];
      if (current.includes(val)) {
        props.onChange(current.filter((v) => v !== val));
      } else {
        props.onChange([...current, val]);
      }
    } else {
      (props as FilterPillsSingleProps).onChange(val);
    }
  }

  if (variant === 'tab') {
    return (
      <div
        className={['flex items-center gap-0 border-b border-app-border overflow-x-auto', className].filter(Boolean).join(' ')}
        role="group"
        aria-label={name}
      >
        {options.map((opt) => {
          const active = isActive(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleClick(opt.value)}
              className={[
                'flex shrink-0 items-center whitespace-nowrap border-b-2 font-medium transition-colors',
                sizeClass,
                active
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-app-fg-muted hover:text-app-fg hover:border-app-border-strong',
              ].join(' ')}
              aria-pressed={active}
            >
              {opt.dotColor && (
                <span className={['w-1.5 h-1.5 rounded-full shrink-0', opt.dotColor].join(' ')} />
              )}
              {opt.label}
              {opt.count !== undefined && (
                <span
                  className={[
                    'rounded-full px-1.5 py-0.5 text-2xs font-semibold',
                    active
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                      : 'bg-surface-200 text-surface-500 dark:bg-surface-700 dark:text-surface-400',
                  ].join(' ')}
                >
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // pill variant
  return (
    <div
      className={['flex flex-wrap items-center gap-1.5', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={name}
    >
      {options.map((opt) => {
        const active = isActive(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleClick(opt.value)}
            className={[
              'inline-flex items-center rounded-full font-medium whitespace-nowrap transition-colors',
              sizeClass,
              active
                ? 'bg-brand-500 text-white'
                : 'bg-app-elevated text-app-fg hover:bg-app-hover border border-app-border',
            ].join(' ')}
            aria-pressed={active}
          >
            {opt.dotColor && (
              <span className={['w-1.5 h-1.5 rounded-full shrink-0', opt.dotColor].join(' ')} />
            )}
            {opt.label}
            {opt.count !== undefined && (
              <span
                className={[
                  'rounded-full px-1 text-2xs font-bold',
                  active
                    ? 'bg-white/20 text-white'
                    : 'bg-surface-200 text-surface-500 dark:bg-surface-700 dark:text-surface-400',
                ].join(' ')}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
