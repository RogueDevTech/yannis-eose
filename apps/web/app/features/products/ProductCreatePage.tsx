import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Await, Form, useNavigation, Link } from '@remix-run/react';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { NumberInput } from '~/components/ui/number-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { FormField } from '~/components/ui/form-field';
import { RadioGroup } from '~/components/ui/radio-group';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import { OfferImagesEditor } from './OfferImagesEditor';

interface CategoryOption {
  id: string;
  name: string;
  brandName: string;
}

interface ProductOption {
  id: string;
  name: string;
}

interface ProductCreatePageProps {
  actionData?: { error?: string } | undefined;
  /**
   * Resolved categories OR a Promise that resolves them. When a Promise, the
   * category select renders a "Loading…" placeholder while every other input
   * is fully interactive (App Shell pattern — form chrome paints instantly).
   */
  categoriesPromise?: Promise<CategoryOption[]> | CategoryOption[];
  allProducts?: ProductOption[];
}

export function ProductCreatePage({ actionData, categoriesPromise = [], allProducts = [] }: ProductCreatePageProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const errorRef = useRef<HTMLDivElement>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>([]);
  const [galleryUploadState, setGalleryUploadState] = useState<FileUploadUploadState>('idle');
  const [productType, setProductType] = useState<'single' | 'bundle'>('single');
  const [bundleRows, setBundleRows] = useState<Array<{ componentProductId: string; quantity: number }>>([]);

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
      <PageHeader
        title="Add Product"
        backTo="/admin/products"
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
        <input type="hidden" name="productType" value={productType} />
        <input
          type="hidden"
          name="bundleComponents"
          value={JSON.stringify(bundleRows.filter((r) => r.componentProductId))}
          readOnly
        />

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

          {/* Product Type */}
          <RadioGroup
            name="productTypeRadio"
            label="Product Type"
            layout="horizontal"
            value={productType}
            onChange={(v) => setProductType(v as 'single' | 'bundle')}
            options={[
              { value: 'single', label: 'Single Product' },
              { value: 'bundle', label: 'Bundle' },
            ]}
          />

          {/* Bundle Components — inline when "Bundle" is selected */}
          {productType === 'bundle' && (
            <CreateBundleComponentsEditor
              rows={bundleRows}
              onChange={setBundleRows}
              allProducts={allProducts}
            />
          )}

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

// ── Inline bundle editor for creation (no fetcher — data submitted with the form) ──

function CreateBundleComponentsEditor({
  rows,
  onChange,
  allProducts,
}: {
  rows: Array<{ componentProductId: string; quantity: number }>;
  onChange: (rows: Array<{ componentProductId: string; quantity: number }>) => void;
  allProducts: ProductOption[];
}) {
  const availableProducts = useMemo(
    () => allProducts.filter((p) => !rows.some((r) => r.componentProductId === p.id)),
    [allProducts, rows],
  );

  const addRow = useCallback(() => {
    onChange([...rows, { componentProductId: '', quantity: 1 }]);
  }, [rows, onChange]);

  const removeRow = useCallback(
    (index: number) => onChange(rows.filter((_, i) => i !== index)),
    [rows, onChange],
  );

  const updateRow = useCallback(
    (index: number, field: 'componentProductId' | 'quantity', value: string | number) => {
      onChange(
        rows.map((r, i) => {
          if (i !== index) return r;
          if (field === 'componentProductId') return { ...r, componentProductId: String(value) };
          return { ...r, quantity: Number(value) || 1 };
        }),
      );
    },
    [rows, onChange],
  );

  return (
    <div className="space-y-3 rounded-lg border border-app-border bg-app-hover/30 p-3">
      <p className="text-xs text-app-fg-muted">
        Add the individual products this bundle contains. Inventory will be checked and deducted from these components.
      </p>

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <SearchableSelect
                  value={row.componentProductId}
                  onChange={(v) => updateRow(i, 'componentProductId', v)}
                  options={[
                    ...(row.componentProductId
                      ? [{ value: row.componentProductId, label: allProducts.find((p) => p.id === row.componentProductId)?.name ?? '—' }]
                      : []),
                    ...availableProducts
                      .filter((p) => p.id !== row.componentProductId)
                      .map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  placeholder="Select product..."
                />
              </div>
              <div className="w-20 shrink-0">
                <NumberInput
                  value={row.quantity}
                  onChange={(v) => updateRow(i, 'quantity', v ?? 1)}
                  min={1}
                  max={999}
                  placeholder="Qty"
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="shrink-0 p-1.5 text-app-fg-muted hover:text-danger-600 dark:hover:text-danger-400 transition-colors"
                aria-label="Remove component"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        disabled={availableProducts.length === 0 && rows.every((r) => r.componentProductId)}
        className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + Add component
      </button>
    </div>
  );
}
