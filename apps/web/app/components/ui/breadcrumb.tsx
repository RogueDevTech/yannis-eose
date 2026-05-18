/**
 * Breadcrumb — navigation trail shown above page titles.
 *
 * Usage:
 *   <Breadcrumb items={[
 *     { label: 'Orders', to: '/admin/orders' },
 *     { label: 'Order #1234' },
 *   ]} />
 */

import { Link } from '@remix-run/react';

export interface BreadcrumbItem {
  label: string;
  /** If provided, renders as a link */
  to?: string;
  icon?: React.ReactNode;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-app-fg-muted">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;

          return (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && (
                <svg className="w-3 h-3 shrink-0 text-app-border-strong" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
              )}

              {item.icon && (
                <span className="w-3.5 h-3.5 shrink-0">{item.icon}</span>
              )}

              {isLast || !item.to ? (
                <span
                  className={isLast ? 'font-medium text-app-fg' : ''}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="hover:text-app-fg transition-colors"
                  prefetch="intent"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
