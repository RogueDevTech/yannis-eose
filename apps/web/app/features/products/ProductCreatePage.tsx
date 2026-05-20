import { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import { Await, Form, useNavigation, Link } from '@remix-run/react';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { FormField } from '~/components/ui/form-field';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import { OfferImagesEditor } from './OfferImagesEditor';

interface CategoryOption {
  id: string;
  name: string;
  brandName: string;
}

interface ProductCreatePageProps {
  actionData?: { error?: string } | undefined;
  /**
   * Resolved categories OR a Promise that resolves them. When a Promise, the
   * category select renders a "Loading…" placeholder while every other input
   * is fully interactive (App Shell pattern — form chrome paints instantly).
   */
  categoriesPromise?: Promise<CategoryOption[]> | CategoryOption[];
}

export function ProductCreatePage({ actionData, categoriesPromise = [] }: ProductCreatePageProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const errorRef = useRef<HTMLDivElement>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>([]);
  const [galleryUploadState, setGalleryUploadState] = useState<FileUploadUploadState>('idle');

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
  }, [actionData?.error]);

  useEffect(() => {
    if (actionData?.error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [actionData?.error]);

  const galleryJson = useMemo(() => JSON.stringify(galleryImageUrls), [galleryImageUrls]);

  return (
    <div className="w-full space-y-6">
      <Breadcrumb items={[{ label: 'Products', to: '/admin/products' }, { label: 'Add Product' }]} />

      <PageHeader
        title="Add Product"
        description="Create a catalog product."
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

      <Form method="post" className="space-y-6">
        <input type="hidden" name="categoryId" value={categoryId} />
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
          />

          {/* App Shell pattern — the rest of the form is interactive immediately;
              ONLY this select shows a brief "Loading categories…" state. */}
          <Suspense
            fallback={
              <SearchableSelect
                id="categoryId-loading"
                label="Category"
                value=""
                onChange={() => undefined}
                placeholder="Loading categories…"
                disabled
                options={[]}
              />
            }
          >
            <Await resolve={categoriesPromise}>
              {(categories: CategoryOption[]) =>
                categories.length > 0 ? (
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
                    />
                    <p className="text-xs text-app-fg-muted mt-1">
                      <Link to="/admin/categories" className="text-brand-500 hover:text-brand-600">
                        Create categories
                      </Link>{' '}
                      to use a dropdown instead.
                    </p>
                  </div>
                )
              }
            </Await>
          </Suspense>

          <Textarea
            id="description"
            name="description"
            label="Description"
            rows={3}
            placeholder="Optional product description"
          />

          <FormField label="Base price (&#8358;)" htmlFor="baseSalePrice" hint="Public “from” price for sorts and dashboards. Edge packages are offer tiers on Marketing → Forms.">
            <AmountInput
              id="baseSalePrice"
              name="baseSalePrice"
              required
              className="input"
              placeholder="0.00"
            />
          </FormField>
        </div>

        <div className="card space-y-3">
          <h2 className="text-lg font-semibold text-app-fg">Catalog images</h2>
          <p className="text-xs text-app-fg-muted">
            Optional gallery for this SKU. Individual offer tiers can pick images when you create templates.
          </p>
          <OfferImagesEditor
            imageUrls={galleryImageUrls}
            onChange={setGalleryImageUrls}
            disabled={isSubmitting}
            onUploadStateChange={setGalleryUploadState}
          />
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-app-fg">Cost</h2>

          <FormField label="Cost Price per Unit (&#8358;)" htmlFor="costPrice">
            <AmountInput id="costPrice" name="costPrice" required className="input" placeholder="0.00" />
            <p className="text-xs text-app-fg-muted mt-1">Only visible to Finance and SuperAdmin roles.</p>
          </FormField>
          <InlineNotification
            variant="info"
            message="Add stock after creating the product via Inventory → Shipments → Receive Shipment (verify to post)."
            action={{ label: 'Inventory', href: '/admin/inventory' }}
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
          <Link to="/admin/products" className="btn-secondary w-full sm:w-auto">
            Cancel
          </Link>
          <Button
            type="submit"
            variant="primary"
            className="w-full sm:w-auto"
            loading={isSubmitting}
            loadingText="Creating..."
            disabled={galleryUploadState === 'uploading'}
          >
            Create Product
          </Button>
        </div>
      </Form>
    </div>
  );
}
