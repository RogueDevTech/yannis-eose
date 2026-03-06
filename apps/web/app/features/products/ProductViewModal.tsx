import { Link } from '@remix-run/react';
import { PRODUCT_STATUS_COLORS } from './types';
import type { Product } from './types';

export interface ProductViewModalProps {
  product: Product;
  canEditProduct: boolean;
  onClose: () => void;
}

export function ProductViewModal({ product, canEditProduct, onClose }: ProductViewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      aria-modal="true"
      role="dialog"
      aria-labelledby="product-view-modal-title"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-surface-200 dark:border-surface-700 shrink-0">
          <h2 id="product-view-modal-title" className="text-lg font-semibold text-surface-900 dark:text-white truncate">
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
              className="p-2 rounded-lg text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800 dark:text-surface-400 dark:hover:text-surface-200"
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
          {/* Product Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Product Details</h3>
            <dl className="space-y-2 text-sm">
              {product.description && (
                <div>
                  <dt className="text-surface-500 dark:text-surface-400">Description</dt>
                  <dd className="text-surface-900 dark:text-white mt-0.5 whitespace-pre-wrap">{product.description}</dd>
                </div>
              )}
              <div>
                <dt className="text-surface-500 dark:text-surface-400">Category</dt>
                <dd className="text-surface-900 dark:text-white mt-0.5">
                  {product.categoryName ?? product.category ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-surface-500 dark:text-surface-400">Created</dt>
                <dd className="text-surface-900 dark:text-white mt-0.5">
                  {new Date(product.createdAt).toLocaleString('en-NG')}
                </dd>
              </div>
            </dl>
          </div>

          {/* Offer Bundles */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Offer Bundles</h3>
            {product.offers?.length ? (
              <div className="space-y-2">
                {product.offers.map((offer, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-surface-900 dark:text-white">{offer.label || `Qty ${offer.qty}`}</p>
                      <p className="text-xs text-surface-600 dark:text-surface-400">
                        {offer.qty} unit{offer.qty !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-surface-900 dark:text-white tabular-nums">
                      &#8358;{Number(offer.price).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-surface-600 dark:text-surface-400">No offer tiers defined.</p>
            )}
          </div>

          {/* Cost (if visible) */}
          {product.costPrice != null && product.costPrice !== '' && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Cost</h3>
              <p className="text-sm text-surface-900 dark:text-white">
                &#8358;{Number(product.costPrice).toLocaleString()} per unit
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-200 dark:border-surface-700 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary w-full sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
