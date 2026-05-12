import { Link } from '@remix-run/react';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
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
      <PageHeader
        title={product.name}
        mobileInlineActions
        description="View product details."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Product tools"
            sheetSubtitle={<span>Status and actions</span>}
            triggerAriaLabel="Product toolbar"
            mobileLeading={<span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>{product.status}</span>}
            desktop={
              <>
                <PageRefreshButton />
                <span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>
                  {product.status}
                </span>
                {canEditProduct ? (
                  <Link
                    to={`/admin/products/${product.id}?mode=edit`}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                    </svg>
                    Edit
                  </Link>
                ) : null}
              </>
            }
            sheet={
              canEditProduct ? (
                <Link to={`/admin/products/${product.id}?mode=edit`} className="btn-primary btn-sm w-full justify-center">
                  Edit
                </Link>
              ) : null
            }
          />
        }
      />

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

      {/* Gallery */}
      {product.galleryImageUrls?.length ? (
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-app-fg">Gallery</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {product.galleryImageUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-xl border border-app-border bg-app-hover"
                title="Open image"
              >
                <img
                  src={url}
                  alt={`${product.name} gallery`}
                  className="h-32 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </div>
      ) : null}

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
            Add stock via Inventory → Shipments → Receive Shipment (verify to post).
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
