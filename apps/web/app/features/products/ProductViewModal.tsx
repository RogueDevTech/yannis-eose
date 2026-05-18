import { Link } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { PRODUCT_STATUS_COLORS } from './types';
import type { Product } from './types';

export interface ProductViewModalProps {
  product: Product;
  canEditProduct: boolean;
  onClose: () => void;
}

export function ProductViewModal({ product, canEditProduct, onClose }: ProductViewModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-2xl"
      role="dialog"
      aria-labelledby="product-view-modal-title"
      contentClassName="p-0 max-h-[90dvh] flex flex-col overflow-hidden border border-app-border"
    >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-app-border shrink-0">
          <h2 id="product-view-modal-title" className="text-lg font-semibold text-app-fg truncate">
            {product.name}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>
              {product.status}
            </span>
            {canEditProduct && (
              <Link
                to={`/admin/products/${product.id}?mode=edit`}
                className="btn-primary btn-sm inline-flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                </svg>
                Edit
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-app-fg-muted hover:text-app-fg hover:bg-app-hover"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-4 space-y-4">
          {/* Gallery */}
          {product.galleryImageUrls?.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-app-fg">Gallery</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {product.galleryImageUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative block overflow-hidden rounded-lg border border-app-border bg-app-hover"
                    title="Open image"
                  >
                    <img
                      src={url}
                      alt={`${product.name} gallery`}
                      className="h-28 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {/* Product Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-app-fg">Product Details</h3>
            <dl className="space-y-2 text-sm">
              {product.description && (
                <div>
                  <dt className="text-app-fg-muted">Description</dt>
                  <dd className="text-app-fg mt-0.5 whitespace-pre-wrap">{product.description}</dd>
                </div>
              )}
              <div>
                <dt className="text-app-fg-muted">Category</dt>
                <dd className="text-app-fg mt-0.5">
                  {product.categoryName ?? product.category ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-app-fg-muted">Created</dt>
                <dd className="text-app-fg mt-0.5">
                  {new Date(product.createdAt).toLocaleString('en-NG')}
                </dd>
              </div>
            </dl>
          </div>

          {/* Cost (if visible) */}
          {product.costPrice != null && product.costPrice !== '' && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-app-fg">Cost</h3>
              <p className="text-sm text-app-fg">
                &#8358;{Number(product.costPrice).toLocaleString()} per unit
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-app-border shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary w-full sm:w-auto"
          >
            Close
          </button>
        </div>
    </Modal>
  );
}
