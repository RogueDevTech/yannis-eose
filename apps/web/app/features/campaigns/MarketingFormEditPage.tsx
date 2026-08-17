import { DEFAULT_CAMPAIGN_FORM_ACCENT_HEX } from '@yannis/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, Link, useActionData, useFetcher, useNavigation, useRevalidator } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { useCurrenciesCatalog } from '~/contexts/currencies-catalog-context';
import { regionsForCountry } from '@yannis/shared';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { PageNotification } from '~/components/ui/page-notification';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { InlineNotification } from '~/components/ui/inline-notification';
import { useFetcherToast } from '~/components/ui/toast';
import { AccentColorInput } from './accent-color-input';
import {
  getOrderedCustomFields,
  getOrderedStandardFields,
  normalizeBuilderFieldOrder,
  type CampaignFieldOrderToken,
} from './form-field-order';
import { templatesToPreviewOffers, type MinimalOfferTemplateForPreview } from './offer-template-preview';
import type { Campaign, CustomFormField, OfferGroupRow, Product, StandardFieldConfig } from './types';
import { CustomFieldsEditor } from './custom-fields-editor';
import { sortAndReindexCustomFields } from './custom-fields-order';
import { FormFullPreview } from './form-full-preview';
import { additionalFieldSelectOptionsFromConfig, ensureFixedStandardFields, normalizeStandardFields } from './standard-fields';
import { StandardFieldsEditor } from './standard-fields-editor';

type MarketingFormEditPicklists = {
  formProducts: Product[];
  offerTemplates: MinimalOfferTemplateForPreview[];
  offerGroups: OfferGroupRow[];
  offerGroupsLoadError: string | null;
};

export interface MarketingFormEditPageProps {
  campaign: Campaign;
  /**
   * Resolved picklists OR a Promise that resolves them. When a Promise, the
   * Offer + Tiers selection sections show "Loading…" while every other input
   * (heading, subtitle, button text, accent, custom fields, status actions)
   * is fully interactive (App Shell pattern).
   */
  picklistsPromise: Promise<MarketingFormEditPicklists> | MarketingFormEditPicklists;
  /** `marketing.offerTemplate` — enables Offer tiers panel on this form. */
  canManageOfferTemplates?: boolean;
}

/** Type guard — distinguishes a pre-resolved payload from a Promise. */
function isResolvedPicklistsForFormEdit<T>(v: T | Promise<T>): v is T {
  return typeof v === 'object' && v != null && !('then' in (v as object));
}

const FORMS_INDEX_ACTION = '/admin/marketing/forms';

const ActivateIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const DeactivateIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ArchiveIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
    />
  </svg>
);

/**
 * Full-page edit: basic form settings + custom fields (same shape as new form), one save.
 * Activate / deactivate / archive use the forms index action (status-only) so they apply immediately.
 */
export function MarketingFormEditPage({
  campaign,
  picklistsPromise,
  canManageOfferTemplates = false,
}: MarketingFormEditPageProps) {
  // Bridge the deferred picklists to local state so the rest of the form
  // (heading, subtitle, button text, accent, custom fields, preview, status
  // actions) renders immediately. Only the Offer/Tiers selection sections
  // briefly suspend until this resolves.
  const [picklists, setPicklists] = useState<MarketingFormEditPicklists | null>(
    isResolvedPicklistsForFormEdit(picklistsPromise) ? picklistsPromise : null,
  );
  useEffect(() => {
    if (isResolvedPicklistsForFormEdit(picklistsPromise)) {
      setPicklists(picklistsPromise);
      return;
    }
    let cancelled = false;
    Promise.resolve(picklistsPromise)
      .then((p) => {
        if (!cancelled) setPicklists(p);
      })
      .catch(() => {
        if (!cancelled) {
          setPicklists({
            formProducts: [],
            offerTemplates: [],
            offerGroups: [],
            offerGroupsLoadError: 'Could not load offers. Try refreshing.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [picklistsPromise]);
  const picklistsLoading = picklists === null;
  const formProducts = picklists?.formProducts ?? [];
  const offerTemplates = picklists?.offerTemplates ?? [];
  const offerGroups = picklists?.offerGroups ?? [];
  const offerGroupsLoadError = picklists?.offerGroupsLoadError ?? null;
  const navigation = useNavigation();
  const actionData = useActionData<{ error?: string } | undefined>();
  const statusFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const { revalidate } = useRevalidator();
  const [dismissedActionError, setDismissedActionError] = useState(false);
  const actionError = actionData?.error;

  /** Use Remix `<Form>` so save action `redirect()` navigates back to the forms list on success. */
  const isSavingForm =
    navigation.formData?.get('intent') === 'updateForm' &&
    (navigation.state === 'submitting' || navigation.state === 'loading');

  const [confirmAction, setConfirmAction] = useState<{ type: 'deactivate' | 'archive' } | null>(null);
  const [dismissedOffersLoadError, setDismissedOffersLoadError] = useState(false);
  // Reset the dismissed-warning flag whenever the loader either fixes the error or surfaces a new one.
  useEffect(() => {
    setDismissedOffersLoadError(false);
  }, [offerGroupsLoadError]);

  useFetcherToast(statusFetcher.data, { successMessage: 'Status updated' });

  const cfg = campaign.formConfig;
  const legacyMultiProduct = (campaign.productIds?.length ?? 0) > 1;

  // Multi-currency config (the currency section is gated on the SELECTED offer
  // actually having multi-currency prices — see offerHasMultiCurrency below).
  const currenciesForForm = useCurrenciesCatalog();
  const baseCurrency = currenciesForForm.find((c) => c.isDefault && c.active) ?? currenciesForForm[0];
  // Only countries configured in Country & Currency settings.
  const configuredCountries = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of currenciesForForm) {
      if (c.active && c.countryName && !seen.has(c.countryName)) {
        seen.add(c.countryName);
        out.push(c.countryName);
      }
    }
    return out;
  }, [currenciesForForm]);

  const [selectedOfferTemplateIds, setSelectedOfferTemplateIds] = useState<string[]>(() =>
    Array.isArray(cfg?.selectedOfferTemplateIds) ? cfg.selectedOfferTemplateIds : [],
  );
  const [selectedOfferGroupId, setSelectedOfferGroupId] = useState<string>(() => campaign.offerGroupId ?? '');

  const [fields, setFields] = useState<CustomFormField[]>(() =>
    sortAndReindexCustomFields((cfg?.customFields ?? []) as CustomFormField[]),
  );
  const [accentColor, setAccentColor] = useState(() => cfg?.accentColor ?? DEFAULT_CAMPAIGN_FORM_ACCENT_HEX);
  const [formHeading, setFormHeading] = useState(() => cfg?.heading ?? '');
  const [formSubtitle, setFormSubtitle] = useState(() => cfg?.subtitle ?? '');
  const [formButtonText, setFormButtonText] = useState(() => cfg?.buttonText ?? '');
  const [successCallbackUrl, setSuccessCallbackUrl] = useState(() => cfg?.successCallbackUrl ?? '');
  const [showProductImages, setShowProductImages] = useState(() => cfg?.showProductImages !== false);
  const [allowMultiCurrency, setAllowMultiCurrency] = useState(() => (cfg as { allowMultiCurrency?: boolean } | null)?.allowMultiCurrency === true);
  const [pinnedCurrency, setPinnedCurrency] = useState(() => (cfg as { pinnedCurrency?: string } | null)?.pinnedCurrency ?? '');
  const [standardFields, setStandardFields] = useState<StandardFieldConfig[]>(() => ensureFixedStandardFields(normalizeStandardFields(campaign.formConfig)));
  const [fieldOrder, setFieldOrder] = useState<CampaignFieldOrderToken[]>(() =>
    normalizeBuilderFieldOrder(cfg?.fieldOrder, normalizeStandardFields(campaign.formConfig), sortAndReindexCustomFields((cfg?.customFields ?? []) as CustomFormField[])),
  );
  const [additionalSelectOptions, setAdditionalSelectOptions] = useState(() =>
    additionalFieldSelectOptionsFromConfig(campaign.formConfig),
  );
  // Delivery country drives the "Delivery State" region list. Defaults to Nigeria.
  const [deliveryCountry, setDeliveryCountry] = useState<string>(
    (cfg as { deliveryCountry?: string } | null)?.deliveryCountry ?? 'Nigeria',
  );
  const [allowCountrySelection, setAllowCountrySelection] = useState<boolean>(
    (cfg as { allowCountrySelection?: boolean } | null)?.allowCountrySelection === true,
  );
  const onDeliveryCountryChange = (country: string) => {
    setDeliveryCountry(country);
    const regions = regionsForCountry(country);
    if (regions.length > 0) setAdditionalSelectOptions((prev) => ({ ...prev, deliveryStateOptions: [...regions] }));
    // Auto-select the currency for this country (when the offer is priced in it).
    const countryCurrency = currenciesForForm.find(
      (c) => c.active && c.countryName.toLowerCase() === country.toLowerCase(),
    );
    if (countryCurrency) {
      if (countryCurrency.isDefault) setPinnedCurrency('');
      else if (selectedOfferCurrencies.includes(countryCurrency.code.toUpperCase())) setPinnedCurrency(countryCurrency.code);
    }
  };

  useEffect(() => {
    const c = campaign.formConfig;
    setFields(sortAndReindexCustomFields((c?.customFields ?? []) as CustomFormField[]));
    setAccentColor(c?.accentColor ?? DEFAULT_CAMPAIGN_FORM_ACCENT_HEX);
    setFormHeading(c?.heading ?? '');
    setFormSubtitle(c?.subtitle ?? '');
    setFormButtonText(c?.buttonText ?? '');
    setSuccessCallbackUrl(c?.successCallbackUrl ?? '');
    setShowProductImages(c?.showProductImages !== false);
    setAllowMultiCurrency((c as { allowMultiCurrency?: boolean } | null)?.allowMultiCurrency === true);
    setPinnedCurrency((c as { pinnedCurrency?: string } | null)?.pinnedCurrency ?? '');
    setStandardFields(normalizeStandardFields(c));
    setFieldOrder(
      normalizeBuilderFieldOrder(
        c?.fieldOrder,
        normalizeStandardFields(c),
        sortAndReindexCustomFields((c?.customFields ?? []) as CustomFormField[]),
      ),
    );
    setAdditionalSelectOptions(additionalFieldSelectOptionsFromConfig(c));
    setDeliveryCountry((c as { deliveryCountry?: string } | null)?.deliveryCountry ?? 'Nigeria');
    setAllowCountrySelection((c as { allowCountrySelection?: boolean } | null)?.allowCountrySelection === true);
    setSelectedOfferTemplateIds(Array.isArray(c?.selectedOfferTemplateIds) ? c.selectedOfferTemplateIds : []);
    setSelectedOfferGroupId(campaign.offerGroupId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when switching form
  }, [campaign.id]);

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

  const selectedOfferTemplateIdsJson = useMemo(
    () => JSON.stringify(selectedOfferTemplateIds),
    [selectedOfferTemplateIds],
  );

  const soleProductId = useMemo(() => {
    const ids = campaign.productIds;
    if (!Array.isArray(ids) || ids.length === 0 || typeof ids[0] !== 'string') return null;
    return ids[0];
  }, [campaign.productIds]);

  // CEO directive 2026-05-04: an offer carries its own products. Forms pick from
  // ANY non-archived, non-empty offer group; the offer's items drive what the
  // Edge form renders. The previous constraint (offer must contain the form's
  // `primary product`) was rejected — products live inside the offer, not the
  // other way around.
  const compatibleOfferGroups = useMemo(() => {
    return offerGroups
      .filter((g) => String(g.status).toUpperCase() !== 'ARCHIVED')
      .filter((g) => g.items.length > 0);
  }, [offerGroups]);

  // Every currency an offer group is priced in — base (NGN) is always present,
  // plus any per-currency prices set on its items. Lets the MB see at a glance
  // which offers carry multiple currencies.
  const baseCode = (baseCurrency?.code ?? 'NGN').toUpperCase();
  const offerGroupCurrencies = (g: (typeof compatibleOfferGroups)[number]): string[] => {
    const codes = new Set<string>([baseCode]);
    for (const it of g.items) {
      for (const [code, v] of Object.entries(it.pricesByCurrency ?? {})) {
        if (Number(v) > 0) codes.add(code.toUpperCase());
      }
    }
    return [...codes];
  };

  const offerGroupOptions = useMemo(
    () =>
      compatibleOfferGroups.map((g) => {
        const codes = offerGroupCurrencies(g);
        return {
          value: g.id,
          label: `${g.name} (${g.items.length} items)`,
          // Always show the offer's currencies (NGN alone, or all when multi).
          labelSuffix: (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {codes.join(', ')}
            </span>
          ),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compatibleOfferGroups, baseCode],
  );

  // Non-base currencies the SELECTED offer is actually priced in (drives the toggle).
  const selectedOfferCurrencies = useMemo(() => {
    const g = compatibleOfferGroups.find((x) => x.id === selectedOfferGroupId);
    if (!g) return [] as string[];
    const codes = new Set<string>();
    for (const it of g.items) {
      for (const [code, v] of Object.entries(it.pricesByCurrency ?? {})) {
        if (code.toUpperCase() !== 'NGN' && Number(v) > 0) codes.add(code.toUpperCase());
      }
    }
    return [...codes];
  }, [compatibleOfferGroups, selectedOfferGroupId]);
  const offerHasMultiCurrency = selectedOfferCurrencies.length > 0;

  const previewOffers = useMemo(() => {
    if (selectedOfferGroupId) {
      const g = compatibleOfferGroups.find((x) => x.id === selectedOfferGroupId);
      if (!g) return [];
      return g.items
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((it) => ({
          label: it.label,
          qty: Number(it.quantity ?? 1) || 1,
          price: typeof it.price === 'number' ? String(it.price) : String(it.price ?? ''),
          ...(typeof it.imageUrl === 'string' && it.imageUrl.length > 0 ? { imageUrls: [it.imageUrl] } : {}),
          ...(it.pricesByCurrency ? { pricesByCurrency: it.pricesByCurrency } : {}),
        }));
    }
    return templatesToPreviewOffers(offerTemplates, selectedOfferTemplateIds);
  }, [compatibleOfferGroups, offerTemplates, selectedOfferGroupId, selectedOfferTemplateIds]);

  function toggleOfferTemplate(templateId: string, checked: boolean) {
    setSelectedOfferTemplateIds((prev) => {
      if (checked) return prev.includes(templateId) ? prev : [...prev, templateId];
      return prev.filter((id) => id !== templateId);
    });
  }

  useEffect(() => {
    if (navigation.state === 'submitting' && navigation.formData?.get('intent') === 'updateForm') {
      setDismissedActionError(false);
    }
  }, [navigation.state, navigation.formData]);

  useEffect(() => {
    if (statusFetcher.state === 'idle' && statusFetcher.data) {
      const result = statusFetcher.data as { success?: boolean };
      if (result.success) {
        revalidate();
        setConfirmAction(null);
      }
    }
  }, [statusFetcher.state, statusFetcher.data, revalidate]);

  const submitStatusChange = useCallback(
    (status: string) => {
      const formData = new FormData();
      formData.set('intent', 'updateFormStatus');
      formData.set('id', campaign.id);
      formData.set('status', status);
      statusFetcher.submit(formData, { method: 'post', action: FORMS_INDEX_ACTION });
    },
    [campaign.id, statusFetcher],
  );

  const statusActions = (
    <>
      {campaign.status === 'ACTIVE' && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5 text-warning-700 dark:text-warning-400 border-warning-200 dark:border-warning-800"
          onClick={() => setConfirmAction({ type: 'deactivate' })}
        >
          {DeactivateIcon}
          Deactivate
        </Button>
      )}
      {campaign.status === 'INACTIVE' && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5 text-success-700 dark:text-success-400"
          onClick={() => submitStatusChange('ACTIVE')}
          loading={statusFetcher.state === 'submitting'}
          loadingText="Activating…"
        >
          {ActivateIcon}
          Activate
        </Button>
      )}
      {campaign.status !== 'ARCHIVED' && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5 text-danger-700 dark:text-danger-400 border-danger-200 dark:border-danger-800"
          onClick={() => setConfirmAction({ type: 'archive' })}
        >
          {ArchiveIcon}
          Archive
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit form"
        backTo="/admin/marketing/forms"
        description={
          <>
            Update settings for <span className="font-medium text-app-fg">{campaign.name}</span>.
          </>
        }
        actions={statusActions}
      />

      {!!offerGroupsLoadError && !dismissedOffersLoadError && (
        <PageNotification
          variant="warning"
          title="Offers could not be loaded"
          message={offerGroupsLoadError}
          durationMs={8000}
          onDismiss={() => setDismissedOffersLoadError(true)}
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

      {legacyMultiProduct ? (
        <InlineNotification
          variant="warning"
          message={`Legacy form: multiple catalog products (${formProducts.map((p) => p.name).join(', ')}). The public Edge form only resolves tiers from the first product.`}
        />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-6 items-start">
        <div className="min-w-0">
          <Form method="post" className="space-y-6" key={campaign.id}>
            <input type="hidden" name="intent" value="updateForm" />
            <input type="hidden" name="id" value={campaign.id} />
            <input type="hidden" name="customFields" value={customFieldsJson} readOnly />
            <input type="hidden" name="standardFields" value={standardFieldsJson} readOnly />
            <input type="hidden" name="fieldOrder" value={fieldOrderJson} readOnly />
            <input type="hidden" name="additionalFieldSelectOptions" value={additionalFieldSelectOptionsJson} readOnly />
            <input type="hidden" name="formAccentColor" value={accentColor} readOnly />
            <input type="hidden" name="showProductImages" value={showProductImages ? 'true' : 'false'} readOnly />
            <input type="hidden" name="deliveryCountry" value={deliveryCountry} readOnly />
            <input type="hidden" name="allowCountrySelection" value={allowCountrySelection ? 'true' : 'false'} readOnly />
            <input type="hidden" name="allowMultiCurrency" value={offerHasMultiCurrency && allowMultiCurrency ? 'true' : 'false'} readOnly />
            {/* pinnedCurrency = default/starting currency (whether the picker is on or off). */}
            <input type="hidden" name="pinnedCurrency" value={offerHasMultiCurrency ? pinnedCurrency : ''} readOnly />
            <input type="hidden" name="selectedOfferTemplateIds" value={selectedOfferTemplateIdsJson} readOnly />
            <input type="hidden" name="offerGroupId" value={selectedOfferGroupId} readOnly />

            <div className="card space-y-5">
              {/* Essentials: a clean 2-per-row grid; Offer spans full width so nothing is left dangling. */}
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <TextInput label="Form name" name="name" required defaultValue={campaign.name} />
                <FormSelect
                  key={`status-${campaign.id}`}
                  label="Status"
                  name="status"
                  defaultValue={campaign.status}
                  options={[
                    { value: 'ACTIVE', label: 'Active' },
                    { value: 'INACTIVE', label: 'Inactive' },
                    { value: 'ARCHIVED', label: 'Archived' },
                  ]}
                />
                <div className="sm:col-span-2">
                  <SearchableSelect
                    label="Offer"
                    value={selectedOfferGroupId}
                    onChange={(v) => {
                      setSelectedOfferGroupId(v);
                      // Selecting an offer group supersedes legacy tier selection.
                      setSelectedOfferTemplateIds([]);
                    }}
                    options={
                      picklistsLoading
                        ? [{ value: selectedOfferGroupId, label: 'Loading offers…' }]
                        : compatibleOfferGroups.length > 0
                          ? [{ value: '', label: 'No offer selected' }, ...offerGroupOptions]
                          : [{ value: '', label: 'No offers yet — create one on the Offers tab' }]
                    }
                    disabled={picklistsLoading || compatibleOfferGroups.length === 0}
                    searchPlaceholder="Search offers..."
                    loading={picklistsLoading}
                  />
                </div>
              </div>

              <div className="border-t border-app-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-app-fg-muted">Form customization</p>

                {/* Consistent 2-per-row grid. Short fields pair up; the URL row spans full width. */}
                <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <TextInput
                    name="formHeading"
                    label="Form heading"
                    labelInfo="Large title shown at the top of the public form."
                    placeholder="Form heading"
                    value={formHeading}
                    onChange={(e) => setFormHeading(e.target.value)}
                  />
                  <TextInput
                    name="formSubtitle"
                    label="Form subtitle"
                    labelInfo="Smaller line under the heading."
                    placeholder="e.g. Fill in your details below"
                    value={formSubtitle}
                    onChange={(e) => setFormSubtitle(e.target.value)}
                  />
                  <TextInput
                    name="formButtonText"
                    label="Button text"
                    labelInfo="Label on the submit button customers tap to order."
                    placeholder="Button text"
                    value={formButtonText}
                    onChange={(e) => setFormButtonText(e.target.value)}
                  />
                  <AccentColorInput
                    value={accentColor}
                    onChange={setAccentColor}
                    labelInfo="Brand color for the button and highlights. Preview updates on the right."
                  />
                  <TextInput
                    name="successCallbackUrl"
                    type="url"
                    label="Success URL (optional)"
                    labelInfo="Thank-you page customers are sent to after ordering. Leave blank to show the default confirmation."
                    placeholder="e.g. https://funnel.example.com/thank-you"
                    value={successCallbackUrl}
                    onChange={(e) => setSuccessCallbackUrl(e.target.value)}
                    className="sm:col-span-2"
                  />
                  {/* Show product images as a dropdown, grouped with the other inputs. */}
                  <FormSelect
                    label="Product images"
                    value={showProductImages ? 'show' : 'hide'}
                    onChange={(e) => setShowProductImages(e.target.value === 'show')}
                    options={[
                      { value: 'show', label: 'Show on the form' },
                      { value: 'hide', label: 'Hide' },
                    ]}
                  />
                </div>

                {/* Multi country and currency — grouped in its own section. */}
                {configuredCountries.length > 1 && (
                  <div className="mt-3 rounded-2xl border border-app-border p-4">
                    <h2 className="mb-3 text-sm font-semibold text-app-fg">Multi country and currency</h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* Country selection only matters when the offer is priced in
                          more than one currency — a single-currency (Naira-only)
                          offer has nothing to switch between. */}
                      {offerHasMultiCurrency && (
                        <FormSelect
                          label="Country mode"
                          value={allowCountrySelection ? 'multi' : 'single'}
                          onChange={(e) => setAllowCountrySelection(e.target.value === 'multi')}
                          options={[
                            { value: 'multi', label: 'Allow country selection' },
                            { value: 'single', label: 'Lock one country' },
                          ]}
                        />
                      )}
                      {offerHasMultiCurrency && (
                        <FormSelect
                          label={allowCountrySelection ? 'Default country (shown first)' : 'Country'}
                          value={deliveryCountry}
                          onChange={(e) => onDeliveryCountryChange(e.target.value)}
                          options={configuredCountries.map((country) => ({ value: country, label: country }))}
                        />
                      )}
                      {offerHasMultiCurrency && (
                        <FormSelect
                          label="Currency mode"
                          value={allowMultiCurrency ? 'multi' : 'single'}
                          onChange={(e) => setAllowMultiCurrency(e.target.value === 'multi')}
                          options={[
                            { value: 'multi', label: 'Allow multi currency selection' },
                            { value: 'single', label: 'Lock one currency' },
                          ]}
                        />
                      )}
                      {offerHasMultiCurrency && (
                        <FormSelect
                          label={allowMultiCurrency ? 'Default currency (shown first)' : 'Currency'}
                          value={pinnedCurrency}
                          onChange={(e) => setPinnedCurrency(e.target.value)}
                          options={[
                            { value: '', label: `${baseCurrency?.symbol ?? '₦'} ${baseCurrency?.code ?? 'NGN'} (default)` },
                            ...selectedOfferCurrencies.map((code) => ({
                              value: code,
                              label: `${currenciesForForm.find((c) => c.code === code)?.symbol ?? ''} ${code}`,
                            })),
                          ]}
                        />
                      )}
                    </div>
                    {!offerHasMultiCurrency && (
                      <p className="mt-2 text-xs text-app-fg-muted">
                        {selectedOfferGroupId
                          ? 'The selected offer only has a Naira price. Add other currency prices to the offer to let customers pick a currency.'
                          : 'Select an offer with multiple currency prices to enable customer currency selection.'}
                      </p>
                    )}
                  </div>
                )}
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
                    once to save the form with these custom fields.
                  </span>
                }
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="sm" loading={isSavingForm} loadingText="Saving…">
                Save changes
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
            multiProduct={false}
            standardFields={orderedStandardFields}
            fieldOrder={fieldOrder}
            onFieldOrderChange={setFieldOrder}
            successCallbackUrl={successCallbackUrl}
            customFields={orderedCustomFields}
            previewOffers={previewOffers}
            additionalSelectOptions={additionalSelectOptions}
            showProductImages={showProductImages}
            currencies={currenciesForForm}
            allowMultiCurrency={allowMultiCurrency}
            pinnedCurrency={pinnedCurrency}
            deliveryCountry={deliveryCountry}
          />
        </div>
      </div>

      {confirmAction && (
        <ConfirmActionModal
          open
          onClose={() => setConfirmAction(null)}
          title={confirmAction.type === 'deactivate' ? 'Deactivate form?' : `Archive "${campaign.name}"?`}
          description={
            confirmAction.type === 'deactivate' ? (
              <>
                <strong>{campaign.name}</strong> will no longer be active. You can activate it again later.
              </>
            ) : (
              <>
                <strong>{campaign.name}</strong> will be hidden from default lists.
              </>
            )
          }
          details={
            confirmAction.type === 'archive' ? (
              <ul className="list-disc list-inside text-sm text-app-fg-muted space-y-1">
                <li>Hidden from default campaign lists</li>
                <li>You can change status back anytime</li>
              </ul>
            ) : undefined
          }
          confirmLabel={confirmAction.type === 'deactivate' ? 'Deactivate' : 'Archive'}
          variant={confirmAction.type === 'deactivate' ? 'warning' : 'archive'}
          loading={statusFetcher.state === 'submitting'}
          onConfirm={() => {
            submitStatusChange(confirmAction.type === 'deactivate' ? 'INACTIVE' : 'ARCHIVED');
          }}
        />
      )}
    </div>
  );
}
