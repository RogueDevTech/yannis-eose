import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import type { Product } from './types';
import { PRODUCT_STATUS_COLORS } from './types';
import { ProductViewModal } from './ProductViewModal';

interface ProductsListPageProps {
  products: Product[];
  total: number;
  canEditProduct?: boolean;
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
  if (!offers?.length) return <span className="text-surface-500">\u2014</span>;
  return (
    <div className="space-y-2 text-xs text-surface-700 dark:text-surface-200 whitespace-normal">
      {offers.map((o, idx) => (
        <div key={`${o.qty}-${o.price}-${idx}`} className="flex items-baseline gap-x-3 whitespace-nowrap">
          <span className="tabular-nums w-5 text-right font-medium">{o.qty}</span>
          <span className="text-surface-500">-</span>
          <span className="tabular-nums font-medium">{'\u20A6'}{Number(o.price).toLocaleString()}</span>
          {o.label && (
            <span className="text-surface-600 dark:text-surface-400">({o.label})</span>
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

export function ProductsListPage({ products, total, canEditProduct = false }: ProductsListPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [viewProduct, setViewProduct] = useState<Product | null>(null);

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

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Products</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Manage your product catalog and bundle offers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageRefreshButton />
          <Link to="/admin/products/new" className="btn-primary">
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Product
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total Products</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Active</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">
            {products.filter((p) => p.status === 'ACTIVE').length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Categories</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
            {new Set(products.map((p) => p.category).filter(Boolean)).size}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 py-1.5"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-full sm:w-40 py-1.5"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
      </div>

      {/* Products card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredProducts.map((product) => (
          <article
            key={product.id}
            className="group relative bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-5 shadow-sm hover:shadow-md hover:border-surface-300 dark:hover:border-surface-600 transition-all duration-200 flex flex-col min-h-[180px] h-full"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="font-semibold text-surface-900 dark:text-white text-base leading-snug line-clamp-2 min-w-0 flex-1">
                {product.name}
              </h3>
              <span className={`${PRODUCT_STATUS_COLORS[product.status] ?? 'badge'} shrink-0 capitalize`}>
                {product.status.toLowerCase()}
              </span>
            </div>

            <div className="text-sm text-surface-500 dark:text-surface-400 mb-4 flex-1">
              {getDisplayCategory(product) !== '\u2014' && (
                <>
                  <span className="text-surface-700 dark:text-surface-300">{getDisplayCategory(product)}</span>
                  <span className="mx-1.5">·</span>
                </>
              )}
              {product.brandName && (
                <>
                  <span className="text-surface-700 dark:text-surface-300">{product.brandName}</span>
                  <span className="mx-1.5">·</span>
                </>
              )}
              <time dateTime={product.createdAt}>
                {new Date(product.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </time>
            </div>

            {(product.description || (product.offers && product.offers.length > 0)) && (
              <div className="mb-4 pt-3 border-t border-surface-100 dark:border-surface-800">
                <p className="text-xs font-medium text-surface-500 dark:text-surface-500 uppercase tracking-wider mb-2">
                  Offer tiers · Price
                </p>
                <div className="space-y-1">
                  {product.offers && product.offers.length > 0 && (
                    <OfferTiersDisplay offers={product.offers} />
                  )}
                  <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                    {formatPriceRange(product)}
                  </p>
                  {product.description && (
                    <p className="text-xs text-surface-600 dark:text-surface-400 line-clamp-2">
                      {product.description}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-3 border-t border-surface-100 dark:border-surface-800">
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
          <div className="col-span-full rounded-xl border border-dashed border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800/50 py-16 text-center">
            <p className="text-surface-600 dark:text-surface-400 font-medium">
              {products.length === 0 ? 'No products yet' : 'No matching products found'}
            </p>
            <p className="text-sm text-surface-500 dark:text-surface-500 mt-1">
              {products.length === 0 ? 'Add your first product with Add Product above.' : 'Try adjusting your search or filters.'}
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-surface-800 dark:text-surface-200">
          Showing {filteredProducts.length} of {total} products
        </p>
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
