import { DEFAULT_CAMPAIGN_FORM_ACCENT_HEX } from '@yannis/shared';
import { useEffect, useMemo, useState } from 'react';

/** Type guard — distinguishes a pre-resolved payload (clientLoader cache hit)
 *  from a Promise (first-paint). */
function isResolved<T>(v: T | Promise<T>): v is T {
  return typeof v === 'object' && v != null && !('then' in (v as object));
}
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { TextInput } from '~/components/ui/text-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { PageNotification } from '~/components/ui/page-notification';
import type { Campaign, CustomFormField, OfferGroupRow, StandardFieldConfig } from './types';
import { AccentColorInput } from './accent-color-input';
import { CustomFieldsEditor } from './custom-fields-editor';
import { sortAndReindexCustomFields } from './custom-fields-order';
import {
  getOrderedCustomFields,
  getOrderedStandardFields,
  normalizeBuilderFieldOrder,
  type CampaignFieldOrderToken,
} from './form-field-order';
import { FormFullPreview, type FormFullPreviewPreviewProduct } from './form-full-preview';
import {
  additionalFieldSelectOptionsFromConfig,
  cloneDefaultAdditionalFieldSelectOptions,
  ensureFixedStandardFields,
  normalizeStandardFields,
} from './standard-fields';
import { StandardFieldsEditor } from './standard-fields-editor';

export interface MarketingFormCreatePageProps {
  /**
   * Resolved offer groups + load error OR a Promise that resolves them. When a
   * Promise, the offer-group dropdown shows a "Loading…" state while every
   * other input is fully interactive (App Shell pattern).
   */
  offerGroupsPromise:
    | Promise<{ offerGroups: OfferGroupRow[]; offerGroupsLoadError: string | null }>
    | { offerGroups: OfferGroupRow[]; offerGroupsLoadError: string | null };
  /**
   * When set (`?duplicateFrom=<id>`), every builder input is seeded from this
   * form — heading, offer, fields, field order, etc. The name is intentionally
   * NOT seeded: it stays blank for the Media Buyer to name the copy.
   */
  duplicateFrom?: Campaign | null;
}

/**
 * Full-page create flow: basic form settings + custom field builder, single submit to
 * `marketing.createCampaign` with `formConfig.customFields`. Offer group is required; product ids are derived server-side.
 */
export function MarketingFormCreatePage({
  offerGroupsPromise,
  duplicateFrom = null,
}: MarketingFormCreatePageProps) {
  // Bridge the deferred offer-groups payload to local state so the rest of the
  // form (heading/subtitle/preview/custom field builder) renders immediately.
  // While `offerGroups` is null, the offer-group select is the only briefly
  // disabled control on the page.
  const [offerGroups, setOfferGroups] = useState<OfferGroupRow[] | null>(
    isResolved(offerGroupsPromise) ? offerGroupsPromise.offerGroups : null,
  );
  const [offerGroupsLoadError, setOfferGroupsLoadError] = useState<string | null>(
    isResolved(offerGroupsPromise) ? offerGroupsPromise.offerGroupsLoadError : null,
  );
  useEffect(() => {
    if (isResolved(offerGroupsPromise)) {
      setOfferGroups(offerGroupsPromise.offerGroups);
      setOfferGroupsLoadError(offerGroupsPromise.offerGroupsLoadError);
      return;
    }
    let cancelled = false;
    Promise.resolve(offerGroupsPromise)
      .then((payload) => {
        if (cancelled) return;
        setOfferGroups(payload.offerGroups);
        setOfferGroupsLoadError(payload.offerGroupsLoadError);
      })
      .catch(() => {
        if (cancelled) return;
        setOfferGroups([]);
        setOfferGroupsLoadError('Could not load offers. Try refreshing the page.');
      });
    return () => {
      cancelled = true;
    };
  }, [offerGroupsPromise]);
  const navigation = useNavigation();
  const actionData = useActionData<{ error?: string } | undefined>();

  /** Use Remix `<Form>` (not `fetcher.Form`) so the action’s `redirect()` applies a real navigation after create. */
  const isCreatingForm =
    navigation.formData?.get('intent') === 'createForm' &&
    (navigation.state === 'submitting' || navigation.state === 'loading');

  // Duplicate flow: seed every builder input from the source form's config.
  // The form NAME is deliberately not seeded — it stays blank for the MB.
  const dupCfg = duplicateFrom?.formConfig ?? null;

  const [accentColor, setAccentColor] = useState<string>(
    dupCfg?.accentColor ?? DEFAULT_CAMPAIGN_FORM_ACCENT_HEX,
  );
  const [fields, setFields] = useState<CustomFormField[]>(() =>
    sortAndReindexCustomFields((dupCfg?.customFields ?? []) as CustomFormField[]),
  );
  const [standardFields, setStandardFields] = useState<StandardFieldConfig[]>(() =>
    ensureFixedStandardFields(normalizeStandardFields(dupCfg)),
  );
  const [fieldOrder, setFieldOrder] = useState<CampaignFieldOrderToken[]>(() =>
    normalizeBuilderFieldOrder(
      dupCfg?.fieldOrder,
      normalizeStandardFields(dupCfg),
      sortAndReindexCustomFields((dupCfg?.customFields ?? []) as CustomFormField[]),
    ),
  );
  const [dismissedOffersError, setDismissedOffersError] = useState(false);
  const [dismissedActionError, setDismissedActionError] = useState(false);
  const [formHeading, setFormHeading] = useState(dupCfg?.heading ?? '');
  const [formSubtitle, setFormSubtitle] = useState(dupCfg?.subtitle ?? '');
  const [formButtonText, setFormButtonText] = useState(dupCfg?.buttonText ?? '');
  const [successCallbackUrl, setSuccessCallbackUrl] = useState(dupCfg?.successCallbackUrl ?? '');
  const [showProductImages, setShowProductImages] = useState(
    dupCfg?.showProductImages !== false && dupCfg?.showProductImages !== 'false',
  );
  const [additionalSelectOptions, setAdditionalSelectOptions] = useState(() =>
    dupCfg ? additionalFieldSelectOptionsFromConfig(dupCfg) : cloneDefaultAdditionalFieldSelectOptions(),
  );
  const [selectedOfferGroupId, setSelectedOfferGroupId] = useState(duplicateFrom?.offerGroupId ?? '');

  useEffect(() => {
    setFieldOrder((current) => normalizeBuilderFieldOrder(current, standardFields, fields));
  }, [standardFields, fields]);

  const orderedStandardFields = useMemo(
    () => getOrderedStandardFields(standardFields, fieldOrder),
    [standardFields, fieldOrder],
  );
  const orderedCustomFields = useMemo(
    () => getOrderedCustomFields(fields, fieldOrder),
    [fields, fieldOrder],
  );

  const customFieldsJson = useMemo(() => JSON.stringify(orderedCustomFields), [orderedCustomFields]);
  const standardFieldsJson = useMemo(() => JSON.stringify(orderedStandardFields), [orderedStandardFields]);
  const fieldOrderJson = useMemo(() => JSON.stringify(fieldOrder), [fieldOrder]);
  const additionalFieldSelectOptionsJson = useMemo(
    () => JSON.stringify(additionalSelectOptions),
    [additionalSelectOptions],
  );
  const actionError = actionData?.error;

  useEffect(() => {
    if (navigation.state === 'submitting' && navigation.formData?.get('intent') === 'createForm') {
      setDismissedActionError(false);
    }
  }, [navigation.state, navigation.formData]);

  const compatibleOfferGroups = useMemo(() => {
    return (offerGroups ?? [])
      .filter((g) => String(g.status).toUpperCase() === 'ACTIVE')
      .filter((g) => g.items.length > 0);
  }, [offerGroups]);
  const offerGroupsLoading = offerGroups === null;

  const offerGroupOptions = useMemo(
    () =>
      compatibleOfferGroups.map((g) => ({
        value: g.id,
        label: `${g.name} (${g.items.length} items)`,
      })),
    [compatibleOfferGroups],
  );

  const { previewMultiProduct, previewOffers, previewProducts } = useMemo(() => {
    if (!selectedOfferGroupId) {
      return {
        previewMultiProduct: false,
        previewOffers: [] as { label: string; qty: number; price: string; imageUrls?: string[] }[],
        previewProducts: undefined as FormFullPreviewPreviewProduct[] | undefined,
      };
    }
    const g = compatibleOfferGroups.find((x) => x.id === selectedOfferGroupId);
    if (!g) {
      return {
        previewMultiProduct: false,
        previewOffers: [],
        previewProducts: undefined,
      };
    }
    const items = g.items
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const orderedProductIds: string[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      if (!seen.has(it.productId)) {
        seen.add(it.productId);
        orderedProductIds.push(it.productId);
      }
    }

    const rowToOffer = (it: (typeof items)[0]) => ({
      label: it.label,
      qty: Number(it.quantity ?? 1) || 1,
      price: typeof it.price === 'number' ? String(it.price) : String(it.price ?? ''),
      ...(typeof it.imageUrl === 'string' && it.imageUrl.length > 0 ? { imageUrls: [it.imageUrl] } : {}),
    });

    if (orderedProductIds.length <= 1) {
      return {
        previewMultiProduct: false,
        previewOffers: items.map(rowToOffer),
        previewProducts: undefined,
      };
    }

    const previewProductsBuilt: FormFullPreviewPreviewProduct[] = orderedProductIds.map((pid) => {
      const tierItems = items.filter((i) => i.productId === pid);
      const name = tierItems[0]?.productName ?? 'Product';
      return {
        id: pid,
        name,
        offers: tierItems.map(rowToOffer),
      };
    });

    return {
      previewMultiProduct: true,
      previewOffers: [],
      previewProducts: previewProductsBuilt,
    };
  }, [compatibleOfferGroups, selectedOfferGroupId]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New form"
        backTo="/admin/marketing/forms"
        description={
          <>
            Configure your public order form in one place. The preview on the right updates as you edit.
          </>
        }
      />

      {offerGroupsLoadError && !dismissedOffersError && (
        <PageNotification
          variant="error"
          message={offerGroupsLoadError}
          durationMs={8000}
          onDismiss={() => setDismissedOffersError(true)}
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
          <Form method="post" className="space-y-6">
            <input type="hidden" name="intent" value="createForm" />
            <input type="hidden" name="customFields" value={customFieldsJson} readOnly />
            <input type="hidden" name="standardFields" value={standardFieldsJson} readOnly />
            <input type="hidden" name="fieldOrder" value={fieldOrderJson} readOnly />
            <input type="hidden" name="additionalFieldSelectOptions" value={additionalFieldSelectOptionsJson} readOnly />
            <input type="hidden" name="formAccentColor" value={accentColor} readOnly />
            <input type="hidden" name="offerGroupId" value={selectedOfferGroupId} readOnly />
            <input type="hidden" name="showProductImages" value={showProductImages ? 'true' : 'false'} readOnly />

            <div className="card space-y-3">
              <h2 className="text-sm font-semibold text-app-fg">Basic settings</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextInput name="name" required placeholder="Form name" className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <SearchableSelect
                    id="marketing-form-offer-group"
                    label="Offer"
                    value={selectedOfferGroupId}
                    onChange={setSelectedOfferGroupId}
                    required
                    options={
                      offerGroupsLoading
                        ? []
                        : compatibleOfferGroups.length > 0
                          ? offerGroupOptions
                          : [{ value: '', label: 'No offers yet — create one on the Offers tab' }]
                    }
                    disabled={offerGroupsLoading || compatibleOfferGroups.length === 0}
                    placeholder={offerGroupsLoading ? 'Loading offers…' : 'Select offer…'}
                    searchPlaceholder="Search offers…"
                    hint={
                      offerGroupsLoading
                        ? 'Fetching available offer packages…'
                        : compatibleOfferGroups.length === 0
                          ? 'Create an offer package on the Offers tab first.'
                          : 'Required. Catalog products and tiers come from this offer.'
                    }
                  />
                </div>
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
                    hint="Optional. Leave blank to hide subtitle text on the public form."
                    placeholder="e.g. Fill in your details below"
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
                  <AccentColorInput value={accentColor} onChange={setAccentColor} hint="Preview updates on the right." />
                  <TextInput
                    name="successCallbackUrl"
                    type="url"
                    label="Success URL (optional)"
                    placeholder="e.g. https://funnel.example.com/thank-you"
                    hint="Skips the inline success message when set."
                    value={successCallbackUrl}
                    onChange={(e) => setSuccessCallbackUrl(e.target.value)}
                    className="sm:col-span-2"
                  />
                  <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm text-app-fg-muted cursor-pointer">
                    <Checkbox checked={showProductImages} onChange={(e) => setShowProductImages(e.target.checked)} />
                    Show product images on the form
                  </label>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-app-fg mb-2">Additional fields</h2>
              <StandardFieldsEditor
                fields={orderedStandardFields}
                onFieldsChange={setStandardFields}
                selectOptions={additionalSelectOptions}
                onSelectOptionsChange={setAdditionalSelectOptions}
              />
            </div>

            <div>
              <h2 className="text-sm font-semibold text-app-fg mb-2">Custom fields</h2>
              <CustomFieldsEditor
                fields={orderedCustomFields}
                onFieldsChange={setFields}
                footnote={
                  <span>
                    Additional field toggles are in <strong className="text-app-fg">Additional fields</strong> above. Submit
                    once to create the form with these custom fields.
                  </span>
                }
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="sm" loading={isCreatingForm} loadingText="Creating…">
                Create form
              </Button>
              <Link to="/admin/marketing/forms" className="btn-secondary btn-sm inline-flex items-center justify-center">
                Cancel
              </Link>
            </div>
          </Form>
        </div>

        <div className="min-w-0 space-y-2 self-start static lg:sticky lg:top-[calc(var(--header-height,3.5rem)+0.5rem)] z-[1] max-lg:mb-2">
          <p className="text-xs text-app-fg-muted font-medium">Live preview (hosted form)</p>
          <FormFullPreview
            heading={formHeading}
            subtitle={formSubtitle}
            buttonText={formButtonText}
            accentColor={accentColor}
            multiProduct={previewMultiProduct}
            standardFields={orderedStandardFields}
            fieldOrder={fieldOrder}
            onFieldOrderChange={setFieldOrder}
            successCallbackUrl={successCallbackUrl}
            customFields={orderedCustomFields}
            previewOffers={previewOffers}
            previewProducts={previewProducts}
            additionalSelectOptions={additionalSelectOptions}
            showProductImages={showProductImages}
          />
        </div>
      </div>
    </div>
  );
}
