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

interface ProductEditPageProps {
  product: Product;
  categories: CategoryOption[];
  actionData?: { error?: string };
  /** When provided, show a "View" link back to the product view (no edit mode). */
  productId?: string;
}

export function ProductEditPage({
  product,
  categories,
  actionData,
  productId,
}: ProductEditPageProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const isSaving = navigation.state !== 'idle';
  const errorRef = useRef<HTMLDivElement>(null);
  const formWrapperRef = useRef<HTMLDivElement>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);

  const [categoryId, setCategoryId] = useState(() => product.categoryId ?? '');
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>(() => product.galleryImageUrls ?? []);
  const [galleryUploadState, setGalleryUploadState] = useState<FileUploadUploadState>('idle');

  const galleryJson = useMemo(() => JSON.stringify(galleryImageUrls), [galleryImageUrls]);

  /** After ConfirmActionModal commits, bypass the Archive guard so requestSubmit succeeds once. */
  const pendingArchiveConfirmed = useRef(false);

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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (product.status === 'ARCHIVED') return;
    if (pendingArchiveConfirmed.current) {
      pendingArchiveConfirmed.current = false;
      return;
    }
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
        description="Update product details."
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
          <input type="hidden" name="galleryImageUrls" value={galleryJson} readOnly />

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

            <FormField label="List price (&#8358;)" htmlFor="baseSalePrice" hint='Public “from” price for sorts and dashboards. Marketing offer tiers may sync the minimum when tiers change on a form.'>
              <AmountInput
                id="baseSalePrice"
                name="baseSalePrice"
                required
                className="input"
                placeholder="0.00"
                defaultValue={product.baseSalePrice}
                disabled={product.status === 'ARCHIVED'}
              />
            </FormField>
          </div>

          <div className="card space-y-3">
            <h2 className="text-lg font-semibold text-app-fg">Catalog images</h2>
            <p className="text-xs text-app-fg-muted">
              Optional SKU gallery (separate from per-tier thumbnails on offer templates).
            </p>
            <OfferImagesEditor
              imageUrls={galleryImageUrls}
              onChange={setGalleryImageUrls}
              disabled={isSaving || product.status === 'ARCHIVED'}
              onUploadStateChange={setGalleryUploadState}
            />
          </div>

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
                disabled={product.status === 'ARCHIVED'}
              />
              <p className="text-xs text-app-fg-muted mt-1">Only visible to Finance and SuperAdmin roles.</p>
            </FormField>
            <InlineNotification
              variant="info"
              message="Add stock via Inventory → Shipments → Receive Shipment."
              action={{ label: 'Inventory', href: '/admin/inventory' }}
            />
          </div>

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
              loading={isSaving}
              loadingText="Saving..."
              disabled={product.status === 'ARCHIVED' || galleryUploadState === 'uploading' || isSaving}
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
          description={
            <>
              <strong>{product.name}</strong> will be hidden from default product lists.
            </>
          }
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
            pendingArchiveConfirmed.current = true;
            formWrapperRef.current?.querySelector<HTMLFormElement>('form')?.requestSubmit();
          }}
        />
      )}
    </div>
  );
}
