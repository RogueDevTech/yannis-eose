import { useEffect, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { Pagination } from '~/components/ui/pagination';
import type { Product } from './types';
import { ProductViewModal } from './ProductViewModal';

interface ProductsListPageProps {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
  canEditProduct?: boolean;
  /** Shown only when user has products.create (e.g. warehouse); media buyers must not see Add Product. */
  canCreateProduct?: boolean;
}

function formatPriceRange(product: Product): string {
  const offers = product.offers ?? [];
  if (offers.length === 0) {
    return `\u20A6${Number(product.baseSalePrice).toLocaleString()}`;
  }
  const prices = offers.map((o) => parseFloat(String(o.price))).filter((p) => !isNaN(p)).sort((a, b) => a - b);
  if (prices.length === 0) {
    return `\u20A6${Number(product.baseSalePrice).toLocaleString()}`;
  }
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (prices.length === 1 || first === last) {
    return `\u20A6${(first ?? 0).toLocaleString()}`;
  }
  return `\u20A6${(first ?? 0).toLocaleString()} \u2013 \u20A6${(last ?? 0).toLocaleString()}`;
}

function formatOffersStructure(offers: Product['offers'] | null | undefined): string {
  if (!offers?.length) return '\u2014';
  return offers
    .map((o) => `${o.qty} \u20A6${Number(o.price).toLocaleString()}${o.label ? ` (${o.label})` : ''}`)
    .join(' \u2022 ');
}

function OfferTiersDisplay({ offers }: { offers: Product['offers'] | null | undefined }) {
  if (!offers?.length) return <span className="text-app-fg-muted">\u2014</span>;
  return (
    <div className="space-y-2 text-xs text-app-fg-muted whitespace-normal">
      {offers.map((o, idx) => (
        <div key={`${o.qty}-${o.price}-${idx}`} className="flex items-baseline gap-x-3 whitespace-nowrap">
          <span className="tabular-nums w-5 text-right font-medium">{o.qty}</span>
          <span className="text-app-fg-muted">-</span>
          <span className="tabular-nums font-medium">{'\u20A6'}{Number(o.price).toLocaleString()}</span>
          {o.label && (
            <span className="text-app-fg-muted">({o.label})</span>
          )}
        </div>
      ))}
    </div>
  );
}

function getDisplayCategory(product: Product): string {
  if (product.categoryName) return product.categoryName;
  if (product.category) return product.category;
  return '\u2014';
}

const ViewIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 116.364 6.364l-1.757 1.757" />
  </svg>
);

export function ProductsListPage({
  products,
  total,
  page,
  totalPages,
  canEditProduct = false,
  canCreateProduct = false,
}: ProductsListPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const safeTotalPages = Math.max(1, totalPages);

  useEffect(() => {
    if (!viewProduct) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewProduct(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewProduct]);

  const filteredProducts = products.filter((product) => {
    if (statusFilter !== 'ALL' && product.status !== statusFilter) return false;
    if (
      searchQuery &&
      !product.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  const goToPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), safeTotalPages);
    const next = new URLSearchParams(searchParams);
    next.set('page', String(clamped));
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader
        title="Products"
        description="Manage your product catalog and bundle offers"
        actions={
          <>
            <PageRefreshButton />
            {canCreateProduct ? (
              <Link to="/admin/products/new" className="btn-primary">
                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Product
              </Link>
            ) : null}
          </>
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Total Products', value: total, valueClassName: 'text-app-fg' },
          {
            label: 'Active',
            value: products.filter((p) => p.status === 'ACTIVE').length,
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'Categories',
            value: new Set(products.map((p) => p.category).filter(Boolean)).size,
            valueClassName: 'text-app-fg',
          },
        ]}
      />

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by name..."
            className="flex-1"
          />
          <FormSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Status' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'ARCHIVED', label: 'Archived' },
            ]}
            className="w-full sm:w-40"
          />
        </div>
      </div>

      {/* Products card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredProducts.map((product) => (
          <article
            key={product.id}
            className="group relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm hover:shadow-md hover:border-app-border transition-all duration-200 flex flex-col min-h-[180px] h-full"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="font-semibold text-app-fg text-base leading-snug line-clamp-2 min-w-0 flex-1">
                {product.name}
              </h3>
              <StatusBadge status={product.status} size="sm" />
            </div>

            <div className="text-sm text-app-fg-muted mb-4 flex-1">
              {getDisplayCategory(product) !== '\u2014' && (
                <>
                  <span className="text-app-fg-muted">{getDisplayCategory(product)}</span>
                  <span className="mx-1.5">·</span>
                </>
              )}
              {product.brandName && (
                <>
                  <span className="text-app-fg-muted">{product.brandName}</span>
                  <span className="mx-1.5">·</span>
                </>
              )}
              <time dateTime={product.createdAt}>
                {new Date(product.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </time>
            </div>

            {(product.description || (product.offers && product.offers.length > 0)) && (
              <div className="mb-4 pt-3 border-t border-app-border">
                <p className="text-xs font-medium text-app-fg-muted dark:text-app-fg-muted uppercase tracking-wider mb-2">
                  Offer tiers · Price
                </p>
                <div className="space-y-1">
                  {product.offers && product.offers.length > 0 && (
                    <OfferTiersDisplay offers={product.offers} />
                  )}
                  <p className="text-sm font-medium text-app-fg-muted">
                    {formatPriceRange(product)}
                  </p>
                  {product.description && (
                    <p className="text-xs text-app-fg-muted line-clamp-2">
                      {product.description}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-3 border-t border-app-border">
              <button
                type="button"
                onClick={() => setViewProduct(product)}
                className="btn-primary btn-sm inline-flex items-center gap-1.5 shrink-0"
              >
                {ViewIcon}
                <span>View</span>
              </button>
            </div>
          </article>
        ))}
        {filteredProducts.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              title={products.length === 0 ? 'No products yet' : 'No matching products found'}
              description={products.length === 0 ? 'Add your first product with Add Product above.' : 'Try adjusting your search or filters.'}
              bordered
            />
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-app-fg-muted">
          Showing {filteredProducts.length} of {total} products
        </p>
        <Pagination page={page} totalPages={safeTotalPages} onPageChange={goToPage} showLabel />
      </div>

      {/* View product modal */}
      {viewProduct && (
        <ProductViewModal
          product={viewProduct}
          canEditProduct={canEditProduct}
          onClose={() => setViewProduct(null)}
        />
      )}
    </div>
  );
}
