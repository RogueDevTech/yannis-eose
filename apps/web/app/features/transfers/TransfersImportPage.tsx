import { useState, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import { read, utils } from 'xlsx';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { useToast } from '~/components/ui/toast';
import type { Location, Product } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  agentName: string;
  items: Array<{ productHeader: string; quantity: number }>;
}

interface PreviewRow {
  agentName: string;
  locationId: string | null;
  locationName: string | null;
  items: Array<{
    productHeader: string;
    productId: string | null;
    productName: string | null;
    quantity: number;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Strings to skip when scanning for agent names */
const SKIP_PATTERNS = [
  'total', 'sub-tota', 'new product', 'new stock', 'openning', 'opening',
  'closing', 'agent', 'sheet', 'transferred', 'balance', 'received',
];
/** True if the string looks like a date header (e.g. "10th 16th November", "13TH JAN 26") */
function isDateLike(s: string): boolean {
  return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(s)
    || /^\d{1,2}(st|nd|rd|th)\s/i.test(s);
}

function parseSpreadsheet(buffer: ArrayBuffer): { rows: ParsedRow[]; productHeaders: string[] } {
  const wb = read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], productHeaders: [] };
  const data = utils.sheet_to_json<string[]>(sheet, { header: 1 }) as unknown[][];

  // The spreadsheet has multiple sections, each with its own header row.
  // Structure: col 0-1 may have "Agent" or date labels, col 2 has "Agent" or agent name,
  // cols 3+ have product names in header rows, quantities in data rows.
  //
  // Step 1: Find the FIRST header row to extract product names.
  // Products start at column 3 in all observed formats.
  const PRODUCT_START_COL = 3;
  let productHeaders: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i] as (string | number | null | undefined)[];
    if (!row) continue;
    const hasAgent = row.some(
      (cell) => typeof cell === 'string' && norm(cell) === 'agent',
    );
    if (!hasAgent) continue;
    // Extract product names from col 3 onward, skip empties and date-like values
    const headers: string[] = [];
    for (let c = PRODUCT_START_COL; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === 'string' && cell.trim().length > 0 && !isDateLike(cell.trim())) {
        headers.push(cell.trim());
      }
    }
    if (headers.length > productHeaders.length) {
      productHeaders = headers;
    }
    break; // Use the first header row for product names
  }

  if (productHeaders.length === 0) return { rows: [], productHeaders: [] };

  // Step 2: Parse all data rows. Agent name is in column 2.
  // Quantities start at column 3 and map to productHeaders by position.
  // Skip header rows (contain "Agent"), summary rows (totals, balances), and empty rows.
  const rows: ParsedRow[] = [];
  const seenAgents = new Set<string>(); // Deduplicate agents with same name across sections

  for (let i = 0; i < data.length; i++) {
    const row = data[i] as (string | number | null | undefined)[];
    if (!row || row.length < PRODUCT_START_COL + 1) continue;

    // Check if this is a header/summary row — skip it
    const isHeaderRow = row.some(
      (cell) => typeof cell === 'string' && norm(cell) === 'agent',
    );
    if (isHeaderRow) continue;

    // Agent name is in column 2
    const agentCell = row[2];
    if (typeof agentCell !== 'string' || agentCell.trim().length < 2) continue;
    const agentName = agentCell.trim();
    const lower = agentName.toLowerCase();

    // Skip summary/date rows
    if (SKIP_PATTERNS.some((p) => lower.startsWith(p) || lower.includes(p))) continue;
    if (isDateLike(agentName)) continue;

    // Extract quantities from col 3 onward, mapped to productHeaders
    const items: ParsedRow['items'] = [];
    for (let p = 0; p < productHeaders.length; p++) {
      const cellVal = row[PRODUCT_START_COL + p];
      const qty = typeof cellVal === 'number' ? cellVal : parseInt(String(cellVal ?? ''), 10);
      if (qty > 0) {
        items.push({ productHeader: productHeaders[p], quantity: qty });
      }
    }
    if (items.length === 0) continue;

    // For duplicate agent names across sections, merge quantities
    const existingIdx = rows.findIndex((r) => r.agentName === agentName);
    if (existingIdx >= 0) {
      // Merge: add quantities for matching products, append new products
      const existing = rows[existingIdx];
      for (const item of items) {
        const matchIdx = existing.items.findIndex((e) => e.productHeader === item.productHeader);
        if (matchIdx >= 0) {
          existing.items[matchIdx].quantity += item.quantity;
        } else {
          existing.items.push(item);
        }
      }
    } else {
      rows.push({ agentName, items });
    }
  }

  return { rows, productHeaders };
}

function matchAgentToLocation(agentName: string, locations: Location[]): Location | null {
  const target = norm(agentName);
  const exact = locations.find((l) => norm(l.name) === target);
  if (exact) return exact;
  const contains = locations.find(
    (l) => norm(l.name).includes(target) || target.includes(norm(l.name)),
  );
  if (contains) return contains;
  const targetWords = target.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  let bestMatch: Location | null = null;
  let bestScore = 0;
  for (const loc of locations) {
    const locWords = norm(loc.name).replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
    const overlap = targetWords.filter((w) => locWords.some((lw) => lw.includes(w) || w.includes(lw))).length;
    const score = overlap / Math.max(targetWords.length, 1);
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = loc;
    }
  }
  return bestMatch;
}

function matchProductHeader(header: string, products: Product[]): Product | null {
  const target = norm(header);
  const exact = products.find((p) => norm(p.name) === target);
  if (exact) return exact;
  return products.find(
    (p) => norm(p.name).includes(target) || target.includes(norm(p.name)),
  ) ?? null;
}

// ── Component ────────────────────────────────────────────────────────────────

interface TransfersImportPageProps {
  locations: Location[];
  products: Product[];
}

export function TransfersImportPage({ locations, products }: TransfersImportPageProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [productHeaders, setProductHeaders] = useState<string[]>([]);
  const [selectedFromLocation, setSelectedFromLocation] = useState('');
  const [fileName, setFileName] = useState('');

  const [productMap, setProductMap] = useState<Map<string, string>>(new Map());
  const [agentMap, setAgentMap] = useState<Map<string, string>>(new Map());

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, created: 0, failed: 0 });
  const [importDone, setImportDone] = useState(false);
  const [rowStatuses, setRowStatuses] = useState<Map<string, 'pending' | 'in_flight' | 'created' | 'failed'>>(new Map());
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);
      setImportDone(false);
      setRowStatuses(new Map());
      setRowErrors(new Map());

      const buffer = await file.arrayBuffer();
      const { rows, productHeaders: headers } = parseSpreadsheet(buffer);
      setParsedRows(rows);
      setProductHeaders(headers);

      const pMap = new Map<string, string>();
      for (const header of headers) {
        const match = matchProductHeader(header, products);
        if (match) pMap.set(header, match.id);
      }
      setProductMap(pMap);

      const aMap = new Map<string, string>();
      for (const row of rows) {
        const match = matchAgentToLocation(row.agentName, locations);
        if (match) aMap.set(row.agentName, match.id);
      }
      setAgentMap(aMap);
    },
    [products, locations],
  );

  const previewRows: PreviewRow[] = useMemo(() => {
    return parsedRows.map((row) => {
      const locationId = agentMap.get(row.agentName) ?? null;
      const location = locationId ? locations.find((l) => l.id === locationId) : null;
      return {
        agentName: row.agentName,
        locationId,
        locationName: location?.name ?? null,
        items: row.items.map((item) => {
          const productId = productMap.get(item.productHeader) ?? null;
          const product = productId ? products.find((p) => p.id === productId) : null;
          return {
            productHeader: item.productHeader,
            productId,
            productName: product?.name ?? null,
            quantity: item.quantity,
          };
        }),
      };
    });
  }, [parsedRows, agentMap, productMap, locations, products]);

  const readyRows = previewRows.filter(
    (r) => r.locationId && r.items.some((it) => it.productId),
  );
  const unmatchedAgents = previewRows.filter((r) => !r.locationId);
  const unmatchedProducts = productHeaders.filter((h) => !productMap.has(h));

  const locationOptions = useMemo(
    () => locations.filter((l) => l.status === 'ACTIVE').map((l) => ({ value: l.id, label: l.name })),
    [locations],
  );
  const productOptions = useMemo(
    () => [
      { value: '', label: '— Skip —' },
      ...products.map((p) => ({ value: p.id, label: p.name })),
    ],
    [products],
  );
  const agentLocationOptions = useMemo(
    () => [
      { value: '', label: '— Unmatched —' },
      ...locationOptions,
    ],
    [locationOptions],
  );

  const handleImport = useCallback(async () => {
    if (!selectedFromLocation || readyRows.length === 0) return;
    setIsImporting(true);
    setImportDone(false);
    const total = readyRows.length;
    let created = 0;
    let failed = 0;

    const statuses = new Map<string, 'pending' | 'in_flight' | 'created' | 'failed'>();
    const errors = new Map<string, string>();
    readyRows.forEach((r) => statuses.set(r.agentName, 'pending'));
    setRowStatuses(new Map(statuses));
    setImportProgress({ done: 0, total, created: 0, failed: 0 });

    for (const row of readyRows) {
      statuses.set(row.agentName, 'in_flight');
      setRowStatuses(new Map(statuses));

      const lines = row.items
        .filter((it) => it.productId && it.quantity > 0)
        .map((it) => ({ productId: it.productId!, quantity: it.quantity }));

      if (lines.length === 0) {
        statuses.set(row.agentName, 'failed');
        errors.set(row.agentName, 'No valid product lines');
        failed++;
        setRowStatuses(new Map(statuses));
        setRowErrors(new Map(errors));
        setImportProgress({ done: created + failed, total, created, failed });
        continue;
      }

      const fd = new FormData();
      fd.set('intent', 'importTransferBatch');
      fd.set('fromLocationId', selectedFromLocation);
      fd.set('toLocationId', row.locationId!);
      fd.set('lines', JSON.stringify(lines));

      try {
        const res = await fetch('/admin/transfers/import', { method: 'POST', body: fd });
        const data = await res.json() as { success?: boolean; error?: string };
        if (data.success) {
          statuses.set(row.agentName, 'created');
          created++;
        } else {
          statuses.set(row.agentName, 'failed');
          errors.set(row.agentName, data.error ?? 'Unknown error');
          failed++;
        }
      } catch (err) {
        statuses.set(row.agentName, 'failed');
        errors.set(row.agentName, err instanceof Error ? err.message : 'Network error');
        failed++;
      }
      setRowStatuses(new Map(statuses));
      setRowErrors(new Map(errors));
      setImportProgress({ done: created + failed, total, created, failed });
    }

    setIsImporting(false);
    setImportDone(true);
    if (failed === 0) {
      toast({ variant: 'success', title: `${created} transfer(s) imported successfully` });
    } else {
      toast({ variant: 'error', title: `${failed} of ${total} transfer(s) failed` });
    }
  }, [selectedFromLocation, readyRows, toast]);

  const hasFile = parsedRows.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk import transfers"
        backTo="/admin/transfers"
        mobileInlineActions
        description="Upload a spreadsheet to create multiple stock transfers at once."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Import tools"
            desktop={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                {hasFile ? 'Replace file' : 'Choose file'}
              </Button>
            }
            sheet={
              <Button
                variant="secondary"
                size="sm"
                className="h-12 w-full justify-center"
                onClick={() => fileRef.current?.click()}
              >
                {hasFile ? 'Replace file' : 'Choose file'}
              </Button>
            }
          />
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="sr-only"
        onChange={handleFileChange}
      />

      {/* ── Step 1: Upload ────────────────────────────────────── */}
      <div className="card">
        <h2 className="text-base font-semibold text-app-fg mb-2">1. Upload spreadsheet</h2>
        <p className="text-sm text-app-fg-muted mb-4">
          Upload an XLSX file with agent names as rows and product quantities in columns. The system matches agents to locations and products automatically.
        </p>
        {!hasFile ? (
          <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
            Choose file
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-app-border bg-app-hover px-3 py-1.5">
              <svg className="w-4 h-4 text-success-600 dark:text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-app-fg">{fileName}</span>
              <span className="text-xs text-app-fg-muted">
                · {parsedRows.length} agent{parsedRows.length !== 1 ? 's' : ''} · {productHeaders.length} product column{productHeaders.length !== 1 ? 's' : ''}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              Replace
            </Button>
          </div>
        )}
      </div>

      {/* ── Step 2: Configuration ─────────────────────────────── */}
      {hasFile && (
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-app-fg">2. Configure transfer</h2>

          <SearchableSelect
            id="bulk-import-from-location"
            label="Source warehouse (all transfers come from here)"
            value={selectedFromLocation}
            onChange={(v) => setSelectedFromLocation(v)}
            options={locationOptions}
            placeholder="Select source location"
            searchPlaceholder="Search locations…"
            wrapperClassName="max-w-sm"
          />

          {/* Unmatched products */}
          {unmatchedProducts.length > 0 && (
            <div className="rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 p-3 space-y-2">
              <p className="text-xs font-medium text-warning-700 dark:text-warning-400">
                {unmatchedProducts.length} product column{unmatchedProducts.length !== 1 ? 's' : ''} not matched — map them or they'll be skipped:
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {unmatchedProducts.map((header) => (
                  <div key={header} className="flex items-center gap-2">
                    <span className="text-xs text-app-fg-muted min-w-[7rem] truncate shrink-0">{header}</span>
                    <SearchableSelect
                      id={`product-map-${header}`}
                      value={productMap.get(header) ?? ''}
                      onChange={(v) => {
                        setProductMap((prev) => {
                          const next = new Map(prev);
                          if (v) next.set(header, v);
                          else next.delete(header);
                          return next;
                        });
                      }}
                      options={productOptions}
                      controlSize="sm"
                      placeholder="Map to product…"
                      searchPlaceholder="Search products…"
                      wrapperClassName="flex-1 min-w-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unmatched agents */}
          {unmatchedAgents.length > 0 && (
            <div className="rounded-lg border border-danger-300 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/20 p-3 space-y-2">
              <p className="text-xs font-medium text-danger-700 dark:text-danger-400">
                {unmatchedAgents.length} agent{unmatchedAgents.length !== 1 ? 's' : ''} not matched to a location — map them or they'll be skipped:
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {unmatchedAgents.map((row) => (
                  <div key={row.agentName} className="flex items-center gap-2">
                    <span className="text-xs text-app-fg-muted min-w-[7rem] truncate shrink-0">{row.agentName}</span>
                    <SearchableSelect
                      id={`agent-map-${row.agentName}`}
                      value={agentMap.get(row.agentName) ?? ''}
                      onChange={(v) => {
                        setAgentMap((prev) => {
                          const next = new Map(prev);
                          if (v) next.set(row.agentName, v);
                          else next.delete(row.agentName);
                          return next;
                        });
                      }}
                      options={agentLocationOptions}
                      controlSize="sm"
                      placeholder="Map to location…"
                      searchPlaceholder="Search locations…"
                      wrapperClassName="flex-1 min-w-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Preview & import ──────────────────────────── */}
      {hasFile && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-app-fg">3. Preview & import</h2>
            <div className="flex items-center gap-2 text-xs text-app-fg-muted">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-success-500" />
                {readyRows.length} ready
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-danger-500" />
                {previewRows.length - readyRows.length} need fixing
              </span>
            </div>
          </div>

          {/* Desktop table */}
          <div className="overflow-x-auto -mx-4 px-4 hidden sm:block">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="text-xs text-app-fg-muted uppercase tracking-wider">
                  <th className="text-left font-medium px-3 py-2 bg-app-hover rounded-tl-lg">#</th>
                  <th className="text-left font-medium px-3 py-2 bg-app-hover min-w-[10rem]">Agent</th>
                  <th className="text-left font-medium px-3 py-2 bg-app-hover min-w-[10rem]">Destination</th>
                  <th className="text-left font-medium px-3 py-2 bg-app-hover min-w-[16rem]">Products</th>
                  <th className="text-center font-medium px-3 py-2 bg-app-hover rounded-tr-lg min-w-[6rem]">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => {
                  const status = rowStatuses.get(row.agentName);
                  const error = rowErrors.get(row.agentName);
                  const isReady = !!row.locationId && row.items.some((it) => it.productId);
                  return (
                    <tr key={row.agentName} className="border-t border-app-border">
                      <td className="px-3 py-2 text-xs text-app-fg-muted">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <span className="text-sm font-medium text-app-fg">{row.agentName}</span>
                      </td>
                      <td className="px-3 py-2">
                        {row.locationId ? (
                          <span className="text-sm text-success-600 dark:text-success-400">{row.locationName}</span>
                        ) : (
                          <span className="text-sm text-danger-600 dark:text-danger-400">No match</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.items.map((it) => (
                            <span
                              key={it.productHeader}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                                it.productId
                                  ? 'bg-app-hover text-app-fg'
                                  : 'bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400'
                              }`}
                            >
                              {it.productName ?? it.productHeader} × {it.quantity}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {status === 'created' ? (
                          <StatusBadge status="CREATED" />
                        ) : status === 'failed' ? (
                          <span className="text-xs text-danger-600 dark:text-danger-400" title={error}><StatusBadge status="FAILED" /></span>
                        ) : status === 'in_flight' ? (
                          <StatusBadge status="IN_PROGRESS" />
                        ) : isReady ? (
                          <StatusBadge status="READY" />
                        ) : (
                          <StatusBadge status="NEEDS_FIX" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {previewRows.map((row, idx) => {
              const status = rowStatuses.get(row.agentName);
              const error = rowErrors.get(row.agentName);
              const isReady = !!row.locationId && row.items.some((it) => it.productId);
              return (
                <div key={row.agentName} className="rounded-lg border border-app-border p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-app-fg">{idx + 1}. {row.agentName}</span>
                    {status === 'created' ? (
                      <StatusBadge status="CREATED" />
                    ) : status === 'failed' ? (
                      <StatusBadge status="FAILED" />
                    ) : status === 'in_flight' ? (
                      <StatusBadge status="IN_PROGRESS" />
                    ) : isReady ? (
                      <StatusBadge status="READY" />
                    ) : (
                      <StatusBadge status="NEEDS_FIX" />
                    )}
                  </div>
                  <p className="text-xs text-app-fg-muted">
                    → {row.locationName ?? 'No match'}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {row.items.map((it) => (
                      <span
                        key={it.productHeader}
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          it.productId ? 'bg-app-hover text-app-fg' : 'bg-danger-100 dark:bg-danger-900/30 text-danger-600'
                        }`}
                      >
                        {it.productName ?? it.productHeader} × {it.quantity}
                      </span>
                    ))}
                  </div>
                  {error && <p className="text-xs text-danger-600 dark:text-danger-400">{error}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Footer actions ────────────────────────────────────── */}
      {hasFile && (
        <div className="flex items-center justify-between">
          <Link to="/admin/transfers" className="text-sm text-app-fg-muted hover:text-app-fg">
            Cancel
          </Link>
          <div className="flex items-center gap-3">
            {isImporting && (
              <p className="text-xs text-app-fg-muted">
                {importProgress.done}/{importProgress.total} — {importProgress.created} created, {importProgress.failed} failed
              </p>
            )}
            {importDone ? (
              <Button variant="primary" onClick={() => navigate('/admin/transfers')}>
                Done — go to transfers
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleImport}
                disabled={!selectedFromLocation || readyRows.length === 0 || isImporting}
                loading={isImporting}
                loadingText={`Importing ${importProgress.done}/${importProgress.total}…`}
              >
                Import {readyRows.length} transfer{readyRows.length !== 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasFile && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <svg className="w-12 h-12 text-app-fg-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm text-app-fg-muted mb-4">
            Upload a spreadsheet to get started
          </p>
          <Button variant="primary" onClick={() => fileRef.current?.click()}>
            Choose file
          </Button>
        </div>
      )}
    </div>
  );
}
