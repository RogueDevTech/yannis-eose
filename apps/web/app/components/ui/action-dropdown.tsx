import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@remix-run/react';

export interface ActionDropdownItem {
  label: string;
  /** Link href; if set, item is rendered as a Link. Otherwise use onClick. */
  to?: string;
  /** Button click handler; use when item is not a link. */
  onClick?: () => void;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<string, string> = {
  default: 'text-app-fg-muted hover:bg-app-hover',
  success: 'text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20',
  warning: 'text-warning-600 dark:text-warning-400 hover:bg-warning-50 dark:hover:bg-warning-900/20',
  danger: 'text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20',
};

function EllipsisIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  );
}

function CaretDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-3.5 h-3.5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export interface ActionDropdownProps {
  id: string;
  items: ActionDropdownItem[];
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  /** 'actions' = "Actions" text + caret (default); 'ellipsis' = circular icon button */
  trigger?: 'actions' | 'ellipsis';
  /** Menu alignment relative to trigger: 'end' = right-align (default for actions), 'start' = left-align */
  align?: 'start' | 'end';
}

export function ActionDropdown({
  id,
  items,
  openMenuId,
  setOpenMenuId,
  trigger = 'actions',
  align = 'end',
}: ActionDropdownProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = openMenuId === id;
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: align === 'end' ? rect.right : rect.left,
    });
  }, [isOpen, align]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, setOpenMenuId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = () => setOpenMenuId(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen, setOpenMenuId]);

  const menuStyle: React.CSSProperties = {
    top: pos.top,
    left: pos.left,
    ...(align === 'end' ? { transform: 'translateX(-100%)' } : {}),
  };

  const menuContent = (
    <div
      ref={menuRef}
      className="fixed z-[9999] w-48 min-w-[160px] bg-app-elevated border border-app-border rounded-lg shadow-lg py-1 animate-fade-in"
      style={menuStyle}
    >
      {items.map((item) => {
        const variantClass = VARIANT_CLASSES[item.variant ?? 'default'];
        const baseClass = `w-full text-left px-3 py-2 text-sm whitespace-nowrap flex items-center gap-2 transition-colors ${variantClass}`;
        if (item.to != null) {
          return (
            <Link
              key={item.label}
              to={item.to}
              className={baseClass}
              onClick={() => setOpenMenuId(null)}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              item.onClick?.();
              setOpenMenuId(null);
            }}
            className={baseClass}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenMenuId(isOpen ? null : id)}
        className={
          trigger === 'actions'
            ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-app-fg-muted bg-app-hover hover:brightness-95 dark:hover:brightness-110 border border-app-border transition-colors'
            : 'w-8 h-8 flex items-center justify-center rounded-full bg-app-hover text-app-fg-muted hover:bg-app-elevated border border-transparent hover:border-app-border hover:text-app-fg transition-colors'
        }
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {trigger === 'actions' ? (
          <>
            Actions
            <CaretDownIcon />
          </>
        ) : (
          <EllipsisIcon className="w-4 h-4" />
        )}
      </button>
      {isOpen && typeof document !== 'undefined' && createPortal(menuContent, document.body)}
    </>
  );
}
