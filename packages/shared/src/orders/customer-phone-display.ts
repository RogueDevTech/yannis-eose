/**
 * Order customer phone as shown in admin / Sales UIs and list rows.
 * - When `customer_phone` is stored: classic digit mask (first 4 + **** + last 4 digits).
 * - When only a hash exists (edge intake): show "Hidden" — never slice the hash into
 *   phone-like hex strings (that confused operators and logistics paste).
 */
export function formatOrderCustomerPhoneDisplay(
  rawPhone: string | null | undefined,
  phoneHash: string | null | undefined,
): string {
  const raw = rawPhone?.trim();
  if (raw) {
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
