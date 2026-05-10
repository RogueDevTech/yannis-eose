import { useEffect, useMemo, useState } from 'react';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormConfigCustomFieldsPreview } from './form-config-custom-preview';
import type { CustomFormField, ProductOfferRow, StandardFieldConfig, StandardFieldKey } from './types';
import {
  cloneDefaultAdditionalFieldSelectOptions,
  DEFAULT_GENDER_OPTIONS,
  type AdditionalFieldSelectOptionsState,
  STANDARD_FIELD_LABELS,
} from './standard-fields';

const DEFAULT_HEADING = 'Place Your Order';
const DEFAULT_BUTTON = 'Submit Order';

/** Match legacy `.input` chrome (same surface as core fields like Email in this preview). */
const PREVIEW_FIELD_SURFACE = 'bg-app-elevated border-app-border-strong';
/** Labels match manual fields: sm semibold, primary fg (not muted). */
const PREVIEW_LABEL_WRAP = '[&_label]:text-sm [&_label]:font-medium [&_label]:text-app-fg';

function formatOfferPrice(price: string | number): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (Number.isNaN(num)) return String(price);
  const formatted = Math.abs(num).toLocaleString('en-NG');
  return num < 0 ? `-₦${formatted}` : `₦${formatted}`;
}

/** Matches Edge worker: first absolute http(s) image on the tier. */
function firstOfferThumbnailUrl(urls: string[] | undefined): string {
  if (!Array.isArray(urls)) return '';
  const first = urls.find((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim()));
  return first?.trim() ?? '';
}

export interface FormFullPreviewPreviewProduct {
  id: string;
  name: string;
  offers: ProductOfferRow[];
}

export interface FormFullPreviewProps {
  heading: string;
  subtitle: string;
  buttonText: string;
  accentColor: string;
  multiProduct: boolean;
  standardFields: StandardFieldConfig[];
  successCallbackUrl?: string;
  customFields: CustomFormField[];
  /** Single-product forms: offers from the selected catalog product. Omit the block when empty. */
  previewOffers?: ProductOfferRow[];
  /** Multi-product forms: each product’s tiers (from loader). Omit tiers when a product has no offers. */
  previewProducts?: FormFullPreviewPreviewProduct[];
  /** Dropdown option lists for gender / delivery state / preferred date (matches Edge). */
  additionalSelectOptions?: AdditionalFieldSelectOptionsState;
  /** When true, show tier thumbnails (same as hosted Edge form). Default true. */
  showProductImages?: boolean;
  className?: string;
}

export function FormFullPreview({
  heading,
  subtitle,
  buttonText,
  accentColor,
  multiProduct,
  standardFields,
  successCallbackUrl,
  customFields,
  previewOffers = [],
  previewProducts,
  additionalSelectOptions,
  showProductImages = true,
  className = '',
}: FormFullPreviewProps) {
  const [submitted, setSubmitted] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');

  const h = heading.trim() || DEFAULT_HEADING;
  const sub = subtitle.trim();
  const btn = buttonText.trim() || DEFAULT_BUTTON;

  const sorted = [...customFields].sort((a, b) => a.order - b.order);
  const standard = useMemo<Map<StandardFieldKey, StandardFieldConfig>>(
    () => new Map(standardFields.map((f) => [f.key, f])),
    [standardFields],
  );
  const callbackUrl = (successCallbackUrl ?? '').trim();
  const validCallback = /^https?:\/\//i.test(callbackUrl);

  const resolvedSelectOptions = useMemo(
    () => additionalSelectOptions ?? cloneDefaultAdditionalFieldSelectOptions(),
    [additionalSelectOptions],
  );
  const defaults = useMemo(() => cloneDefaultAdditionalFieldSelectOptions(), []);
  const previewStateOpts = useMemo(
    () =>
      resolvedSelectOptions.deliveryStateOptions.length > 0
        ? resolvedSelectOptions.deliveryStateOptions
        : defaults.deliveryStateOptions,
    [resolvedSelectOptions.deliveryStateOptions, defaults.deliveryStateOptions],
  );
  const previewDateOpts = useMemo(
    () =>
      resolvedSelectOptions.preferredDeliveryDateOptions.length > 0
        ? resolvedSelectOptions.preferredDeliveryDateOptions
        : defaults.preferredDeliveryDateOptions,
    [resolvedSelectOptions.preferredDeliveryDateOptions, defaults.preferredDeliveryDateOptions],
  );
  const previewGenderOpts = useMemo(
    () => (resolvedSelectOptions.genderOptions.length > 0 ? resolvedSelectOptions.genderOptions : DEFAULT_GENDER_OPTIONS),
    [resolvedSelectOptions.genderOptions],
  );

  /** Reset demo submission when builder inputs change so the preview stays in sync. */
  const previewSignature = useMemo(
    () =>
      JSON.stringify({
        heading,
        subtitle,
        buttonText,
        accentColor,
        multiProduct,
        standardFields,
        successCallbackUrl: callbackUrl,
        customFields: [...customFields].sort((a, b) => a.order - b.order),
        previewOffers,
        previewProducts,
        additionalSelectOptions: resolvedSelectOptions,
        showProductImages,
      }),
    [
      heading,
      subtitle,
      buttonText,
      accentColor,
      multiProduct,
      standardFields,
      callbackUrl,
      customFields,
      previewOffers,
      previewProducts,
      resolvedSelectOptions,
      showProductImages,
    ],
  );

  const offerSections = useMemo(() => {
    if (multiProduct) {
      const rows = previewProducts ?? [];
      return rows
        .map((p) => ({
          id: p.id,
          name: p.name.trim() || 'Product',
          offers: (p.offers ?? []).filter((o) => o.label?.trim()),
        }))
        .filter((p) => p.offers.length > 0);
    }
    const offers = (previewOffers ?? []).filter((o) => o.label?.trim());
    if (offers.length === 0) return [];
    return [{ id: 'single', name: '', offers }];
  }, [multiProduct, previewProducts, previewOffers]);

  useEffect(() => {
    setSubmitted(false);
    setPaymentMethod('');
  }, [previewSignature]);

  if (submitted) {
    return (
      <div
        className={[
          'card text-left p-3 space-y-3',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {validCallback ? (
          <iframe
            src={callbackUrl}
            title="Success callback preview"
            className="w-full min-h-[480px] rounded-lg border border-app-border bg-app-canvas"
            style={{ height: 'calc(100vh - var(--header-height, 3.5rem) - 10rem)' }}
          />
        ) : (
          <div className="rounded-lg border border-app-border bg-app-elevated p-4">
            <p className="text-sm text-app-fg">Thank you. We will contact you shortly.</p>
          </div>
        )}

        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            setSubmitted(false);
            setPaymentMethod('');
          }}
        >
          Fill form again
        </button>
      </div>
    );
  }

  return (
    <div
      className={[
        'form-order-preview card text-left p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-y-auto bg-[#efefef] dark:bg-app-elevated',
        'max-h-[min(800px,calc(100vh-var(--header-height,3.5rem)-1.5rem))]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-app-fg leading-tight">{h}</h2>
        {sub && <p className="text-lg sm:text-2xl text-app-fg-muted mt-2 sm:mt-3">{sub}</p>}
      </div>

      {multiProduct ? (
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-app-fg-muted mb-2">Select Product</label>
          {previewProducts && previewProducts.length > 0 ? (
            <div className="space-y-2">
              {previewProducts.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl border-2 border-[#c8c8c8] px-4 py-3 text-lg font-semibold text-app-fg bg-transparent"
                >
                  {p.name.trim() || 'Product'}
                </div>
              ))}
              <p className="text-xs text-app-fg-muted">Live form lets the buyer pick one product; offers update per product.</p>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-[#c8c8c8] p-4 text-lg text-app-fg bg-transparent">
              Your customer picks a product…
            </div>
          )}
        </div>
      ) : null}

      <form
        className="space-y-3 sm:space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
        {offerSections.length > 0 ? (
          <div className="space-y-3 sm:space-y-4">
            <span className="block text-xs font-bold uppercase tracking-wider text-app-fg-muted mb-1.5 sm:mb-2">
              Select Offer
            </span>
            {offerSections.map((section) => (
              <div key={section.id} className="space-y-2 sm:space-y-3">
                {section.name ? (
                  <p className="text-sm font-medium text-app-fg-muted -mt-1">{section.name}</p>
                ) : null}
                <div className="space-y-2 sm:space-y-3">
                  {section.offers.map((o, idx) => {
                    const thumb = showProductImages ? firstOfferThumbnailUrl(o.imageUrls) : '';
                    return (
                    <label
                      key={`${section.id}-${idx}-${o.label}`}
                      className="flex items-start gap-2.5 sm:gap-3 rounded-xl sm:rounded-2xl border-2 border-[#c8c8c8] px-3 py-2.5 sm:px-4 sm:py-3 cursor-pointer"
                    >
                      <input
                        type="radio"
                        className="mt-1 shrink-0"
                        name={multiProduct ? `preview-offer-${section.id}` : 'preview-offer'}
                        defaultChecked={idx === 0}
                      />
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                          className="mt-0.5 w-12 h-12 rounded-lg object-cover border border-[#c8c8c8] shrink-0 bg-app-hover"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 flex flex-col gap-1">
                        <span className="text-base sm:text-xl tracking-wide font-semibold text-app-fg leading-snug">
                          {o.label}
                        </span>
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0 text-sm text-app-fg-muted">
                          <span>
                            {o.qty} UNIT{o.qty > 1 ? 'S' : ''}
                          </span>
                          <span className="font-semibold" style={{ color: accentColor }}>
                            {formatOfferPrice(o.price)}
                          </span>
                        </span>
                      </span>
                    </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <TextInput
          label="Full Name"
          required
          placeholder="Your full name"
          minLength={2}
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />

        <TextInput
          label="Phone Number"
          type="tel"
          required
          placeholder="08012345678"
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />

        {standard.has('gender') ? (
          <FormSelect
            label="Gender"
            required={!!standard.get('gender')?.required}
            placeholder="Select gender..."
            options={previewGenderOpts.map((opt) => ({ value: opt, label: opt }))}
            defaultValue=""
            controlSize="lg"
            className={PREVIEW_FIELD_SURFACE}
            wrapperClassName={PREVIEW_LABEL_WRAP}
          />
        ) : null}

        {standard.has('deliveryState') ? (
          <FormSelect
            label="Delivery State"
            required={!!standard.get('deliveryState')?.required}
            placeholder="Select state..."
            options={previewStateOpts.map((opt) => ({ value: opt, label: opt }))}
            defaultValue=""
            controlSize="lg"
            className={PREVIEW_FIELD_SURFACE}
            wrapperClassName={PREVIEW_LABEL_WRAP}
          />
        ) : null}

        {standard.has('deliveryAddress') ? (
          <Textarea
            label="Delivery Address"
            required={!!standard.get('deliveryAddress')?.required}
            rows={2}
            placeholder="Your delivery address"
            className={`${PREVIEW_FIELD_SURFACE} min-h-[4.5rem] !resize-y`}
            wrapperClassName={PREVIEW_LABEL_WRAP}
          />
        ) : null}

        {standard.has('deliveryNotes') ? (
          <TextInput
            label={
              standard.get('deliveryNotes')?.required ? 'Delivery Notes' : 'Delivery Notes (optional)'
            }
            required={!!standard.get('deliveryNotes')?.required}
            placeholder="Any special instructions"
            controlSize="lg"
            className={PREVIEW_FIELD_SURFACE}
            wrapperClassName={PREVIEW_LABEL_WRAP}
          />
        ) : null}

        {standard.has('preferredDeliveryDate') ? (
          <FormSelect
            label="When do you want to receive your order?"
            required={!!standard.get('preferredDeliveryDate')?.required}
            placeholder="Select..."
            options={previewDateOpts.map((opt) => ({ value: opt, label: opt }))}
            defaultValue=""
            controlSize="lg"
            className={PREVIEW_FIELD_SURFACE}
            wrapperClassName={PREVIEW_LABEL_WRAP}
          />
        ) : null}

        {standard.has('customerEmail') ? (
          <TextInput
            type="email"
            label={STANDARD_FIELD_LABELS.customerEmail}
            required={!!standard.get('customerEmail')?.required}
            placeholder="your@email.com"
            controlSize="lg"
            className={PREVIEW_FIELD_SURFACE}
            wrapperClassName={PREVIEW_LABEL_WRAP}
          />
        ) : null}

        {standard.has('paymentMethod') ? (
          <div className="space-y-2">
            <div>
              <FormSelect
                label={STANDARD_FIELD_LABELS.paymentMethod}
                required={!!standard.get('paymentMethod')?.required}
                placeholder="Select payment method..."
                options={[
                  { value: 'PAY_ON_DELIVERY', label: 'Pay on delivery' },
                  { value: 'PAY_ONLINE', label: 'Pay online (card / bank)' },
                ]}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                controlSize="lg"
                className={PREVIEW_FIELD_SURFACE}
                wrapperClassName={PREVIEW_LABEL_WRAP}
              />
            </div>
            {paymentMethod === 'PAY_ONLINE' && !standard.has('customerEmail') ? (
              <TextInput
                type="email"
                label="Email (for payment receipt)"
                required
                placeholder="your@email.com"
                controlSize="lg"
                className={PREVIEW_FIELD_SURFACE}
                wrapperClassName={PREVIEW_LABEL_WRAP}
              />
            ) : null}
          </div>
        ) : null}

        {sorted.length > 0 ? (
          <FormConfigCustomFieldsPreview
            fields={sorted}
            accentColor={accentColor}
            withOuterWrap={false}
            controlClassName={PREVIEW_FIELD_SURFACE}
          />
        ) : null}

        <button type="submit" className="btn btn-primary w-full" style={{ backgroundColor: accentColor, borderColor: accentColor }}>
          {btn}
        </button>
      </form>
    </div>
  );
}

export { DEFAULT_HEADING, DEFAULT_BUTTON };
