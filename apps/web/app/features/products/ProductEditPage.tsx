import { useState, useEffect, useRef, useMemo } from 'react';
import { Form, useNavigation, Link } from '@remix-run/react';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { FormField } from '~/components/ui/form-field';
import { StatusBadge } from '~/components/ui/status-badge';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import { OfferImagesEditor } from './OfferImagesEditor';
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
  imageUrls: string[];
}

interface ProductEditPageProps {
  product: Product;
  categories: CategoryOption[];
  actionData?: { error?: string };
  /** When provided, show a "View" link back to the product view (no edit mode). */
  productId?: string;
}

function parseOffers(offers: Product['offers']): OfferRow[] {
  if (!offers?.length) return [{ label: '', qty: '1', price: '', imageUrls: [] }];
  return offers.map((o) => ({
    label: o.label ?? '',
    qty: String(o.qty ?? 1),
    price: String(o.price ?? ''),
    imageUrls: Array.isArray(o.imageUrls) ? o.imageUrls.filter((u) => typeof u === 'string') : [],
  }));
}

export function ProductEditPage({ product, categories, actionData, productId }: ProductEditPageProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const errorRef = useRef<HTMLDivElement>(null);
  const formWrapperRef = useRef<HTMLDivElement>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);

  const [offers, setOffers] = useState<OfferRow[]>(() => parseOffers(product.offers));
  const [categoryId, setCategoryId] = useState(() => product.categoryId ?? '');
  const [offerUploadStates, setOfferUploadStates] = useState<Record<number, FileUploadUploadState>>({});

  const anyOfferImageUploading = useMemo(
    () => Object.values(offerUploadStates).some((s) => s === 'uploading'),
    [offerUploadStates],
  );

  // Close archive confirm modal on successful submission
  const prevNavState = useRef(navigation.state);
  useEffect(() => {
    if (prevNavState.current === 'submitting' && navigation.state === 'idle' && showArchiveConfirm) {
      setShowArchiveConfirm(false);
    }
    prevNavState.current = navigation.state;
  }, [navigation.state, showArchiveConfirm]);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
  }, [actionData?.error]);

  useEffect(() => {
    if (actionData?.error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [actionData?.error]);

  function addOffer() {
    setOffers((prev) => [...prev, { label: '', qty: '1', price: '', imageUrls: [] }]);
  }

  function removeOffer(index: number) {
    setOffers((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOffer(index: number, field: keyof Pick<OfferRow, 'label' | 'qty' | 'price'>, value: string) {
    setOffers((prev) =>
      prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    );
  }

  function setOfferImageUrls(index: number, urls: string[]) {
    setOffers((prev) => prev.map((o, i) => (i === index ? { ...o, imageUrls: urls } : o)));
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
      <Breadcrumb items={[{ label: 'Products', to: '/admin/products' }, { label: product.name }]} />

      <PageHeader
        title="Edit Product"
        description="Update product details, offers, and status."
        actions={<StatusBadge status={product.status} />}
      />

      {actionData?.error && !dismissedError && (
        <div ref={errorRef}>
          <PageNotification
            variant="error"
            message={actionData.error}
            durationMs={5000}
            onDismiss={() => setDismissedError(true)}
          />
        </div>
      )}

      <div ref={formWrapperRef}>
      <Form method="post" className="space-y-6" onSubmit={handleSubmit}>
        <input type="hidden" name="productId" value={product.id} />
        {categories.length > 0 ? <input type="hidden" name="categoryId" value={categoryId} /> : null}
        <input type="hidden" name="offers" value={JSON.stringify(
          offers.map((o) => ({
            label: o.label,
            qty: parseInt(o.qty, 10) || 1,
            price: o.price,
            imageUrls: o.imageUrls,
          })),
        )} />

        {/* Basic Info */}
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-app-fg">Product Details</h2>

          <TextInput
            id="name"
            name="name"
            label="Product Name"
            required
            minLength={2}
            placeholder="e.g. Premium Face Cream"
            defaultValue={product.name}
          />

          <div>
            {categories.length > 0 ? (
              <SearchableSelect
                id="categoryId"
                label="Category"
                value={categoryId}
                onChange={setCategoryId}
                placeholder="— Select category —"
                searchPlaceholder="Search categories..."
                options={categories.map((cat) => ({
                  value: cat.id,
                  label: cat.name,
                  description: cat.brandName,
                }))}
              />
            ) : (
              <div>
                <TextInput
                  id="category"
                  name="category"
                  label="Category"
                  placeholder="e.g. Skincare"
                  defaultValue={product.category ?? ''}
                />
                <p className="text-xs text-app-fg-muted mt-1">
                  <Link to="/admin/categories" className="text-brand-500 hover:text-brand-600">
                    Create categories
                  </Link>{' '}
                  to use a dropdown instead.
                </p>
              </div>
            )}
          </div>

          <Textarea
            id="description"
            name="description"
            label="Description"
            rows={3}
            placeholder="Optional product description"
            defaultValue={product.description ?? ''}
          />

          <FormSelect
            id="status"
            name="status"
            label="Status"
            defaultValue={product.status}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'ARCHIVED', label: 'Archived' },
            ]}
          />
        </div>

        {/* Offer Bundles */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-app-fg">Offer Bundles</h2>
              <p className="text-xs text-app-fg-muted mt-0.5">
                Each tier can include its own images (e.g. for sales forms).
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
                className="flex flex-col gap-4 p-4 rounded-lg bg-app-hover border border-app-border"
              >
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4">
                  <div className="flex-1 min-w-[280px]">
                    <TextInput
                      id={`offer-label-${index}`}
                      label="Label"
                      required
                      placeholder="e.g. Buy 1 Get 1 Free"
                      value={offer.label}
                      onChange={(e) => updateOffer(index, 'label', e.target.value)}
                    />
                  </div>
                  <div className="w-full sm:w-32 sm:flex-shrink-0">
                    <TextInput
                      id={`offer-qty-${index}`}
                      label="Total Qty"
                      type="number"
                      required
                      min={1}
                      placeholder="2"
                      value={offer.qty}
                      onChange={(e) => updateOffer(index, 'qty', e.target.value)}
                    />
                  </div>
                  <div className="w-full sm:w-32 sm:flex-shrink-0">
                    <FormField label="Price (&#8358;)" htmlFor={`offer-price-${index}`}>
                      <AmountInput
                        id={`offer-price-${index}`}
                        required
                        className="input py-2 text-sm"
                        placeholder="16,500.00"
                        value={offer.price}
                        onChange={(v) => updateOffer(index, 'price', v)}
                      />
                    </FormField>
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
                <OfferImagesEditor
                  imageUrls={offer.imageUrls}
                  onChange={(urls) => setOfferImageUrls(index, urls)}
                  disabled={isSubmitting || product.status === 'ARCHIVED'}
                  onUploadStateChange={(s) =>
                    setOfferUploadStates((prev) => ({ ...prev, [index]: s }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* Cost */}
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-app-fg">Cost & Stock</h2>

          <FormField label="Cost Price per Unit (&#8358;)" htmlFor="costPrice">
            <AmountInput
              id="costPrice"
              name="costPrice"
              required
              className="input"
              placeholder="0.00"
              defaultValue={product.costPrice ?? ''}
            />
            <p className="text-xs text-app-fg-muted mt-1">
              Only visible to Finance and SuperAdmin roles.
            </p>
          </FormField>
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
          <Button
            type="submit"
            variant="primary"
            className="w-full sm:w-auto"
            loading={isSubmitting}
            loadingText="Saving..."
            disabled={offers.length === 0 || anyOfferImageUploading}
          >
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
            <ul className="list-disc list-inside text-sm text-app-fg-muted space-y-1">
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
