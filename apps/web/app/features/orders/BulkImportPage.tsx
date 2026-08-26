/**
 * BulkImportPage — resumable, large-file order import (SuperAdmin/Support).
 *
 * Unlike the row-by-row OrdersImportPage (browser fires one request per row,
 * capped at 1,000), this uploads the whole Excel/CSV to storage and hands it to
 * a background worker that streams + upserts it in chunks. The import is
 * idempotent (keyed by a unique external-id column), so it can be paused and
 * CONTINUED from where it stopped, and failed rows can be RETRIED — with no
 * duplicate orders ever created.
 *
 * Flow: pick file → read header row → map columns + options → upload → create
 * job → poll live progress with Continue / Retry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@remix-run/react';
import * as XLSX from 'xlsx';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { InlineNotification } from '~/components/ui/inline-notification';
import {
  useHasMultipleCurrencies,
  useCurrenciesCatalog,
} from '~/contexts/currencies-catalog-context';
import { uploadAssetDetailed } from '~/lib/object-storage';
import { downloadOrdersImportTemplate } from './orders-import-template';
import {
  createImportJob,
  getImportJobStatus,
  listImportJobs,
  resumeImportJob,
  retryFailedImportRows,
  deleteImportJob,
  type ImportJob,
  type ImportJobConfig,
} from './bulk-import-api';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';

interface UserOption {
  id: string;
  name: string;
}
interface ProductOption {
  id: string;
  name: string;
}

interface BulkImportPageProps {
  /**
   * Passed by the route for a future code-reference legend (which USR-N / PDT-N
   * maps to which name). Not used for input any more — branch, media buyer, CS
   * agent, and product all come from per-row code columns now. Optional so the
   * route contract is loose while the legend is pending.
   */
  mediaBuyers?: UserOption[];
  csAgents?: UserOption[];
  products?: ProductOption[];
  backHref: string;
}

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'PAUSED'] as const;

/**
 * Read the header row + count data rows, in-browser. We parse the whole first
 * sheet once so we can report how many orders the file targets before upload.
 */
async function readHeaderAndRowCount(file: File): Promise<{ headers: string[]; rowCount: number }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return { headers: [], rowCount: 0 };
  const sheet = wb.Sheets[firstSheet];
  if (!sheet) return { headers: [], rowCount: 0 };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const header = (rows[0] as unknown[] | undefined) ?? [];
  const headers = header.map((h, i) => (h == null || String(h).trim() === '' ? `col_${i}` : String(h).trim()));
  // Data rows = everything after the header row (blank rows already dropped).
  const rowCount = Math.max(0, rows.length - 1);
  return { headers, rowCount };
}

function fileTypeOf(file: File): 'xlsx' | 'csv' | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
  return null;
}

/* ── Auto-mapping ──────────────────────────────────────────────────────────
 * On file pick we match each mappable field to a header by name, so the user
 * doesn't have to hand-pick every dropdown. Matching is case/space/punctuation
 * -insensitive and accepts common aliases. The dropdowns stay editable so a
 * non-standard sheet can still be corrected by hand. */

type MapField =
  | 'externalId' | 'name' | 'phone' | 'address' | 'state' | 'total'
  | 'createdAt' | 'qty' | 'unitPrice'
  | 'productCode' | 'mediaBuyerCode' | 'closerCode' | 'currency';

/** Every field's accepted header names, already normalised (see `normHeader`). */
const FIELD_ALIASES: Record<MapField, string[]> = {
  externalId: ['orderid', 'order', 'id', 'externalid', 'uniqueid', 'crmid', 'reference', 'ref'],
  name: ['name', 'customername', 'customer', 'fullname', 'clientname'],
  phone: ['phonenumber', 'phone', 'customerphone', 'mobile', 'msisdn', 'tel', 'telephone'],
  address: ['address', 'customeraddress', 'deliveryaddress', 'street'],
  state: ['state', 'deliverystate', 'region', 'province'],
  total: ['cost', 'total', 'totalamount', 'amount', 'ordertotal', 'price', 'value'],
  createdAt: ['date', 'orderdate', 'createdat', 'created', 'datetime', 'timestamp'],
  qty: ['quantity', 'qty', 'units', 'count'],
  unitPrice: ['unitprice', 'priceperunit', 'unitcost', 'rate'],
  productCode: ['productid', 'productcode', 'product', 'sku', 'pdt', 'pdtcode'],
  mediaBuyerCode: ['mediabuyerid', 'mediabuyercode', 'mbid', 'mbcode', 'buyerid', 'mediabuyer'],
  closerCode: ['csid', 'csagentid', 'closercode', 'closerid', 'csclosercode', 'csclose', 'cs', 'csagent'],
  currency: ['currency', 'country', 'currencycode', 'countryname'],
};

/** Strip everything but letters+digits, lower-cased. "Phone Number" → "phonenumber". */
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Pick the best header for a field. Prefers an exact normalised match, then a
 * header that starts with an alias, then one that contains it — so "Product ID"
 * wins over "Product Name" for `productCode`. Never returns a header already
 * claimed by an earlier (higher-priority) field.
 */
function matchHeader(field: MapField, headers: string[], claimed: Set<string>): string {
  const aliases = FIELD_ALIASES[field];
  const norm = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  const pools: Array<(a: string, n: string) => boolean> = [
    (a, n) => n === a,
    (a, n) => n.startsWith(a),
    (a, n) => n.includes(a),
  ];
  for (const test of pools) {
    for (const a of aliases) {
      const hit = norm.find(({ raw, n }) => !claimed.has(raw) && test(a, n));
      if (hit) return hit.raw;
    }
  }
  return '';
}

export interface AutoMapResult {
  map: Record<MapField, string>;
  matchedCount: number;
}

/** Resolve every field against the headers in priority order, without reuse. */
function autoMapHeaders(headers: string[]): AutoMapResult {
  // Order matters: fields listed first get first claim on a shared header
  // (e.g. externalId claims "Order ID" before productCode can grab "Product ID").
  const order: MapField[] = [
    'externalId', 'name', 'phone', 'productCode',
    'address', 'state', 'total', 'createdAt', 'qty', 'unitPrice',
    'mediaBuyerCode', 'closerCode', 'currency',
  ];
  const claimed = new Set<string>();
  const map = {} as Record<MapField, string>;
  let matchedCount = 0;
  for (const field of order) {
    const hit = matchHeader(field, headers, claimed);
    map[field] = hit;
    if (hit) {
      claimed.add(hit);
      matchedCount += 1;
    }
  }
  return { map, matchedCount };
}

/** The fields the import cannot start without (mirror of `canStart`). */
const REQUIRED_FIELDS: Array<{ field: MapField; label: string }> = [
  { field: 'externalId', label: 'Unique ID' },
  { field: 'name', label: 'Customer name' },
  { field: 'phone', label: 'Customer phone' },
  { field: 'productCode', label: 'Product code' },
];

export function BulkImportPage({ backHref }: BulkImportPageProps) {
  // Multi-country: the import is scoped to the caller's active country (enforced
  // server-side against ctx.effectiveCurrencyCodes — a row whose currency is out
  // of scope hard-fails). We only surface the notice when >1 currency is active;
  // single-currency installs behave exactly as before.
  const hasMultipleCurrencies = useHasMultipleCurrencies();
  const currencies = useCurrenciesCatalog();
  const baseCurrency = currencies.find((c) => c.isDefault && c.active) ?? currencies[0];

  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Config
  // Imported orders land as CS_ASSIGNED (Pending). Fixed — no longer surfaced in
  // the UI, but still stamped on every job.
  const [targetStatus] = useState('CS_ASSIGNED');
  const [externalIdColumn, setExternalIdColumn] = useState('');
  const [colName, setColName] = useState('');
  const [colPhone, setColPhone] = useState('');
  const [colAddress, setColAddress] = useState('');
  const [colState, setColState] = useState('');
  const [colTotal, setColTotal] = useState('');
  const [colCreatedAt, setColCreatedAt] = useState('');
  const [colQty, setColQty] = useState('');
  const [colUnitPrice, setColUnitPrice] = useState('');
  // Display-code columns: headers whose cells carry a human code (PDT-N / USR-N /
  // branch code) resolved to the internal UUID at import time. Optional — leave
  // as "None" to keep using the job-level MB/CS dropdowns + product column above.
  const [colProductCode, setColProductCode] = useState('');
  const [colMediaBuyerCode, setColMediaBuyerCode] = useState('');
  const [colCloserCode, setColCloserCode] = useState('');
  // No branch column — branch is always derived from the media buyer / CS user.
  const [colCurrency, setColCurrency] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const headerOptions = headers.map((h) => ({ value: h, label: h }));
  const optionalHeaderOptions = [{ value: '', label: 'None' }, ...headerOptions];

  // How many required fields auto-mapped on the last file pick (for the banner).
  const [autoMatched, setAutoMatched] = useState<number | null>(null);

  const clearMapping = useCallback(() => {
    setExternalIdColumn(''); setColName(''); setColPhone('');
    setColAddress(''); setColState(''); setColTotal(''); setColCreatedAt('');
    setColQty(''); setColUnitPrice('');
    setColProductCode(''); setColMediaBuyerCode(''); setColCloserCode(''); setColCurrency('');
  }, []);

  const onPickFile = useCallback(async (f: File | null) => {
    setParseError(null);
    setFile(f);
    setHeaders([]);
    setRowCount(null);
    setAutoMatched(null);
    clearMapping();
    if (!f) return;
    if (!fileTypeOf(f)) {
      setParseError('Unsupported file. Upload a .xlsx, .xls, or .csv file.');
      return;
    }
    try {
      const { headers: h, rowCount: n } = await readHeaderAndRowCount(f);
      if (h.length === 0) {
        setParseError('Could not read a header row from this file.');
        return;
      }
      setHeaders(h);
      setRowCount(n);
      // Prefill the mapping dropdowns from the detected headers.
      const { map, matchedCount } = autoMapHeaders(h);
      setExternalIdColumn(map.externalId);
      setColName(map.name);
      setColPhone(map.phone);
      setColAddress(map.address);
      setColState(map.state);
      setColTotal(map.total);
      setColCreatedAt(map.createdAt);
      setColQty(map.qty);
      setColUnitPrice(map.unitPrice);
      setColProductCode(map.productCode);
      setColMediaBuyerCode(map.mediaBuyerCode);
      setColCloserCode(map.closerCode);
      setColCurrency(map.currency);
      setAutoMatched(matchedCount);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to read file headers.');
    }
  }, [clearMapping]);

  // Required-field state → drives the confirmation banner + Start button.
  const requiredValues: Record<string, string> = {
    externalId: externalIdColumn,
    name: colName,
    phone: colPhone,
    productCode: colProductCode,
  };
  const missingRequired = REQUIRED_FIELDS.filter((r) => !requiredValues[r.field]);
  const allRequiredMapped = missingRequired.length === 0;

  const canStart = !!file && headers.length > 0 && allRequiredMapped && !busy;

  // " and N rows to import" fragment for the banner (omitted if unknown/empty).
  const rowCountPhrase =
    rowCount != null && rowCount > 0
      ? ` and ${rowCount.toLocaleString()} ${rowCount === 1 ? 'row' : 'rows'} to import`
      : '';

  const startImport = useCallback(async () => {
    if (!file) return;
    const ft = fileTypeOf(file);
    if (!ft) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Upload the file to storage (returns URL + key for the worker).
      const { fileUrl, key } = await uploadAssetDetailed(file, 'imports');
      if (!key) throw new Error('Upload did not return a storage key.');

      // 2. Create the background job. Branch / media buyer / CS agent are no
      // longer job-level: they're resolved per row from the code columns, and
      // branch is derived server-side. groupId is stamped server-side.
      const config: ImportJobConfig = {
        targetStatus,
        externalIdColumn,
        columnMap: {
          customerName: colName,
          customerPhone: colPhone,
          ...(colAddress ? { customerAddress: colAddress } : {}),
          ...(colState ? { deliveryState: colState } : {}),
          ...(colTotal ? { totalAmount: colTotal } : {}),
          ...(colCreatedAt ? { createdAt: colCreatedAt } : {}),
          ...(colQty ? { quantity: colQty } : {}),
          ...(colUnitPrice ? { unitPrice: colUnitPrice } : {}),
          productCode: colProductCode,
          ...(colMediaBuyerCode ? { mediaBuyerCode: colMediaBuyerCode } : {}),
          ...(colCloserCode ? { closerCode: colCloserCode } : {}),
          ...(colCurrency ? { currency: colCurrency } : {}),
        },
      };
      const { id } = await createImportJob({
        fileUrl,
        fileKey: key,
        fileName: file.name,
        fileType: ft,
        ...(rowCount != null ? { totalRows: rowCount } : {}),
        config,
      });
      const initial = await getImportJobStatus(id);
      setJob(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import.');
    } finally {
      setBusy(false);
    }
  }, [
    file, rowCount, targetStatus, externalIdColumn,
    colName, colPhone, colAddress, colState, colTotal, colCreatedAt,
    colQty, colUnitPrice,
    colProductCode, colMediaBuyerCode, colCloserCode, colCurrency,
  ]);

  // Poll while a job is active (not terminal).
  useEffect(() => {
    if (!job) return;
    if (TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number])) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(async () => {
      try {
        const next = await getImportJobStatus(job.id);
        setJob(next);
      } catch {
        // transient — keep polling
      }
    }, 2500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [job]);

  const onContinue = useCallback(async () => {
    if (!job) return;
    setError(null);
    try {
      await resumeImportJob(job.id);
      const next = await getImportJobStatus(job.id);
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue.');
    }
  }, [job]);

  const onRetryFailed = useCallback(async () => {
    if (!job) return;
    setError(null);
    try {
      await retryFailedImportRows(job.id);
      const next = await getImportJobStatus(job.id);
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry.');
    }
  }, [job]);

  const resetForNewImport = useCallback(() => {
    setJob(null);
    setFile(null);
    setHeaders([]);
  }, []);

  // ── Import history table ────────────────────────────────────────────────────
  const [history, setHistory] = useState<ImportJob[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await listImportJobs(20));
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load import history.');
    }
  }, []);

  // Delete-from-history: confirm, then remove the job (+ its row records). Does
  // NOT delete any orders already imported. If the deleted job is the one open
  // in the active panel, clear it.
  const [deleteHistoryJob, setDeleteHistoryJob] = useState<ImportJob | null>(null);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [deleteHistoryError, setDeleteHistoryError] = useState<string | null>(null);
  const confirmDeleteHistory = useCallback(async () => {
    if (!deleteHistoryJob) return;
    setDeletingHistory(true);
    setDeleteHistoryError(null);
    try {
      await deleteImportJob(deleteHistoryJob.id);
      if (job?.id === deleteHistoryJob.id) setJob(null);
      setDeleteHistoryJob(null);
      await loadHistory();
    } catch (err) {
      setDeleteHistoryError(err instanceof Error ? err.message : 'Failed to delete import.');
    } finally {
      setDeletingHistory(false);
    }
  }, [deleteHistoryJob, job, loadHistory]);
  // Load on mount, and refresh whenever the active job reaches a terminal state
  // (so a just-finished import appears in the list) or is cleared.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory, job?.status, job === null]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bulk import orders"
        description="Upload a large Excel or CSV export. It imports in the background and can be paused, continued, and retried without creating duplicates."
        backTo={backHref}
        actions={
          <Button variant="secondary" onClick={() => downloadOrdersImportTemplate()}>
            Download template
          </Button>
        }
      />

      {error && <InlineNotification variant="danger" message={error} />}

      {hasMultipleCurrencies && (
        <InlineNotification
          variant="info"
          message={`Country-scoped import: rows without a currency default to your selected country${
            baseCurrency ? ` (base ${baseCurrency.code})` : ''
          }. Any row whose currency is outside your country access is rejected so you can fix and re-import it.`}
        />
      )}

      {job ? (
        <ImportProgress
          job={job}
          onContinue={onContinue}
          onRetryFailed={onRetryFailed}
          onNewImport={resetForNewImport}
        />
      ) : (
        <div className="space-y-5 rounded-lg border border-app-border bg-app-surface p-4">
          {/* Step 1: file */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-app-fg">1. Choose file (.xlsx, .xls, .csv)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                {file ? 'Replace file' : 'Choose file'}
              </Button>
              <span className="min-w-0 truncate text-sm text-app-fg-muted" title={file?.name ?? undefined}>
                {file?.name ?? 'No file chosen'}
              </span>
              {rowCount != null && (
                <span className="shrink-0 rounded-full bg-app-hover px-2 py-0.5 text-xs font-medium text-app-fg tabular-nums">
                  {rowCount.toLocaleString()} {rowCount === 1 ? 'row' : 'rows'}
                </span>
              )}
            </div>
            {parseError && <InlineNotification variant="danger" message={parseError} />}
          </div>

          {headers.length > 0 && (
            <>
              {/* Auto-map confirmation: green when every required column was
                  found, warning listing what still needs a column otherwise. */}
              {allRequiredMapped ? (
                <InlineNotification
                  variant="success"
                  message={`Detected ${headers.length} columns${rowCountPhrase}. All required columns matched automatically. Review the mapping below, then start the import.`}
                />
              ) : (
                <InlineNotification
                  variant="warning"
                  message={`Detected ${headers.length} columns${rowCountPhrase}. Select a column for: ${missingRequired.map((m) => m.label).join(', ')}.`}
                />
              )}

              {/* Column mapping — prefilled from the detected headers, editable. */}
              <div className="flex items-end justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-app-fg">Map columns</p>
                  <p className="text-xs text-app-fg-muted">
                    Prefilled from your file. The unique ID is the override key: re-importing the same ID overwrites that order instead of duplicating it.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearMapping}
                  className="shrink-0 text-xs font-medium text-app-accent hover:underline"
                >
                  Clear all
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                <Field label="Unique ID column" required mapped={!!externalIdColumn}>
                  <SearchableSelect value={externalIdColumn} onChange={setExternalIdColumn} options={headerOptions} placeholder="Select column" />
                </Field>
                <Field label="Customer name" required mapped={!!colName}>
                  <SearchableSelect value={colName} onChange={setColName} options={headerOptions} placeholder="Select column" />
                </Field>
                <Field label="Customer phone" required mapped={!!colPhone}>
                  <SearchableSelect value={colPhone} onChange={setColPhone} options={headerOptions} placeholder="Select column" />
                </Field>
                <Field label="Product code" required mapped={!!colProductCode}>
                  <SearchableSelect value={colProductCode} onChange={setColProductCode} options={optionalHeaderOptions} placeholder="Select column" />
                </Field>
                <Field label="Address" mapped={!!colAddress}>
                  <SearchableSelect value={colAddress} onChange={setColAddress} options={optionalHeaderOptions} placeholder="None" />
                </Field>
                <Field label="State" mapped={!!colState}>
                  <SearchableSelect value={colState} onChange={setColState} options={optionalHeaderOptions} placeholder="None" />
                </Field>
                <Field label="Total amount" mapped={!!colTotal}>
                  <SearchableSelect value={colTotal} onChange={setColTotal} options={optionalHeaderOptions} placeholder="None" />
                </Field>
                <Field label="Order date" mapped={!!colCreatedAt}>
                  <SearchableSelect value={colCreatedAt} onChange={setColCreatedAt} options={optionalHeaderOptions} placeholder="None" />
                </Field>
                <Field label="Quantity" mapped={!!colQty}>
                  <SearchableSelect value={colQty} onChange={setColQty} options={optionalHeaderOptions} placeholder="None (defaults to 1)" />
                </Field>
                <Field label="Unit price" mapped={!!colUnitPrice}>
                  <SearchableSelect value={colUnitPrice} onChange={setColUnitPrice} options={optionalHeaderOptions} placeholder="None" />
                </Field>
              </div>

              {/* Attribution codes — optional short codes (USR-N) resolved to the
                  internal record. Product code sits above with the required
                  fields. Branch is derived from the media buyer / CS user. */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                <Field label="Media buyer code" mapped={!!colMediaBuyerCode}>
                  <SearchableSelect value={colMediaBuyerCode} onChange={setColMediaBuyerCode} options={optionalHeaderOptions} placeholder="None" />
                </Field>
                <Field label="Closer code" mapped={!!colCloserCode}>
                  <SearchableSelect value={colCloserCode} onChange={setColCloserCode} options={optionalHeaderOptions} placeholder="None" />
                </Field>
                <Field label="Currency / country" mapped={!!colCurrency}>
                  <SearchableSelect value={colCurrency} onChange={setColCurrency} options={optionalHeaderOptions} placeholder="None" />
                </Field>
              </div>
              <p className="text-xs text-app-fg-muted">
                Currency accepts a code or country name (e.g. NGN, GHS, Ghana). If blank, it uses
                the media buyer or closer&apos;s country, then the base currency. An unknown currency fails the row.
              </p>

              <div className="flex justify-end">
                <Button onClick={() => void startImport()} disabled={!canStart}>
                  {busy ? 'Starting...' : 'Start import'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ImportHistory
        jobs={history}
        error={historyError}
        basePath={backHref}
        onRefresh={() => void loadHistory()}
        onDelete={(j) => setDeleteHistoryJob(j)}
      />

      <ConfirmActionModal
        open={!!deleteHistoryJob}
        onClose={() => {
          if (deletingHistory) return;
          setDeleteHistoryJob(null);
          setDeleteHistoryError(null);
        }}
        title="Delete this import?"
        description={
          deleteHistoryJob
            ? `Removes "${deleteHistoryJob.fileName ?? 'this import'}" and its row records. Orders already imported are NOT deleted.`
            : ''
        }
        confirmLabel="Delete import"
        variant="danger"
        loading={deletingHistory}
        error={deleteHistoryError}
        onConfirm={confirmDeleteHistory}
      />
    </div>
  );
}

/** Recent imports table — "View" opens the job's dedicated status page. */
function ImportHistory({
  jobs,
  error,
  basePath,
  onRefresh,
  onDelete,
}: {
  jobs: ImportJob[];
  error: string | null;
  /** Base import path; the job page lives at `${basePath}/${jobId}`. */
  basePath: string;
  onRefresh: () => void;
  onDelete: (job: ImportJob) => void;
}) {
  return (
    <div className="rounded-lg border border-app-border bg-app-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-app-fg">Recent imports</h3>
        <Button variant="secondary" onClick={onRefresh}>Refresh</Button>
      </div>
      {error && <InlineNotification variant="danger" message={error} />}
      {jobs.length === 0 ? (
        <p className="py-6 text-center text-sm text-app-fg-muted">No imports yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wide text-app-fg-muted">
                <th className="px-2 py-2 font-medium">File</th>
                <th className="px-2 py-2 font-medium">Uploaded</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Imported</th>
                <th className="px-2 py-2 text-right font-medium">Failed</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-app-border/60 last:border-0">
                  <td className="max-w-[220px] truncate px-2 py-2 text-app-fg" title={j.fileName ?? ''}>
                    {j.fileName || 'Untitled import'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-app-fg-muted" title={formatImportTimestamp(j.createdAt, true)}>
                    {formatImportTimestamp(j.createdAt)}
                  </td>
                  <td className="px-2 py-2">
                    <ImportStatusPill status={j.status} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-app-fg">{j.processedRows}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-danger-600 dark:text-danger-400">
                    {j.failedRows || 0}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-app-fg-muted">{j.totalRows || '—'}</td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        to={`${basePath}/${j.id}`}
                        prefetch="intent"
                        className="text-xs font-medium text-app-accent hover:underline"
                      >
                        View
                      </Link>
                      {j.status !== 'PROCESSING' && (
                        <button
                          type="button"
                          onClick={() => onDelete(j)}
                          className="text-xs font-medium text-danger-600 hover:underline dark:text-danger-400"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Format an import job's created_at for the table. Short form (default) shows
 * date + time; the `full` variant (used in the title tooltip) adds seconds.
 * Returns an em-dash for a missing/unparseable value.
 */
function formatImportTimestamp(iso: string | null | undefined, full = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(full ? { second: '2-digit' } : {}),
  });
}

const IMPORT_STATUS_STYLES: Record<ImportJob['status'], { label: string; cls: string }> = {
  PENDING: { label: 'Pending', cls: 'bg-app-hover text-app-fg-muted' },
  PROCESSING: { label: 'Processing', cls: 'bg-brand-500/15 text-brand-600 dark:text-brand-400' },
  PAUSED: { label: 'Paused', cls: 'bg-warning-500/15 text-warning-600 dark:text-warning-400' },
  COMPLETED: { label: 'Completed', cls: 'bg-success-500/15 text-success-600 dark:text-success-400' },
  FAILED: { label: 'Failed', cls: 'bg-danger-500/15 text-danger-600 dark:text-danger-400' },
};

function ImportStatusPill({ status }: { status: ImportJob['status'] }) {
  const s = IMPORT_STATUS_STYLES[status] ?? IMPORT_STATUS_STYLES.PENDING;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function Field({
  label,
  children,
  required,
  mapped,
}: {
  label: string;
  children: React.ReactNode;
  /** Show a required marker (red *) until a column is picked. */
  required?: boolean;
  /** A column is currently selected for this field (drives the check colour). */
  mapped?: boolean;
}) {
  // Compact stacked layout: a small label row above the control. Stacking (vs a
  // fixed-width side label) is what lets the grid pack 4 fields per row without
  // crushing the dropdowns.
  return (
    <div className="min-w-0 space-y-1">
      <label className="flex items-center gap-1 text-xs font-medium text-app-fg-muted">
        <span className="truncate" title={label}>{label}</span>
        {required && !mapped && <span className="shrink-0 text-app-danger">*</span>}
        {mapped && (
          <svg className="h-3.5 w-3.5 shrink-0 text-app-success" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.3 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
          </svg>
        )}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ImportProgress({
  job,
  onContinue,
  onRetryFailed,
  onNewImport,
}: {
  job: ImportJob;
  onContinue: () => void;
  onRetryFailed: () => void;
  /** Optional — omitted on the standalone job page where "New import" isn't shown. */
  onNewImport?: () => void;
}) {
  const total = job.totalRows || 0;
  const done = job.processedRows + job.failedRows;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : job.status === 'COMPLETED' ? 100 : 0;
  const failures = job.errorLog ?? [];

  const statusLabel: Record<ImportJob['status'], string> = {
    PENDING: 'Queued',
    PROCESSING: 'Importing...',
    PAUSED: 'Paused',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
  };

  const running = job.status === 'PENDING' || job.status === 'PROCESSING';

  return (
    <div className="space-y-4 rounded-lg border border-app-border bg-app-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-app-fg">{job.fileName ?? 'Import'}</p>
          <p className="text-xs text-app-fg-muted">{statusLabel[job.status]}</p>
        </div>
        <span
          className={[
            'rounded-full px-2.5 py-1 text-xs font-medium',
            job.status === 'COMPLETED' ? 'bg-app-success/15 text-app-success' : '',
            job.status === 'FAILED' ? 'bg-app-danger/15 text-app-danger' : '',
            job.status === 'PAUSED' ? 'bg-app-warning/15 text-app-warning' : '',
            running ? 'bg-app-accent/15 text-app-accent' : '',
          ].filter(Boolean).join(' ')}
        >
          {statusLabel[job.status]}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-app-border">
          <div
            className={[
              'h-full transition-all',
              job.status === 'FAILED' ? 'bg-app-danger' : job.status === 'COMPLETED' ? 'bg-app-success' : 'bg-app-accent',
            ].join(' ')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-fg-muted">
          <span>{pct}%</span>
          <span>Imported: <strong className="text-app-fg">{job.processedRows.toLocaleString()}</strong></span>
          {job.failedRows > 0 && (
            <span>Failed: <strong className="text-app-danger">{job.failedRows.toLocaleString()}</strong></span>
          )}
          {total > 0 && <span>Total rows seen: {total.toLocaleString()}</span>}
          {running && <span>Resumes from row {job.cursor.toLocaleString()}</span>}
        </div>
      </div>

      {job.lastError && (
        <InlineNotification
          variant={job.status === 'FAILED' ? 'danger' : 'warning'}
          message={job.lastError}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {(job.status === 'PAUSED' || job.status === 'FAILED') && (
          <Button onClick={onContinue}>Continue from row {job.cursor.toLocaleString()}</Button>
        )}
        {failures.length > 0 && (job.status === 'COMPLETED' || job.status === 'PAUSED' || job.status === 'FAILED') && (
          <Button variant="secondary" onClick={onRetryFailed}>
            Retry {failures.length} failed row{failures.length === 1 ? '' : 's'}
          </Button>
        )}
        {onNewImport && (job.status === 'COMPLETED' || job.status === 'FAILED') && (
          <Button variant="ghost" onClick={onNewImport}>New import</Button>
        )}
      </div>

      {failures.length > 0 && (
        <details className="rounded-md border border-app-border bg-app-bg p-3">
          <summary className="cursor-pointer text-xs font-medium text-app-fg">
            View {failures.length} failed row{failures.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-app-fg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Row</th>
                  <th className="px-2 py-1 text-left">External ID</th>
                  <th className="px-2 py-1 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {failures.slice(0, 500).map((f, i) => (
                  <tr key={`${f.row}-${i}`} className="border-t border-app-border">
                    <td className="px-2 py-1">{f.row}</td>
                    <td className="px-2 py-1">{f.externalId ?? '—'}</td>
                    <td className="px-2 py-1 text-app-danger">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
