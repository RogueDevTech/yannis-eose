import { useEffect, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { Checkbox } from '~/components/ui/checkbox';
import { PageNotification } from '~/components/ui/page-notification';
import type { CustomFormField, Product } from './types';
import { CustomFieldsEditor } from './custom-fields-editor';
import { FormFullPreview } from './form-full-preview';

export interface MarketingFormCreatePageProps {
  products: Product[];
  productsLoadError?: string | null;
}

const DEFAULT_ACCENT = '#6366f1';

/**
 * Full-page create flow: basic form settings + custom field builder, single submit to
 * `marketing.createCampaign` with `formConfig.customFields`.
 */
export function MarketingFormCreatePage({ products, productsLoadError = null }: MarketingFormCreatePageProps) {
  const fetcher = useFetcher<{ error?: string }>();

  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [fields, setFields] = useState<CustomFormField[]>([]);
  const [dismissedProductsError, setDismissedProductsError] = useState(false);
  const [dismissedActionError, setDismissedActionError] = useState(false);
  const [formHeading, setFormHeading] = useState('');
  const [formSubtitle, setFormSubtitle] = useState('');
  const [formButtonText, setFormButtonText] = useState('');
  const [showDeliveryAddress, setShowDeliveryAddress] = useState(false);
  const [showDeliveryNotes, setShowDeliveryNotes] = useState(false);
  const [showDeliveryState, setShowDeliveryState] = useState(false);
  const [showGender, setShowGender] = useState(false);
  const [showPreferredDeliveryDate, setShowPreferredDeliveryDate] = useState(false);
  const [showPaymentMethod, setShowPaymentMethod] = useState(false);

  const customFieldsJson = useMemo(() => JSON.stringify(fields), [fields]);
  const actionError = (fetcher.data as { error?: string } | undefined)?.error;

  useEffect(() => {
    if (fetcher.state === 'submitting') setDismissedActionError(false);
  }, [fetcher.state]);

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: p.id,
        label: `${p.name} (₦${Number(p.baseSalePrice).toLocaleString()})`,
      })),
    [products],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="New form"
        description={
          <>
            Configure your public order form in one place. The preview on the right updates as you edit.{' '}
            <Link to="/admin/marketing/forms" className="text-brand-600 dark:text-brand-400 hover:underline">
              Back to all forms
            </Link>
          </>
        }
      />

      {productsLoadError && !dismissedProductsError && (
        <PageNotification
          variant="error"
          message={productsLoadError}
          durationMs={8000}
          onDismiss={() => setDismissedProductsError(true)}
        />
      )}

      {actionError && !dismissedActionError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={8000}
          onDismiss={() => setDismissedActionError(true)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-6 items-start">
        <div className="min-w-0">
          <fetcher.Form method="post" className="space-y-6">
            <input type="hidden" name="intent" value="createForm" />
            <input type="hidden" name="customFields" value={customFieldsJson} readOnly />
            <input type="hidden" name="formAccentColor" value={accentColor} readOnly />
            {showDeliveryAddress && <input type="hidden" name="showDeliveryAddress" value="on" />}
            {showDeliveryNotes && <input type="hidden" name="showDeliveryNotes" value="on" />}
            {showDeliveryState && <input type="hidden" name="showDeliveryState" value="on" />}
            {showGender && <input type="hidden" name="showGender" value="on" />}
            {showPreferredDeliveryDate && <input type="hidden" name="showPreferredDeliveryDate" value="on" />}
            {showPaymentMethod && <input type="hidden" name="showPaymentMethod" value="on" />}

            <div className="card space-y-3">
              <h2 className="text-sm font-semibold text-app-fg">Basic settings</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextInput name="name" required placeholder="Form name" />
                <FormSelect name="productId" required options={productOptions} placeholder="Select product..." />
              </div>

              <div className="border-t border-app-border pt-3">
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Form customization (optional)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    name="formHeading"
                    label="Form heading"
                    placeholder="Default: Place Your Order"
                    value={formHeading}
                    onChange={(e) => setFormHeading(e.target.value)}
                  />
                  <TextInput
                    name="formSubtitle"
                    label="Form subtitle"
                    placeholder="Default: Fill in your details below"
                    value={formSubtitle}
                    onChange={(e) => setFormSubtitle(e.target.value)}
                  />
                  <TextInput
                    name="formButtonText"
                    label="Button text"
                    placeholder="Default: Submit Order"
                    value={formButtonText}
                    onChange={(e) => setFormButtonText(e.target.value)}
                  />
                  <div className="flex items-center gap-2 sm:col-span-1">
                    <input
                      type="color"
                      aria-label="Accent color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-10 h-9 rounded border border-app-border cursor-pointer shrink-0"
                    />
                    <span className="text-sm text-app-fg-muted">Accent (preview on the right)</span>
                  </div>
                  <TextInput
                    name="successCallbackUrl"
                    type="url"
                    label="Success URL (optional)"
                    placeholder="e.g. https://funnel.example.com/thank-you"
                    hint="Skips the inline success message when set."
                    defaultValue=""
                    className="sm:col-span-2"
                  />
                </div>
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mt-4 mb-2">Optional standard fields</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={showDeliveryAddress}
                      onChange={(e) => setShowDeliveryAddress(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg-muted">Delivery Address</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={showDeliveryNotes}
                      onChange={(e) => setShowDeliveryNotes(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg-muted">Delivery Notes</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={showDeliveryState}
                      onChange={(e) => setShowDeliveryState(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg-muted">Delivery State</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={showGender} onChange={(e) => setShowGender(e.target.checked)} />
                    <span className="text-sm text-app-fg-muted">Gender</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={showPreferredDeliveryDate}
                      onChange={(e) => setShowPreferredDeliveryDate(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg-muted">Preferred Delivery Date</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={showPaymentMethod}
                      onChange={(e) => setShowPaymentMethod(e.target.checked)}
                    />
                    <span className="text-sm text-app-fg-muted">Payment method (Pay on delivery / Pay online)</span>
                  </label>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-app-fg mb-2">Custom fields</h2>
              <CustomFieldsEditor
                fields={fields}
                onFieldsChange={setFields}
                footnote={
                  <span>
                    Standard field toggles are in <strong className="text-app-fg">Basic settings</strong> above. Submit once
                    to create the form with these custom fields.
                  </span>
                }
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating…">
                Create form
              </Button>
              <Link to="/admin/marketing/forms" className="btn-secondary btn-sm inline-flex items-center justify-center">
                Cancel
              </Link>
            </div>
          </fetcher.Form>
        </div>

        <div className="min-w-0 space-y-2 self-start static lg:sticky lg:top-[calc(var(--header-height,3.5rem)+0.5rem)] z-[1] max-lg:mb-2">
          <p className="text-xs text-app-fg-muted font-medium">Live preview (hosted form)</p>
          <FormFullPreview
            heading={formHeading}
            subtitle={formSubtitle}
            buttonText={formButtonText}
            accentColor={accentColor}
            multiProduct={false}
            showGender={showGender}
            showDeliveryState={showDeliveryState}
            showDeliveryAddress={showDeliveryAddress}
            showDeliveryNotes={showDeliveryNotes}
            showPreferredDeliveryDate={showPreferredDeliveryDate}
            showPaymentMethod={showPaymentMethod}
            customFields={fields}
          />
        </div>
      </div>
    </div>
  );
}
