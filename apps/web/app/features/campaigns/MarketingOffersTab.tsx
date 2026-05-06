import { useEffect, useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { Modal } from '~/components/ui/modal';
import { FormField } from '~/components/ui/form-field';
import { TableActionButton } from '~/components/ui/table-action-button';
import { NairaPrice } from '~/components/ui/naira-price';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useToast } from '~/components/ui/toast';
import type { OfferGroupRow, Product } from './types';

export interface MarketingOffersTabProps {
  products: Product[];
  offerGroups: OfferGroupRow[];
  offerGroupsLoadError?: string | null;
  canManageOfferTemplates: boolean;
}

/**
 * Offer groups hub: reusable multi-item offers rendered as cards.
 * Browse: `marketing.campaigns`. Mutations: `marketing.offerTemplate` (same as legacy tiers).
 */
export function MarketingOffersTab({
  products,
  offerGroups,
  offerGroupsLoadError = null,
  canManageOfferTemplates,
}: MarketingOffersTabProps) {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const clearFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [viewingOffer, setViewingOffer] = useState<OfferGroupRow | null>(null);

  const [dismissedOffersError, setDismissedOffersError] = useState(false);
  useEffect(() => {
    if (offerGroupsLoadError) setDismissedOffersError(false);
  }, [offerGroupsLoadError]);

  const [filterProductId, setFilterProductId] = useState('');
  const [offerSearch, setOfferSearch] = useState('');

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Editor was moved to a dedicated Create/Edit page.

  const productOptions = useMemo(
    () =>
      [{ value: '', label: 'All products' }].concat(
        products.map((p) => ({
          value: p.id,
          label: `${p.name} (₦${Number(p.baseSalePrice).toLocaleString()})`,
        })),
      ),
    [products],
  );

  const filteredGroups = useMemo(() => {
    let rows = offerGroups;
    if (filterProductId) {
      rows = rows.filter((g) => g.items.some((it) => it.productId === filterProductId));
    }
    const q = offerSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((g) => {
        if (g.name.toLowerCase().includes(q)) return true;
        return g.items.some((it) => it.label.toLowerCase().includes(q) || it.productName.toLowerCase().includes(q));
      });
    }
    return rows;
  }, [offerGroups, filterProductId, offerSearch]);

  // (Create/Edit page now owns product selection + images + price inheritance.)

  useEffect(() => {
    const flag = searchParams.get('createOffer');
    if (flag !== '1') return;
    if (!canManageOfferTemplates) return;
    // Dedicated page flow now.
    const next = new URLSearchParams(searchParams);
    next.delete('createOffer');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on URL flag
  }, [searchParams, canManageOfferTemplates]);

  const goToCreateOffer = () => {
    const returnTo = `/admin/products?${new URLSearchParams({ tab: 'offers' }).toString()}`;
    window.location.href = `/admin/marketing/offers/new?${new URLSearchParams({ returnTo }).toString()}`;
  };

  useEffect(() => {
    if (!clearFetcher.data) return;
    if (clearFetcher.data.success) {
      toast.success('Legacy offers cleared');
      setShowClearConfirm(false);
    } else if (clearFetcher.data.error) {
      toast.error('Clear failed', clearFetcher.data.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- data reference changes only
  }, [clearFetcher.data]);

  return (
    <div className="space-y-4">
      {offerGroupsLoadError && !dismissedOffersError ? (
        <PageNotification
          variant="error"
          message={offerGroupsLoadError}
          durationMs={8000}
          onDismiss={() => setDismissedOffersError(true)}
        />
      ) : null}

      {!canManageOfferTemplates ? (
        <InlineNotification
          variant="info"
          message="Viewing is available, but creating/editing requires Offers permission (products.offers)."
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <FormField label="Search offers" htmlFor="offers-hub-search">
              <SearchInput
                id="offers-hub-search"
                value={offerSearch}
                onChange={setOfferSearch}
                placeholder="Name or product…"
              />
            </FormField>
          </div>
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <SearchableSelect
              id="offers-filter-product"
              label="Product filter"
              value={filterProductId}
              onChange={setFilterProductId}
              options={productOptions}
              placeholder="All products"
              searchPlaceholder="Search products…"
            />
          </div>
        </div>

        {/* Actions moved to the page header (FormsPage) */}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredGroups.map((g) => {
          const first = g.items[0];
          const titleProduct = first?.productName ?? '—';
          return (
            <article
              key={g.id}
              className="group relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm hover:shadow-md hover:border-app-border transition-all duration-200 flex flex-col min-h-[180px]"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-semibold text-app-fg text-base leading-snug line-clamp-2 min-w-0 flex-1">
                  {g.name}
                </h3>
                <StatusBadge status={g.status} className="shrink-0" />
              </div>
              <p className="text-xs text-app-fg-muted mb-3">
                Product: <span className="font-medium text-app-fg">{titleProduct}</span> · {g.items.length} items
              </p>
              <div className="space-y-2 flex-1">
                {g.items.slice(0, 3).map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-app-fg line-clamp-1">{it.label}</span>
                    <span className="text-app-fg-muted whitespace-nowrap">
                      x{it.quantity} · <NairaPrice amount={Number(it.price)} />
                    </span>
                  </div>
                ))}
                {g.items.length > 3 ? (
                  <div className="text-xs text-app-fg-muted">+{g.items.length - 3} more</div>
                ) : null}
              </div>
              <div className="pt-4 flex justify-end gap-2">
                <TableActionButton type="button" variant="primary" onClick={() => setViewingOffer(g)}>
                  View
                </TableActionButton>
              </div>
            </article>
          );
        })}
      </div>

      {viewingOffer ? (
        <Modal
          open
          onClose={() => setViewingOffer(null)}
          maxWidth="max-w-2xl"
          role="dialog"
          aria-labelledby="offer-view-modal-title"
          contentClassName="p-0 max-h-[90dvh] flex flex-col overflow-hidden border border-app-border"
        >
          <div className="flex items-center justify-between gap-3 p-4 border-b border-app-border shrink-0">
            <div className="min-w-0">
              <h2 id="offer-view-modal-title" className="text-lg font-semibold text-app-fg truncate">
                View · {viewingOffer.name}
              </h2>
              <p className="text-xs text-app-fg-muted mt-0.5">
                Product:{' '}
                <span className="font-medium text-app-fg">
                  {viewingOffer.items[0]?.productName ?? '—'}
                </span>{' '}
                · {viewingOffer.items.length} items
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={viewingOffer.status} />
              <button
                type="button"
                onClick={() => setViewingOffer(null)}
                className="p-2 rounded-lg text-app-fg-muted hover:text-app-fg hover:bg-app-hover"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-4 space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-app-fg">Offer items</h3>
              <div className="space-y-2">
                {viewingOffer.items
                  .slice()
                  .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                  .map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-app-border bg-app-elevated px-3 py-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {it.imageUrl ? (
                          <a
                            href={it.imageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="w-10 h-10 rounded-lg overflow-hidden border border-app-border bg-app-hover shrink-0"
                            title="Open image"
                          >
                            <img src={it.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          </a>
                        ) : (
                          <div className="w-10 h-10 rounded-lg border border-app-border bg-app-hover shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-app-fg truncate">{it.label}</p>
                          <p className="text-xs text-app-fg-muted truncate">{it.productName}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm text-app-fg whitespace-nowrap">
                          <NairaPrice amount={Number(it.price) * Number(it.quantity)} />
                        </p>
                        <p className="text-xs text-app-fg-muted whitespace-nowrap">
                          x{it.quantity} · <NairaPrice amount={Number(it.price)} /> each
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-app-border shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => setViewingOffer(null)} className="btn-secondary w-full sm:w-auto">
              Close
            </button>
          </div>
        </Modal>
      ) : null}

      <ConfirmActionModal
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="Clear legacy offers?"
        description="This will archive ALL legacy offer tiers and detach forms that still reference them. This does not delete your new Offer Groups."
        confirmLabel="Clear legacy offers"
        variant="danger"
        loading={clearFetcher.state !== 'idle'}
        onConfirm={() => {
          const fd = new FormData();
          fd.set('intent', 'clearLegacyOffers');
          clearFetcher.submit(fd, { method: 'post' });
        }}
      />
    </div>
  );
}
