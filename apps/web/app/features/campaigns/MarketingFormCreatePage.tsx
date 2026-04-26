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
            Configure your public order form in one place.{' '}
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

      <fetcher.Form method="post" className="space-y-6">
        <input type="hidden" name="intent" value="createForm" />
        <input type="hidden" name="customFields" value={customFieldsJson} readOnly />
        <input type="hidden" name="formAccentColor" value={accentColor} readOnly />

        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-app-fg">Basic settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextInput name="name" required placeholder="Form name" />
            <FormSelect name="productId" required options={productOptions} placeholder="Select product..." />
          </div>

          <div className="border-t border-app-border pt-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Form customization (optional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput name="formHeading" placeholder="Form heading (default: Place Your Order)" />
              <TextInput name="formSubtitle" placeholder="Form subtitle" />
              <TextInput name="formButtonText" placeholder="Button text (default: Submit Order)" />
              <div className="flex items-center gap-2 sm:col-span-1">
                <input
                  type="color"
                  aria-label="Accent color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-10 h-9 rounded border border-app-border cursor-pointer shrink-0"
                />
                <span className="text-sm text-app-fg-muted">Accent color (preview updates below)</span>
              </div>
              <TextInput
                name="successCallbackUrl"
                type="url"
                placeholder="Success URL (e.g. https://funnel.example.com/thank-you)"
                hint="Optional — full URL of your funnel's thank-you page. Skips the inline success message."
                className="sm:col-span-2"
              />
            </div>
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mt-4 mb-2">Optional standard fields</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryAddress" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Delivery Address</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryNotes" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Delivery Notes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryState" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Delivery State</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showGender" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Gender</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showPreferredDeliveryDate" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Preferred Delivery Date</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showPaymentMethod" defaultChecked={false} />
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
            accentColor={accentColor}
            footnote={
              <span>
                Standard field toggles are in <strong className="text-app-fg">Basic settings</strong> above. Submit once to
                create the form with these custom fields.
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
  );
}
