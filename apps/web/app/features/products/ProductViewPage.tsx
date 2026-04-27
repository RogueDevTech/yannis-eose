import { Link } from '@remix-run/react';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PRODUCT_STATUS_COLORS } from './types';
import type { Product } from './types';

interface ProductViewPageProps {
  product: Product;
  canEditProduct: boolean;
}

export function ProductViewPage({ product, canEditProduct }: ProductViewPageProps) {
  return (
    <div className="w-full space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/admin/products" className="text-app-fg-muted hover:text-brand-500">
          Products
        </Link>
        <svg className="w-4 h-4 text-app-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-app-fg font-medium">{product.name}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-app-fg">{product.name}</h1>
          <p className="text-sm text-app-fg-muted mt-1">
            View product details and offer bundles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageRefreshButton />
          <span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>
            {product.status}
          </span>
          {canEditProduct && (
            <Link
              to={`/admin/products/${product.id}?mode=edit`}
              className="btn-primary inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
              </svg>
              Edit
            </Link>
          )}
        </div>
      </div>

      {/* Product Details */}
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold text-app-fg">Product Details</h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-app-fg-muted">Name</dt>
            <dd className="text-app-fg mt-0.5">{product.name}</dd>
          </div>
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
            <dt className="text-app-fg-muted">Status</dt>
            <dd className="mt-0.5">
              <span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>{product.status}</span>
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

      {/* Offer Bundles */}
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold text-app-fg">Offer Bundles</h2>
        {product.offers?.length ? (
          <div className="space-y-3">
            {product.offers.map((offer, index) => (
              <div
                key={index}
                className="flex flex-col gap-3 p-4 rounded-lg bg-app-hover border border-app-border"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-app-fg">{offer.label}</p>
                    <p className="text-sm text-app-fg-muted mt-0.5">
                      {offer.qty} unit{offer.qty !== 1 ? 's' : ''} · &#8358;{Number(offer.price).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-sm font-semibold text-app-fg sm:text-right">
                    &#8358;{Number(offer.price).toLocaleString()}
                  </div>
                </div>
                {offer.imageUrls && offer.imageUrls.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {offer.imageUrls.map((url) => (
                      <li key={url} className="w-20 h-20 rounded-md border border-app-border overflow-hidden bg-app-elevated shrink-0">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-app-fg-muted">No offer tiers defined.</p>
        )}
      </div>

      {/* Cost & Stock (only if API returned cost; backend may strip for non-Finance/SuperAdmin) */}
      {product.costPrice != null && product.costPrice !== '' && (
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-app-fg">Cost & Stock</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-app-fg-muted">Cost Price per Unit (&#8358;)</dt>
              <dd className="text-app-fg mt-0.5">
                &#8358;{Number(product.costPrice).toLocaleString()}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-app-fg-muted">
            Add stock via Inventory → Stock Intake.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
        <Link to="/admin/products" className="btn-secondary w-full sm:w-auto">
          Back to products
        </Link>
      </div>
    </div>
  );
}
