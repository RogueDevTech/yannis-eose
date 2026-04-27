import { useEffect, useState, useRef } from 'react';
import { Link, useFetcher, useSearchParams, useRevalidator } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { EmptyState } from '~/components/ui/empty-state';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
import { NairaPrice } from '~/components/ui/naira-price';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import { SearchInput } from '~/components/ui/search-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';
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
  /** Super Admin archives immediately; others submit a permission request. */
  canInstantArchiveProduct?: boolean;
}

function getDisplayCategory(product: Product): string {
  if (product.categoryName) return product.categoryName;
  if (product.category) return product.category;
  return '—';
}

/** Hash a string into a deterministic gradient pair so each product has a stable thumbnail color. */
const THUMB_GRADIENTS = [
  'from-brand-400 to-brand-600',
  'from-success-400 to-success-600',
  'from-warning-400 to-warning-600',
  'from-info-400 to-info-600',
  'from-danger-400 to-danger-600',
  'from-purple-400 to-purple-600',
  'from-pink-400 to-pink-600',
  'from-amber-400 to-amber-600',
];
function thumbGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return THUMB_GRADIENTS[h % THUMB_GRADIENTS.length]!;
}

function firstProductThumbUrl(product: Product): string | undefined {
  for (const o of product.offers ?? []) {
    const u = o.imageUrls?.[0];
    if (typeof u === 'string' && u.length > 0) return u;
  }
  return undefined;
}

function ProductThumb({ product }: { product: Product }) {
  const thumbUrl = firstProductThumbUrl(product);
  if (thumbUrl) {
    return (
      <div className="w-9 h-9 shrink-0 rounded-md border border-app-border overflow-hidden bg-app-hover shadow-sm" aria-hidden>
        <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  const initial = product.name.trim().charAt(0).toUpperCase() || '?';
  const gradient = thumbGradient(product.id);
  return (
    <div
      className={`w-9 h-9 shrink-0 rounded-md bg-gradient-to-br ${gradient} text-white flex items-center justify-center font-semibold text-sm shadow-sm`}
      aria-hidden
    >
      {initial}
    </div>
  );
}

export function ProductsListPage({
  products,
  total,
  page,
  totalPages,
  canEditProduct = false,
  canCreateProduct = false,
  canInstantArchiveProduct = false,
}: ProductsListPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const safeTotalPages = Math.max(1, totalPages);
  const { revalidate } = useRevalidator();
  const { toast } = useToast();

  const archiveFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    requiresApproval?: boolean;
    message?: string | null;
  }>();
  const prevArchiveFetcherState = useRef(archiveFetcher.state);

  useEffect(() => {
    const wasSubmitting = prevArchiveFetcherState.current === 'submitting';
    prevArchiveFetcherState.current = archiveFetcher.state;
    if (!wasSubmitting || archiveFetcher.state !== 'idle' || !archiveFetcher.data) return;
    const d = archiveFetcher.data;
    if (d.success) {
      if (d.requiresApproval) {
        toast.info('Request submitted', d.message ?? 'A Super Admin will review your archive request.');
      } else {
        toast.success('Product archived');
      }
      setArchiveTarget(null);
      setArchiveReason('');
      revalidate();
    } else if (d.error) {
      toast.error('Archive failed', d.error);
    }
  }, [archiveFetcher.state, archiveFetcher.data, revalidate, toast]);

  // Whether to show the cost column — driven by whether the API stripped costPrice
  // from any row. (Column-level security at API; if user lacks finance access, every
  // product comes back with costPrice === null.)
  const showCostColumn = products.some((p) => p.costPrice !== null && p.costPrice !== undefined);

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

      {/* Desktop table */}
      <div className="card p-0 hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header w-12"></th>
                <th className="table-header">Name</th>
                <th className="table-header">Category</th>
                <th className="table-header text-right">Base Price</th>
                {showCostColumn && <th className="table-header text-right">Cost</th>}
                <th className="table-header text-right">Stock</th>
                <th className="table-header">Status</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const cost = product.costPrice !== null && product.costPrice !== undefined
                  ? Number(product.costPrice)
                  : null;
                const stock = product.totalStock ?? 0;
                return (
                  <tr key={product.id} className="table-row">
                    <td className="table-cell">
                      <ProductThumb product={product} />
                    </td>
                    <td className="table-cell">
                      <div className="font-medium text-app-fg">{product.name}</div>
                      {product.brandName && (
                        <div className="text-xs text-app-fg-muted">{product.brandName}</div>
                      )}
                    </td>
                    <td className="table-cell text-sm text-app-fg-muted">
                      {getDisplayCategory(product)}
                    </td>
                    <td className="table-cell text-right font-medium tabular-nums">
                      <NairaPrice amount={Number(product.baseSalePrice)} />
                    </td>
                    {showCostColumn && (
                      <td className="table-cell text-right tabular-nums text-app-fg-muted">
                        {cost !== null ? <NairaPrice amount={cost} /> : <span className="text-app-fg-muted">—</span>}
                      </td>
                    )}
                    <td className={`table-cell text-right font-medium tabular-nums ${stock <= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}>
                      {stock.toLocaleString()}
                    </td>
                    <td className="table-cell">
                      <StatusBadge status={product.status} size="sm" />
                    </td>
                    <td className="table-cell text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewProduct(product)}
                          className="btn-primary btn-sm text-xs"
                        >
                          View
                        </button>
                        {canEditProduct && (
                          <Link
                            to={`/admin/products/${product.id}?mode=edit`}
                            prefetch="intent"
                            className="btn-secondary btn-sm text-xs"
                          >
                            Edit
                          </Link>
                        )}
                        {canEditProduct && product.status !== 'ARCHIVED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setArchiveReason('');
                              setArchiveTarget(product);
                            }}
                            className="btn-secondary btn-sm text-xs text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20"
                          >
                            {canInstantArchiveProduct ? 'Archive' : 'Request archive'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={showCostColumn ? 8 : 7}>
                    <EmptyState
                      title={products.length === 0 ? 'No products yet' : 'No matching products found'}
                      description={products.length === 0 ? 'Add your first product with Add Product above.' : 'Try adjusting your search or filters.'}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3 px-1">
        {filteredProducts.map((product) => {
          const cost = product.costPrice !== null && product.costPrice !== undefined
            ? Number(product.costPrice)
            : null;
          const stock = product.totalStock ?? 0;
          return (
            <article
              key={product.id}
              className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <ProductThumb product={product} />
                  <div className="min-w-0">
                    <h3 className="font-medium text-app-fg truncate">{product.name}</h3>
                    <p className="text-xs text-app-fg-muted truncate">{getDisplayCategory(product)}</p>
                  </div>
                </div>
                <StatusBadge status={product.status} size="sm" />
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-app-fg-muted">Base Price</p>
                  <p className="font-medium text-app-fg tabular-nums">
                    <NairaPrice amount={Number(product.baseSalePrice)} />
                  </p>
                </div>
                {showCostColumn && (
                  <div>
                    <p className="text-xs text-app-fg-muted">Cost</p>
                    <p className="font-medium text-app-fg-muted tabular-nums">
                      {cost !== null ? <NairaPrice amount={cost} /> : '—'}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-app-fg-muted">Stock</p>
                  <p className={`font-medium tabular-nums ${stock <= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}>
                    {stock.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-app-border">
                <button
                  type="button"
                  onClick={() => setViewProduct(product)}
                  className="btn-primary btn-sm text-xs"
                >
                  View
                </button>
                {canEditProduct && (
                  <Link
                    to={`/admin/products/${product.id}?mode=edit`}
                    prefetch="intent"
                    className="btn-secondary btn-sm text-xs"
                  >
                    Edit
                  </Link>
                )}
                {canEditProduct && product.status !== 'ARCHIVED' && (
                  <button
                    type="button"
                    onClick={() => {
                      setArchiveReason('');
                      setArchiveTarget(product);
                    }}
                    className="btn-secondary btn-sm text-xs text-danger-600 dark:text-danger-400 ml-auto"
                  >
                    {canInstantArchiveProduct ? 'Archive' : 'Request archive'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {filteredProducts.length === 0 && (
          <EmptyState
            title={products.length === 0 ? 'No products yet' : 'No matching products found'}
            description={products.length === 0 ? 'Add your first product with Add Product above.' : 'Try adjusting your search or filters.'}
            bordered
          />
        )}
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-app-fg-muted">
          Showing {filteredProducts.length} of {total} products
        </p>
        <Pagination page={page} totalPages={safeTotalPages} onPageChange={goToPage} showLabel />
      </div>

      {/* Super Admin: archive immediately */}
      {archiveTarget && canInstantArchiveProduct && (
        <ConfirmActionModal
          open
          title="Archive product?"
          description={
            <>
              <strong>{archiveTarget.name}</strong> will be hidden from active product lists, edge forms, and new orders. Existing orders are unaffected. You can restore it later from the Archived filter.
            </>
          }
          confirmLabel="Archive"
          variant="archive"
          onClose={() => setArchiveTarget(null)}
          onConfirm={() => {
            const fd = new FormData();
            fd.set('intent', 'archiveProduct');
            fd.set('id', archiveTarget.id);
            fd.set('reason', 'Super Admin catalog archive from product list.');
            archiveFetcher.submit(fd, { method: 'post' });
          }}
          loading={archiveFetcher.state === 'submitting'}
          error={archiveFetcher.data?.error ?? null}
        />
      )}

      {/* Others: request Super Admin approval */}
      {archiveTarget && !canInstantArchiveProduct && (
        <Modal
          open
          onClose={() => {
            setArchiveTarget(null);
            setArchiveReason('');
          }}
          maxWidth="max-w-md"
          backdropBlur
          contentClassName="p-6 flex flex-col gap-4 border border-app-border bg-app-elevated"
        >
          <h3 className="text-lg font-semibold text-app-fg">Request product archive</h3>
          <p className="text-sm text-app-fg-muted">
            <strong className="text-app-fg">{archiveTarget.name}</strong> will be archived after a Super Admin approves
            your request. Existing orders are unaffected.
          </p>
          <Textarea
            label="Reason"
            hint="Minimum 10 characters — visible to approvers."
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            rows={3}
            placeholder="Why should this product be archived?"
          />
          {archiveFetcher.data?.error ? (
            <p className="text-sm text-danger-600 dark:text-danger-400">{archiveFetcher.data.error}</p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setArchiveTarget(null);
                setArchiveReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={archiveReason.trim().length < 10 || archiveFetcher.state === 'submitting'}
              loading={archiveFetcher.state === 'submitting'}
              loadingText="Submitting…"
              onClick={() => {
                const fd = new FormData();
                fd.set('intent', 'archiveProduct');
                fd.set('id', archiveTarget.id);
                fd.set('reason', archiveReason.trim());
                archiveFetcher.submit(fd, { method: 'post' });
              }}
            >
              Submit request
            </Button>
          </div>
        </Modal>
      )}

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
