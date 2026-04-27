import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type SearchableSelectSize = 'sm' | 'md' | 'lg';

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  leading?: React.ReactNode;
}

interface SearchableSelectProps {
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  controlSize?: SearchableSelectSize;
  wrapperClassName?: string;
  filterFn?: (opt: SearchableSelectOption, query: string) => boolean;
}

const sizeClasses: Record<SearchableSelectSize, string> = {
  sm: 'h-8 px-2.5 pr-7 text-xs',
  md: 'h-9 px-3 pr-8 text-sm',
  lg: 'h-10 px-3.5 pr-9 text-base',
};

const chevronSizeClasses: Record<SearchableSelectSize, string> = {
  sm: 'right-2 w-3 h-3',
  md: 'right-2.5 w-3.5 h-3.5',
  lg: 'right-3 w-4 h-4',
};

function defaultFilter(option: SearchableSelectOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${option.label} ${option.description ?? ''}`.toLowerCase().includes(q);
}

export function SearchableSelect({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results',
  disabled = false,
  required = false,
  controlSize = 'md',
  wrapperClassName = '',
  filterFn,
}: SearchableSelectProps) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const listboxId = inputId ? `${inputId}-listbox` : 'searchable-select-listbox';
  const hasError = Boolean(error);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = options.find((o) => o.value === value);
  const effectiveFilter = filterFn ?? defaultFilter;
  const filtered = useMemo(
    () => options.filter((opt) => effectiveFilter(opt, query)),
    [options, query, effectiveFilter],
  );
  const firstEnabled = filtered.findIndex((o) => !o.disabled);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(firstEnabled);
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, firstEnabled]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll, true);
    };
  }, [open]);

  /** Keep keyboard-highlighted option visible; listbox uses its own scroll container. */
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = document.getElementById(`${listboxId}-opt-${activeIndex}`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, activeIndex, filtered, listboxId]);

  const forwardWheelToListbox = (e: React.WheelEvent) => {
    const lb = listboxRef.current;
    if (!lb || filtered.length === 0) return;
    const { scrollTop, scrollHeight, clientHeight } = lb;
    const delta = e.deltaY;
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
    if (delta < 0 && atTop) return;
    if (delta > 0 && atBottom) return;
    e.preventDefault();
    e.stopPropagation();
    lb.scrollTop += delta;
  };

  const move = (dir: 1 | -1) => {
    if (filtered.length === 0) return;
    let idx = activeIndex;
    for (let i = 0; i < filtered.length; i += 1) {
      idx = (idx + dir + filtered.length) % filtered.length;
      if (!filtered[idx]?.disabled) {
        setActiveIndex(idx);
        return;
      }
    }
  };

  const selectAt = (idx: number) => {
    const option = filtered[idx];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const triggerClass = [
    'w-full appearance-none rounded-lg border transition-colors text-left',
    'bg-app-canvas text-app-fg',
    'border-app-border focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
    disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
    hasError ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500' : '',
    sizeClasses[controlSize],
  ].filter(Boolean).join(' ');

  return (
    <div className={['flex flex-col gap-1', wrapperClassName].filter(Boolean).join(' ')}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-app-fg-muted">
          {label}
          {required && <span className="ml-0.5 text-danger-500">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          ref={triggerRef}
          id={inputId}
          type="button"
          className={triggerClass}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
        >
          {selected?.label ?? placeholder}
        </button>
        <span
          className={[
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-app-fg-muted',
            chevronSizeClasses[controlSize],
          ].join(' ')}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </div>

      {(error || hint) && (
        <p className={['text-xs', hasError ? 'text-danger-500' : 'text-app-fg-muted'].join(' ')}>
          {error ?? hint}
        </p>
      )}

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] flex max-h-[min(24rem,calc(100dvh-1rem))] flex-col rounded-lg border border-app-border bg-app-elevated shadow-lg p-2"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(filtered.findIndex((o) => !o.disabled));
            }}
            placeholder={searchPlaceholder}
            className="mb-2 h-8 w-full shrink-0 rounded-md border border-app-border bg-app-canvas px-2 text-sm text-app-fg placeholder:text-app-fg-muted focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
            onWheel={forwardWheelToListbox}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                selectAt(activeIndex);
              } else if (e.key === 'Escape' || e.key === 'Tab') {
                setOpen(false);
              }
            }}
            role="combobox"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
          />

          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            className={[
              'min-w-0 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y',
              filtered.length === 0 ? 'max-h-40 shrink-0' : 'min-h-0 max-h-56 flex-1',
            ].join(' ')}
          >
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-app-fg-muted">{emptyText}</p>
            ) : (
              filtered.map((opt, idx) => (
                <button
                  key={`${listboxId}-${idx}-${opt.value}`}
                  id={`${listboxId}-opt-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  aria-disabled={opt.disabled}
                  disabled={opt.disabled}
                  className={[
                    'w-full text-left px-2 py-1.5 rounded-md transition-colors',
                    idx === activeIndex ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-app-hover',
                    opt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                  ].join(' ')}
                  onMouseEnter={() => !opt.disabled && setActiveIndex(idx)}
                  onClick={() => selectAt(idx)}
                >
                  <div className="flex items-start gap-2">
                    {opt.leading ? <span className="mt-0.5">{opt.leading}</span> : null}
                    <div className="min-w-0">
                      <p className="text-sm text-app-fg truncate">{opt.label}</p>
                      {opt.description ? (
                        <p className="text-xs text-app-fg-muted truncate">{opt.description}</p>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
