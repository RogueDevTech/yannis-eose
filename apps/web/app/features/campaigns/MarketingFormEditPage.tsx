import { DEFAULT_CAMPAIGN_FORM_ACCENT_HEX } from '@yannis/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, Link, useActionData, useFetcher, useNavigation, useRevalidator } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
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
  const [standardFields, setStandardFields] = useState<StandardFieldConfig[]>(() => ensureFixedStandardFields(normalizeStandardFields(campaign.formConfig)));
  const [fieldOrder, setFieldOrder] = useState<CampaignFieldOrderToken[]>(() =>
    normalizeBuilderFieldOrder(cfg?.fieldOrder, normalizeStandardFields(campaign.formConfig), sortAndReindexCustomFields((cfg?.customFields ?? []) as CustomFormField[])),
  );
  const [additionalSelectOptions, setAdditionalSelectOptions] = useState(() =>
    additionalFieldSelectOptionsFromConfig(campaign.formConfig),
  );

  useEffect(() => {
    const c = campaign.formConfig;
    setFields(sortAndReindexCustomFields((c?.customFields ?? []) as CustomFormField[]));
    setAccentColor(c?.accentColor ?? DEFAULT_CAMPAIGN_FORM_ACCENT_HEX);
    setFormHeading(c?.heading ?? '');
    setFormSubtitle(c?.subtitle ?? '');
    setFormButtonText(c?.buttonText ?? '');
    setSuccessCallbackUrl(c?.successCallbackUrl ?? '');
    setShowProductImages(c?.showProductImages !== false);
    setStandardFields(normalizeStandardFields(c));
    setFieldOrder(
      normalizeBuilderFieldOrder(
        c?.fieldOrder,
        normalizeStandardFields(c),
        sortAndReindexCustomFields((c?.customFields ?? []) as CustomFormField[]),
      ),
    );
    setAdditionalSelectOptions(additionalFieldSelectOptionsFromConfig(c));
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

  const offerGroupOptions = useMemo(
    () =>
      compatibleOfferGroups.map((g) => ({
        value: g.id,
        label: `${g.name} (${g.items.length} items)`,
      })),
    [compatibleOfferGroups],
  );

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
            <input type="hidden" name="selectedOfferTemplateIds" value={selectedOfferTemplateIdsJson} readOnly />
            <input type="hidden" name="offerGroupId" value={selectedOfferGroupId} readOnly />

            <div className="card space-y-4">
              <h2 className="text-sm font-semibold text-app-fg">Basic settings</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextInput label="Form Name" name="name" required defaultValue={campaign.name} />
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

              <div className="border-t border-app-border pt-3">
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Form customization</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    name="formHeading"
                    label="Form heading"
                    placeholder="Form heading"
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
                    placeholder="Button text"
                    value={formButtonText}
                    onChange={(e) => setFormButtonText(e.target.value)}
                  />
                  <AccentColorInput value={accentColor} onChange={setAccentColor} hint="Preview updates on the right." />
                  <TextInput
                    name="successCallbackUrl"
                    type="url"
                    label="Success URL (optional)"
                    placeholder="e.g. https://funnel.example.com/thank-you"
                    hint="Full URL of your thank-you page. Skips the inline success message when set."
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
