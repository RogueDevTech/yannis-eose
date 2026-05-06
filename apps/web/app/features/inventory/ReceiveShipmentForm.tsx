import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { AmountInput } from '~/components/ui/amount-input';
import { FormField } from '~/components/ui/form-field';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { InlineNotification } from '~/components/ui/inline-notification';
import { useFetcherToast } from '~/components/ui/toast';
import type { LocationOption, ProductOption } from './types';

interface ReceiveLineDraft {
  uid: string;
  productId: string;
  expectedQuantity: string;
  factoryCost: string;
}

export function ReceiveShipmentForm({
  products,
  locations,
  actionUrl,
  disabled = false,
}: {
  products: ProductOption[];
  locations: LocationOption[];
  actionUrl: string;
  disabled?: boolean;
}) {
  const id = useId();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data, { successMessage: 'Shipment saved' });

  const isCreating = fetcher.state !== 'idle';

  const lineUidRef = useRef(0);
  const newLineUid = () => `line-${id}-${++lineUidRef.current}`;

  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [label, setLabel] = useState('');
  const [expectedArrivalDate, setExpectedArrivalDate] = useState('');
  const [totalLandingCost, setTotalLandingCost] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ReceiveLineDraft[]>(() => [
    { uid: `line-${id}-1`, productId: '', expectedQuantity: '', factoryCost: '' },
  ]);

  if (lineUidRef.current === 0) lineUidRef.current = 1;

  const updateLine = (uid: string, patch: Partial<ReceiveLineDraft>) => {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  };

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { uid: newLineUid(), productId: '', expectedQuantity: '', factoryCost: '' },
    ]);

  const removeLine = (uid: string) => setLines((prev) => prev.filter((l) => l.uid !== uid));

  const validLines = useMemo(() => {
    return lines.filter(
      (l) =>
        l.productId &&
        Number(l.expectedQuantity) > 0 &&
        l.factoryCost !== '' &&
        Number(l.factoryCost) >= 0,
    );
  }, [lines]);

  const ready = !!destinationLocationId && validLines.length > 0;

  const selectedProductIds = useMemo(() => new Set(lines.map((l) => l.productId).filter(Boolean)), [lines]);
  const hasDuplicateProducts = useMemo(() => {
    const seen = new Set<string>();
    for (const l of lines) {
      if (!l.productId) continue;
      if (seen.has(l.productId)) return true;
      seen.add(l.productId);
    }
    return false;
  }, [lines]);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.name })),
    [products],
  );

  const buildFormData = (arrivedNow: boolean): FormData => {
    const fd = new FormData();
    fd.set('intent', 'createShipment');
    fd.set('destinationLocationId', destinationLocationId);
    fd.set('label', label.trim());
    fd.set('supplierName', supplierName.trim());
    fd.set('supplierReference', supplierReference.trim());
    fd.set('expectedArrivalDate', expectedArrivalDate);
    fd.set('totalLandingCost', totalLandingCost.trim() || '0');
    fd.set('notes', notes.trim());
    fd.set('arrivedNow', arrivedNow ? 'true' : 'false');
    fd.set(
      'lines',
      JSON.stringify(
        validLines.map((l) => ({
          productId: l.productId,
          expectedQuantity: Number(l.expectedQuantity),
          factoryCost: Number(l.factoryCost),
        })),
      ),
    );
    return fd;
  };

  const submit = (arrivedNow: boolean) => {
    if (!ready || disabled) return;
    fetcher.submit(buildFormData(arrivedNow), { method: 'post', action: actionUrl });
  };

  return (
    <div className="card p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Destination location" hint="Company-owned warehouse where goods will be received">
          <SearchableSelect
            id={`${id}-destination`}
            value={destinationLocationId}
            onChange={setDestinationLocationId}
            placeholder="Select a warehouse…"
            searchPlaceholder="Search locations…"
            disabled={disabled}
            options={locations.map((l) => ({
              value: l.id,
              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
            }))}
          />
        </FormField>
        <FormField label="Label" hint="Optional — e.g. Lagos container, May 12">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} disabled={disabled} />
        </FormField>
        <FormField label="Supplier name">
          <TextInput value={supplierName} onChange={(e) => setSupplierName(e.target.value)} maxLength={160} disabled={disabled} />
        </FormField>
        <FormField label="Supplier reference" hint="BOL / waybill / invoice number">
          <TextInput value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} maxLength={160} disabled={disabled} />
        </FormField>
        <FormField label="Expected arrival">
          <TextInput type="date" value={expectedArrivalDate} onChange={(e) => setExpectedArrivalDate(e.target.value)} disabled={disabled} />
        </FormField>
        <FormField label="Total landing cost (₦)" hint="Freight + duty + clearing — allocated across lines on verify">
          <AmountInput value={totalLandingCost} onChange={setTotalLandingCost} disabled={disabled} />
        </FormField>
      </div>

      {hasDuplicateProducts ? (
        <InlineNotification
          variant="warning"
          message="Some products appear more than once. Combine them into one line to keep costing and variance clean."
        />
      ) : null}

      <div className="space-y-2 rounded-md border border-app-border bg-app-elevated/40 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-app-fg">Line items</h3>
            <p className="text-xs text-app-fg-muted">
              Add every SKU on the supplier shipment. Verify later to post into inventory and create FIFO batches.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addLine}
            disabled={disabled || lines.length >= 200}
          >
            Add line
          </Button>
        </div>

        <div className="space-y-2">
          {lines.map((line, idx) => {
            const disableOption = (productId: string) =>
              productId !== line.productId && selectedProductIds.has(productId);
            return (
              <div
                key={line.uid}
                className="grid grid-cols-1 gap-2 rounded-md border border-app-border bg-app-card p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-5">
                  <SearchableSelect
                    id={`${line.uid}-product`}
                    value={line.productId}
                    onChange={(v) => updateLine(line.uid, { productId: v })}
                    placeholder={`Select product…`}
                    searchPlaceholder="Search products…"
                    disabled={disabled}
                    options={productOptions.map((o) => ({
                      ...o,
                      disabled: disableOption(o.value),
                      description: disableOption(o.value) ? 'Already selected' : undefined,
                    }))}
                  />
                </div>
                <div className="sm:col-span-3">
                  <TextInput
                    type="number"
                    inputMode="numeric"
                    placeholder="Qty"
                    value={line.expectedQuantity}
                    onChange={(e) => updateLine(line.uid, { expectedQuantity: e.target.value })}
                    min={1}
                    disabled={disabled}
                    aria-label={`Line ${idx + 1} quantity`}
                  />
                </div>
                <div className="sm:col-span-3">
                  <TextInput
                    type="number"
                    inputMode="decimal"
                    placeholder="Factory cost ₦"
                    value={line.factoryCost}
                    onChange={(e) => updateLine(line.uid, { factoryCost: e.target.value })}
                    min={0}
                    step="0.01"
                    disabled={disabled}
                    aria-label={`Line ${idx + 1} factory cost`}
                  />
                </div>
                <div className="sm:col-span-1 flex items-center justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(line.uid)}
                    disabled={disabled || lines.length === 1}
                    title={lines.length === 1 ? 'At least one line is required' : 'Remove line'}
                  >
                    ×
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {validLines.length === 0 ? (
          <p className="text-xs text-app-fg-muted">
            Add at least one line with product, quantity, and factory cost.
          </p>
        ) : null}
      </div>

      <FormField label="Notes" hint="Optional">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} disabled={disabled} />
      </FormField>

      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-app-elevated border-t border-app-border">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <LinkButton to="/admin/inventory/shipments" disabled={isCreating}>
            Cancel
          </LinkButton>
          <Button
            type="button"
            variant="secondary"
            disabled={!ready || disabled || isCreating}
            loading={isCreating}
            onClick={() => submit(false)}
          >
            Save as planned
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!ready || disabled || isCreating}
            loading={isCreating}
            onClick={() => submit(true)}
          >
            Already arrived
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinkButton({ to, disabled, children }: { to: string; disabled?: boolean; children: ReactNode }) {
  return disabled ? (
    <span className="btn-ghost btn-sm opacity-60 cursor-not-allowed">{children}</span>
  ) : (
    <Link to={to} prefetch="intent" className="btn-ghost btn-sm">
      {children}
    </Link>
  );
}

