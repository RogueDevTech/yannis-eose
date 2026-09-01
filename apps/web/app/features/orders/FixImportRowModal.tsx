import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { InlineNotification } from '~/components/ui/inline-notification';
import { Spinner } from '~/components/ui/spinner';
import {
  getImportJobRow,
  getImportRowOptions,
  resubmitImportRow,
  type ImportJobRow,
  type ImportJobRowDetail,
  type ImportRowOptions,
} from './bulk-import-api';

/**
 * The fields the import maps, in the order they are shown in the form. `key` is
 * the ImportColumnMap field; the actual spreadsheet header comes from the job's
 * own column map, so the form edits the SAME cells the worker reads.
 */
type FieldKind = 'text' | 'product' | 'user' | 'currency' | 'status';

interface FieldSpec {
  key:
    | 'externalId'
    | 'customerName'
    | 'customerPhone'
    | 'productCode'
    | 'quantity'
    | 'totalAmount'
    | 'currency'
    | 'status'
    | 'createdAt'
    | 'mediaBuyerCode'
    | 'closerCode'
    | 'customerAddress'
    | 'deliveryState';
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
}

const FIELDS: FieldSpec[] = [
  { key: 'externalId', label: 'Order ID', kind: 'text', required: true, hint: 'Unique ID from your source file' },
  { key: 'createdAt', label: 'Date', kind: 'text' },
  { key: 'customerName', label: 'Customer name', kind: 'text', required: true },
  { key: 'customerPhone', label: 'Phone', kind: 'text', required: true },
  { key: 'productCode', label: 'Product', kind: 'product', required: true },
  { key: 'quantity', label: 'Quantity', kind: 'text' },
  { key: 'totalAmount', label: 'Cost', kind: 'text', hint: 'Numbers only: 100000, not 100,000' },
  { key: 'currency', label: 'Currency', kind: 'currency' },
  { key: 'status', label: 'Status', kind: 'status', required: true },
  { key: 'mediaBuyerCode', label: 'Media buyer', kind: 'user' },
  { key: 'closerCode', label: 'CS closer', kind: 'user' },
  { key: 'customerAddress', label: 'Address', kind: 'text' },
  { key: 'deliveryState', label: 'State', kind: 'text' },
];

/**
 * Guess which fields the failure reason is complaining about, so they can be
 * highlighted. Purely a presentation aid: the server is the authority on whether
 * a row is valid, and it re-validates everything on submit.
 */
function fieldsInReason(reason: string | null): Set<FieldSpec['key']> {
  const out = new Set<FieldSpec['key']>();
  if (!reason) return out;
  const r = reason.toLowerCase();
  if (r.includes('external id')) out.add('externalId');
  if (r.includes('customer name') || r.includes('name')) out.add('customerName');
  if (r.includes('phone')) out.add('customerPhone');
  if (r.includes('product')) out.add('productCode');
  if (r.includes('status')) out.add('status');
  if (r.includes('media buyer')) out.add('mediaBuyerCode');
  if (r.includes('cs code')) out.add('closerCode');
  if (r.includes('currency') || r.includes('country scope')) out.add('currency');
  if (r.includes('totalamount') || r.includes('amount') || r.includes('cost')) out.add('totalAmount');
  if (r.includes('state')) out.add('deliveryState');
  if (r.includes('email')) out.add('customerName');
  return out;
}

interface FixImportRowModalProps {
  open: boolean;
  jobId: string;
  row: ImportJobRow | null;
  onClose: () => void;
  /** Called after the row imports successfully, so the list can refresh. */
  onFixed: () => void;
}

/**
 * View, correct and re-import a single FAILED import row.
 *
 * The form is built from the job's OWN column map, and every edit is sent back
 * keyed by the file's original header names — so the corrected row goes through
 * the exact same validation, branch/currency derivation and audit path as a
 * normal imported row. Codes are chosen from dropdowns of records that actually
 * exist in this job's company, which makes the most common failures (unknown
 * product / user / status / currency) impossible to re-enter.
 */
export function FixImportRowModal({ open, jobId, row, onClose, onFixed }: FixImportRowModalProps) {
  const [detail, setDetail] = useState<ImportJobRowDetail | null>(null);
  const [options, setOptions] = useState<ImportRowOptions | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rowIndex = row?.rowIndex ?? null;

  useEffect(() => {
    if (!open || rowIndex == null) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSubmitError(null);
    Promise.all([getImportJobRow(jobId, rowIndex), getImportRowOptions(jobId)])
      .then(([d, o]) => {
        if (cancelled) return;
        setDetail(d);
        setOptions(o);
        setValues({ ...(d.rawData ?? {}) });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load this row.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, jobId, rowIndex]);

  /** Map a form field to the spreadsheet header it edits. */
  const headerFor = useCallback(
    (key: FieldSpec['key']): string | null => {
      if (!detail) return null;
      if (key === 'externalId') return detail.externalIdColumn;
      const cm = detail.columnMap;
      if (!cm) return null;
      const map: Record<string, string | undefined> = {
        customerName: cm.customerName,
        customerPhone: cm.customerPhone,
        customerAddress: cm.customerAddress,
        deliveryState: cm.deliveryState,
        totalAmount: cm.totalAmount,
        createdAt: cm.createdAt,
        quantity: cm.quantity,
        status: cm.status,
        productCode: cm.productCode,
        mediaBuyerCode: cm.mediaBuyerCode,
        closerCode: cm.closerCode,
        currency: cm.currency,
      };
      return map[key] ?? null;
    },
    [detail],
  );

  const highlighted = useMemo(() => fieldsInReason(detail?.reason ?? null), [detail]);

  /** Only fields the file actually mapped are editable. */
  const visibleFields = useMemo(
    () => FIELDS.filter((f) => headerFor(f.key) != null),
    [headerFor],
  );

  /**
   * Cells present in the file that no mapped field edits — WhatsApp number,
   * Gender, Delivery agent, Comments, and anything else the sheet carried.
   * They are shown read-only so the row is fully legible: when a row is blocked
   * by one bad field, everything else it contained should still be visible, not
   * hidden because the importer happens not to map that column.
   */
  const extraCells = useMemo(() => {
    const raw = detail?.rawData;
    if (!raw) return [];
    const mapped = new Set(
      FIELDS.map((f) => headerFor(f.key)).filter((h): h is string => !!h),
    );
    return Object.entries(raw)
      .filter(([header, value]) => !mapped.has(header) && value != null && String(value).trim() !== '')
      .map(([header, value]) => ({ header, value: String(value) }));
  }, [detail, headerFor]);

  const setField = useCallback(
    (key: FieldSpec['key'], v: string) => {
      const header = headerFor(key);
      if (!header) return;
      setValues((prev) => ({ ...prev, [header]: v }));
    },
    [headerFor],
  );

  const getField = useCallback(
    (key: FieldSpec['key']): string => {
      const header = headerFor(key);
      if (!header) return '';
      return values[header] ?? '';
    },
    [headerFor, values],
  );

  const onSubmit = useCallback(async () => {
    if (rowIndex == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await resubmitImportRow({ jobId, rowIndex, values });
      if (res.ok) {
        onFixed();
        onClose();
      } else {
        // Still invalid — show the next problem and let the user keep editing.
        setSubmitError(res.reason);
        setDetail((d) => (d ? { ...d, reason: res.reason } : d));
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not import this row.');
    } finally {
      setSubmitting(false);
    }
  }, [jobId, rowIndex, values, onFixed, onClose]);

  const productOptions = useMemo(
    () =>
      (options?.products ?? []).map((p) => ({
        value: p.code,
        label: p.code,
        description: p.name,
      })),
    [options],
  );
  const userOptions = useMemo(
    () =>
      (options?.users ?? []).map((u) => ({
        value: u.code,
        label: `${u.code} — ${u.name}`,
        description: u.role,
      })),
    [options],
  );
  const currencyOptions = useMemo(
    () =>
      (options?.currencies ?? []).map((c) => ({
        value: c.code,
        label: c.code,
        description: c.countryName ?? undefined,
      })),
    [options],
  );
  const statusOptions = useMemo(
    () =>
      (options?.statuses ?? []).map((s) => ({
        value: s.label,
        label: s.label,
        description: s.status,
      })),
    [options],
  );

  function optionsFor(kind: FieldKind) {
    if (kind === 'product') return productOptions;
    if (kind === 'user') return userOptions;
    if (kind === 'currency') return currencyOptions;
    if (kind === 'status') return statusOptions;
    return [];
  }

  const noSnapshot = !loading && detail != null && detail.rawData == null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl" aria-labelledby="fix-row-title">
      <div className="flex max-h-[85vh] flex-col">
        <div className="border-b border-app-border px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-app-fg-muted">
            Failed row {row != null ? row.rowIndex + 1 : ''}
          </p>
          <h2 id="fix-row-title" className="text-lg font-semibold text-app-fg">
            Fix and import this row
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner />
            </div>
          ) : loadError ? (
            <InlineNotification variant="danger" message={loadError} />
          ) : noSnapshot ? (
            <InlineNotification
              variant="warning"
              message={
                "This row's values could not be recovered: it has no saved snapshot and the " +
                'uploaded file is no longer readable. Correct the row in your spreadsheet and ' +
                'upload the file again.'
              }
            />
          ) : (
            <>
              {detail?.reason && (
                <div className="mb-4">
                  <InlineNotification variant="danger" message={detail.reason} />
                </div>
              )}

              {detail?.recoveredFromFile && (
                <div className="mb-4">
                  <InlineNotification
                    variant="info"
                    message="These values were read back from the uploaded file, because this row failed before per-row values were saved."
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {visibleFields.map((f) => {
                  const isBad = highlighted.has(f.key);
                  const common = {
                    label: f.label,
                    required: f.required,
                    ...(isBad ? { error: 'Check this field' } : f.hint ? { hint: f.hint } : {}),
                  };
                  if (f.kind === 'text') {
                    return (
                      <TextInput
                        key={f.key}
                        {...common}
                        value={getField(f.key)}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    );
                  }
                  return (
                    <SearchableSelect
                      key={f.key}
                      {...common}
                      value={getField(f.key)}
                      onChange={(v) => setField(f.key, v)}
                      options={optionsFor(f.kind)}
                      clearable={!f.required}
                      placeholder={`Select ${f.label.toLowerCase()}`}
                    />
                  );
                })}
              </div>

              {/* Everything else the file carried on this row. Read-only: these
                  columns are not part of the import mapping, so editing them
                  would change nothing. Shown so the row can be identified and
                  judged in full. */}
              {extraCells.length > 0 && (
                <div className="mt-5 rounded-lg border border-app-border bg-app-bg p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-app-fg-muted">
                    Also on this row (not imported)
                  </p>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    {extraCells.map((c) => (
                      <div key={c.header} className="min-w-0">
                        <dt className="text-xs text-app-fg-muted">{c.header}</dt>
                        <dd className="truncate text-sm text-app-fg" title={c.value}>
                          {c.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {submitError && (
                <div className="mt-4">
                  <InlineNotification variant="danger" message={submitError} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-app-border px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={submitting || loading || noSnapshot}>
            {submitting ? 'Importing…' : 'Save and import row'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
