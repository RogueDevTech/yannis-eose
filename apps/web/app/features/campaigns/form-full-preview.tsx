import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { FormConfigCustomFieldsPreview } from './form-config-custom-preview';
import type { CustomFormField } from './types';

const DEFAULT_HEADING = 'Place Your Order';
const DEFAULT_SUBTITLE = 'Fill in your details below';
const DEFAULT_BUTTON = 'Submit Order';

const PREVIEW_STATE_OPTIONS = ['Lagos', 'Abuja (FCT)', 'Rivers', 'Kano', 'Oyo', 'Delta'];
const PREVIEW_DATE_OPTIONS = [
  'As soon as possible',
  'Within 1-2 days',
  'Within 3-5 days',
  'Next week',
  'Specific date (mention in notes)',
];

export interface FormFullPreviewProps {
  heading: string;
  subtitle: string;
  buttonText: string;
  accentColor: string;
  /** If true, show a product picker placeholder before offer (mirrors multi-product hosted form). */
  multiProduct: boolean;
  showGender: boolean;
  showDeliveryState: boolean;
  showDeliveryAddress: boolean;
  showDeliveryNotes: boolean;
  showPreferredDeliveryDate: boolean;
  showPaymentMethod: boolean;
  customFields: CustomFormField[];
  /** If set, use as sticky column className (e.g. max-height, scroll). */
  className?: string;
}

/**
 * Read-only, full hosted-form order: heading, product/offer, core + optional standard fields,
 * then custom fields and submit (aligned with `getFormInnerHTML` in the Edge worker).
 */
export function FormFullPreview({
  heading,
  subtitle,
  buttonText,
  accentColor,
  multiProduct,
  showGender,
  showDeliveryState,
  showDeliveryAddress,
  showDeliveryNotes,
  showPreferredDeliveryDate,
  showPaymentMethod,
  customFields,
  className = '',
}: FormFullPreviewProps) {
  const h = heading.trim() || DEFAULT_HEADING;
  const sub = subtitle.trim() || DEFAULT_SUBTITLE;
  const btn = buttonText.trim() || DEFAULT_BUTTON;

  const sorted = [...customFields].sort((a, b) => a.order - b.order);

  return (
    <div
      className={[
        'card text-left p-4 space-y-3 overflow-y-auto',
        'max-h-[min(800px,calc(100vh-var(--header-height,3.5rem)-1.5rem))]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ borderTop: `3px solid ${accentColor}` }}
    >
      <div>
        <h2 className="text-lg font-semibold text-app-fg leading-tight">{h}</h2>
        {sub && <p className="text-sm text-app-fg-muted mt-1">{sub}</p>}
      </div>

      {multiProduct && (
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Select Product</label>
          <TextInput disabled placeholder="Your customer picks a product…" readOnly wrapperClassName="pointer-events-none" />
        </div>
      )}

      <div>
        <span className="block text-sm font-medium text-app-fg mb-1">Select offer</span>
        <div className="space-y-1.5 border border-dashed border-app-border rounded-md p-2 bg-app-elevated/30">
          <label className="flex items-center gap-2 text-xs text-app-fg">
            <input type="radio" name="preview-offer" defaultChecked disabled style={{ accentColor }} />
            <span>Standard (example — 1 unit)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-app-fg-muted">
            <input type="radio" name="preview-offer" disabled style={{ accentColor }} />
            <span>Bundle (example)</span>
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-app-fg mb-1">Full Name</label>
        <TextInput
          disabled
          readOnly
          placeholder="Your full name"
          minLength={2}
          wrapperClassName="pointer-events-none"
        />
        <p className="text-[10px] text-app-fg-muted mt-0.5">Required on live form (min. 2 characters)</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-app-fg mb-1">Phone Number</label>
        <TextInput
          type="tel"
          disabled
          readOnly
          placeholder="08012345678"
          wrapperClassName="pointer-events-none"
        />
        <p className="text-[10px] text-app-fg-muted mt-0.5">Nigerian format, required on live form</p>
      </div>

      {showGender && (
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">
            Gender <span className="text-danger-500">*</span>
          </label>
          <FormSelect
            disabled
            placeholder="Select gender…"
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
            ]}
            defaultValue=""
            wrapperClassName="pointer-events-none"
          />
        </div>
      )}

      {showDeliveryState && (
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">
            Delivery State <span className="text-danger-500">*</span>
          </label>
          <FormSelect
            disabled
            placeholder="Select state…"
            options={PREVIEW_STATE_OPTIONS.map((s) => ({ value: s, label: s }))}
            defaultValue=""
            wrapperClassName="pointer-events-none"
          />
        </div>
      )}

      {showDeliveryAddress && (
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Delivery Address</label>
          <Textarea
            rows={2}
            disabled
            readOnly
            placeholder="Your delivery address"
            wrapperClassName="pointer-events-none"
          />
        </div>
      )}

      {showDeliveryNotes && (
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Delivery Notes (optional)</label>
          <TextInput disabled readOnly placeholder="Any special instructions" wrapperClassName="pointer-events-none" />
        </div>
      )}

      {showPreferredDeliveryDate && (
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">
            When do you want to receive your order? <span className="text-danger-500">*</span>
          </label>
          <FormSelect
            disabled
            placeholder="Select…"
            options={PREVIEW_DATE_OPTIONS.map((o) => ({ value: o, label: o }))}
            defaultValue=""
            wrapperClassName="pointer-events-none"
          />
        </div>
      )}

      {showPaymentMethod && (
        <div className="space-y-2">
          <div>
            <label className="block text-sm font-medium text-app-fg mb-1">Payment method</label>
            <FormSelect
              disabled
              placeholder="Select payment method…"
              options={[
                { value: 'POD', label: 'Pay on delivery' },
                { value: 'PAY', label: 'Pay online (card / bank)' },
              ]}
              defaultValue=""
              wrapperClassName="pointer-events-none"
            />
          </div>
          <p className="text-xs text-app-fg-muted">If the buyer picks Pay online, the hosted form also asks for email (receipt).</p>
        </div>
      )}

      <div className="pt-1 border-t border-app-border">
        <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Custom fields</p>
        <FormConfigCustomFieldsPreview
          fields={sorted}
          accentColor={accentColor}
          withOuterWrap={true}
          emptyMessage="No custom fields on this form."
        />
      </div>

      <Button type="button" variant="primary" className="w-full pointer-events-none" disabled>
        {btn}
      </Button>
    </div>
  );
}

export { DEFAULT_HEADING, DEFAULT_SUBTITLE, DEFAULT_BUTTON };
