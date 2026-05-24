import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type OptgroupHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CONTROL_HEIGHT_CLASS } from './_control-heights';

type FormSelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface FormSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  /** Flat options list */
  options?: SelectOption[];
  /** Grouped options — if provided, takes precedence over `options` */
  groups?: SelectGroup[];
  /** Placeholder option shown when no value is selected */
  placeholder?: string;
  /** Visual height — distinct from native HTML `select size` (row count) */
  controlSize?: FormSelectSize;
  wrapperClassName?: string;
  /**
   * How the option list is presented when open.
   * - `popover` (default): anchored dropdown below the trigger.
   * - `modal`: centered overlay modal — better on mobile and when the select
   *   sits inside another sheet/modal where an anchored popover gets cramped.
   */
  openAs?: 'popover' | 'modal';
}

const sizeClasses: Record<FormSelectSize, string> = {
  sm: 'h-8 px-2.5 pr-7 text-xs',
  md: `${CONTROL_HEIGHT_CLASS} px-3 pr-8 text-sm`,
  lg: 'h-10 px-3.5 pr-9 text-base',
};

const chevronSizeClasses: Record<FormSelectSize, string> = {
  sm: 'right-2 w-3 h-3',
  md: 'right-2.5 w-3.5 h-3.5',
  lg: 'right-3 w-4 h-4',
};

interface FlatOption extends SelectOption {
  key: string;
  groupLabel?: string;
}

const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

function optionLabelFromChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return '';
    })
    .join('')
    .trim();
}

function groupsFromChildren(children: ReactNode): SelectGroup[] {
  const looseOptions: SelectOption[] = [];
  const parsedGroups: SelectGroup[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    if (child.type === 'optgroup') {
      // React 19 typed `isValidElement` returns ReactElement<unknown>; we already
      // narrowed by tag name, so a typed cast is the honest way to read props.
      const groupEl = child as ReactElement<OptgroupHTMLAttributes<HTMLOptGroupElement>>;
      const groupLabel = String(groupEl.props.label ?? '');
      const groupOptions: SelectOption[] = [];

      Children.forEach(groupEl.props.children, (optionChild) => {
        if (!isValidElement(optionChild) || optionChild.type !== 'option') return;
        const optionEl = optionChild as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
        groupOptions.push({
          value: String(optionEl.props.value ?? ''),
          label: optionLabelFromChildren(optionEl.props.children),
          disabled: Boolean(optionEl.props.disabled),
        });
      });

      parsedGroups.push({ label: groupLabel, options: groupOptions });
      return;
    }

    if (child.type === 'option') {
      const optionEl = child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
      looseOptions.push({
        value: String(optionEl.props.value ?? ''),
        label: optionLabelFromChildren(optionEl.props.children),
        disabled: Boolean(optionEl.props.disabled),
      });
    }
  });

  return looseOptions.length > 0 ? [{ label: '', options: looseOptions }, ...parsedGroups] : parsedGroups;
}

export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(
  (
    {
      label,
      hint,
      error,
      options,
      groups,
      placeholder,
      controlSize = 'md',
      wrapperClassName = '',
      openAs = 'popover',
      className = '',
      required,
      id,
      value,
      defaultValue,
      onChange,
      disabled,
      children,
      ...rest
    },
    ref
  ) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const hasError = Boolean(error);
    const isControlled = value !== undefined;
    const initialValue =
      defaultValue == null
        ? ''
        : Array.isArray(defaultValue)
          ? String(defaultValue[0] ?? '')
          : String(defaultValue);

    const [internalValue, setInternalValue] = useState(initialValue);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0, maxWidth: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const nativeSelectRef = useRef<HTMLSelectElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const suppressCloseUntilRef = useRef(0);

    useImperativeHandle(ref, () => nativeSelectRef.current as HTMLSelectElement);

    const childGroups = useMemo(() => groupsFromChildren(children), [children]);
    const normalizedGroups = useMemo<SelectGroup[]>(() => {
      if (groups && groups.length > 0) return groups;
      if (options && options.length > 0) return [{ label: '', options }];
      return childGroups;
    }, [groups, options, childGroups]);

    const flatOptions = useMemo<FlatOption[]>(() => {
      return normalizedGroups.flatMap((group, groupIndex) =>
        group.options.map((option, optionIndex) => ({
          ...option,
          value: String(option.value),
          key: `${group.label || 'ungrouped'}-${groupIndex}-${option.value}-${optionIndex}`,
          groupLabel: group.label || undefined,
        }))
      );
    }, [normalizedGroups]);

    const currentValue = String(isControlled ? value ?? '' : internalValue);
    const selected = flatOptions.find((option) => option.value === currentValue);
    const firstEnabled = flatOptions.findIndex((option) => !option.disabled);

    const triggerClass = [
      'w-full appearance-none rounded-lg border transition-colors text-left',
      'bg-app-canvas text-app-fg',
      'border-app-border focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      hasError ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500' : '',
      sizeClasses[controlSize],
      className,
    ]
      .filter(Boolean)
      .join(' ');

    useEffect(() => {
      if (!open) return;
      const selectedIndex = flatOptions.findIndex((option) => option.value === currentValue && !option.disabled);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled);
      suppressCloseUntilRef.current =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 250;
    }, [open, flatOptions, currentValue, firstEnabled]);

    useEffect(() => {
      if (!open || !triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const viewportMax = Math.max(240, Math.floor(window.innerWidth - rect.left - 8));
      const maxWidth = Math.min(Math.floor(rect.width * 2), viewportMax);
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: Math.floor(rect.width),
        maxWidth,
      });
    }, [open]);

    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        const target = e.target as Node;
        if (
          triggerRef.current &&
          !triggerRef.current.contains(target) &&
          popoverRef.current &&
          !popoverRef.current.contains(target)
        ) {
          setOpen(false);
        }
      };

      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    useEffect(() => {
      // Modal mode is not anchored to the trigger, so background scroll/resize
      // must not close it.
      if (!open || openAs === 'modal') return;

      const onScroll = (e: Event) => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now < suppressCloseUntilRef.current) return;
        const target = e.target as Node | null;
        if (target && popoverRef.current?.contains(target)) return;
        setOpen(false);
      };

      let lastInnerWidth = window.innerWidth;
      const onResize = () => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now < suppressCloseUntilRef.current) return;
        const w = window.innerWidth;
        if (w !== lastInnerWidth) {
          lastInnerWidth = w;
          setOpen(false);
        }
      };

      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize, true);
      return () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize, true);
      };
    }, [open, openAs]);

    useLayoutEffect(() => {
      if (!open || activeIndex < 0) return;
      const el = document.getElementById(`${inputId || 'form-select'}-opt-${activeIndex}`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [open, activeIndex, inputId]);

    function move(dir: 1 | -1) {
      if (flatOptions.length === 0) return;
      let idx = activeIndex;
      for (let i = 0; i < flatOptions.length; i += 1) {
        idx = (idx + dir + flatOptions.length) % flatOptions.length;
        if (!flatOptions[idx]?.disabled) {
          setActiveIndex(idx);
          return;
        }
      }
    }

    function handleNativeChange(e: React.ChangeEvent<HTMLSelectElement>) {
      if (!isControlled) setInternalValue(e.target.value);
      onChange?.(e);
    }

    function commitSelection(nextValue: string) {
      const selectEl = nativeSelectRef.current;
      if (!selectEl) {
        if (!isControlled) setInternalValue(nextValue);
        setOpen(false);
        return;
      }

      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      )?.set;
      nativeValueSetter?.call(selectEl, nextValue);
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      setOpen(false);
    }

    function selectAt(index: number) {
      const option = flatOptions[index];
      if (!option || option.disabled) return;
      commitSelection(option.value);
    }

    function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
      if (disabled) return;

      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setOpen(true);
        return;
      }

      if (!open) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectAt(activeIndex);
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        setOpen(false);
      }
    }

    return (
      <div className={['flex flex-col gap-1', wrapperClassName].filter(Boolean).join(' ')}>
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-app-fg-muted">
            {label}
            {required && <span className="ml-0.5 text-danger-500">*</span>}
          </label>
        )}

        <div className="relative">
          <select
            {...rest}
            ref={nativeSelectRef}
            name={rest.name}
            required={required}
            disabled={disabled}
            value={currentValue}
            onChange={handleNativeChange}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            tabIndex={-1}
            aria-hidden="true"
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}

            {groups
              ? groups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((opt) => (
                      <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                ))
              : options?.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))}

            {children}
          </select>

          <button
            id={inputId}
            ref={triggerRef}
            type="button"
            className={triggerClass}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            onKeyDown={handleTriggerKeyDown}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={inputId ? `${inputId}-listbox` : undefined}
          >
            <span
              className={['block min-w-0 truncate', selected ? 'text-app-fg' : 'text-app-fg-muted'].join(' ')}
            >
              {selected?.label ?? placeholder ?? ''}
            </span>
          </button>

          <span
            className={[
              'pointer-events-none absolute top-1/2 -translate-y-1/2 text-app-fg-muted',
              chevronSizeClasses[controlSize],
            ].join(' ')}
            aria-hidden="true"
          >
            <ChevronDownIcon className="h-full w-full" />
          </span>

          {open &&
            typeof document !== 'undefined' &&
            createPortal(
              (() => {
                const listbox = (
                  <div
                    id={inputId ? `${inputId}-listbox` : undefined}
                    role="listbox"
                    className="min-w-0 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y"
                  >
                    {flatOptions.length === 0 ? (
                      <p className="px-2 py-1.5 text-xs text-app-fg-muted">No options</p>
                    ) : (
                      (() => {
                        let optionIndex = -1;
                        return normalizedGroups.map((group, groupIndex) => (
                          <div key={`${group.label || 'ungrouped'}-${groupIndex}`} className="min-w-0">
                            {group.label ? (
                              <p className="px-2 pb-1 pt-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted">
                                {group.label}
                              </p>
                            ) : null}
                            {group.options.map((option, optionIndexInGroup) => {
                              optionIndex += 1;
                              const currentOptionIndex = optionIndex;
                              const flatOption = flatOptions[currentOptionIndex];
                              return (
                                <button
                                  key={flatOption?.key ?? `${groupIndex}-${option.value}-${optionIndexInGroup}`}
                                  id={`${inputId || 'form-select'}-opt-${currentOptionIndex}`}
                                  type="button"
                                  role="option"
                                  aria-selected={flatOption?.value === currentValue}
                                  aria-disabled={option.disabled}
                                  disabled={option.disabled}
                                  className={[
                                    openAs === 'modal'
                                      ? 'w-full rounded-md px-3 py-2.5 text-left transition-colors'
                                      : 'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                                    currentOptionIndex === activeIndex ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-app-hover',
                                    option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                                  ].join(' ')}
                                  onMouseEnter={() => !option.disabled && setActiveIndex(currentOptionIndex)}
                                  onClick={() => selectAt(currentOptionIndex)}
                                >
                                  <span className="block truncate text-sm text-app-fg">{option.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ));
                      })()
                    )}
                  </div>
                );

                if (openAs === 'modal') {
                  return (
                    <div
                      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setOpen(false);
                      }}
                    >
                      <div
                        ref={popoverRef}
                        className="flex max-h-[70dvh] w-full max-w-sm flex-col rounded-xl border border-app-border bg-app-elevated p-2 shadow-xl"
                      >
                        {label ? (
                          <p className="px-2 pb-1.5 pt-1 text-sm font-semibold text-app-fg">{label}</p>
                        ) : null}
                        {listbox}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    ref={popoverRef}
                    className="fixed z-[9999] flex max-h-[min(24rem,calc(100dvh-1rem))] flex-col rounded-lg border border-app-border bg-app-elevated p-2 shadow-lg"
                    style={{
                      top: pos.top,
                      left: pos.left,
                      minWidth: pos.minWidth,
                      maxWidth: pos.maxWidth,
                      width: 'auto',
                    }}
                  >
                    {listbox}
                  </div>
                );
              })(),
              document.body
            )}
        </div>

        {(error || hint) && (
          <p className={['text-xs', hasError ? 'text-danger-500' : 'text-app-fg-muted'].join(' ')}>
            {error ?? hint}
          </p>
        )}
      </div>
    );
  }
);

FormSelect.displayName = 'FormSelect';
