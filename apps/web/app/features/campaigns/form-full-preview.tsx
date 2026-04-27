import { useMemo, useState } from 'react';
import { FormConfigCustomFieldsPreview } from './form-config-custom-preview';
import type { CustomFormField, StandardFieldConfig, StandardFieldKey } from './types';
import { STANDARD_FIELD_LABELS } from './standard-fields';

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
  multiProduct: boolean;
  standardFields: StandardFieldConfig[];
  successCallbackUrl?: string;
  customFields: CustomFormField[];
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
  className = '',
}: FormFullPreviewProps) {
  const [submitted, setSubmitted] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');

  const h = heading.trim() || DEFAULT_HEADING;
  const sub = subtitle.trim() || DEFAULT_SUBTITLE;
  const btn = buttonText.trim() || DEFAULT_BUTTON;

  const sorted = [...customFields].sort((a, b) => a.order - b.order);
  const standard = useMemo<Map<StandardFieldKey, StandardFieldConfig>>(
    () => new Map(standardFields.map((f) => [f.key, f])),
    [standardFields],
  );
  const callbackUrl = (successCallbackUrl ?? '').trim();
  const validCallback = /^https?:\/\//i.test(callbackUrl);

  if (submitted) {
    return (
      <div
        className={[
          'card text-left p-4 space-y-3 overflow-y-auto',
          'max-h-[min(800px,calc(100vh-var(--header-height,3.5rem)-1.5rem))]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="rounded-lg border border-success-200 bg-success-50 dark:bg-success-950/20 dark:border-success-900 p-3">
          <p className="text-sm font-semibold text-success-700 dark:text-success-400">Order received successfully!</p>
          <p className="text-xs text-success-700/80 dark:text-success-300/90 mt-1">Preview-only submission. No API request was sent.</p>
        </div>

        {validCallback ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-app-fg-muted">Success callback preview (iframe)</p>
            <iframe
              src={callbackUrl}
              title="Success callback preview"
              className="w-full h-[420px] rounded-lg border border-app-border bg-app-canvas"
            />
          </div>
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
        'card text-left p-4 space-y-4 overflow-y-auto bg-[#efefef] dark:bg-app-elevated',
        'max-h-[min(800px,calc(100vh-var(--header-height,3.5rem)-1.5rem))]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div>
        <h2 className="text-3xl font-semibold text-app-fg leading-tight">{h}</h2>
        {sub && <p className="text-2xl text-app-fg-muted mt-3">{sub}</p>}
      </div>

      <span className="inline-flex items-center rounded-xl bg-warning-100 text-warning-900 px-3 py-1.5 text-xl font-semibold w-fit">
        Offline
      </span>

      {multiProduct ? (
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-app-fg-muted mb-2">Select Product</label>
          <div className="rounded-2xl border-2 border-[#c8c8c8] p-4 text-lg text-app-fg bg-transparent">Your customer picks a product...</div>
        </div>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-app-fg-muted mb-2">Select Offer</span>
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-2xl border-2 border-[#c8c8c8] px-4 py-3 cursor-pointer">
              <span className="flex items-center gap-3">
                <input type="radio" name="preview-offer" defaultChecked />
                <span className="text-xl tracking-wide font-semibold text-app-fg">BUY ONE GET ONE FREE</span>
              </span>
              <span className="text-xl font-semibold text-app-fg-muted">
                1 UNIT <span style={{ color: accentColor }}>₦20,000</span>
              </span>
            </label>
            <label className="flex items-center justify-between rounded-2xl border-2 border-[#c8c8c8] px-4 py-3 cursor-pointer">
              <span className="flex items-center gap-3">
                <input type="radio" name="preview-offer" />
                <span className="text-xl tracking-wide font-semibold text-app-fg">BUY THREE GET TWO FREE</span>
              </span>
              <span className="text-xl font-semibold text-app-fg-muted">
                3 UNITS <span style={{ color: accentColor }}>₦40,000</span>
              </span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Full Name</label>
          <input className="input input-bordered w-full" placeholder="Your full name" minLength={2} required />
        </div>

        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Phone Number</label>
          <input className="input input-bordered w-full" type="tel" placeholder="08012345678" required />
        </div>

        {standard.has('gender') ? (
          <div>
            <label className="block text-sm font-medium text-app-fg mb-1">
              Gender {standard.get('gender')?.required ? <span className="text-danger-500">*</span> : null}
            </label>
            <select className="select select-bordered w-full" required={!!standard.get('gender')?.required} defaultValue="">
              <option value="">Select gender...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
        ) : null}

        {standard.has('deliveryState') ? (
          <div>
            <label className="block text-sm font-medium text-app-fg mb-1">
              Delivery State {standard.get('deliveryState')?.required ? <span className="text-danger-500">*</span> : null}
            </label>
            <select className="select select-bordered w-full" required={!!standard.get('deliveryState')?.required} defaultValue="">
              <option value="">Select state...</option>
              {PREVIEW_STATE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {standard.has('deliveryAddress') ? (
          <div>
            <label className="block text-sm font-medium text-app-fg mb-1">
              Delivery Address {standard.get('deliveryAddress')?.required ? <span className="text-danger-500">*</span> : null}
            </label>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={2}
              required={!!standard.get('deliveryAddress')?.required}
              placeholder="Your delivery address"
            />
          </div>
        ) : null}

        {standard.has('deliveryNotes') ? (
          <div>
            <label className="block text-sm font-medium text-app-fg mb-1">
              {standard.get('deliveryNotes')?.required ? 'Delivery Notes' : 'Delivery Notes (optional)'}{' '}
              {standard.get('deliveryNotes')?.required ? <span className="text-danger-500">*</span> : null}
            </label>
            <input
              className="input input-bordered w-full"
              required={!!standard.get('deliveryNotes')?.required}
              placeholder="Any special instructions"
            />
          </div>
        ) : null}

        {standard.has('preferredDeliveryDate') ? (
          <div>
            <label className="block text-sm font-medium text-app-fg mb-1">
              When do you want to receive your order?{' '}
              {standard.get('preferredDeliveryDate')?.required ? <span className="text-danger-500">*</span> : null}
            </label>
            <select className="select select-bordered w-full" required={!!standard.get('preferredDeliveryDate')?.required} defaultValue="">
              <option value="">Select...</option>
              {PREVIEW_DATE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {standard.has('paymentMethod') ? (
          <div className="space-y-2">
            <div>
              <label className="block text-sm font-medium text-app-fg mb-1">
                {STANDARD_FIELD_LABELS.paymentMethod}{' '}
                {standard.get('paymentMethod')?.required ? <span className="text-danger-500">*</span> : null}
              </label>
              <select
                className="select select-bordered w-full"
                value={paymentMethod}
                required={!!standard.get('paymentMethod')?.required}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="">Select payment method...</option>
                <option value="PAY_ON_DELIVERY">Pay on delivery</option>
                <option value="PAY_ONLINE">Pay online (card / bank)</option>
              </select>
            </div>
            {paymentMethod === 'PAY_ONLINE' ? (
              <div>
                <label className="block text-sm font-medium text-app-fg mb-1">
                  Email (for payment receipt) <span className="text-danger-500">*</span>
                </label>
                <input className="input input-bordered w-full" type="email" required placeholder="your@email.com" />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="pt-1 border-t border-app-border">
          <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Custom fields</p>
          <FormConfigCustomFieldsPreview
            fields={sorted}
            accentColor={accentColor}
            withOuterWrap={true}
            emptyMessage="No custom fields on this form."
          />
        </div>

        <button type="submit" className="btn btn-primary w-full" style={{ backgroundColor: accentColor, borderColor: accentColor }}>
          {btn}
        </button>
      </form>
    </div>
  );
}

export { DEFAULT_HEADING, DEFAULT_SUBTITLE, DEFAULT_BUTTON };
