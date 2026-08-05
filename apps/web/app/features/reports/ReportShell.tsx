import { useMemo, useState } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import {
  CompactTable,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import type { ReportColumnDef } from './report-registry';

/**
 * Shared shell for every report in the Reports module. Built once, reused by
 * all categories via a single set of props:
 *
 *   - date range: rendered by <DateFilterBar> (URL-driven). The route loader
 *     reads startDate/endDate from the URL and fetches `rows` for that window,
 *     so the shell itself is stateless about the period.
 *   - column picker: the user ticks which of `columns` to show; ticks drive
 *     both the on-screen table and the export.
 *   - sortable table: click a header to sort; numeric/money/percent columns
 *     sort numerically, text columns alphabetically.
 *   - export: opens <LocalExportModal> with the currently-picked columns and
 *     the full row set (CSV / PDF / XLSX).
 *
 * Reports differ only in their column definitions and the rows the loader
 * hands in — never in this chrome.
 */

export interface ReportShellProps {
  title: string;
  description: string;
  /** Every column the report can show. */
  columns: ReportColumnDef[];
  /** Keys of the columns shown by default (subset of `columns`). */
  defaultColumns: string[];
  /** Rows for the selected period, already fetched by the route loader. */
  rows: Array<Record<string, unknown>>;
  /** Current period from the URL (for the date bar + export filename). */
  startDate?: string;
  endDate?: string;
  periodAllTime?: boolean;
  /** Filename stem for exports, e.g. "product-performance". */
  exportFilenamePrefix: string;
}

type SortDir = 'asc' | 'desc';

function isNumericColumn(col: ReportColumnDef): boolean {
  return col.format === 'number' || col.format === 'money' || col.format === 'percent';
}

function renderCell(col: ReportColumnDef, value: unknown): React.ReactNode {
  if (value == null || value === '') return <span className="text-app-fg-muted">N/A</span>;
  switch (col.format) {
    case 'money': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return <NairaPrice amount={n} />;
    }
    case 'percent': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return `${n.toFixed(1)}%`;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return n.toLocaleString('en-NG');
    }
    default:
      return String(value);
  }
}

export function ReportShell({
  title,
  description,
  columns,
  defaultColumns,
  rows,
  startDate = '',
  endDate = '',
  periodAllTime = false,
  exportFilenamePrefix,
}: ReportShellProps) {
  // Column visibility — default set on mount, user-adjustable via the picker.
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(
    () => new Set(defaultColumns.length ? defaultColumns : columns.map((c) => c.key)),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const visibleColumns = useMemo(
    () => columns.filter((c) => visibleKeys.has(c.key)),
    [columns, visibleKeys],
  );

  const columnByKey = useMemo(() => {
    const m = new Map<string, ReportColumnDef>();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columnByKey.get(sortKey);
    const numeric = col ? isNumericColumn(col) : false;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (numeric) {
        cmp = (Number(av) || 0) - (Number(bv) || 0);
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir, columnByKey]);

  function toggleColumn(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Never allow zero columns — keep at least one visible.
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  // Map report columns → CompactTable columns (with sortable headers).
  const tableColumns: CompactTableColumn<Record<string, unknown>>[] = visibleColumns.map((col) => ({
    key: col.key,
    align: col.align ?? (isNumericColumn(col) ? 'right' : 'left'),
    header: (
      <button
        type="button"
        onClick={() => toggleSort(col.key)}
        className="inline-flex items-center gap-1 font-medium hover:text-app-fg"
        data-no-row-click
      >
        {col.label}
        {sortKey === col.key ? (
          <span aria-hidden className="text-2xs">{sortDir === 'asc' ? '↑' : '↓'}</span>
        ) : null}
      </button>
    ),
    mobileLabel: col.label,
    render: (row) => renderCell(col, row[col.key]),
  }));

  // Export offers every report column; it pre-checks the on-screen selection so
  // "export" defaults to exactly what's displayed, while still letting the user
  // add columns they hid on screen.
  const exportColumns = columns.map((c) => ({ key: c.key, label: c.label }));
  const exportDefaultColumns = visibleColumns.map((c) => c.key);

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        backTo="/admin/reports"
        mobileInlineActions
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DateFilterBar
              startDate={startDate}
              endDate={endDate}
              periodAllTime={periodAllTime}
              chrome="pill"
            />
            <div className="relative">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPickerOpen((o) => !o)}
              >
                Columns ({visibleColumns.length})
              </Button>
              {pickerOpen && (
                <>
                  {/* Click-away backdrop */}
                  <button
                    type="button"
                    aria-hidden
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setPickerOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-1 w-56 max-h-80 overflow-y-auto rounded-lg border border-app-border bg-app-elevated p-2 shadow-lg">
                    {columns.map((c) => (
                      <label
                        key={c.key}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-app-hover cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={visibleKeys.has(c.key)}
                          onChange={() => toggleColumn(c.key)}
                          className="rounded border-app-border"
                        />
                        <span className="text-app-fg">{c.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setExportOpen(true)}
              disabled={rows.length === 0}
            >
              Export
            </Button>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No data for this period"
          description="No records matched the selected date range. Try a wider period."
        />
      ) : (
        <div className="list-panel p-0">
          <CompactTable
            withCard={false}
            columns={tableColumns}
            rows={sortedRows}
            rowKey={(_row, i) => i}
          />
        </div>
      )}

      <LocalExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={`Export ${title}`}
        rows={sortedRows}
        columns={exportColumns}
        defaultColumns={exportDefaultColumns}
        filenamePrefix={exportFilenamePrefix}
      />
    </div>
  );
}
