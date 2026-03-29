/**
 * Collapsible — expandable/collapsible content section.
 * Can be uncontrolled (manages its own state) or controlled via open/onOpenChange.
 *
 * Accordion usage:
 *   Use multiple Collapsibles with a shared activeKey state and
 *   pass open={activeKey === id} onOpenChange={() => setActiveKey(id)}
 */

import { useState } from 'react';

interface CollapsibleProps {
  /** Trigger/header content */
  trigger: React.ReactNode;
  children: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Default open for uncontrolled usage */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Show separator line under trigger */
  divided?: boolean;
  /** Show chevron icon automatically */
  showChevron?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

export function Collapsible({
  trigger,
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  divided = false,
  showChevron = true,
  className = '',
  triggerClassName = '',
  contentClassName = '',
}: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  function toggle() {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={[
          'flex w-full items-center justify-between gap-2 text-left transition-colors',
          divided ? 'border-b border-app-border pb-2' : '',
          'hover:opacity-80',
          triggerClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="flex-1 min-w-0">{trigger}</span>
        {showChevron && (
          <svg
            className={['w-4 h-4 shrink-0 text-app-fg-muted transition-transform duration-200', isOpen ? 'rotate-180' : ''].join(' ')}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      {isOpen && (
        <div className={['animate-fade-in', contentClassName].filter(Boolean).join(' ')}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Accordion ───────────────────────────────────────────────────────────────

export interface AccordionItem {
  id: string;
  trigger: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
}

interface AccordionProps {
  items: AccordionItem[];
  /** Allow multiple open at once */
  multiple?: boolean;
  defaultOpen?: string | string[];
  className?: string;
  itemClassName?: string;
}

export function Accordion({ items, multiple = false, defaultOpen, className = '', itemClassName = '' }: AccordionProps) {
  const initialOpen = defaultOpen
    ? Array.isArray(defaultOpen)
      ? new Set(defaultOpen)
      : new Set([defaultOpen])
    : new Set<string>();

  const [openItems, setOpenItems] = useState<Set<string>>(initialOpen);

  function toggle(id: string) {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!multiple) next.clear();
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className={['flex flex-col divide-y divide-app-border', className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <Collapsible
          key={item.id}
          open={openItems.has(item.id)}
          onOpenChange={() => !item.disabled && toggle(item.id)}
          trigger={item.trigger}
          className={['py-3 first:pt-0 last:pb-0', item.disabled ? 'opacity-50' : '', itemClassName].filter(Boolean).join(' ')}
          triggerClassName="py-0"
          contentClassName="pt-3"
        >
          {item.content}
        </Collapsible>
      ))}
    </div>
  );
}
