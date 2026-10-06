import { formatInternationalPhone, toInternationalPhone } from '../currency/phone-format';

/**
 * Order customer phone as shown in admin / Sales UIs and list rows.
 * - When `customer_phone` is stored: classic digit mask (first 4 + **** + last 4 digits).
 * - When only a hash exists (edge intake): show "Hidden" — never slice the hash into
 *   phone-like hex strings (that confused operators and logistics paste).
 */
export function formatOrderCustomerPhoneDisplay(
  rawPhone: string | null | undefined,
  phoneHash: string | null | undefined,
  /** Order currency = order country. Non-NGN numbers mask in international form. */
  currencyCode?: string | null,
): string {
  const raw = rawPhone?.trim();
  if (raw) {
    // Non-Nigerian orders: mask the international form so CS sees the country
    // code ('+255 97****552'). Nigeria keeps the legacy local mask unchanged.
    const isNgn = !currencyCode || currencyCode.trim().toUpperCase() === 'NGN';
    const intl = isNgn ? null : toInternationalPhone(raw, currencyCode);
    if (intl) {
      // Short plans (≤8 national digits) stay fully masked, like the legacy rule.
      if (intl.national.length <= 8) return `+${intl.dialCode} ****`;
      return `+${intl.dialCode} ${intl.national.slice(0, 2)}****${intl.national.slice(-3)}`;
    }
    let digits = raw.replace(/\D+/g, '');
    // Normalize Nigeria country code to local leading 0 for a consistent digit mask.
    if (digits.startsWith('234') && digits.length >= 13) {
      digits = `0${digits.slice(3)}`;
    }
    if (digits.length <= 8) return '****';
    return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
  }
  const h = (phoneHash ?? '').trim();
  if (!h.length) return '—';
  return 'Hidden';
}

/**
 * Find a Nigerian GSM number inside free text (notes, custom field answers).
 * Returns local form `0XXXXXXXXXX` (11 digits).
 */
export function extractNigerianPhoneFromText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const intlChunk = text.match(/\+234[\d\s-]{10,}/);
  if (intlChunk) {
    const digits = intlChunk[0].replace(/\D/g, '');
    if (digits.startsWith('234') && digits.length >= 13) {
      const local = `0${digits.slice(3, 13)}`;
      if (/^0[789]\d{9}$/.test(local)) return local;
    }
  }
  const local = text.match(/\b0[789]\d{9}\b/);
  if (local) return local[0];
  const loose = text.match(/0[789]\d{9}/);
  return loose ? loose[0] : null;
}

/**
 * Nigerian GSM in clipboard / WhatsApp handoff: prefer E.164 without spaces so
 * WhatsApp and mobile dialers offer tap-to-call from pasted text.
 * - `08031234567` → `+2348031234567`
 * - Already `+234…` (with optional spaces) → compact `+234…`
 * - Non-Nigerian / unknown shape → returned trimmed as-is
 */
export function formatNigerianPhoneForClipboardPaste(phone: string): string {
  const t = phone.trim();
  if (!t) return phone;
  const compact = t.replace(/\s+/g, '');
  if (/^\+234[789]\d{9}$/.test(compact)) return compact;
  if (/^0[789]\d{9}$/.test(compact)) return `+234${compact.slice(1)}`;
  return t;
}

/**
 * Full phone for logistics / WhatsApp clipboard: DB column first, then notes / custom fields.
 */
export function resolveOrderClipboardPhone(input: {
  customerPhone: string | null | undefined;
  deliveryNotes?: string | null | undefined;
  customerAddress?: string | null | undefined;
  customFields?: Record<string, unknown> | null | undefined;
}): string | null {
  const direct = input.customerPhone?.trim();
  if (direct) return direct;

  const chunks: string[] = [];
  if (input.deliveryNotes?.trim()) chunks.push(input.deliveryNotes.trim());
  if (input.customerAddress?.trim()) chunks.push(input.customerAddress.trim());
  if (input.customFields && typeof input.customFields === 'object') {
    for (const v of Object.values(input.customFields)) {
      if (typeof v === 'string' && v.trim()) chunks.push(v.trim());
      if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === 'string' && x.trim()) chunks.push(x.trim());
        }
      }
    }
  }
  for (const c of chunks) {
    const hit = extractNigerianPhoneFromText(c);
    if (hit) return hit;
  }
  return null;
}

/**
 * Country-aware clipboard / WhatsApp handoff phone: E.164 for the order's
 * country ('+255976372552'), falling back to the Nigerian rules above, then the
 * trimmed raw value.
 */
export function formatPhoneForClipboardPaste(phone: string, currencyCode: string | null | undefined): string {
  return toInternationalPhone(phone, currencyCode)?.e164 ?? formatNigerianPhoneForClipboardPaste(phone);
}

/**
 * Full customer phone for screens, exports and message templates. Non-Nigerian
 * orders get the grouped international form ('+255 976 372 552'); Nigerian
 * orders keep the stored local form that staff, riders and 3PLs already use.
 */
export function formatCustomerPhoneForDisplay(phone: string, currencyCode: string | null | undefined): string {
  const isNgn = !currencyCode || currencyCode.trim().toUpperCase() === 'NGN';
  return isNgn ? phone.trim() : formatInternationalPhone(phone, currencyCode);
}
