import { useMemo, useState } from 'react';
import { Form, Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
import { AmountInput } from '~/components/ui/amount-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { PageNotification } from '~/components/ui/page-notification';
import { EmptyState } from '~/components/ui/empty-state';
import { useCurrenciesCatalog } from '~/contexts/currencies-catalog-context';
import type { Product } from './types';

export interface OfferLineInput {
  label: string;
  quantity: number;
  price: string;
  imageUrl?: string;
  /** Non-base currency prices keyed by code. */
  prices?: Record<string, string>;
}

interface Props {
  mode: 'create' | 'edit';
  products: Product[] | null;
  productsLoadError: string | null;
  returnTo: string;
  busy: boolean;
  error?: string;
  initialName?: string;
  initialProductId?: string;
  initialLines?: OfferLineInput[];
}

const EMPTY_LINE: OfferLineInput = { label: '', quantity: 1, price: '', prices: {} };

/**
 * Shared create/edit offer form. Compact-table layout: offer name + product on
 * top, then one editable row per offer line (Label | Qty | ₦ | per-currency | image).
 * Used by both the create page and the edit page so they stay identical.
 */
export function OfferForm({
  mode,
  products,
  productsLoadError,
  returnTo,
  busy,
  error,
  initialName = '',
  initialProductId = '',
  initialLines,
}: Props) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState(initialName);
  const [productId, setProductId] = useState(initialProductId);
  const [lines, setLines] = useState<OfferLineInput[]>(
    initialLines && initialLines.length > 0 ? initialLines : [EMPTY_LINE],
  );

  const currencies = useCurrenciesCatalog();
  // Non-base currency columns: any active catalog currency, PLUS any currency that
  // already has a price on this offer's lines (so existing multi-currency prices
  // are always visible even if the catalog is stale/scoped differently).
  const extraCurrencies = useMemo(() => {
    const map = new Map<string, { code: string; symbol: string }>();
    for (const c of currencies) {
      if (c.active && !c.isDefault) map.set(c.code.toUpperCase(), { code: c.code, symbol: c.symbol });
    }
    for (const line of lines) {
      for (const code of Object.keys(line.prices ?? {})) {
        const up = code.toUpperCase();
        if (up === 'NGN') continue;
        if (!map.has(up)) {
          const known = currencies.find((c) => c.code.toUpperCase() === up);
          map.set(up, { code: up, symbol: known?.symbol ?? up });
        }
      }
    }
    return [...map.values()];
  }, [currencies, lines]);

  const productOptions = useMemo(
    () => (products ?? []).map((p) => ({ value: p.id, label: `${p.name} (₦${Number(p.baseSalePrice).toLocaleString()})` })),
    [products],
  );
  const selectedProduct = useMemo(() => (products ?? []).find((p) => p.id === productId) ?? null, [products, productId]);
  const gallery = useMemo(
    () => (selectedProduct?.galleryImageUrls ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0),
    [selectedProduct],
  );
  const basePrice = useMemo(() => {
    const n = Number(String(selectedProduct?.baseSalePrice ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  }, [selectedProduct]);
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '');

  const itemsJson = useMemo(() => JSON.stringify(lines), [lines]);

  const patchLine = (idx: number, patch: Partial<OfferLineInput>) =>
    setLines((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const patchLinePrice = (idx: number, code: string, raw: string) =>
    setLines((p) => p.map((x, i) => (i === idx ? { ...x, prices: { ...(x.prices ?? {}), [code]: raw } } : x)));

  return (
    <div className="space-y-4">
      <PageHeader
        title={isEdit ? 'Edit offer' : 'Create offer'}
        description="Bundle products into a reusable offer. Add a line per package, set its price per currency."
        backTo={returnTo}
      />

      {error ? <PageNotification variant="error" message={error} durationMs={8000} onDismiss={() => {}} /> : null}
      {productsLoadError ? (
        <PageNotification variant="error" message={productsLoadError} durationMs={8000} onDismiss={() => {}} />
      ) : null}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value={isEdit ? 'updateOffer' : 'createOffer'} />
        <input type="hidden" name="productId" value={productId} readOnly />
        <input type="hidden" name="itemsJson" value={itemsJson} readOnly />

        {/* Offer details */}
        <div className="card p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput
              name="name"
              label="Offer name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Slim Bundle"
            />
            <SearchableSelect
              id="offer-product"
              label="Product"
              value={productId}
              onChange={(v) => {
                setProductId(v);
                setLines((prev) => prev.map((l) => ({ ...l, imageUrl: undefined })));
              }}
              options={productOptions}
              placeholder={products === null ? 'Loading products…' : 'Select product…'}
              searchPlaceholder="Search products…"
              disabled={products === null}
            />
          </div>
        </div>

        {/* Offer lines — compact table */}
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between gap-2 border-b border-app-border px-4 py-3">
            <h3 className="text-sm font-semibold text-app-fg">Offer lines</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => setLines((p) => p.concat([{ ...EMPTY_LINE }]))}>
              + Add line
            </Button>
          </div>

          {lines.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No lines yet" description="Add a line for each offer package." variant="inline" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-app-elevated text-left text-xs uppercase tracking-wide text-app-muted-fg">
                  <tr>
                    <th className="px-3 py-2 font-medium">Label</th>
                    <th className="w-20 px-3 py-2 font-medium">Qty</th>
                    <th className="w-40 px-3 py-2 font-medium">Price (₦)</th>
                    {extraCurrencies.map((c) => (
                      <th key={c.code} className="w-40 px-3 py-2 font-medium">
                        Price ({c.symbol} {c.code})
                      </th>
                    ))}
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {lines.map((it, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="px-3 py-2">
                        <TextInput
                          value={it.label}
                          onChange={(e) => patchLine(idx, { label: e.target.value })}
                          placeholder="Buy 2"
                        />
                        {/* Image picker tucked under the label to keep the row tight */}
                        {productId && gallery.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {gallery.map((url) => {
                              const on = it.imageUrl === url;
                              return (
                                <button
                                  key={url}
                                  type="button"
                                  onClick={() => patchLine(idx, { imageUrl: on ? undefined : url })}
                                  className={`h-10 w-10 shrink-0 overflow-hidden rounded-md border ${on ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-app-border hover:border-app-fg-muted'}`}
                                  title={on ? 'Selected image' : 'Use this image'}
                                >
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <NumberInput
                          min={1}
                          fallbackValue={1}
                          value={it.quantity}
                          onValueChange={(n) => patchLine(idx, { quantity: n })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <AmountInput
                          prefix="₦"
                          value={it.price}
                          onChange={(raw) => patchLine(idx, { price: raw })}
                          placeholder={Number.isFinite(basePrice) ? fmt(basePrice * (it.quantity ?? 1)) : '0'}
                        />
                      </td>
                      {extraCurrencies.map((c) => (
                        <td key={c.code} className="px-3 py-2">
                          <AmountInput
                            prefix={c.symbol}
                            value={it.prices?.[c.code] ?? ''}
                            onChange={(raw) => patchLinePrice(idx, c.code, raw)}
                            placeholder="0"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}
                          disabled={lines.length <= 1}
                          className="rounded-md p-1.5 text-app-muted-fg hover:bg-app-hover hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Remove line"
                          aria-label="Remove line"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {extraCurrencies.length > 0 && (
            <p className="border-t border-app-border px-4 py-2 text-xs text-app-muted-fg">
              Leave a currency price blank to hide that line in that currency.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Link to={returnTo} className="btn-secondary btn-sm">
            Cancel
          </Link>
          <Button type="submit" variant="primary" size="sm" loading={busy} loadingText="Saving…">
            {isEdit ? 'Save offer' : 'Create offer'}
          </Button>
        </div>
      </Form>
    </div>
  );
}
