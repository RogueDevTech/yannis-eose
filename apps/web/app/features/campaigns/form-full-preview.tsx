import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormConfigCustomFieldBlock } from './form-config-custom-preview';
import {
  buildOrderedPreviewFields,
  describeFieldOrderToken,
  normalizeBuilderFieldOrder,
  type CampaignFieldOrderToken,
  type OrderedPreviewField,
} from './form-field-order';
import type { CustomFormField, ProductOfferRow, StandardFieldConfig, StandardFieldKey } from './types';
import {
  cloneDefaultAdditionalFieldSelectOptions,
  DEFAULT_GENDER_OPTIONS,
  type AdditionalFieldSelectOptionsState,
  STANDARD_FIELD_LABELS,
} from './standard-fields';

const DEFAULT_HEADING = 'Place Your Order';
const DEFAULT_BUTTON = 'Submit Order';
const DRAG_FIELD_MIME = 'text/yannis-preview-field-token';

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

function moveFieldOrderToken(
  fieldOrder: CampaignFieldOrderToken[],
  draggedToken: CampaignFieldOrderToken,
  targetIndex: number,
): CampaignFieldOrderToken[] {
  const currentIndex = fieldOrder.indexOf(draggedToken);
  if (currentIndex === -1) return fieldOrder;

  const remaining = fieldOrder.filter((token) => token !== draggedToken);
  const clampedTargetIndex = Math.max(0, Math.min(targetIndex, remaining.length));
  remaining.splice(clampedTargetIndex, 0, draggedToken);

  const nextIndex = remaining.indexOf(draggedToken);
  if (nextIndex === currentIndex && fieldOrder.every((token, index) => token === remaining[index])) {
    return fieldOrder;
  }

  return remaining;
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
  fieldOrder?: CampaignFieldOrderToken[];
  onFieldOrderChange?: (next: CampaignFieldOrderToken[]) => void;
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
  fieldOrder,
  onFieldOrderChange,
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
  const [draggingToken, setDraggingToken] = useState<CampaignFieldOrderToken | null>(null);
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null);
  const [dragContainerTop, setDragContainerTop] = useState(0);
  const [rowLayouts, setRowLayouts] = useState<Record<string, { top: number; height: number }>>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const rowRefs = useRef(new Map<CampaignFieldOrderToken, HTMLDivElement>());

  const h = heading.trim() || DEFAULT_HEADING;
  const sub = subtitle.trim();
  const btn = buttonText.trim() || DEFAULT_BUTTON;

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
  const resolvedFieldOrder = useMemo(
    () => normalizeBuilderFieldOrder(fieldOrder, standardFields, customFields),
    [fieldOrder, standardFields, customFields],
  );
  const baseOrderedPreviewFields = useMemo(
    () => buildOrderedPreviewFields(standardFields, customFields, resolvedFieldOrder),
    [standardFields, customFields, resolvedFieldOrder],
  );
  const projectedFieldOrder = useMemo(() => {
    if (!draggingToken || dragInsertIndex === null) return resolvedFieldOrder;
    return moveFieldOrderToken(resolvedFieldOrder, draggingToken, dragInsertIndex);
  }, [resolvedFieldOrder, draggingToken, dragInsertIndex]);

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
        fieldOrder: resolvedFieldOrder,
        successCallbackUrl: callbackUrl,
        customFields: baseOrderedPreviewFields
          .filter((field): field is Extract<OrderedPreviewField, { kind: 'custom' }> => field.kind === 'custom')
          .map((field) => field.field),
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
      resolvedFieldOrder,
      callbackUrl,
      baseOrderedPreviewFields,
      previewOffers,
      previewProducts,
      resolvedSelectOptions,
      showProductImages,
    ],
  );

  function snapshotRowLayouts(): Record<string, { top: number; height: number }> {
    const nextLayouts: Record<string, { top: number; height: number }> = {};
    for (const token of resolvedFieldOrder) {
      const row = rowRefs.current.get(token);
      if (!row) continue;
      nextLayouts[token] = {
        top: row.offsetTop,
        height: row.offsetHeight,
      };
    }
    return nextLayouts;
  }

  useLayoutEffect(() => {
    function measureRowLayouts() {
      setRowLayouts(snapshotRowLayouts());
    }

    measureRowLayouts();
    window.addEventListener('resize', measureRowLayouts);
    return () => window.removeEventListener('resize', measureRowLayouts);
  }, [resolvedFieldOrder, baseOrderedPreviewFields, paymentMethod]);

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
    setDraggingToken(null);
    setDragInsertIndex(null);
    setDragContainerTop(0);
  }, [previewSignature]);

  function reorderFields(draggedToken: CampaignFieldOrderToken, targetIndex: number) {
    if (!onFieldOrderChange) return;
    const next = moveFieldOrderToken(resolvedFieldOrder, draggedToken, targetIndex);
    setDraggingToken(null);
    setDragInsertIndex(null);
    onFieldOrderChange(next);
  }

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
        ref={formRef}
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

        {baseOrderedPreviewFields.map((field, index) => {
          const projectedIndex = projectedFieldOrder.indexOf(field.token);
          const currentLayout = rowLayouts[field.token];
          const projectedSlotToken = resolvedFieldOrder[projectedIndex];
          const projectedLayout = projectedSlotToken ? rowLayouts[projectedSlotToken] : undefined;
          const translateY =
            currentLayout && projectedLayout ? projectedLayout.top - currentLayout.top : 0;

          return (
          <ReorderablePreviewField
            key={field.token}
            token={field.token}
            index={index}
            label={field.kind === 'standard' ? field.label : describeFieldOrderToken(field.token)}
            canReorder={!!onFieldOrderChange}
            isDragging={draggingToken === field.token}
            translateY={translateY}
            dragContainerTop={dragContainerTop}
            rowTop={currentLayout?.top ?? 0}
            rowHeight={currentLayout?.height ?? 0}
            rowRef={(node) => {
              if (node) {
                rowRefs.current.set(field.token, node);
              } else {
                rowRefs.current.delete(field.token);
              }
            }}
            onDragStart={(token) => {
              setDragContainerTop(formRef.current?.getBoundingClientRect().top ?? 0);
              setDraggingToken(token);
              setDragInsertIndex(resolvedFieldOrder.indexOf(token));
            }}
            onDragHoverGap={(nextGapIndex) =>
              setDragInsertIndex((current) => (current === nextGapIndex ? current : nextGapIndex))
            }
            onDragEnd={() => {
              setDraggingToken(null);
              setDragInsertIndex(null);
              setDragContainerTop(0);
            }}
            onDropToken={(token) => reorderFields(token, dragInsertIndex ?? resolvedFieldOrder.indexOf(token))}
          >
            {renderPreviewField({
              field,
              accentColor,
              paymentMethod,
              previewGenderOpts,
              previewStateOpts,
              previewDateOpts,
              showStandaloneEmail: standard.has('customerEmail'),
              onPaymentMethodChange: setPaymentMethod,
            })}
          </ReorderablePreviewField>
          );
        })}

        <button type="submit" className="btn btn-primary w-full" style={{ backgroundColor: accentColor, borderColor: accentColor }}>
          {btn}
        </button>
      </form>
    </div>
  );
}

function renderPreviewField({
  field,
  accentColor,
  paymentMethod,
  previewGenderOpts,
  previewStateOpts,
  previewDateOpts,
  showStandaloneEmail,
  onPaymentMethodChange,
}: {
  field: OrderedPreviewField;
  accentColor: string;
  paymentMethod: string;
  previewGenderOpts: string[];
  previewStateOpts: string[];
  previewDateOpts: string[];
  showStandaloneEmail: boolean;
  onPaymentMethodChange: (value: string) => void;
}) {
  if (field.kind === 'fixed') {
    if (field.key === 'fullName') {
      return (
        <TextInput
          label="Full Name"
          required
          placeholder="Your full name"
          minLength={2}
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />
      );
    }
    return (
      <TextInput
        label="Phone Number"
        type="tel"
        required
        placeholder="08012345678"
        controlSize="lg"
        className={PREVIEW_FIELD_SURFACE}
        wrapperClassName={PREVIEW_LABEL_WRAP}
      />
    );
  }

  if (field.kind === 'custom') {
    return (
      <FormConfigCustomFieldBlock
        field={field.field}
        accentColor={accentColor}
        controlClassName={PREVIEW_FIELD_SURFACE}
      />
    );
  }

  switch (field.key) {
    case 'gender':
      return (
        <FormSelect
          label={field.label}
          required={field.required}
          placeholder="Select gender..."
          options={previewGenderOpts.map((opt) => ({ value: opt, label: opt }))}
          defaultValue=""
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />
      );
    case 'deliveryState':
      return (
        <FormSelect
          label={field.label}
          required={field.required}
          placeholder="Select state..."
          options={previewStateOpts.map((opt) => ({ value: opt, label: opt }))}
          defaultValue=""
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />
      );
    case 'deliveryAddress':
      return (
        <Textarea
          label={field.label}
          required={field.required}
          rows={2}
          placeholder="Your delivery address"
          className={`${PREVIEW_FIELD_SURFACE} min-h-[4.5rem] !resize-y`}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />
      );
    case 'deliveryNotes':
      return (
        <TextInput
          label={field.required ? field.label : `${field.label} (optional)`}
          required={field.required}
          placeholder="Any special instructions"
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />
      );
    case 'preferredDeliveryDate':
      return (
        <FormSelect
          label={field.label}
          required={field.required}
          placeholder="Select..."
          options={previewDateOpts.map((opt) => ({ value: opt, label: opt }))}
          defaultValue=""
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />
      );
    case 'customerEmail':
      return (
        <TextInput
          type="email"
          label={field.label}
          required={field.required}
          placeholder="your@email.com"
          controlSize="lg"
          className={PREVIEW_FIELD_SURFACE}
          wrapperClassName={PREVIEW_LABEL_WRAP}
        />
      );
    case 'paymentMethod':
      return (
        <div className="space-y-2">
          <FormSelect
            label={field.label}
            required={field.required}
            placeholder="Select payment method..."
            options={[
              { value: 'PAY_ON_DELIVERY', label: 'Pay on delivery' },
              { value: 'PAY_ONLINE', label: 'Pay online (card / bank)' },
            ]}
            value={paymentMethod}
            onChange={(e) => onPaymentMethodChange(e.target.value)}
            controlSize="lg"
            className={PREVIEW_FIELD_SURFACE}
            wrapperClassName={PREVIEW_LABEL_WRAP}
          />
          {paymentMethod === 'PAY_ONLINE' && !showStandaloneEmail ? (
            <TextInput
              type="email"
              label={`${STANDARD_FIELD_LABELS.customerEmail} (for payment receipt)`}
              required
              placeholder="your@email.com"
              controlSize="lg"
              className={PREVIEW_FIELD_SURFACE}
              wrapperClassName={PREVIEW_LABEL_WRAP}
            />
          ) : null}
        </div>
      );
  }
}

function ReorderablePreviewField({
  token,
  index,
  label,
  canReorder,
  isDragging,
  translateY,
  dragContainerTop,
  rowTop,
  rowHeight,
  rowRef,
  onDragStart,
  onDragHoverGap,
  onDragEnd,
  onDropToken,
  children,
}: {
  token: CampaignFieldOrderToken;
  index: number;
  label: string;
  canReorder: boolean;
  isDragging: boolean;
  translateY: number;
  dragContainerTop: number;
  rowTop: number;
  rowHeight: number;
  rowRef: (node: HTMLDivElement | null) => void;
  onDragStart: (token: CampaignFieldOrderToken) => void;
  onDragHoverGap: (gapIndex: number) => void;
  onDragEnd: () => void;
  onDropToken: (token: CampaignFieldOrderToken) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={rowRef}
      onDragOver={(e) => {
        if (!canReorder || !e.dataTransfer.types.includes(DRAG_FIELD_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const pointerY = e.clientY - dragContainerTop;
        const gapIndex = pointerY < rowTop + rowHeight / 2 ? index : index + 1;
        onDragHoverGap(gapIndex);
      }}
      onDrop={(e) => {
        if (!canReorder) return;
        e.preventDefault();
        const draggedToken = e.dataTransfer.getData(DRAG_FIELD_MIME) as CampaignFieldOrderToken;
        if (draggedToken) {
          onDropToken(draggedToken);
        }
      }}
      className={[
        'flex items-start gap-3 rounded-xl transition-all duration-150',
        isDragging ? 'relative z-20 rotate-[1deg] scale-[1.02] opacity-95 shadow-2xl' : '',
      ].join(' ')}
      style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
    >
      {canReorder ? (
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_FIELD_MIME, token);
            e.dataTransfer.effectAllowed = 'move';
            const row = e.currentTarget.parentElement as HTMLElement | null;
            if (row) {
              const rect = row.getBoundingClientRect();
              e.dataTransfer.setDragImage(row, Math.min(24, rect.width / 2), Math.min(24, rect.height / 2));
            }
            onDragStart(token);
          }}
          onDragEnd={() => {
            onDragEnd();
          }}
          className={[
            'mt-8 inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-lg border bg-app-canvas text-app-fg-muted active:cursor-grabbing transition-all duration-150',
            isDragging
              ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-md dark:bg-brand-900/30 dark:text-brand-300'
              : 'border-app-border',
          ].join(' ')}
          title={`Drag to move ${label}`}
          aria-label={`Drag to move ${label}`}
        >
          <DragHandleIcon />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function DragHandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="3" r="1.2" />
      <circle cx="10" cy="3" r="1.2" />
      <circle cx="4" cy="7" r="1.2" />
      <circle cx="10" cy="7" r="1.2" />
      <circle cx="4" cy="11" r="1.2" />
      <circle cx="10" cy="11" r="1.2" />
    </svg>
  );
}

export { DEFAULT_HEADING, DEFAULT_BUTTON };
