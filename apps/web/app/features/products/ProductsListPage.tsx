import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { Button } from '~/components/ui/button';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { CompactTableTruncatedValue } from '~/components/ui/compact-table-truncated-value';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
import { NairaPrice } from '~/components/ui/naira-price';
import { RouteFetchErrorBanner } from '~/components/ui/route-fetch-error-banner';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
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
  /** Loader/API failure — not an empty catalog. */
  productsLoadError?: string | null;
  canEditProduct?: boolean;
  /** Shown only when user has products.create (e.g. warehouse); media buyers must not see Add Product. */
  canCreateProduct?: boolean;
  /** Super Admin archives immediately; others submit a permission request. */
  canInstantArchiveProduct?: boolean;
  /** Per-page picker — caller threads the URL-resolved size + options through to <Pagination>. */
  pageSize?: number;
  pageSizeOptions?: number[];
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
  const g = product.galleryImageUrls?.[0];
  if (typeof g === 'string' && g.length > 0) return g;
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
  productsLoadError = null,
  canEditProduct = false,
  canCreateProduct = false,
  canInstantArchiveProduct = false,
  pageSize,
  pageSizeOptions,
}: ProductsListPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const safeTotalPages = Math.max(1, totalPages);
  const { toast } = useToast();

  const archiveFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    requiresApproval?: boolean;
    message?: string | null;
  }>();
  const archiveSurface = useFetcherActionSurface(archiveFetcher);

  // Close-on-success — see CLAUDE.md → "Modal + Optimistic UI Pattern".
  // We can't use the generic `useFetcherToast` here because the toast copy
  // depends on `requiresApproval` (immediate archive vs request submitted),
  // so we fire the toast from inside the onSuccess callback instead.
  const handleArchiveSuccess = useCallback(
    (data: { success: true } & Record<string, unknown>) => {
      if (data['requiresApproval']) {
        const message = (data['message'] as string | null | undefined) ?? 'A Super Admin will review your archive request.';
        toast.info('Request submitted', message);
      } else {
        toast.success('Product archived');
      }
      setArchiveTarget(null);
      setArchiveReason('');
    },
    [toast],
  );
  useCloseOnFetcherSuccess(archiveFetcher, handleArchiveSuccess);

  // Surface error toasts when no archive overlay is visible (dual flow: ConfirmActionModal vs Modal).
  useEffect(() => {
    const d = archiveFetcher.data;
    if (archiveTarget) return;
    if (archiveFetcher.state === 'idle' && d && !d.success && d.error) {
      toast.error('Archive failed', d.error);
    }
  }, [archiveFetcher.state, archiveFetcher.data, archiveTarget, toast]);

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

  const productsToolbarFilterBadge = useMemo(() => (statusFilter !== 'ACTIVE' ? 1 : 0), [statusFilter]);

  const productColumns = useMemo((): CompactTableColumn<Product>[] => {
    const cols: CompactTableColumn<Product>[] = [
      {
        key: 'product',
        header: 'Product',
        minWidth: 'min-w-[200px]',
        nowrap: true,
        render: (product) => (
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumb product={product} />
            <CompactTableTruncatedValue
              className="min-w-0 flex-1"
              popoverLabel="Product details"
              detailTrigger={product.brandName ? 'always' : 'when-overflow'}
              fullText={
                product.brandName
                  ? `${product.name}\n\nBrand: ${product.brandName}`
                  : product.name
              }
            >
              <span className="font-medium text-app-fg">{product.name}</span>
              {product.brandName ? (
                <>
                  <span className="font-medium text-app-fg-muted"> · </span>
                  <span className="font-medium text-app-fg-muted">{product.brandName}</span>
                </>
              ) : null}
            </CompactTableTruncatedValue>
          </div>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        render: (product) => <span className="text-sm text-app-fg-muted">{getDisplayCategory(product)}</span>,
      },
      {
        key: 'baseSalePrice',
        header: 'Base Price',
        align: 'right',
        render: (product) => (
          <span className="font-medium tabular-nums">
            <NairaPrice amount={Number(product.baseSalePrice)} />
          </span>
        ),
      },
    ];
    if (showCostColumn) {
      cols.push({
        key: 'costPrice',
        header: 'Cost',
        align: 'right',
        render: (product) => {
          const cost =
            product.costPrice !== null && product.costPrice !== undefined ? Number(product.costPrice) : null;
          return (
            <span className="tabular-nums text-app-fg-muted">
              {cost !== null ? <NairaPrice amount={cost} /> : '—'}
            </span>
          );
        },
      });
    }
    cols.push(
      {
        key: 'stock',
        header: 'Stock',
        align: 'right',
        render: (product) => {
          const stock = product.totalStock ?? 0;
          return (
            <span
              className={`font-medium tabular-nums ${stock <= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}
            >
              {stock.toLocaleString()}
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (product) => <StatusBadge status={product.status} size="sm" />,
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (product) => (
          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <CompactTableActionButton onClick={() => setViewProduct(product)}>View</CompactTableActionButton>
            {canEditProduct ? (
              <CompactTableActionButton
                to={`/admin/products/${product.id}?mode=edit`}
                className="!text-app-fg-muted hover:!text-brand-500 dark:hover:!text-brand-400"
              >
                Edit
              </CompactTableActionButton>
            ) : null}
            {canEditProduct && product.status !== 'ARCHIVED' ? (
              <CompactTableActionButton
                tone="danger"
                onClick={() => {
                  setArchiveReason('');
                  setArchiveTarget(product);
                }}
              >
                {canInstantArchiveProduct ? 'Archive' : 'Request archive'}
              </CompactTableActionButton>
            ) : null}
          </div>
        ),
      },
    );
    return cols;
  }, [showCostColumn, canEditProduct, canInstantArchiveProduct]);

  const goToPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), safeTotalPages);
    const next = new URLSearchParams(searchParams);
    next.set('page', String(clamped));
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="card p-0 overflow-hidden">
        <ToolbarFiltersCollapsible
          className="!border-0"
          badgeCount={productsToolbarFilterBadge}
          sheetSubtitle={<span>Status applies immediately</span>}
          searchRow={
            <form
              className="min-w-0 flex-1"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search by name..."
                withSubmitButton
                wrapperClassName="min-w-0 w-full flex-1 md:min-w-0"
              />
            </form>
          }
          desktopInlineFilters={
            <FormSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'ALL', label: 'All Status' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
                { value: 'ARCHIVED', label: 'Archived' },
              ]}
              wrapperClassName="w-full min-w-0 sm:w-40"
            />
          }
          sheetFilterBody={
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-app-fg-muted">Status</span>
              <FormSelect
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: 'ALL', label: 'All Status' },
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                  { value: 'ARCHIVED', label: 'Archived' },
                ]}
                wrapperClassName="w-full"
              />
            </div>
          }
        />
      </div>

      {productsLoadError && <RouteFetchErrorBanner messages={[productsLoadError]} variant="danger" />}

      <CompactTable<Product>
        columns={productColumns}
        rows={filteredProducts}
        rowKey={(p) => p.id}
        emptyTitle={
          productsLoadError
            ? 'Unable to load products'
            : products.length === 0
              ? 'No products yet'
              : 'No matching products found'
        }
        emptyDescription={
          productsLoadError
            ? 'Use Reload data above and try again.'
            : products.length === 0
              ? 'Add your first product above.'
              : 'Try adjusting your search or filters.'
        }
        pagination={{
          page,
          totalPages: safeTotalPages,
          onPageChange: goToPage,
          pageSize,
          pageSizeOptions,
          summary: (
            <span>
              Showing {filteredProducts.length} of {total} products
            </span>
          ),
          wrapperClassName: 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1',
        }}
      />

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
          error={archiveSurface.errorMatchingIntent('archiveProduct')}
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
          <ModalFetcherInlineError message={archiveSurface.errorMatchingIntent('archiveProduct')} />
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
