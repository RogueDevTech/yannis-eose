/**
 * CompactTable — **canonical list table** for the Yannis web app (dense rows, optional pagination,
 * loading overlay, mobile card rows).
 *
 * Prefer **`CompactTable`** over raw `<table>` or legacy `DataTable` for any tabular list so mobile
 * layout, alignment, and action density stay consistent platform-wide.
 *
 * **Responsive:** Below `md`, each row is a **card**. Default: label beside value (`<dl>`).
 * Pass **`renderMobileCard`** to replace the card body with a fully custom layout (funding, finance).
 *
 * **Tight / actions:** `tight: true` columns keep **one horizontal row** on desktop and mobile (no
 * wrapping that grows row height). Use **`CompactTableActions`** to group custom controls; avoid
 * `flex-wrap` in action cells.
 *
 * **Selection:** Optional **`selection`** adds a leading checkbox column (desktop) and exposes
 * **`rowSelection`** to **`renderMobileCard`** helpers for bespoke card headers.
 *
 * Usage:
 *   <CompactTable
 *     columns={[ ... ]}
 *     rows={items}
 *     rowKey={(r) => r.id}
 *     pagination={{ page, totalPages, summary: <span>Showing …</span>, showWhenSinglePage: true }}
 *     emptyTitle="No items yet"
 *   />
 */

import { Fragment, type ReactNode } from 'react';
import { Link } from '@remix-run/react';
import type { LinkProps } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { Spinner } from '~/components/ui/spinner';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';

export type CompactTableAlign = 'left' | 'right' | 'center';

export type CompactTableLoadingVariant = 'replace' | 'overlay';

export interface CompactTableColumn<T> {
  /** Stable key — used as React key for cells/headers */
  key: string;
  /** Header label (string or any node — e.g. icon + text). Empty string uses `mobileLabel` or a title-cased `key` on mobile cards. */
  header: ReactNode;
  /** Mobile card label when `header` is empty (e.g. `"Actions"`). Desktop `<th>` stays empty. */
  mobileLabel?: ReactNode;
  /**
   * When false, the mobile stacked card shows only the cell content (no left label column).
   * Use for action columns so buttons sit on the card without an "Actions" heading.
   */
  mobileShowLabel?: boolean;
  /** Column alignment. Default 'left'. Action columns usually use 'right'. */
  align?: CompactTableAlign;
  /** Tight column for icons / actions — applies w-px + whitespace-nowrap */
  tight?: boolean;
  /** Force whitespace-nowrap on cells in this column */
  nowrap?: boolean;
  /** Render the cell value from the row */
  render: (row: T, index: number) => ReactNode;
  /** Optional className applied to <td>. May be a string OR function of row. */
  cellClassName?: string | ((row: T) => string);
  /** Optional className override for <th> */
  headerClassName?: string;
  /** Applied to &lt;th&gt;, &lt;td&gt;, and mobile value wrapper */
  className?: string;
  /** On the desktop table only, cell is `hidden sm:table-cell` (still shown on mobile cards with a label). */
  hideOnMobile?: boolean;
  /** Minimum width utility on desktop (e.g. `min-w-[160px]`) */
  minWidth?: string;
  /** Optional tooltip on the cell (e.g. full text for truncated content) */
  cellTitle?: (row: T) => string | undefined;
}

export interface CompactTablePagination {
  page: number;
  totalPages: number;
  /** URL search-param key. Default 'page'. Ignored if onPageChange is set. */
  pageParam?: string;
  /** Switch from URL-driven to callback-driven pagination */
  onPageChange?: (page: number) => void;
  /** Line above the pager (e.g. “Showing 1–20 of 45”). */
  summary?: ReactNode;
  /** Forwarded to `Pagination` — show Prev/Next chrome when `totalPages === 1`. */
  showWhenSinglePage?: boolean;
  /** Wrapper around summary + pager (e.g. `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`). */
  wrapperClassName?: string;
  /** Forwarded to `Pagination` `className` (e.g. `sm:justify-end`). */
  controlsClassName?: string;
}

export interface CompactTableSelection<T> {
  selectedIds: ReadonlySet<string>;
  /** When false, row has no checkbox (desktop) / no control (mobile). Default: all rows selectable. */
  isSelectable?: (row: T) => boolean;
  onToggle: (rowId: string, selected: boolean) => void;
  /** Enables header “select all” checkbox on desktop. */
  onToggleAll?: (selectAll: boolean) => void;
  /** Stable string id for selection keys; defaults to `String(rowKey(row, index))`. */
  getRowId?: (row: T) => string;
}

export interface CompactTableMobileCardHelpers<T> {
  columns: CompactTableColumn<T>[];
  /** Present when `selection` is set — place in your card header/toolbar. */
  rowSelection: ReactNode;
}

export interface CompactTableProps<T> {
  columns: CompactTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  /** Per-row className (e.g. 'opacity-60' for soft-disabled rows) */
  rowClassName?: (row: T, index: number) => string;
  pagination?: CompactTablePagination;
  /** Empty state shown when rows.length === 0 */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  emptyAction?: ReactNode;
  /** Custom empty state node — overrides emptyTitle/emptyDescription/icon/action */
  emptyState?: ReactNode;
  /** Wrap the table in `card p-0 overflow-hidden`. Default true. */
  withCard?: boolean;
  className?: string;
  loading?: boolean;
  /**
   * `replace`: spinner only while loading (legacy).
   * `overlay`: keep rows/empty visible with a dimmed overlay + spinner (filter refetch UX).
   */
  loadingVariant?: CompactTableLoadingVariant;
  /** Accessible caption for the desktop `<table>` */
  caption?: string;
  /** Replace default mobile `<dl>` card body (label:value rows). Receives `rowSelection` when `selection` is set. */
  renderMobileCard?: (row: T, index: number, helpers: CompactTableMobileCardHelpers<T>) => ReactNode;
  /** Bulk row selection — adds a leading checkbox column on desktop. */
  selection?: CompactTableSelection<T>;
  /** `<tfoot>` content — single row spanning all columns (e.g. order line totals). */
  footer?: ReactNode;
  /** Optional second row under each data row (e.g. payroll adjustments sub-list). */
  renderRowDetail?: (row: T) => ReactNode;
}

const ALIGN_CLASS: Record<CompactTableAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/** Desktop tight cells: single-row actions; nested flex rows from consumers get nowrap via [&>*]. */
function wrapTightDesktopCellContent(content: ReactNode, align: CompactTableAlign | undefined): ReactNode {
  const a = align ?? 'left';
  const justify =
    a === 'right' ? 'justify-end' : a === 'center' ? 'justify-center' : 'justify-start';
  return (
    <div
      className={[
        'flex min-w-0 w-full max-w-full flex-nowrap items-center gap-x-1.5',
        justify,
        // Override consumer `flex-wrap` on a single wrapper div (e.g. funding tables)
        '[&>*]:!flex-nowrap [&>*]:min-w-0',
      ].join(' ')}
    >
      {content}
    </div>
  );
}

/**
 * Canonical horizontal action cluster for `CompactTable` (and dense tables). Always one row —
 * use inside `tight` columns so row height stays compact; pair with `overflow-x-auto` on the cell
 * if many actions must scroll on very narrow viewports.
 */
export function CompactTableActions({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={['inline-flex max-w-full flex-nowrap items-center gap-x-1.5', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

function showColumnHeaderLabel(header: ReactNode): boolean {
  if (header == null) return false;
  if (typeof header === 'string') return header.trim().length > 0;
  return true;
}

/** Title-case column key for mobile when there is no table header (e.g. `reserved_count` → "Reserved Count"). */
function humanizeColumnKey(key: string): string {
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function mobileCardFieldLabel<T>(col: CompactTableColumn<T>): ReactNode {
  if (showColumnHeaderLabel(col.header)) return col.header;
  if (col.mobileLabel != null) {
    if (typeof col.mobileLabel === 'string' && col.mobileLabel.trim() === '') {
      return humanizeColumnKey(col.key);
    }
    return col.mobileLabel;
  }
  return humanizeColumnKey(col.key);
}

function resolveSelectionRowId<T>(
  row: T,
  index: number,
  rowKey: CompactTableProps<T>['rowKey'],
  getRowId: CompactTableSelection<T>['getRowId'],
): string {
  return getRowId?.(row) ?? String(rowKey(row, index));
}

/**
 * CompactTableActionButton — canonical row actions inside CompactTable cells.
 * For tables outside CompactTable, use `TableActionButton` per CLAUDE.md.
 */
export interface CompactTableActionButtonProps {
  children: ReactNode;
  onClick?: () => void;
  to?: string;
  /** Passed through to Remix `<Link state>` when `to` is set (e.g. return URL for detail pages). */
  state?: LinkProps['state'];
  disabled?: boolean;
  tone?: 'brand' | 'danger' | 'success';
  className?: string;
}

const TONE_CLASSES: Record<'brand' | 'danger' | 'success', string> = {
  brand:
    'text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300',
  danger:
    'text-danger-600 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300',
  success:
    'text-success-600 hover:text-success-700 dark:text-success-400 dark:hover:text-success-300',
};

export function CompactTableActionButton({
  children,
  onClick,
  to,
  state,
  disabled = false,
  tone = 'brand',
  className = '',
}: CompactTableActionButtonProps) {
  const toneClass = TONE_CLASSES[tone];
  const sharedClass = `${toneClass} font-medium h-auto py-0 ${className}`;

  if (to && !disabled) {
    return (
      <Link to={to} state={state} className={`btn-ghost btn-sm ${sharedClass}`}>
        {children}
      </Link>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={sharedClass}
    >
      {children}
    </Button>
  );
}

export function CompactTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  pagination,
  emptyTitle = 'No data',
  emptyDescription,
  emptyIcon,
  emptyAction,
  emptyState,
  withCard = true,
  className = '',
  loading = false,
  loadingVariant = 'replace',
  caption,
  renderMobileCard,
  selection,
  footer,
  renderRowDetail,
}: CompactTableProps<T>) {
  const hasRows = rows.length > 0;
  const showOverlay = loading && loadingVariant === 'overlay';
  const colCount = columns.length + (selection ? 1 : 0);

  const showPaginationFooter =
    pagination &&
    pagination.totalPages >= 1 &&
    (pagination.totalPages > 1 || pagination.showWhenSinglePage);

  const paginationWrapClass = ['mt-3', pagination?.wrapperClassName].filter(Boolean).join(' ');
  const paginationEl =
    pagination && showPaginationFooter ? (
      <div className={[paginationWrapClass, !pagination.wrapperClassName ? 'space-y-2' : ''].filter(Boolean).join(' ')}>
        {pagination.summary ? <div className="text-sm text-app-fg-muted">{pagination.summary}</div> : null}
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageParam={pagination.pageParam}
          onPageChange={pagination.onPageChange}
          showWhenSinglePage={pagination.showWhenSinglePage ?? false}
          className={pagination.controlsClassName ?? ''}
        />
      </div>
    ) : pagination?.summary ? (
      <div className={paginationWrapClass}>
        <div className="text-sm text-app-fg-muted">{pagination.summary}</div>
      </div>
    ) : null;

  if (loading && loadingVariant === 'replace') {
    return (
      <>
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
        {paginationEl}
      </>
    );
  }

  const emptyInner = (
    <div className="p-4">
      {emptyState ?? (
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          variant="card"
        />
      )}
    </div>
  );

  const emptyWrapped = withCard ? (
    <div className={['card p-0 overflow-hidden', className].filter(Boolean).join(' ')}>{emptyInner}</div>
  ) : (
    <div className={className}>{emptyInner}</div>
  );

  if (!hasRows) {
    return (
      <>
        {showOverlay ? <TableLoadingOverlay show>{emptyWrapped}</TableLoadingOverlay> : emptyWrapped}
        {paginationEl}
      </>
    );
  }

  const selectableIndices = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => selection?.isSelectable?.(row) !== false);
  const selectableIds = selectableIndices.map(({ row, i }) =>
    resolveSelectionRowId(row, i, rowKey, selection?.getRowId),
  );
  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selection?.selectedIds.has(id));

  function renderSelectionCell(row: T, index: number): ReactNode {
    if (!selection) return null;
    const id = resolveSelectionRowId(row, index, rowKey, selection.getRowId);
    const canSelect = selection.isSelectable?.(row) !== false;
    if (!canSelect) {
      return <span className="inline-block w-4" aria-hidden />;
    }
    return (
      <Checkbox
        checked={selection.selectedIds.has(id)}
        onChange={(e) => selection.onToggle(id, e.target.checked)}
        aria-label="Select row"
      />
    );
  }

  function renderHeaderSelection(): ReactNode {
    if (!selection?.onToggleAll) return null;
    return (
      <th scope="col" className="w-px px-2 py-2">
        <Checkbox
          checked={allSelectableSelected}
          onChange={(e) => selection.onToggleAll!(e.target.checked)}
          aria-label="Select all rows"
        />
      </th>
    );
  }

  const mobileCards = (
    <div className="space-y-3 bg-app-canvas px-3 py-3 md:hidden">
      {rows.map((row, i) => {
        const rowExtra = rowClassName?.(row, i) ?? '';
        const rowSelection = selection ? renderSelectionCell(row, i) : null;
        const helpers: CompactTableMobileCardHelpers<T> = { columns, rowSelection };

        return (
          <article
            key={rowKey(row, i)}
            className={[
              'rounded-xl border border-app-border-strong bg-app-elevated px-3 py-2.5 shadow-card dark:shadow-lg dark:shadow-black/40',
              rowExtra,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {selection && !renderMobileCard ? (
              <div className="mb-2 flex justify-end border-b border-app-border/80 pb-2">{rowSelection}</div>
            ) : null}
            {renderMobileCard ? (
              renderMobileCard(row, i, helpers)
            ) : (
              <dl className="m-0 divide-y divide-app-border/80">
                {columns.map((col) => {
                  const cellExtra =
                    typeof col.cellClassName === 'function'
                      ? col.cellClassName(row)
                      : col.cellClassName ?? '';
                  const title = col.cellTitle?.(row);
                  const valueUsesTabularNums = (col.align ?? 'left') === 'right' && !col.tight;
                  const align = col.align ?? 'left';
                  const valueShellClass = [
                    'min-w-0 w-full',
                    align === 'right'
                      ? col.tight
                        ? 'flex flex-nowrap justify-end gap-x-2 overflow-x-auto'
                        : 'text-right'
                      : align === 'center'
                        ? 'text-center'
                        : 'text-left',
                    valueUsesTabularNums ? 'tabular-nums' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  if (col.mobileShowLabel === false) {
                    /** Headerless mobile row — tight = actions in one horizontal row (scroll if needed). */
                    const mobileHeaderlessShell = [
                      cellExtra,
                      'min-w-0 w-full text-left',
                      col.tight ? 'flex flex-nowrap justify-start gap-x-2 overflow-x-auto' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div
                        key={col.key}
                        className={[
                          'py-2.5 first:pt-0 last:pb-0',
                          col.className ?? '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <div className={mobileHeaderlessShell} title={title}>
                          {col.render(row, i)}
                        </div>
                      </div>
                    );
                  }

                  const labelRaw = mobileCardFieldLabel(col);
                  const labelForMobile =
                    typeof labelRaw === 'string' ? <span>{labelRaw}:</span> : labelRaw;
                  return (
                    <div
                      key={col.key}
                      className={[
                        'grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-x-3 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[9.5rem_minmax(0,1fr)]',
                        col.className ?? '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <dt className="m-0 min-w-0 pt-0.5 text-left text-[11px] font-semibold uppercase leading-snug tracking-wide text-app-fg-muted [&_svg]:inline [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0">
                        {labelForMobile}
                      </dt>
                      <dd
                        className="m-0 min-w-0 max-w-full text-sm break-words text-app-fg"
                        title={title}
                      >
                        <div className={[cellExtra, valueShellClass].filter(Boolean).join(' ')}>
                          {col.render(row, i)}
                        </div>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </article>
        );
      })}
    </div>
  );

  const desktopTable = (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="border-b border-app-border bg-app-elevated">
          <tr>
            {renderHeaderSelection()}
            {columns.map((col) => {
              const alignClass = ALIGN_CLASS[col.align ?? 'left'];
              return (
                <th
                  key={col.key}
                  className={[
                    'px-3 py-2 font-semibold text-xs text-app-fg-muted uppercase tracking-wide whitespace-nowrap',
                    alignClass,
                    col.tight ? 'w-px' : '',
                    col.hideOnMobile ? 'hidden sm:table-cell' : '',
                    col.minWidth ?? '',
                    col.headerClassName ?? '',
                    col.className ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border bg-app-canvas">
          {rows.map((row, i) => {
            const rowExtra = rowClassName?.(row, i) ?? '';
            const detailContent = renderRowDetail?.(row);
            return (
              <Fragment key={String(rowKey(row, i))}>
                <tr className={['bg-transparent transition-colors', rowExtra].filter(Boolean).join(' ')}>
                  {selection ? (
                    <td className="px-2 py-2 align-middle">{renderSelectionCell(row, i)}</td>
                  ) : null}
                  {columns.map((col) => {
                    const alignClass = ALIGN_CLASS[col.align ?? 'left'];
                    const cellExtra =
                      typeof col.cellClassName === 'function'
                        ? col.cellClassName(row)
                        : col.cellClassName ?? '';
                    const title = col.cellTitle?.(row);
                    const cellBody = col.tight
                      ? wrapTightDesktopCellContent(col.render(row, i), col.align)
                      : col.render(row, i);
                    return (
                      <td
                        key={col.key}
                        className={[
                          'px-3 py-2',
                          alignClass,
                          col.nowrap || col.tight ? 'whitespace-nowrap' : '',
                          col.hideOnMobile ? 'hidden sm:table-cell' : '',
                          col.minWidth ?? '',
                          cellExtra,
                          col.className ?? '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={title}
                      >
                        {cellBody}
                      </td>
                    );
                  })}
                </tr>
                {detailContent != null && detailContent !== false ? (
                  <tr className="border-t border-app-border bg-app-hover/40">
                    <td colSpan={colCount} className="px-3 py-2 text-sm text-app-fg">
                      {detailContent}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        {footer ? (
          <tfoot>
            <tr className="border-t border-app-border-strong bg-app-elevated">
              <td colSpan={colCount} className="px-3 py-2 text-sm">
                {footer}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );

  const body = (
    <>
      {mobileCards}
      {desktopTable}
    </>
  );

  const wrapped = withCard ? (
    <div className={['card p-0 overflow-hidden', className].filter(Boolean).join(' ')}>{body}</div>
  ) : (
    <div className={className}>{body}</div>
  );

  return (
    <>
      {showOverlay ? <TableLoadingOverlay show>{wrapped}</TableLoadingOverlay> : wrapped}
      {paginationEl}
    </>
  );
}
