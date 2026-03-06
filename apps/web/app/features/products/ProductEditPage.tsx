import { useState, useEffect, useRef } from 'react';
import { Form, useNavigation, Link } from '@remix-run/react';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PRODUCT_STATUS_COLORS } from './types';
import type { Product } from './types';

interface CategoryOption {
  id: string;
  name: string;
  brandName: string;
}

interface OfferRow {
  label: string;
  qty: string;
  price: string;
}

interface ProductEditPageProps {
  product: Product;
  categories: CategoryOption[];
  actionData?: { error?: string };
  /** When provided, show a "View" link back to the product view (no edit mode). */
  productId?: string;
}

function parseOffers(offers: Product['offers']): OfferRow[] {
  if (!offers?.length) return [{ label: '', qty: '1', price: '' }];
  return offers.map((o) => ({
    label: o.label ?? '',
    qty: String(o.qty ?? 1),
    price: String(o.price ?? ''),
  }));
}

export function ProductEditPage({ product, categories, actionData, productId }: ProductEditPageProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const errorRef = useRef<HTMLDivElement>(null);
  const formWrapperRef = useRef<HTMLDivElement>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const [offers, setOffers] = useState<OfferRow[]>(() => parseOffers(product.offers));

  // Close archive confirm modal on successful submission
  const prevNavState = useRef(navigation.state);
  useEffect(() => {
    if (prevNavState.current === 'submitting' && navigation.state === 'idle' && showArchiveConfirm) {
      setShowArchiveConfirm(false);
    }
    prevNavState.current = navigation.state;
  }, [navigation.state, showArchiveConfirm]);

  useEffect(() => {
    if (actionData?.error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [actionData?.error]);

  function addOffer() {
    setOffers((prev) => [...prev, { label: '', qty: '1', price: '' }]);
  }

  function removeOffer(index: number) {
    setOffers((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOffer(index: number, field: keyof OfferRow, value: string) {
    setOffers((prev) =>
      prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    );
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (product.status === 'ARCHIVED') return;
    const form = e.currentTarget;
    const statusSelect = form.querySelector<HTMLSelectElement>('[name="status"]');
    if (statusSelect?.value === 'ARCHIVED') {
      e.preventDefault();
      setShowArchiveConfirm(true);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/admin/products" className="text-surface-800 dark:text-surface-200 hover:text-brand-500">
          Products
        </Link>
        <svg className="w-4 h-4 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-surface-900 dark:text-white font-medium">{product.name}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Edit Product</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-1">
            Update product details, offers, and status.
          </p>
        </div>
        <span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>
          {product.status}
        </span>
      </div>

      {actionData?.error && (
        <div ref={errorRef} className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionData.error}</p>
        </div>
      )}

      <div ref={formWrapperRef}>
      <Form method="post" className="space-y-6" onSubmit={handleSubmit}>
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="offers" value={JSON.stringify(
          offers.map((o) => ({
            label: o.label,
            qty: parseInt(o.qty, 10) || 1,
            price: o.price,
          })),
        )} />

        {/* Basic Info */}
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Product Details</h2>

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Product Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              minLength={2}
              className="input"
              placeholder="e.g. Premium Face Cream"
              defaultValue={product.name}
            />
          </div>

          <div>
            <label htmlFor="categoryId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Category
            </label>
            {categories.length > 0 ? (
              <select id="categoryId" name="categoryId" className="input" defaultValue={product.categoryId ?? ''}>
                <option value="">— Select category —</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.brandName})
                  </option>
                ))}
              </select>
            ) : (
              <div>
                <input
                  id="category"
                  name="category"
                  type="text"
                  className="input"
                  placeholder="e.g. Skincare"
                  defaultValue={product.category ?? ''}
                />
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                  <Link to="/admin/categories" className="text-brand-500 hover:text-brand-600">
                    Create categories
                  </Link>{' '}
                  to use a dropdown instead.
                </p>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              className="input resize-none"
              placeholder="Optional product description"
              defaultValue={product.description ?? ''}
            />
          </div>

          <div>
            <label htmlFor="status" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Status
            </label>
            <select id="status" name="status" className="input" defaultValue={product.status}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
        </div>

        {/* Offer Bundles */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Offer Bundles</h2>
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                Define pricing tiers. E.g. &quot;Buy 1 Get 1 Free&quot; = 2 units at &#8358;16,500
              </p>
            </div>
            <button
              type="button"
              onClick={addOffer}
              className="btn-secondary text-sm py-1.5 px-3"
            >
              <svg className="w-4 h-4 mr-1 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Tier
            </button>
          </div>

          {offers.length === 0 && (
            <p className="text-sm text-danger-600 dark:text-danger-400">At least one offer is required.</p>
          )}

          <div className="space-y-3">
            {offers.map((offer, index) => (
              <div
                key={index}
                className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700"
              >
                <div className="flex-1 min-w-[280px]">
                  <label htmlFor={`offer-label-${index}`} className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Label
                  </label>
                  <input
                    id={`offer-label-${index}`}
                    type="text"
                    required
                    className="input py-2 text-sm w-full"
                    placeholder="e.g. Buy 1 Get 1 Free"
                    value={offer.label}
                    onChange={(e) => updateOffer(index, 'label', e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-32 sm:flex-shrink-0">
                  <label htmlFor={`offer-qty-${index}`} className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Total Qty
                  </label>
                  <input
                    id={`offer-qty-${index}`}
                    type="number"
                    required
                    min={1}
                    className="input py-2 text-sm"
                    placeholder="2"
                    value={offer.qty}
                    onChange={(e) => updateOffer(index, 'qty', e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-32 sm:flex-shrink-0">
                  <label htmlFor={`offer-price-${index}`} className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Price (&#8358;)
                  </label>
                  <AmountInput
                    id={`offer-price-${index}`}
                    required
                    className="input py-2 text-sm"
                    placeholder="16,500.00"
                    value={offer.price}
                    onChange={(v) => updateOffer(index, 'price', v)}
                  />
                </div>
                {offers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeOffer(index)}
                    className="p-1.5 text-danger-500 hover:text-danger-700 dark:hover:text-danger-400 transition-colors self-end sm:self-auto"
                    title="Remove offer"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Cost */}
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Cost & Stock</h2>

          <div>
            <label htmlFor="costPrice" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Cost Price per Unit (&#8358;)
            </label>
            <AmountInput
              id="costPrice"
              name="costPrice"
              required
              className="input"
              placeholder="0.00"
              defaultValue={product.costPrice ?? ''}
            />
            <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
              Only visible to Finance and SuperAdmin roles.
            </p>
          </div>
          <InlineNotification
            variant="info"
            message="Add stock via Inventory → Stock Intake."
            action={{ label: 'Stock Intake', href: '/admin/inventory' }}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
          {productId ? (
            <Link to={`/admin/products/${productId}`} className="btn-secondary w-full sm:w-auto">
              View
            </Link>
          ) : (
            <Link to="/admin/products" className="btn-secondary w-full sm:w-auto">
              Cancel
            </Link>
          )}
          <Button type="submit" variant="primary" className="w-full sm:w-auto" loading={isSubmitting} loadingText="Saving..." disabled={offers.length === 0}>
            Save Changes
          </Button>
        </div>
      </Form>
      </div>

      {showArchiveConfirm && (
        <ConfirmActionModal
          open={showArchiveConfirm}
          onClose={() => setShowArchiveConfirm(false)}
          title={`Archive "${product.name}"?`}
          description={<><strong>{product.name}</strong> will be hidden from default product lists.</>}
          details={
            <ul className="list-disc list-inside text-sm text-surface-600 dark:text-surface-400 space-y-1">
              <li>Hidden from default product lists</li>
              <li>You can change status back anytime</li>
            </ul>
          }
          confirmLabel="Archive"
          variant="archive"
          loading={isSubmitting}
          onConfirm={() => {
            formWrapperRef.current?.querySelector<HTMLFormElement>('form')?.requestSubmit();
          }}
        />
      )}
    </div>
  );
}
