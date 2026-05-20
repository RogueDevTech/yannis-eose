import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { InlineNotification } from '~/components/ui/inline-notification';
import { AmountInput } from '~/components/ui/amount-input';
import { useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import type { Product } from './types';

type DraftLine = {
  label: string;
  quantity: number;
  price: string;
  imageUrl?: string;
  /** True once the user hand-edits the price — suppresses the qty × base auto-prefill. */
  priceTouched?: boolean;
};

/**
 * Auto-price for a line as a raw (comma-free) string: `quantity × normal price`
 * so a qty-3 line defaults to 3× the product's base price. '' when unavailable.
 */
function productLinePriceRaw(product: Product | null | undefined, quantity: number): string {
  const base = Number(product?.baseSalePrice);
  if (!product || !Number.isFinite(base) || base <= 0) return '';
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  return String(base * qty);
}

export function OfferGroupCreateModal({
  open,
  onClose,
  products,
  productsLoading,
  actionUrl,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  productsLoading?: boolean;
  actionUrl: string;
  onCreated?: () => void;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const { toast } = useToast();

  const submitting = fetcher.state !== 'idle';
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ label: '', quantity: 1, price: '' }]);

  useEffect(() => {
    if (!open) {
      setInlineError(null);
      setName('');
      setProductId('');
      setLines([{ label: '', quantity: 1, price: '' }]);
    }
  }, [open]);

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: p.id,
        label: `${p.name} (₦${Number(p.baseSalePrice).toLocaleString()})`,
      })),
    [products],
  );

  const selectedProduct = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);
  const gallery = useMemo(
    () => (selectedProduct?.galleryImageUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0),
    [selectedProduct?.galleryImageUrls],
  );

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) => ({
          label: l.label,
          quantity: l.quantity,
          price: Number(l.price.replace(/,/g, '').trim()) || 0,
          imageUrl: l.imageUrl,
        })),
      ),
    [lines],
  );

  const handleSuccess = useCallback(() => {
    toast.success('Offer created');
    onCreated?.();
    onClose();
  }, [onClose, onCreated, toast]);
  useCloseOnFetcherSuccess(fetcher, handleSuccess, { intent: 'createOfferGroup' });

  const error = inlineError ?? fetcherSurface.errorMatchingIntent('createOfferGroup');

  // Hard guard against rapid double / triple clicks. The button is also
  // `disabled={submitting}`, but React's state update lags one tick behind a
  // fast double-click, which previously let two submissions through and
  // produced duplicate offer groups in the DB. Migration 0122 + the service
  // pre-check now reject duplicates server-side too — this ref just trims the
  // round-trip when the user double-clicks.
  const inFlightRef = useRef(false);
  useEffect(() => {
    if (fetcher.state === 'idle') inFlightRef.current = false;
  }, [fetcher.state]);

  const submit = () => {
    if (inFlightRef.current || submitting) return;
    setInlineError(null);
    const trimmedName = name.trim();
    if (!trimmedName) return setInlineError('Offer name is required.');
    if (!productId) return setInlineError(productsLoading ? 'Wait for products to load.' : 'Select a product.');
    const nonEmpty = lines.filter((l) => l.label.trim().length > 0);
    if (nonEmpty.length === 0) return setInlineError('Add at least one offer item.');

    inFlightRef.current = true;
    const fd = new FormData();
    fd.set('intent', 'createOfferGroup');
    fd.set('offerGroupName', trimmedName);
    fd.set('productId', productId);
    fd.set('itemsJson', itemsJson);
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      maxWidth="max-w-2xl"
      contentClassName="p-0 max-h-[92dvh] flex flex-col"
    >
      <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-app-fg truncate">Create offer</h2>
          <p className="text-xs text-app-fg-muted mt-0.5">Create a reusable Offer Group (cards) tied to one product.</p>
        </div>
        <button
          type="button"
          onClick={submitting ? undefined : onClose}
          className="text-app-fg-muted hover:text-app-fg shrink-0"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        {productsLoading ? (
          <InlineNotification variant="info" message="Loading products… (this can take a few seconds)" />
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput label="Offer name" value={name} onChange={(e) => setName(e.target.value)} required />
          <SearchableSelect
            id="create-offer-product"
            label="Product"
            value={productId}
            onChange={(v) => {
              setProductId(v);
              const prod = products.find((p) => p.id === v) ?? null;
              setLines((prev) =>
                prev.map((l) => {
                  // Seed each line with qty × normal price unless hand-priced.
                  const auto = productLinePriceRaw(prod, l.quantity);
                  return {
                    ...l,
                    imageUrl: undefined,
                    price: !l.priceTouched && auto ? auto : l.price,
                  };
                }),
              );
            }}
            options={productOptions}
            placeholder="Select product…"
            searchPlaceholder="Search products…"
            disabled={productsLoading || productOptions.length === 0}
            loading={productsLoading}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-app-fg">Offer items</h3>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setLines((p) =>
                  p.concat([{ label: '', quantity: 1, price: productLinePriceRaw(selectedProduct, 1) }]),
                )
              }
            >
              + Add line
            </Button>
          </div>

          <div className="space-y-3">
            {lines.map((it, idx) => (
              <div key={idx} className="rounded-xl border border-app-border bg-app-surface p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <TextInput
                    label="Label"
                    value={it.label}
                    onChange={(e) =>
                      setLines((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Buy 1 get 1 free"
                  />
                  <NumberInput
                    label="Qty"
                    min={1}
                    fallbackValue={1}
                    value={it.quantity}
                    onValueChange={(n) =>
                      setLines((p) =>
                        p.map((x, i) => {
                          if (i !== idx) return x;
                          // Qty change re-seeds price to n × normal price
                          // unless the user has hand-priced this line.
                          const auto = productLinePriceRaw(selectedProduct, n);
                          const price = !x.priceTouched && auto ? auto : x.price;
                          return { ...x, quantity: n, price };
                        }),
                      )
                    }
                  />
                  <div>
                    <label className="block text-xs font-medium text-app-fg-muted mb-1">Price (₦)</label>
                    <AmountInput
                      prefix="₦"
                      value={it.price}
                      onChange={(raw) =>
                        setLines((p) =>
                          p.map((x, i) => (i === idx ? { ...x, price: raw, priceTouched: true } : x)),
                        )
                      }
                      placeholder={selectedProduct ? `${Number(selectedProduct.baseSalePrice).toLocaleString()}` : '0'}
                    />
                  </div>
                </div>

                {!productId ? null : gallery.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-app-fg-muted mb-2">Pick image for this line (optional)</p>
                    <div className="flex flex-wrap gap-2">
                      {gallery.map((url) => {
                        const selected = it.imageUrl === url;
                        return (
                          <button
                            key={url}
                            type="button"
                            onClick={() =>
                              setLines((p) => p.map((x, i) => (i === idx ? { ...x, imageUrl: url } : x)))
                            }
                            className={[
                              'w-16 h-16 rounded-lg border overflow-hidden bg-app-hover shrink-0',
                              selected ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-app-border hover:border-app-border/80',
                            ].join(' ')}
                          >
                            <img src={url} alt="" className="w-full h-full object-cover" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <InlineNotification variant="info" message="This product has no gallery images yet." />
                )}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}
                  >
                    Remove line
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <div className="rounded-md bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2">
            <p className="text-sm text-danger-700 dark:text-danger-300">{error}</p>
          </div>
        ) : null}
      </div>

      <div className="px-5 py-3 border-t border-app-border flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={submit} loading={submitting} disabled={submitting}>
          Create offer
        </Button>
      </div>
    </Modal>
  );
}

