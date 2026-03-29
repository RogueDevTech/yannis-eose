/**
 * DataTable — responsive table with sticky header, loading state, and empty state.
 * Columns are defined as typed objects; rows are passed as data.
 *
 * Usage:
 *   const columns: TableColumn<Order>[] = [
 *     { key: 'id', header: 'Order ID', render: (row) => <OrderIdBadge id={row.id} /> },
 *     { key: 'status', header: 'Status', render: (row) => <OrderStatusBadge status={row.status} /> },
 *     { key: 'total', header: 'Total', render: (row) => <NairaPrice amount={row.total} />, align: 'right' },
 *   ];
 *   <DataTable columns={columns} data={orders} keyField="id" />
 */

import { EmptyState } from '~/components/ui/empty-state';
import { Spinner } from '~/components/ui/spinner';

export interface TableColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T, index: number) => React.ReactNode;
  /** Text alignment of cell (default left) */
  align?: 'left' | 'center' | 'right';
  /** Extra className on the <th> and <td> */
  className?: string;
  /** Hide on mobile (hidden sm:table-cell) */
  hideOnMobile?: boolean;
  /** Minimum width (e.g. 'min-w-[120px]') */
  minWidth?: string;
}

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  /** Field name used as React key (must be unique per row) */
  keyField: keyof T;
  loading?: boolean;
  /** Shown when data is empty */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
  emptyAction?: React.ReactNode;
  /** Called when a row is clicked */
  onRowClick?: (row: T) => void;
  /** Extra className on table wrapper */
  className?: string;
  /** Sticky header — defaults to true */
  stickyHeader?: boolean;
  /** Row-level className override */
  rowClassName?: (row: T, index: number) => string;
  /** Caption for accessibility */
  caption?: string;
}

const alignClass = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export function DataTable<T>({
  columns,
  data,
  keyField,
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription,
  emptyIcon,
  emptyAction,
  onRowClick,
  className = '',
  stickyHeader = true,
  rowClassName,
  caption,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        variant="card"
      />
    );
  }

  return (
    <div className={['overflow-x-auto rounded-xl border border-app-border', className].filter(Boolean).join(' ')}>
      <table className="w-full min-w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className={[stickyHeader ? 'sticky top-[var(--header-height,3.5rem)] z-10' : ''].filter(Boolean).join(' ')}>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={[
                  'border-b border-app-border bg-app-elevated px-4 py-2.5 text-xs font-semibold text-app-fg-muted whitespace-nowrap',
                  alignClass[col.align ?? 'left'],
                  col.hideOnMobile ? 'hidden sm:table-cell' : '',
                  col.minWidth ?? '',
                  col.className ?? '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border bg-app-canvas">
          {data.map((row, i) => (
            <tr
              key={String(row[keyField])}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={[
                'transition-colors',
                onRowClick ? 'cursor-pointer hover:bg-app-hover' : '',
                rowClassName?.(row, i) ?? '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={[
                    'px-4 py-3 text-app-fg',
                    alignClass[col.align ?? 'left'],
                    col.hideOnMobile ? 'hidden sm:table-cell' : '',
                    col.className ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
