import { DEFAULT_CAMPAIGN_FORM_ACCENT_HEX, normalizeCampaignFieldOrder } from '@yannis/shared';

/**
 * Yannis EOSE — Edge Worker
 *
 * Handles sales form submissions at the Cloudflare Edge.
 * Implements: rate limiting, dedup, inventory budget cap,
 * circuit breaker with QStash failover, phone hashing,
 * campaign config loading, embed modes, and offline IndexedDB fallback.
 */

export interface Env {
  API_URL: string;
  QSTASH_URL: string;
  QSTASH_TOKEN: string;
  EDGE_API_KEY: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  DEDUP_CACHE: KVNamespace;
  RATE_LIMIT_CACHE: KVNamespace;
  INVENTORY_CACHE: KVNamespace;
  CAMPAIGN_CACHE: KVNamespace;
}

// ── Types ──────────────────────────────────────────────────────

/**
 * Custom field response value sent from the Edge Form. The shape mirrors `CustomFormField.type`
 * on the campaign config: text/email/phone/number/dropdown/radio/date → string, toggle → boolean,
 * checkbox_group → string[]. Edge Worker does not validate per-field rules — that's the
 * builder's job at save time + the API's job on create. Edge just collects + forwards.
 */
type CustomFieldValue = string | number | boolean | string[];

interface SubmissionPayload {
  campaignId?: string;
  mediaBuyerId?: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;
  deliveryState?: string;
  customerGender?: string;
  preferredDeliveryDate?: string;
  paymentMethod?: string;
  customerEmail?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
    offerLabel?: string;
  }>;
  totalAmount?: string;
  cartId?: string;
  /** Form-builder responses, keyed by `customField.id`. */
  customFields?: Record<string, CustomFieldValue>;
}

interface OrderCreatePayload {
  campaignId?: string;
  mediaBuyerId?: string;
  customerName: string;
  customerPhoneHash: string;
  /** Raw phone for manual-call reveal when VOIP is off. Sent to API on create only. */
  customerPhone?: string;
  customerAddress?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;
  deliveryState?: string;
  customerGender?: string;
  preferredDeliveryDate?: string;
  paymentMethod?: string;
  customerEmail?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
    offerLabel?: string;
  }>;
  totalAmount?: string;
  /** Identifies Edge Form as source for audit trail */
  source?: 'edge-form';
  /** Cart ID from prior cart save — marks cart as CONVERTED when order created */
  cartId?: string;
  /** Form-builder responses, keyed by `customField.id`. Persisted to `orders.custom_fields` JSONB. */
  customFields?: Record<string, CustomFieldValue>;
}

/**
 * Progressive form-field capture shared by `CartFormData` and `CartSavePayload`.
 * Every field is optional — Edge debounces saves as the customer types, so any
 * given payload may only carry a subset of the form. The API merges field-by-field.
 */
interface ProgressiveCartFields {
  customerEmail?: string;
  customerAddress?: string;
  deliveryAddress?: string;
  deliveryState?: string;
  deliveryNotes?: string;
  customerGender?: string;
  preferredDeliveryDate?: string;
  paymentMethod?: string;
  quantity?: number;
  customFieldValues?: Record<string, CustomFieldValue>;
}

/** Validated cart form data (has raw customerPhone from form) */
interface CartFormData extends ProgressiveCartFields {
  campaignId: string;
  mediaBuyerId?: string;
  customerName: string;
  customerPhone: string;
  productId: string;
  offerLabel?: string;
}

interface CartSavePayload extends ProgressiveCartFields {
  campaignId: string;
  mediaBuyerId?: string;
  customerName: string;
  customerPhoneHash: string;
  /**
   * Raw phone — set by the form so CS can reveal-to-call dropped-off
   * customers (CEO directive 2026-05-08). Never echoed back to the browser;
   * the API stores it for the same audited reveal flow as orders.
   */
  customerPhone: string;
  productId: string;
  offerLabel?: string;
}

interface ProductOffer {
  label: string;
  qty: number;
  price: string;
  imageUrls?: string[];
}

interface CampaignConfig {
  id: string;
  name: string;
  mediaBuyerId: string;
  deploymentType: string;
  products: Array<{
    id: string;
    name: string;
    price: string;
    /** Optional catalog gallery from `products.gallery_image_urls` (Worker may use as fallbacks). */
    galleryImageUrls?: string[];
    offers: ProductOffer[];
    variants?: unknown;
  }>;
  formConfig?: {
    heading?: string;
    subtitle?: string;
    buttonText?: string;
    accentColor?: string;
    successMessage?: string;
    /**
     * Optional URL to redirect the buyer to on a successful submit (their funnel's
     * thank-you page). When undefined/empty, the form falls back to the default inline
     * success message. Bypassed when the order has a Paystack `authorizationUrl` —
     * payment redirect always wins.
     */
    successCallbackUrl?: string;
    showDeliveryAddress?: boolean;
    showDeliveryNotes?: boolean;
    showDeliveryState?: boolean;
    showGender?: boolean;
    showPreferredDeliveryDate?: boolean;
    showCustomerEmail?: boolean;
    showPaymentMethod?: boolean;
    requireDeliveryAddress?: boolean;
    requireDeliveryNotes?: boolean;
    requireDeliveryState?: boolean;
    requireGender?: boolean;
    requirePreferredDeliveryDate?: boolean;
    requireCustomerEmail?: boolean;
    requirePaymentMethod?: boolean;
    standardFields?: Array<{
      key:
        | 'deliveryAddress'
        | 'deliveryNotes'
        | 'deliveryState'
        | 'gender'
        | 'preferredDeliveryDate'
        | 'customerEmail'
        | 'paymentMethod';
      label?: string;
      required: boolean;
    }>;
    fieldOrder?: string[];
    deliveryStateOptions?: string[];
    preferredDeliveryDateOptions?: string[];
    genderOptions?: string[];
    showProductImages?: boolean;
    /** Form-builder output. The Edge Worker renders these between the standard fields and
     *  the submit button. Submission collects values into `customFields[id] = value` keyed
     *  by `field.id` and forwards them to the API → `orders.custom_fields` JSONB. */
    customFields?: Array<{
      id: string;
      type: 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'date' | 'dropdown' | 'radio' | 'checkbox_group' | 'toggle';
      label: string;
      placeholder?: string;
      helpText?: string;
      required: boolean;
      order: number;
      options?: string[];
      min?: number | string;
      max?: number | string;
    }>;
  };
}

// ── Constants ──────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_CAPTCHA_THRESHOLD = 3; // After 3 submissions, require CAPTCHA
const DEDUP_WINDOW_SECONDS = 21600; // 6 hours
const CIRCUIT_BREAKER_TIMEOUT_MS = 20000; // 20s production (slow API/cold start still completes; short timeout caused false "busy" after successful creates)
const CIRCUIT_BREAKER_TIMEOUT_LOCAL_MS = 30000; // 30s for localhost (cold starts, slow DB)
const VIRTUAL_BUFFER_PCT = 0.10; // 10% stock buffer

/** Use longer timeout when calling localhost so local dev doesn't 503 on slow API. */
function getApiTimeoutMs(apiUrl: string): number {
  try {
    const u = new URL(apiUrl);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return CIRCUIT_BREAKER_TIMEOUT_LOCAL_MS;
  } catch {
    // ignore
  }
  return CIRCUIT_BREAKER_TIMEOUT_MS;
}
const CAMPAIGN_CACHE_TTL = 300; // 5 min cache for campaign configs (edge)

// ── CORS Headers ───────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Edge-Api-Key',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// ── Crypto Helpers ─────────────────────────────────────────────

async function hashPhone(phone: string): Promise<string> {
  const normalized = phone.replace(/\D/g, '');
  const encoder = new TextEncoder();
  const data = encoder.encode(`yannis:phone:${normalized}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * KV dedup key. Scoped by `mediaBuyerId` so that the SAME MB submitting the
 * same phone+product twice within the window is short-circuited at the edge
 * (no API call), but a DIFFERENT MB submitting the same phone+product is NOT
 * blocked here — that case must fall through to the API so a cross-funnel
 * attempt row can be recorded for attribution truth (Pillar 2 / per-MB
 * visibility). When mediaBuyerId is missing (legacy embeds, manual posts) we
 * fall back to the older unscoped key to preserve old behavior.
 */
async function dedupKey(phone: string, productId: string, mediaBuyerId?: string): Promise<string> {
  const encoder = new TextEncoder();
  const suffix = mediaBuyerId ? `:${mediaBuyerId}` : '';
  const data = encoder.encode(`dedup:${phone}:${productId}${suffix}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Validation ─────────────────────────────────────────────────

function validateSubmission(body: unknown): { valid: true; data: SubmissionPayload } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const b = body as Record<string, unknown>;

  if (!b['customerName'] || typeof b['customerName'] !== 'string' || (b['customerName'] as string).length < 2) {
    return { valid: false, error: 'Customer name is required (min 2 characters)' };
  }

  // Nigerian phone format only — same regex used everywhere else in the system.
  // Accepts `0XXXXXXXXXX` (11 digits, leading 0 + 7/8/9) or `+234XXXXXXXXXX` (13 chars).
  // Reject anything longer (e.g. `08031234567899`) so we don't store trailing junk.
  {
    const phoneStr = typeof b['customerPhone'] === 'string' ? (b['customerPhone'] as string).trim() : '';
    if (!/^(?:0[789]\d{9}|\+234[789]\d{9})$/.test(phoneStr)) {
      return {
        valid: false,
        error: 'Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567).',
      };
    }
    b['customerPhone'] = phoneStr;
  }

  if (!Array.isArray(b['items']) || (b['items'] as unknown[]).length === 0) {
    return { valid: false, error: 'At least one item is required' };
  }

  for (const item of b['items'] as Array<Record<string, unknown>>) {
    if (!item['productId'] || typeof item['productId'] !== 'string') {
      return { valid: false, error: 'Each item must have a productId' };
    }
    if (typeof item['quantity'] !== 'number' || item['quantity'] < 1) {
      return { valid: false, error: 'Each item must have a quantity >= 1' };
    }
    const rawPrice = item['unitPrice'];
    if (rawPrice === undefined || rawPrice === null || rawPrice === '') {
      return { valid: false, error: 'Each item must have a unitPrice' };
    }
    // coerce number → string so both "40000" and 40000 are accepted
    item['unitPrice'] = String(rawPrice);
  }

  // normalise items: coerce any numeric unitPrice to string
  const normalisedItems = (b['items'] as Array<Record<string, unknown>>).map((item) => ({
    ...item,
    unitPrice: String(item['unitPrice']),
  }));

  const paymentMethod = typeof b['paymentMethod'] === 'string' && (b['paymentMethod'] === 'PAY_ON_DELIVERY' || b['paymentMethod'] === 'PAY_ONLINE')
    ? b['paymentMethod']
    : 'PAY_ON_DELIVERY';
  const customerEmail = typeof b['customerEmail'] === 'string' ? (b['customerEmail'] as string).trim() : undefined;
  if (paymentMethod === 'PAY_ONLINE') {
    if (!customerEmail || customerEmail.length < 5) {
      return { valid: false, error: 'Email is required for Pay online. Please enter your email address.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return { valid: false, error: 'Please enter a valid email address for Pay online.' };
    }
  }

  // Custom field responses: object keyed by field id with primitive / string[] values.
  // Edge Worker doesn't enforce per-field rules — that's the API's job. We just sanity-check
  // the top-level shape so a malformed payload doesn't hand garbage to the API.
  let customFields: Record<string, CustomFieldValue> | undefined;
  const rawCf = b['customFields'];
  if (rawCf && typeof rawCf === 'object' && !Array.isArray(rawCf)) {
    const safe: Record<string, CustomFieldValue> = {};
    for (const [k, v] of Object.entries(rawCf as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        safe[k] = v;
      } else if (Array.isArray(v)) {
        // Force every element to string and cap the array to 50 items
        safe[k] = v.slice(0, 50).map((item) => String(item));
      }
      // Drop unknown shapes silently — never throw on a custom field.
    }
    if (Object.keys(safe).length > 0) customFields = safe;
  }

  return {
    valid: true,
    data: {
      campaignId: typeof b['campaignId'] === 'string' ? b['campaignId'] : undefined,
      mediaBuyerId: typeof b['mediaBuyerId'] === 'string' ? b['mediaBuyerId'] : undefined,
      customerName: b['customerName'] as string,
      customerPhone: b['customerPhone'] as string,
      customerAddress: typeof b['customerAddress'] === 'string' ? b['customerAddress'] : undefined,
      deliveryAddress: typeof b['deliveryAddress'] === 'string' ? b['deliveryAddress'] : undefined,
      deliveryNotes: typeof b['deliveryNotes'] === 'string' ? b['deliveryNotes'] : undefined,
      deliveryState: typeof b['deliveryState'] === 'string' ? b['deliveryState'] : undefined,
      customerGender: typeof b['customerGender'] === 'string' ? b['customerGender'] : undefined,
      preferredDeliveryDate: typeof b['preferredDeliveryDate'] === 'string' ? b['preferredDeliveryDate'] : undefined,
      paymentMethod,
      customerEmail: customerEmail || undefined,
      items: normalisedItems as SubmissionPayload['items'],
      totalAmount: typeof b['totalAmount'] === 'string' ? b['totalAmount'] : typeof b['totalAmount'] === 'number' ? String(b['totalAmount']) : undefined,
      cartId: typeof b['cartId'] === 'string' ? b['cartId'] : undefined,
      customFields,
    },
  };
}

// ── Rate Limiter ───────────────────────────────────────────────

type RateLimitResult = 'allowed' | 'captcha_required' | 'blocked';

async function checkRateLimit(ip: string, env: Env): Promise<RateLimitResult> {
  if (!env.RATE_LIMIT_CACHE) return 'allowed'; // KV not bound (local dev)
  const key = `rate:${ip}`;
  const current = await env.RATE_LIMIT_CACHE.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return 'blocked';
  }

  await env.RATE_LIMIT_CACHE.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });

  if (count >= RATE_LIMIT_CAPTCHA_THRESHOLD) {
    return 'captcha_required';
  }

  return 'allowed';
}

// ── Turnstile CAPTCHA Verification ─────────────────────────────
// Disabled — we switched to honeypot-based bot protection (see handleSubmission step 1a).
// Helper kept (commented) so the wiring is documented for anyone re-enabling Turnstile later.
//
// async function verifyTurnstile(token: string, ip: string, env: Env): Promise<boolean> {
//   if (!env.TURNSTILE_SECRET_KEY) return true;
//   const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
//   });
//   const result = await response.json() as { success: boolean };
//   return result.success;
// }

// ── Dedup Check ────────────────────────────────────────────────

async function checkDedup(
  phone: string,
  productIds: string[],
  env: Env,
  mediaBuyerId?: string,
): Promise<string | null> {
  if (!env.DEDUP_CACHE) return null; // KV not bound (local dev)
  for (const productId of productIds) {
    const key = await dedupKey(phone, productId, mediaBuyerId);
    const existing = await env.DEDUP_CACHE.get(key);
    if (existing) {
      return productId;
    }
  }
  return null;
}

async function markDedup(
  phone: string,
  productIds: string[],
  env: Env,
  mediaBuyerId?: string,
): Promise<void> {
  if (!env.DEDUP_CACHE) return; // KV not bound (local dev)
  for (const productId of productIds) {
    const key = await dedupKey(phone, productId, mediaBuyerId);
    await env.DEDUP_CACHE.put(key, new Date().toISOString(), {
      expirationTtl: DEDUP_WINDOW_SECONDS,
    });
  }
}

// ── Inventory Budget Cap ───────────────────────────────────────

async function checkInventoryCap(productIds: string[], env: Env): Promise<string | null> {
  if (!env.INVENTORY_CACHE) return null; // KV not bound (local dev)
  for (const productId of productIds) {
    const cacheKey = `stock:${productId}`;
    const stockData = await env.INVENTORY_CACHE.get(cacheKey);

    if (stockData) {
      const parsed = JSON.parse(stockData) as { total: number; pending: number; confirmed: number };
      const bufferedTotal = Math.floor(parsed.total * (1 - VIRTUAL_BUFFER_PCT));
      const reserved = parsed.pending + parsed.confirmed;

      if (reserved >= bufferedTotal) {
        return productId; // sold out
      }
    }
    // If no cache data, allow the order — API will do the final check
  }
  return null;
}

// ── Campaign Config Fetcher ────────────────────────────────────

async function getCampaignConfig(campaignId: string, env: Env): Promise<CampaignConfig | null> {
  // Check KV cache first
  const cacheKey = `campaign:${campaignId}`;
  const cached = env.CAMPAIGN_CACHE ? await env.CAMPAIGN_CACHE.get(cacheKey) : null;
  if (cached) {
    return JSON.parse(cached) as CampaignConfig;
  }

  // Fetch from API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), getApiTimeoutMs(env.API_URL));
    const encodedInput = encodeURIComponent(JSON.stringify({ campaignId }));

    const response = await fetch(`${env.API_URL}/trpc/marketing.getPublic?input=${encodedInput}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const result = await response.json() as { result?: { data?: CampaignConfig } };
    const config = result?.result?.data;
    if (!config) return null;

    // Cache for 10 minutes
    if (env.CAMPAIGN_CACHE) {
      await env.CAMPAIGN_CACHE.put(cacheKey, JSON.stringify(config), {
        expirationTtl: CAMPAIGN_CACHE_TTL,
      });
    }

    return config;
  } catch {
    return null;
  }
}

// ── Forward Cart to API ───────────────────────────────────────

async function forwardCartToApi(
  payload: CartSavePayload,
  env: Env,
): Promise<{ ok: boolean; data: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getApiTimeoutMs(env.API_URL));

  try {
    const response = await fetch(`${env.API_URL}/trpc/cart.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  } catch {
    clearTimeout(timeoutId);
    return { ok: false, data: { error: 'API unreachable' } };
  }
}

// ── Circuit Breaker (Forward to API) ───────────────────────────

async function forwardToApi(
  payload: OrderCreatePayload,
  env: Env,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getApiTimeoutMs(env.API_URL));

  try {
    const response = await fetch(`${env.API_URL}/trpc/orders.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[edge] orders.create failed', response.status, JSON.stringify(data));
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      isTimeout ? '[edge] orders.create timed out (increase getApiTimeoutMs or check API)' : '[edge] orders.create unreachable:',
      err,
    );
    return {
      ok: false,
      status: 503,
      data: { error: 'API unreachable', timedOut: isTimeout },
    };
  }
}

// ── Prepare Paystack (payment-first: no order until paid) ───────

async function forwardPreparePaystackToApi(
  payload: OrderCreatePayload,
  env: Env,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getApiTimeoutMs(env.API_URL));

  try {
    const response = await fetch(`${env.API_URL}/trpc/orders.preparePaystackOrder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[edge] orders.preparePaystackOrder failed', response.status, JSON.stringify(data));
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      isTimeout ? '[edge] orders.preparePaystackOrder timed out' : '[edge] orders.preparePaystackOrder unreachable:',
      err,
    );
    return { ok: false, status: 503, data: { error: 'API unreachable' } };
  }
}

// ── QStash Failover ────────────────────────────────────────────

async function bufferToQStash(
  payload: OrderCreatePayload,
  env: Env,
): Promise<boolean> {
  if (!env.QSTASH_URL || !env.QSTASH_TOKEN) {
    return false;
  }

  try {
    const response = await fetch(`${env.QSTASH_URL}/v2/publish/${env.API_URL}/trpc/orders.create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.QSTASH_TOKEN}`,
        'Upstash-Retries': '3',
        'Upstash-Delay': '10s',
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}

// ── Form Styles (shared across all form modes) ─────────────────

function getFormStyles(accentColor: string): string {
  return `
    *{margin:0;padding:0;box-sizing:border-box}
    .yannis-form-card{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:2rem;max-width:480px;width:100%}
    .yannis-form-card h2{font-size:1.5rem;margin-bottom:.5rem;color:#111}
    .yannis-form-card .subtitle{color:#666;font-size:.875rem;margin-bottom:1.5rem}
    .yannis-form-card label{display:block;font-size:.75rem;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.25rem}
    .yannis-form-card input,.yannis-form-card textarea,.yannis-form-card select{width:100%;padding:.625rem .75rem;border:1px solid #ddd;border-radius:8px;font-size:.875rem;margin-bottom:1rem;transition:border-color .2s;font-family:inherit}
    .yannis-form-card input:focus,.yannis-form-card textarea:focus,.yannis-form-card select:focus{outline:none;border-color:${accentColor}}
    .yannis-form-card textarea{resize:vertical;min-height:60px}
    .yannis-form-card .btn{width:100%;padding:.75rem;background:${accentColor};color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s}
    .yannis-form-card .btn:hover{opacity:.9}
    .yannis-form-card .btn:disabled{opacity:.6;cursor:not-allowed}
    .yannis-form-card .msg{padding:.75rem;border-radius:8px;margin-bottom:1rem;font-size:.875rem}
    .yannis-form-card .msg-success{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}
    .yannis-form-card .msg-error{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
    .yannis-form-card .msg-info{background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe}
    .yannis-form-card .hidden{display:none}
    .yannis-form-card .required{color:#dc2626;font-weight:700}
    .yannis-form-card .product-selector{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1rem}
    .yannis-form-card .product-option{display:flex;align-items:center;gap:.75rem;padding:.75rem;border:1px solid #ddd;border-radius:8px;cursor:pointer;transition:border-color .2s}
    .yannis-form-card .product-option:hover{border-color:${accentColor}}
    .yannis-form-card .product-option.selected{border-color:${accentColor};background:${accentColor}08}
    .yannis-form-card .product-name{font-weight:600;font-size:.875rem}
    .yannis-form-card .product-price{color:${accentColor};font-weight:700;font-size:.875rem}
    .yannis-form-card .offer-selector{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1rem}
    .yannis-form-card .offer-option{display:flex;align-items:flex-start;gap:.625rem;padding:.75rem;border:2px solid #ddd;border-radius:10px;cursor:pointer;transition:border-color .2s,background .2s}
    .yannis-form-card .offer-thumb{width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid #e5e5e5;margin-top:.125rem}
    .yannis-form-card .offer-option:hover{border-color:${accentColor}}
    .yannis-form-card .offer-option.selected{border-color:${accentColor};background:${accentColor}08}
    .yannis-form-card .offer-option input[type=radio]{accent-color:${accentColor};width:18px;height:18px;flex-shrink:0;margin-top:.25rem}
    .yannis-form-card .offer-body{display:flex;flex-direction:column;align-items:flex-start;gap:.25rem;flex:1;min-width:0}
    .yannis-form-card .offer-label{font-weight:600;font-size:.875rem;line-height:1.35;width:100%}
    .yannis-form-card .offer-details{display:flex;flex-wrap:wrap;align-items:center;column-gap:.5rem;row-gap:.125rem}
    .yannis-form-card .offer-qty{font-size:.75rem;color:#666}
    .yannis-form-card .offer-price{color:${accentColor};font-weight:700;font-size:.9375rem}
    @media (max-width:480px){
      .yannis-form-card{padding:1rem;border-radius:10px}
      .yannis-form-card h2{font-size:1.25rem;margin-bottom:.375rem}
      .yannis-form-card .subtitle{font-size:.8125rem;margin-bottom:1rem}
      .yannis-form-card label{font-size:.6875rem;margin-bottom:.2rem}
      .yannis-form-card input,.yannis-form-card textarea,.yannis-form-card select{padding:.5rem .625rem;font-size:16px;margin-bottom:.75rem;border-radius:8px}
      .yannis-form-card .btn{padding:.6875rem;font-size:.9375rem}
      .yannis-form-card .offer-option{padding:.625rem .75rem;gap:.5rem;border-radius:10px;border-width:1px}
      .yannis-form-card .offer-thumb{width:40px;height:40px}
      .yannis-form-card .offer-label{font-size:.8125rem}
      .yannis-form-card .offer-price{font-size:.875rem}
      .yannis-form-card .offer-selector{gap:.375rem;margin-bottom:.75rem}
      .yannis-form-card .product-option{padding:.625rem}
      .yannis-form-card .product-selector{margin-bottom:.75rem}
    }
    .yannis-form-card .embed-success{padding:1rem .5rem;text-align:center}
    .yannis-form-card .embed-success-icon{width:44px;height:44px;margin:0 auto .75rem;border-radius:9999px;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.125rem;border:1px solid #a7f3d0}
    .yannis-form-card .embed-success h3{margin:0 0 .375rem;font-size:1.05rem;color:#111827}
    .yannis-form-card .embed-success p{margin:0;color:#4b5563;font-size:.875rem;line-height:1.4}
    .yannis-form-card .embed-success-actions{margin-top:.875rem;display:flex;justify-content:center;gap:.5rem;flex-wrap:wrap}
    .yannis-form-card .embed-success-actions .btn{width:auto;min-width:140px;padding:.625rem .875rem}
    .yannis-form-card .embed-success-actions .btn-secondary{background:#fff;color:#374151;border:1px solid #d1d5db}
    @media (max-width:480px){
      body{padding:.5rem!important;align-items:flex-start}
    }
  `;
}

// ── Form Script (shared across all modes) ──────────────────────

function getFormScript(
  workerUrl: string,
  campaignId: string,
  products: CampaignConfig['products'],
  mediaBuyerId?: string,
  _formMode: 'hosted' | 'embedded' | 'iframe' | 'fallback' = 'hosted',
): string {
  const mediaBuyerIdJson = mediaBuyerId ? `'${mediaBuyerId}'` : 'undefined';
  return `
    (function() {
      var form = document.getElementById('yannisOrderForm');
      var msg = document.getElementById('yannisMsg');
      var btn = document.getElementById('yannisSubmitBtn');
      var selectedProduct = null;
      var selectedOffer = null;
      var products = ${JSON.stringify(products)};
      var card = form ? form.closest('.yannis-form-card') : null;
      var singleProductId = form ? form.dataset.singleProduct : null;
      var successPanel = null;

      function resetForAnotherOrder() {
        if (!form) return;
        form.reset();
        selectedOffer = null;
        selectedProduct = singleProductId || null;
        document.querySelectorAll('.product-option').forEach(function(o) { o.classList.remove('selected'); });
        document.querySelectorAll('.offer-option').forEach(function(o) { o.classList.remove('selected'); });
        // Hide all offer groups, then re-show the one for the active product so the user
        // can immediately pick another offer. For single-product forms that's the only
        // group (always visible). For multi-product flows, groups stay hidden until the
        // user clicks a product card again.
        document.querySelectorAll('.offer-group').forEach(function(g) { g.style.display = 'none'; });
        if (selectedProduct) {
          var activeOffers = document.getElementById('offers-' + selectedProduct);
          if (activeOffers) { activeOffers.style.display = 'flex'; }
        }
        var paymentMethodEl = form.querySelector('#paymentMethod');
        if (paymentMethodEl) {
          var evt = document.createEvent('HTMLEvents');
          evt.initEvent('change', true, false);
          paymentMethodEl.dispatchEvent(evt);
        }
        if (msg) {
          msg.className = 'msg hidden';
          msg.textContent = '';
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
        }
      }

      function showInlineSuccess(message, actionUrl) {
        if (!card || !form) return false;
        var safeMessage = String(message || 'Order received successfully! We will contact you shortly.');
        if (!successPanel) {
          successPanel = document.createElement('div');
          successPanel.className = 'embed-success hidden';
          successPanel.innerHTML = [
            '<div class="embed-success-icon">✓</div>',
            '<h3>Order received</h3>',
            '<p class="embed-success-message"></p>',
            '<div class="embed-success-actions">',
            '  <a class="btn hidden" data-role="pay-link" target="_blank" rel="noopener noreferrer">Continue payment</a>',
            '  <button type="button" class="btn btn-secondary" data-role="order-another">Order another</button>',
            '</div>',
          ].join('');
          card.appendChild(successPanel);
          var anotherBtn = successPanel.querySelector('[data-role="order-another"]');
          if (anotherBtn) {
            anotherBtn.addEventListener('click', function() {
              successPanel.classList.add('hidden');
              form.classList.remove('hidden');
              resetForAnotherOrder();
            });
          }
        }
        var msgEl = successPanel.querySelector('.embed-success-message');
        var payLink = successPanel.querySelector('[data-role="pay-link"]');
        if (msgEl) msgEl.textContent = safeMessage;
        if (payLink) {
          if (actionUrl) {
            payLink.href = actionUrl;
            payLink.classList.remove('hidden');
          } else {
            payLink.removeAttribute('href');
            payLink.classList.add('hidden');
          }
        }
        form.classList.add('hidden');
        if (msg) {
          msg.className = 'msg hidden';
          msg.textContent = '';
        }
        successPanel.classList.remove('hidden');
        return true;
      }

      function clearError() {
        msg.className = 'msg hidden';
        msg.textContent = '';
      }
      form.addEventListener('input', clearError);
      form.addEventListener('change', clearError);
      form.addEventListener('focusin', clearError);

      // Single-product: set product only, do not preselect offer
      singleProductId = form.dataset.singleProduct;
      if (singleProductId) {
        selectedProduct = singleProductId;
      }

      // Multi-product selection
      document.querySelectorAll('.product-option').forEach(function(el) {
        el.addEventListener('click', function() {
          document.querySelectorAll('.product-option').forEach(function(o) { o.classList.remove('selected'); });
          el.classList.add('selected');
          selectedProduct = el.dataset.productId;
          selectedOffer = null;
          document.querySelectorAll('.offer-group').forEach(function(g) { g.style.display = 'none'; });
          var offerGroup = document.getElementById('offers-' + selectedProduct);
          if (offerGroup) { offerGroup.style.display = 'flex'; }
          maybeSaveCart();
        });
      });

      // Offer selection via radio buttons
      document.querySelectorAll('.offer-radio').forEach(function(radio) {
        radio.addEventListener('change', function() {
          selectedOffer = JSON.parse(radio.dataset.offer);
          // Highlight selected offer option
          var parent = radio.closest('.offer-group');
          if (parent) {
            parent.querySelectorAll('.offer-option').forEach(function(o) { o.classList.remove('selected'); });
            radio.closest('.offer-option').classList.add('selected');
          }
          maybeSaveCart();
        });
      });

      // Online/Offline detection
      var isOnline = navigator.onLine;
      function updateOnlineStatus() {
        isOnline = navigator.onLine;
      }
      window.addEventListener('online', function() { updateOnlineStatus(); syncPending(); });
      window.addEventListener('offline', updateOnlineStatus);
      updateOnlineStatus();

      // IndexedDB helpers for offline buffering
      var DB_NAME = 'yannis_orders';
      var STORE_NAME = 'pending_orders';
      function openDB() {
        return new Promise(function(resolve, reject) {
          var req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function(e) { e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true }); };
          req.onsuccess = function(e) { resolve(e.target.result); };
          req.onerror = function() { reject(req.error); };
        });
      }
      function saveOffline(order) {
        return openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).add(order);
            tx.oncomplete = resolve;
            tx.onerror = function() { reject(tx.error); };
          });
        });
      }
      function getPending() {
        return openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = function() { resolve(req.result); };
            req.onerror = function() { reject(req.error); };
          });
        });
      }
      function deletePending(id) {
        return openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = resolve;
            tx.onerror = function() { reject(tx.error); };
          });
        });
      }

      // Sync pending offline orders when back online
      function syncPending() {
        getPending().then(function(orders) {
          orders.forEach(function(order) {
            fetch('${workerUrl}/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(order.data)
            }).then(function(res) {
              if (res.ok) deletePending(order.id);
            }).catch(function() { /* will retry next online event */ });
          });
        }).catch(function() {});
      }
      // Try syncing on load if online
      if (isOnline) syncPending();

      // Nigerian phone regex — mirrors the worker's /cart + /submit validators.
      // Accepts 0XXXXXXXXXX (11 digits, leading 0 + 7/8/9) or +234XXXXXXXXXX.
      var NG_PHONE_RE = /^(?:0[789]\\d{9}|\\+234[789]\\d{9})$/;

      // Cart abandonment: save name+phone when both filled (debounced)
      var savedCartId = null;
      var cartSaveTimeout = null;
      var CART_DEBOUNCE_MS = 600;
      function isValidNgPhone(value) {
        return NG_PHONE_RE.test((value || '').trim());
      }
      function maybeSaveCart() {
        if (!selectedProduct || !selectedOffer) return;
        var nameEl = form.querySelector('#customerName') || form.querySelector('[name="customerName"]');
        var phoneEl = form.querySelector('#customerPhone') || form.querySelector('[name="customerPhone"]');
        if (!nameEl || !phoneEl) return;
        var name = (nameEl.value || '').trim();
        if (name.length < 2) return;
        // Gate on a real Nigerian phone — prevents a noisy 400 on /cart while the
        // user is mid-type. The save was already best-effort (errors swallowed),
        // but a malformed phone produces a visible network error otherwise.
        if (!isValidNgPhone(phoneEl.value)) return;
        if (!isOnline) return;
        // Helper: read a field by name, return trimmed value or undefined if blank.
        function fv(name) {
          var el = form.querySelector('[name="' + name + '"]');
          if (!el) return undefined;
          var v = (el.value || '').trim();
          return v.length > 0 ? v : undefined;
        }
        // Custom form-builder fields are rendered with [data-custom-field="<id>"].
        function readCustomFieldValues() {
          var els = form.querySelectorAll('[data-custom-field]');
          if (!els || els.length === 0) return undefined;
          var out = {};
          var count = 0;
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var key = el.getAttribute('data-custom-field');
            if (!key) continue;
            var val;
            if (el.type === 'checkbox') {
              val = !!el.checked;
            } else {
              val = (el.value || '').trim();
              if (val.length === 0) continue;
            }
            out[key] = val;
            count++;
          }
          return count > 0 ? out : undefined;
        }
        clearTimeout(cartSaveTimeout);
        cartSaveTimeout = setTimeout(function() {
          var payload = {
            campaignId: '${campaignId}',
            mediaBuyerId: ${mediaBuyerIdJson},
            customerName: name,
            customerPhone: phoneEl.value,
            productId: selectedProduct,
            offerLabel: selectedOffer.label
          };
          // Progressive capture — only include fields that have a value right now.
          // API merges field-by-field, so a missing value never wipes earlier capture.
          var addr = fv('customerAddress');
          if (addr) payload.customerAddress = addr;
          var delAddr = fv('deliveryAddress');
          if (delAddr) payload.deliveryAddress = delAddr;
          var delState = fv('deliveryState');
          if (delState) payload.deliveryState = delState;
          var delNotes = fv('deliveryNotes');
          if (delNotes) payload.deliveryNotes = delNotes;
          var gender = fv('customerGender');
          if (gender) payload.customerGender = gender;
          var prefDate = fv('preferredDeliveryDate');
          if (prefDate) payload.preferredDeliveryDate = prefDate;
          var payMethod = fv('paymentMethod');
          if (payMethod) payload.paymentMethod = payMethod;
          var email = fv('customerEmail');
          if (email) payload.customerEmail = email;
          var qtyRaw = fv('quantity');
          if (qtyRaw) {
            var qty = parseInt(qtyRaw, 10);
            if (qty > 0) payload.quantity = qty;
          }
          var cfv = readCustomFieldValues();
          if (cfv) payload.customFieldValues = cfv;
          fetch('${workerUrl}/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d.id) savedCartId = d.id;
          }).catch(function() {});
        }, CART_DEBOUNCE_MS);
      }
      // Trigger save on input/blur for every field the form might collect —
      // address, state, email, etc. — not just name/phone. The function gates
      // on name + valid phone before issuing a request, so empty progressive
      // fields are harmless. Use event delegation on the form so dynamically
      // rendered fields (custom builder fields) are covered automatically.
      form.addEventListener('input', maybeSaveCart);
      form.addEventListener('blur', maybeSaveCart, true);
      // `phoneInput` is still consumed by the phone validation + sanitizer block
      // below — keep the local handle even though save listening is delegated to
      // the form element above.
      var phoneInput = form.querySelector('#customerPhone') || form.querySelector('[name="customerPhone"]');

      // Inline phone validation — show a friendly error below the input on blur
      // if the value is filled but invalid. Cleared on input.
      if (phoneInput) {
        var phoneError = document.createElement('p');
        phoneError.className = 'field-error';
        phoneError.style.cssText = 'color:#dc2626;font-size:0.875rem;margin:0.25rem 0 0;display:none;';
        phoneError.textContent = 'Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567).';
        if (phoneInput.parentNode) {
          phoneInput.parentNode.insertBefore(phoneError, phoneInput.nextSibling);
        }
        // Live sanitizer: strip everything except digits and a single leading +,
        // then cap at the Nigerian-number max length (14 chars including +, 11
        // without). The HTML maxlength attribute caps total chars, but it would
        // count dashes / spaces / parens against the limit and let the user run
        // out of room before reaching 11 digits — so we strip those characters
        // here as they type. Also handles paste / autofill of formatted numbers.
        phoneInput.addEventListener('input', function() {
          var raw = phoneInput.value || '';
          var hadPlus = raw.charAt(0) === '+';
          var digits = raw.replace(/\\D/g, '');
          var maxDigits = hadPlus ? 13 : 11; // +234XXXXXXXXXX (13) or 0XXXXXXXXXX (11)
          if (digits.length > maxDigits) digits = digits.substring(0, maxDigits);
          var next = hadPlus ? '+' + digits : digits;
          if (next !== raw) {
            // Preserve cursor position by writing through .value (browser will
            // place the caret at end, which is the expected behavior when
            // autocorrecting input).
            phoneInput.value = next;
          }
        });
        phoneInput.addEventListener('blur', function() {
          var v = (phoneInput.value || '').trim();
          phoneError.style.display = v.length > 0 && !isValidNgPhone(v) ? '' : 'none';
        });
        phoneInput.addEventListener('input', function() {
          if (phoneError.style.display !== 'none') phoneError.style.display = 'none';
        });
      }

      var pmSelect = form.querySelector('#paymentMethod');
      if (pmSelect) {
        var emailWrap = document.getElementById('customerEmailWrap');
        var emailInput = document.getElementById('customerEmail');
        function togglePaymentEmail() {
          if (!emailInput) return;
          var standaloneEmail = form.dataset.showCustomerEmail === 'true';
          var requireStandalone = form.dataset.requireCustomerEmail === 'true';
          if (pmSelect.value === 'PAY_ONLINE') {
            if (emailWrap) emailWrap.classList.remove('hidden');
            emailInput.setAttribute('required', 'required');
          } else {
            if (emailWrap && !standaloneEmail) {
              emailWrap.classList.add('hidden');
              emailInput.value = '';
            }
            if (standaloneEmail && requireStandalone) {
              emailInput.setAttribute('required', 'required');
            } else {
              emailInput.removeAttribute('required');
            }
          }
        }
        pmSelect.addEventListener('change', togglePaymentEmail);
        togglePaymentEmail();
      }

      form.addEventListener('submit', function(e) {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = 'Submitting...';
        msg.className = 'msg hidden';

        if (!selectedProduct || !selectedOffer) {
          msg.className = 'msg msg-error';
          msg.textContent = !selectedProduct ? 'Please select a product.' : 'Please select an offer.';
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
          return;
        }

        var fd = new FormData(form);
        var showPaymentMethod = form.dataset.showPaymentMethod === 'true';
        var paymentMethod = (fd.get('paymentMethod') || '').toString().trim();
        if (showPaymentMethod && !paymentMethod) {
          msg.className = 'msg msg-error';
          msg.textContent = 'Please select a payment method.';
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
          return;
        }
        if (!paymentMethod) paymentMethod = 'PAY_ON_DELIVERY';
        var customerEmail = (fd.get('customerEmail') || '').toString().trim();
        if (paymentMethod === 'PAY_ONLINE' && (!customerEmail || customerEmail.length < 5)) {
          msg.className = 'msg msg-error';
          msg.textContent = 'Email is required for Pay online. Please enter your email address.';
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
          return;
        }
        // ── Custom fields (form builder) ───────────────────────────────────────
        // Walk every element with [data-yannis-cf] and fold into a single object keyed
        // by field id. Multi-select types (checkbox_group) collect into arrays.
        // Required-checkbox-group: at least one option must be checked, else block submit.
        var customFields = {};
        var cfRequiredFail = '';
        var cfNodes = form.querySelectorAll('[data-yannis-cf]');
        for (var i = 0; i < cfNodes.length; i++) {
          var el = cfNodes[i];
          var fid = el.getAttribute('data-yannis-cf');
          var ftype = el.getAttribute('data-yannis-cf-type');
          if (!fid || !ftype) continue;

          if (ftype === 'checkbox_group') {
            // Append to array; first occurrence creates it.
            if (el.checked) {
              if (!customFields[fid]) customFields[fid] = [];
              customFields[fid].push(el.value);
            } else if (!customFields[fid]) {
              customFields[fid] = [];
            }
          } else if (ftype === 'radio') {
            if (el.checked) customFields[fid] = el.value;
            else if (!(fid in customFields)) customFields[fid] = '';
          } else if (ftype === 'toggle') {
            customFields[fid] = !!el.checked;
          } else if (ftype === 'number') {
            var nv = el.value;
            customFields[fid] = nv === '' ? '' : Number(nv);
          } else {
            customFields[fid] = el.value;
          }
        }
        // Validate required checkbox groups (browser-required only enforces >=1 on radios).
        var cfGroups = form.querySelectorAll('[data-cf-required="1"]');
        for (var g = 0; g < cfGroups.length; g++) {
          var grp = cfGroups[g];
          var checked = grp.querySelectorAll('input[type="checkbox"]:checked');
          if (checked.length === 0) {
            var lbl = (grp.previousElementSibling && grp.previousElementSibling.textContent) || 'a required field';
            cfRequiredFail = 'Please select at least one option for ' + lbl.replace(/\\s*\\*\\s*$/, '').trim();
            break;
          }
        }
        if (cfRequiredFail) {
          msg.className = 'msg msg-error';
          msg.textContent = cfRequiredFail;
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
          return;
        }

        var orderData = {
          campaignId: '${campaignId}',
          mediaBuyerId: ${mediaBuyerIdJson},
          // Honeypot — humans never fill this; bots usually do. Server checks and silently
          // drops the submission. Sent every time so an absent field also fails closed.
          yannis_website_url: fd.get('yannis_website_url') || '',
          customerName: fd.get('customerName'),
          customerPhone: fd.get('customerPhone'),
          deliveryAddress: fd.get('deliveryAddress') || undefined,
          deliveryNotes: fd.get('deliveryNotes') || undefined,
          deliveryState: fd.get('deliveryState') || undefined,
          customerGender: fd.get('customerGender') || undefined,
          preferredDeliveryDate: fd.get('preferredDeliveryDate') || undefined,
          paymentMethod: paymentMethod === 'PAY_ONLINE' ? 'PAY_ONLINE' : 'PAY_ON_DELIVERY',
          customerEmail: customerEmail ? customerEmail : undefined,
          items: [{ productId: selectedProduct, quantity: selectedOffer.qty, unitPrice: selectedOffer.price, offerLabel: selectedOffer.label }],
          cartId: savedCartId || undefined,
          totalAmount: (selectedOffer.qty * parseFloat(selectedOffer.price)).toString(),
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined
        };

        if (!isOnline) {
          saveOffline({ data: orderData, timestamp: new Date().toISOString() }).then(function() {
            msg.className = 'msg msg-info';
            msg.textContent = 'You are offline. Your order has been saved and will be submitted when you reconnect.';
            form.reset();
          }).catch(function() {
            msg.className = 'msg msg-error';
            msg.textContent = 'Failed to save order offline. Please try again.';
          });
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
          return;
        }

        function submitOrder(data) {
          return fetch('${workerUrl}/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }).then(function(res) {
            return res.json().then(function(d) { return { ok: res.ok, status: res.status, data: d }; });
          });
        }

        submitOrder(orderData).then(function(result) {
          if (result.ok) {
            // Edge gave up waiting for the API (timeout) but the order may already exist — avoid scary error + repeat submits.
            if (result.data.pendingConfirmation) {
              btn.disabled = true;
              btn.textContent = 'Submitted';
              msg.className = 'msg msg-info';
              msg.textContent =
                result.data.message ||
                'Your order may still be processing. Please do not submit again while you wait.';
              return;
            }
            var authUrl = result.data.authorizationUrl;
            // Already-submitted (dedup hit OR cross-funnel attempt): never redirect to the
            // funnel's thank-you page — that masks the duplicate as a fresh success and is
            // why one customer can post the same order three times and think each worked.
            // Always show the inline message and lock the form so they can't retry into
            // the same dead state.
            if (result.data.alreadySubmitted) {
              btn.disabled = true;
              btn.textContent = 'Already submitted';
              if (!showInlineSuccess(result.data.message || 'Your order has already been submitted. No need to submit again.')) {
                msg.className = 'msg msg-info';
                msg.textContent = result.data.message || 'Your order has already been submitted. No need to submit again.';
              }
              return;
            }
            if (authUrl) {
              // Payment redirect always wins over the campaign-level success URL — the buyer
              // needs to complete payment before any thank-you page.
              if (showInlineSuccess('Order created successfully. Continue to secure payment.', authUrl)) {
                return;
              }
              window.location.href = authUrl;
              return;
            }
            // Optional Media Buyer success callback — redirects to their funnel's thank-you page.
            // Validated as a full URL on save; redirect only if it parses as http(s).
            var callbackUrl = (form.dataset.successCallback || '').trim();
            if (callbackUrl && /^https?:\\/\\//i.test(callbackUrl)) {
              window.location.href = callbackUrl;
              return;
            }
            if (showInlineSuccess(result.data.message || 'Order received successfully! We will contact you shortly.')) {
              return;
            }
            msg.className = 'msg msg-success';
            msg.textContent = result.data.message || 'Order received successfully! We will contact you shortly.';
            form.reset();
            selectedOffer = null;
          } else {
            msg.className = 'msg msg-error';
            msg.textContent = result.data.error || 'Something went wrong. Please try again.';
          }
        }).catch(function() {
          // Network failed — save offline
          saveOffline({ data: orderData, timestamp: new Date().toISOString() }).then(function() {
            msg.className = 'msg msg-info';
            msg.textContent = 'Connection lost. Your order has been saved and will be submitted automatically when you reconnect.';
            form.reset();
          }).catch(function() {
            msg.className = 'msg msg-error';
            msg.textContent = 'Network error. Please try again.';
          });
        }).finally(function() {
          // Don't re-enable when we deliberately locked the form (e.g. alreadySubmitted,
          // pendingConfirmation after API timeout). Leave button text as stamped.
          if (btn.textContent !== 'Already submitted' && btn.textContent !== 'Submitted') {
            btn.disabled = false;
            btn.textContent = form.dataset.btnText || 'Submit Order';
          }
        });
      });
    })();
  `;
}

// ── Form HTML (shared inner content) ──────────────────────────

function getFormInnerHTML(config: CampaignConfig): string {
  const fc = config.formConfig ?? {};
  const heading = fc.heading ?? 'Place Your Order';
  const subtitleTrimmed = typeof fc.subtitle === 'string' ? fc.subtitle.trim() : '';
  const subtitleBlock = subtitleTrimmed
    ? `<p class="subtitle">${escapeHtml(subtitleTrimmed)}</p>`
    : '';
  const buttonText = fc.buttonText ?? 'Submit Order';
  const defaultStandardLabels = {
    deliveryAddress: 'Delivery Address',
    deliveryNotes: 'Delivery Notes',
    deliveryState: 'Delivery State',
    gender: 'Gender',
    preferredDeliveryDate: 'Preferred Delivery Date',
    customerEmail: 'Email',
    paymentMethod: 'Payment Method',
  } as const;
  const getStandardLabel = (
    key: keyof typeof defaultStandardLabels,
    labelOverride?: string,
  ) => {
    const trimmed = typeof labelOverride === 'string' ? labelOverride.trim() : '';
    return trimmed.length > 0 ? trimmed : defaultStandardLabels[key];
  };
  const standard = new Map(
    (fc.standardFields ?? []).map((f) => [
      f.key,
      { required: !!f.required, label: getStandardLabel(f.key, f.label) },
    ]),
  );
  const hasStandard = standard.size > 0;
  type StdFieldKey =
    | 'deliveryAddress'
    | 'deliveryNotes'
    | 'deliveryState'
    | 'gender'
    | 'preferredDeliveryDate'
    | 'customerEmail'
    | 'paymentMethod';
  const showField = (key: StdFieldKey) => {
    if (hasStandard) return standard.has(key);
    if (key === 'deliveryAddress') return fc.showDeliveryAddress !== false;
    if (key === 'deliveryNotes') return fc.showDeliveryNotes === true;
    if (key === 'deliveryState') return fc.showDeliveryState === true;
    if (key === 'gender') return fc.showGender === true;
    if (key === 'preferredDeliveryDate') return fc.showPreferredDeliveryDate === true;
    if (key === 'customerEmail') return fc.showCustomerEmail === true;
    return fc.showPaymentMethod === true;
  };
  const requiredField = (key: StdFieldKey) => {
    if (hasStandard) return standard.get(key)?.required === true;
    if (key === 'deliveryAddress') return fc.requireDeliveryAddress === true;
    if (key === 'deliveryNotes') return fc.requireDeliveryNotes === true;
    if (key === 'deliveryState') return fc.requireDeliveryState === true;
    if (key === 'gender') return fc.requireGender === true;
    if (key === 'preferredDeliveryDate') return fc.requirePreferredDeliveryDate === true;
    if (key === 'customerEmail') return fc.requireCustomerEmail === true;
    return fc.requirePaymentMethod === true;
  };
  const standardLabel = (key: StdFieldKey) => standard.get(key)?.label ?? defaultStandardLabels[key];
  const showPaymentMethod = showField('paymentMethod');
  const showStandaloneEmail = showField('customerEmail');
  const showProductImages = fc.showProductImages !== false;
  const standardFieldEntries = (
    [
      'gender',
      'deliveryState',
      'deliveryAddress',
      'deliveryNotes',
      'preferredDeliveryDate',
      'customerEmail',
      'paymentMethod',
    ] as const
  )
    .filter((key) => showField(key))
    .map((key) => ({ key, label: standardLabel(key), required: requiredField(key) }));
  const customFields = Array.isArray(fc.customFields)
    ? [...fc.customFields].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    : [];
  const customFieldMap = new Map(customFields.map((field) => [field.id, field]));
  const resolvedFieldOrder = normalizeCampaignFieldOrder(fc.fieldOrder, standardFieldEntries, customFields);

  const hasSingleProduct = config.products.length === 1;

  const productOptionsHtml = hasSingleProduct ? '' : config.products.map((p) =>
    `<div class="product-option" data-product-id="${p.id}">
      <div><span class="product-name">${escapeHtml(p.name)}</span></div>
      <div class="product-price">${formatPrice(p.price)}</div>
    </div>`
  ).join('\n');

  // Build offer radio buttons for each product
  const offerGroupsHtml = config.products.map((p) => {
    const offers = (p.offers && p.offers.length > 0)
      ? p.offers
      : [{ label: 'Standard', qty: 1, price: p.price }];

    const radioName = `offer-${p.id}`;
    const offersHtml = offers.map((o) => {
      const urls = (o as ProductOffer).imageUrls;
      const firstImg =
        Array.isArray(urls) && typeof urls[0] === 'string' && /^https?:\/\//i.test(urls[0]) ? urls[0] : '';
      const thumbHtml = showProductImages && firstImg
        ? `<img src="${escapeHtml(firstImg)}" alt="" class="offer-thumb" width="48" height="48" loading="lazy">`
        : '';
      return `<label class="offer-option">
        <input type="radio" name="${radioName}" class="offer-radio"
          data-offer='${JSON.stringify({ label: o.label, qty: o.qty, price: o.price }).replace(/'/g, '&#39;')}'>
        ${thumbHtml}
        <span class="offer-body">
          <span class="offer-label">${escapeHtml(o.label)}</span>
          <span class="offer-details">
            <span class="offer-qty">${o.qty} unit${o.qty > 1 ? 's' : ''}</span>
            <span class="offer-price">${formatPrice(o.price)}</span>
          </span>
        </span>
      </label>`;
    }).join('\n');

    const display = hasSingleProduct ? 'flex' : 'none';
    return `<div id="offers-${p.id}" class="offer-group offer-selector" style="display:${display}">${offersHtml}</div>`;
  }).join('\n');

  // If single product, auto-set selectedProduct via hidden data attribute
  const firstProduct = config.products[0];
  const singleProductAttr = hasSingleProduct && firstProduct ? ` data-single-product="${firstProduct.id}"` : '';
  const orderedFormInfoHtml = resolvedFieldOrder
    .map((token) => {
      if (token === 'fixed.fullName') {
        return `<label for="customerName">Full Name</label>
      <input id="customerName" name="customerName" type="text" required minlength="2" placeholder="Your full name">`;
      }
      if (token === 'fixed.phoneNumber') {
        return `<label for="customerPhone">Phone Number</label>
      <input id="customerPhone" name="customerPhone" type="tel" inputmode="tel" required placeholder="08012345678" maxlength="14" pattern="^(0[789][0-9]{9}|\\+234[789][0-9]{9})$" title="Enter a valid Nigerian phone number, e.g. 08012345678 or +2348012345678" autocomplete="tel-national">`;
      }
      if (token.startsWith('standard.')) {
        return renderStandardField(
          standardFieldEntries.find((field) => field.key === token.slice('standard.'.length)),
          requiredField,
          fc,
          showStandaloneEmail,
          standardLabel('customerEmail'),
        );
      }
      if (token.startsWith('custom.')) {
        const field = customFieldMap.get(token.slice('custom.'.length));
        return field ? renderCustomField(field) : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return `
    <h2>${escapeHtml(heading)}</h2>
    ${subtitleBlock}
    <div id="yannisMsg" class="msg hidden"></div>
    <form id="yannisOrderForm" data-btn-text="${escapeHtml(buttonText)}" data-show-payment-method="${showPaymentMethod ? 'true' : 'false'}" data-show-customer-email="${showStandaloneEmail ? 'true' : 'false'}" data-require-customer-email="${requiredField('customerEmail') ? 'true' : 'false'}" data-success-callback="${escapeHtml(fc.successCallbackUrl ?? '')}"${singleProductAttr}>
      <!-- Honeypot: bots auto-fill every input they see; humans never touch this. Field is
           visually hidden + tabindex=-1 + autocomplete=off + aria-hidden so real users and
           screen readers skip it entirely. If submitted with a value, the worker silently
           drops the order. Do NOT remove or rename without updating the server check below. -->
      <div aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none">
        <label for="yannis_website_url">Website (leave blank)</label>
        <input id="yannis_website_url" name="yannis_website_url" type="text" tabindex="-1" autocomplete="off" />
      </div>
      ${!hasSingleProduct ? `<label>Select Product</label>
      <div class="product-selector">${productOptionsHtml}</div>` : ''}
      <label>Select Offer</label>
      ${offerGroupsHtml}
      ${orderedFormInfoHtml}
      <button type="submit" class="btn" id="yannisSubmitBtn">${escapeHtml(buttonText)}</button>
    </form>
  `;
}

/**
 * Render the form-builder custom fields between the standard delivery / payment block and
 * the submit button. The Edge Worker is just an HTML template renderer — no per-type
 * validation here beyond what the browser handles via `required` / `type` / `min` / `max`
 * attributes. The form-submit JS reads these via `[data-yannis-cf]` and folds them into
 * the `customFields` payload sent to the API.
 */
function renderStandardField(
  field:
    | {
        key:
          | 'deliveryAddress'
          | 'deliveryNotes'
          | 'deliveryState'
          | 'gender'
          | 'preferredDeliveryDate'
          | 'customerEmail'
          | 'paymentMethod';
        label: string;
        required: boolean;
      }
    | undefined,
  requiredField: (key: 'deliveryAddress' | 'deliveryNotes' | 'deliveryState' | 'gender' | 'preferredDeliveryDate' | 'customerEmail' | 'paymentMethod') => boolean,
  fc: NonNullable<CampaignConfig['formConfig']>,
  showStandaloneEmail: boolean,
  emailLabel: string,
): string {
  if (!field) return '';
  switch (field.key) {
    case 'gender':
      return `<label for="customerGender">${escapeHtml(field.label)}${requiredField('gender') ? ' <span class="required">*</span>' : ''}</label>
      <select id="customerGender" name="customerGender"${requiredField('gender') ? ' required' : ''}>
        <option value="">Select gender...</option>
        ${(
          fc.genderOptions && fc.genderOptions.length > 0 ? fc.genderOptions : ['Male', 'Female']
        ).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('\n')}
      </select>`;
    case 'deliveryState':
      return `<label for="deliveryState">${escapeHtml(field.label)}${requiredField('deliveryState') ? ' <span class="required">*</span>' : ''}</label>
      <select id="deliveryState" name="deliveryState"${requiredField('deliveryState') ? ' required' : ''}>
        <option value="">Select state...</option>
        ${(fc.deliveryStateOptions && fc.deliveryStateOptions.length > 0
          ? fc.deliveryStateOptions
          : ['Lagos', 'Abuja (FCT)', 'Rivers', 'Oyo', 'Kano', 'Delta', 'Edo', 'Ogun', 'Anambra', 'Enugu', 'Kaduna', 'Imo', 'Abia', 'Kwara', 'Osun', 'Ondo', 'Ekiti', 'Bayelsa', 'Cross River', 'Akwa Ibom', 'Plateau', 'Benue', 'Nasarawa', 'Niger', 'Kogi', 'Taraba', 'Adamawa', 'Bauchi', 'Gombe', 'Borno', 'Yobe', 'Jigawa', 'Zamfara', 'Sokoto', 'Kebbi', 'Katsina', 'Ebonyi']
        ).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('\n')}
      </select>`;
    case 'deliveryAddress':
      return `<label for="deliveryAddress">${escapeHtml(field.label)}${requiredField('deliveryAddress') ? ' <span class="required">*</span>' : ''}</label>
      <textarea id="deliveryAddress" name="deliveryAddress" placeholder="Your delivery address"${requiredField('deliveryAddress') ? ' required' : ''}></textarea>`;
    case 'deliveryNotes':
      return `<label for="deliveryNotes">${escapeHtml(field.label)}${requiredField('deliveryNotes') ? ' <span class="required">*</span>' : ' (optional)'}</label>
      <input id="deliveryNotes" name="deliveryNotes" type="text" placeholder="Any special instructions"${requiredField('deliveryNotes') ? ' required' : ''}>`;
    case 'preferredDeliveryDate':
      return `<label for="preferredDeliveryDate">${escapeHtml(field.label)}${requiredField('preferredDeliveryDate') ? ' <span class="required">*</span>' : ''}</label>
      <select id="preferredDeliveryDate" name="preferredDeliveryDate"${requiredField('preferredDeliveryDate') ? ' required' : ''}>
        <option value="">Select...</option>
        ${(fc.preferredDeliveryDateOptions && fc.preferredDeliveryDateOptions.length > 0
          ? fc.preferredDeliveryDateOptions
          : ['As soon as possible', 'Within 1-2 days', 'Within 3-5 days', 'Next week', 'Specific date (mention in notes)']
        ).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('\n')}
      </select>`;
    case 'customerEmail':
      return `<label for="customerEmail">${escapeHtml(field.label)}${requiredField('customerEmail') ? ' <span class="required">*</span>' : ''}</label>
      <input id="customerEmail" name="customerEmail" type="email" placeholder="your@email.com"${requiredField('customerEmail') ? ' required' : ''}>`;
    case 'paymentMethod':
      return `<label for="paymentMethod">${escapeHtml(field.label)}${requiredField('paymentMethod') ? ' <span class="required">*</span>' : ''}</label>
      <select id="paymentMethod" name="paymentMethod"${requiredField('paymentMethod') ? ' required' : ''}>
        <option value="">Select payment method...</option>
        <option value="PAY_ON_DELIVERY">Pay on delivery</option>
        <option value="PAY_ONLINE">Pay online (card / bank)</option>
      </select>
      ${showStandaloneEmail ? '' : `<div id="customerEmailWrap" class="hidden">
        <label for="customerEmail">${escapeHtml(emailLabel)} (for payment receipt) <span class="required">*</span></label>
        <input id="customerEmail" name="customerEmail" type="email" placeholder="your@email.com">
      </div>`}`;
  }
}

type CampaignCustomField = NonNullable<NonNullable<CampaignConfig['formConfig']>['customFields']>[number];

function renderCustomField(field: CampaignCustomField): string {
  const id = `yannis-cf-${field.id}`;
  const required = field.required ? 'required' : '';
  const placeholder = field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '';
  const helpHtml = field.helpText ? `<p class="help-text">${escapeHtml(field.helpText)}</p>` : '';
  const labelHtml = `<label for="${id}">${escapeHtml(field.label)}${field.required ? ' <span class="required">*</span>' : ''}</label>`;

  switch (field.type) {
    case 'text':
      return `${labelHtml}
        <input id="${id}" name="${id}" type="text" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="text" ${required} ${placeholder}
          ${field.min != null ? `minlength="${Number(field.min)}"` : ''}
          ${field.max != null ? `maxlength="${Number(field.max)}"` : ''}>
        ${helpHtml}`;
    case 'textarea':
      return `${labelHtml}
        <textarea id="${id}" name="${id}" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="textarea" ${required} ${placeholder}
          ${field.min != null ? `minlength="${Number(field.min)}"` : ''}
          ${field.max != null ? `maxlength="${Number(field.max)}"` : ''}></textarea>
        ${helpHtml}`;
    case 'email':
      return `${labelHtml}
        <input id="${id}" name="${id}" type="email" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="email" ${required} ${placeholder}>
        ${helpHtml}`;
    case 'phone':
      return `${labelHtml}
        <input id="${id}" name="${id}" type="tel" inputmode="numeric"
          autocomplete="tel"
          data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="phone" ${required} ${placeholder}
          ${field.min != null ? `minlength="${Number(field.min)}"` : ''}
          ${field.max != null ? `maxlength="${Number(field.max)}"` : ''}
          pattern="[0-9+\\-\\s()]*"
          title="Numbers only"
          oninput="this.value = this.value.replace(/[^0-9+\\-\\s()]/g, '')">
        ${helpHtml}`;
    case 'number':
      return `${labelHtml}
        <input id="${id}" name="${id}" type="number" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="number" ${required} ${placeholder}
          ${field.min != null ? `min="${Number(field.min)}"` : ''}
          ${field.max != null ? `max="${Number(field.max)}"` : ''}>
        ${helpHtml}`;
    case 'date':
      return `${labelHtml}
        <input id="${id}" name="${id}" type="date" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="date" ${required}
          ${field.min ? `min="${escapeHtml(String(field.min))}"` : ''}
          ${field.max ? `max="${escapeHtml(String(field.max))}"` : ''}>
        ${helpHtml}`;
    case 'dropdown': {
      const options = (field.options ?? [])
        .map((option: string) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
        .join('\n');
      return `${labelHtml}
        <select id="${id}" name="${id}" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="dropdown" ${required}>
          <option value="">Select...</option>
          ${options}
        </select>
        ${helpHtml}`;
    }
    case 'radio': {
      const options = (field.options ?? []).map((option: string, index: number) => `
        <label class="radio-option">
          <input type="radio" name="${id}" value="${escapeHtml(option)}" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="radio" ${index === 0 && field.required ? 'required' : ''}>
          <span>${escapeHtml(option)}</span>
        </label>`).join('\n');
      return `${labelHtml}
        <div class="radio-group" role="radiogroup" data-cf-group="${escapeHtml(field.id)}">${options}</div>
        ${helpHtml}`;
    }
    case 'checkbox_group': {
      const options = (field.options ?? []).map((option: string) => `
        <label class="checkbox-option">
          <input type="checkbox" name="${id}" value="${escapeHtml(option)}" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="checkbox_group">
          <span>${escapeHtml(option)}</span>
        </label>`).join('\n');
      return `${labelHtml}
        <div class="checkbox-group" data-cf-group="${escapeHtml(field.id)}" ${field.required ? 'data-cf-required="1"' : ''}>${options}</div>
        ${helpHtml}`;
    }
    case 'toggle':
      return `<label class="toggle-row">
          <input type="checkbox" id="${id}" name="${id}" data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="toggle" ${field.required ? 'required' : ''}>
          <span>${escapeHtml(field.label)}${field.required ? ' <span class="required">*</span>' : ''}</span>
        </label>
        ${helpHtml}`;
    default:
      return '';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (isNaN(num)) return price;
  const formatted = Math.abs(num).toLocaleString('en-NG');
  return num < 0 ? `-\u20A6${formatted}` : `\u20A6${formatted}`;
}

// ── Fallback Form (no campaign data) ──────────────────────────

const FALLBACK_PRODUCTS: CampaignConfig['products'] = [
  { id: 'from-campaign', name: 'Product', price: '0', offers: [] },
];

function renderFallbackForm(campaignId: string, workerUrl: string): Response {
  // Render a simplified form without product selection
  const accentColor = DEFAULT_CAMPAIGN_FORM_ACCENT_HEX;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Form</title>
  <style>${getFormStyles(accentColor)}
    body{background:#f8f9fa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  </style>
</head>
<body>
  <div class="yannis-form-card">
    <h2>Place Your Order</h2>
    <div id="yannisMsg" class="msg hidden"></div>
    <form id="yannisOrderForm">
      <label for="customerName">Full Name</label>
      <input id="customerName" name="customerName" type="text" required minlength="2" placeholder="Your full name">
      <label for="customerPhone">Phone Number</label>
      <input id="customerPhone" name="customerPhone" type="tel" inputmode="tel" required placeholder="08012345678" maxlength="14" pattern="^(0[789][0-9]{9}|\\+234[789][0-9]{9})$" title="Enter a valid Nigerian phone number, e.g. 08012345678 or +2348012345678" autocomplete="tel-national">
      <label for="deliveryAddress">Delivery Address</label>
      <textarea id="deliveryAddress" name="deliveryAddress" placeholder="Your delivery address"></textarea>
      <label for="deliveryNotes">Delivery Notes (optional)</label>
      <input id="deliveryNotes" name="deliveryNotes" type="text" placeholder="Any special instructions">
      <button type="submit" class="btn" id="yannisSubmitBtn">Submit Order</button>
    </form>
  </div>
  <script>
    ${getFormScript(workerUrl, campaignId, FALLBACK_PRODUCTS, undefined, 'fallback')}
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html;charset=utf-8', ...CORS_HEADERS },
  });
}

// ── Hosted Form Page (GET /form/:campaignId) ───────────────────

function renderHostedForm(config: CampaignConfig, workerUrl: string): Response {
  const accentColor = config.formConfig?.accentColor ?? DEFAULT_CAMPAIGN_FORM_ACCENT_HEX;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.name)} — Order Form</title>
  <style>${getFormStyles(accentColor)}
    body{background:#f8f9fa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  </style>
</head>
<body>
  <div class="yannis-form-card">
    ${getFormInnerHTML(config)}
  </div>
  <script>
    ${getFormScript(workerUrl, config.id, config.products, config.mediaBuyerId, 'hosted')}
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html;charset=utf-8', ...CORS_HEADERS },
  });
}

// ── Embeddable Script (GET /embed.js?campaign=:id) ─────────────

function renderEmbedScript(config: CampaignConfig, workerUrl: string): Response {
  const accentColor = config.formConfig?.accentColor ?? DEFAULT_CAMPAIGN_FORM_ACCENT_HEX;

  // Self-executing script that injects form into Shadow DOM
  const js = `(function(){
  var target = document.currentScript.parentElement;
  var shadow = target.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = ${JSON.stringify(getFormStyles(accentColor))};
  shadow.appendChild(style);

  var container = document.createElement('div');
  container.className = 'yannis-form-card';
  container.innerHTML = ${JSON.stringify(getFormInnerHTML(config))};
  shadow.appendChild(container);

  // Run form logic inside shadow DOM context
  var formScript = document.createElement('script');
  // We need to bind into shadow DOM — inline the logic
  ${getFormScript(workerUrl, config.id, config.products, config.mediaBuyerId, 'embedded')}
})();`;

  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript;charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...CORS_HEADERS,
    },
  });
}

// ── iFrame Form (GET /iframe/:campaignId) ──────────────────────

function renderIframeForm(config: CampaignConfig, workerUrl: string): Response {
  // Same as hosted but with iframe-friendly styles (no body centering)
  const accentColor = config.formConfig?.accentColor ?? DEFAULT_CAMPAIGN_FORM_ACCENT_HEX;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.name)}</title>
  <style>${getFormStyles(accentColor)}
    body{margin:0;padding:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .yannis-form-card{box-shadow:none;border-radius:0;max-width:100%}
  </style>
</head>
<body>
  <div class="yannis-form-card">
    ${getFormInnerHTML(config)}
  </div>
  <script>
    ${getFormScript(workerUrl, config.id, config.products, config.mediaBuyerId, 'iframe')}
    // Auto-resize iframe height
    var resizeObserver = new ResizeObserver(function() {
      window.parent.postMessage({ type: 'yannis-form-resize', height: document.body.scrollHeight }, '*');
    });
    resizeObserver.observe(document.body);
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html;charset=utf-8', ...CORS_HEADERS },
  });
}

// ── API Health Check (used by healer cron) ─────────────────────

async function isApiHealthy(env: Env): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${env.API_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

// ── Main Handler ───────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Normalize double slashes in pathname
    url.pathname = url.pathname.replace(/\/\/+/g, '/');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Health check ─────────────────────────────────────────
    if (url.pathname === '/health') {
      return corsResponse({
        status: 'ok',
        service: 'yannis-edge-worker',
        timestamp: new Date().toISOString(),
      });
    }

    // ── Hosted form page ─────────────────────────────────────
    if (url.pathname.startsWith('/form/') && request.method === 'GET') {
      const campaignId = url.pathname.split('/form/')[1];
      if (!campaignId) {
        return corsResponse({ error: 'Campaign ID is required' }, 400);
      }
      const workerUrl = `${url.protocol}//${url.host}`;
      const config = await getCampaignConfig(campaignId, env);
      if (!config) {
        return renderFallbackForm(campaignId, workerUrl);
      }
      return renderHostedForm(config, workerUrl);
    }

    // ── iFrame form ───────────────────────────────────────────
    if (url.pathname.startsWith('/iframe/') && request.method === 'GET') {
      const campaignId = url.pathname.split('/iframe/')[1];
      if (!campaignId) {
        return corsResponse({ error: 'Campaign ID is required' }, 400);
      }
      const workerUrl = `${url.protocol}//${url.host}`;
      const config = await getCampaignConfig(campaignId, env);
      if (!config) {
        return renderFallbackForm(campaignId, workerUrl);
      }
      return renderIframeForm(config, workerUrl);
    }

    // ── Embeddable Shadow DOM script ──────────────────────────
    if (url.pathname === '/embed.js' && request.method === 'GET') {
      const campaignId = url.searchParams.get('campaign');
      if (!campaignId) {
        return new Response('// Error: campaign query parameter required', {
          status: 400,
          headers: { 'Content-Type': 'application/javascript', ...CORS_HEADERS },
        });
      }
      const workerUrl = `${url.protocol}//${url.host}`;
      const config = await getCampaignConfig(campaignId, env);
      if (!config) {
        return new Response('// Error: campaign not found', {
          status: 404,
          headers: { 'Content-Type': 'application/javascript', ...CORS_HEADERS },
        });
      }
      return renderEmbedScript(config, workerUrl);
    }

    // ── Cart save (name + phone before submit) ─────────────────
    if (url.pathname === '/cart' && request.method === 'POST') {
      return handleCart(request, env);
    }

    // ── Order submission ─────────────────────────────────────
    if (url.pathname === '/submit' && request.method === 'POST') {
      return handleSubmission(request, env);
    }

    // ── Inventory cache update (called by API, secured with API key) ──
    if (url.pathname === '/inventory/update' && request.method === 'POST') {
      return handleInventoryUpdate(request, env);
    }

    return corsResponse({ error: 'Not Found' }, 404);
  },

  /**
   * Healer cron — runs every 60 seconds.
   * When the API is healthy, this job does nothing meaningful.
   * The primary purpose is to provide a heartbeat check and log
   * API health status. QStash handles its own retries internally,
   * so there's no manual buffer draining needed.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const healthy = await isApiHealthy(env);
    if (!healthy) {
      console.log('[healer] API is unhealthy — QStash will continue retrying buffered orders');
      return;
    }
    console.log('[healer] API is healthy — all systems nominal');
  },
};

// ── Cart Save Handler ──────────────────────────────────────────

function validateCart(body: unknown): { valid: true; data: CartFormData } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const b = body as Record<string, unknown>;

  if (!b['campaignId'] || typeof b['campaignId'] !== 'string') {
    return { valid: false, error: 'Campaign ID is required' };
  }

  if (!b['customerName'] || typeof b['customerName'] !== 'string' || (b['customerName'] as string).length < 2) {
    return { valid: false, error: 'Customer name is required (min 2 characters)' };
  }

  // Nigerian phone format only — same regex used everywhere else in the system.
  // Accepts `0XXXXXXXXXX` (11 digits, leading 0 + 7/8/9) or `+234XXXXXXXXXX` (13 chars).
  // Reject anything longer (e.g. `08031234567899`) so we don't store trailing junk.
  {
    const phoneStr = typeof b['customerPhone'] === 'string' ? (b['customerPhone'] as string).trim() : '';
    if (!/^(?:0[789]\d{9}|\+234[789]\d{9})$/.test(phoneStr)) {
      return {
        valid: false,
        error: 'Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567).',
      };
    }
    b['customerPhone'] = phoneStr;
  }

  if (!b['productId'] || typeof b['productId'] !== 'string') {
    return { valid: false, error: 'Product ID is required' };
  }

  const strField = (key: string): string | undefined => {
    const v = b[key];
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };
  const numField = (key: string): number | undefined => {
    const v = b[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
    if (typeof v === 'string' && v.trim().length > 0) {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    return undefined;
  };
  const cfv =
    b['customFieldValues'] && typeof b['customFieldValues'] === 'object' && !Array.isArray(b['customFieldValues'])
      ? (b['customFieldValues'] as Record<string, CustomFieldValue>)
      : undefined;

  return {
    valid: true,
    data: {
      campaignId: b['campaignId'] as string,
      mediaBuyerId: typeof b['mediaBuyerId'] === 'string' ? b['mediaBuyerId'] : undefined,
      customerName: b['customerName'] as string,
      customerPhone: b['customerPhone'] as string,
      productId: b['productId'] as string,
      offerLabel: typeof b['offerLabel'] === 'string' ? b['offerLabel'] : undefined,
      customerEmail: strField('customerEmail'),
      customerAddress: strField('customerAddress'),
      deliveryAddress: strField('deliveryAddress'),
      deliveryState: strField('deliveryState'),
      deliveryNotes: strField('deliveryNotes'),
      customerGender: strField('customerGender'),
      preferredDeliveryDate: strField('preferredDeliveryDate'),
      paymentMethod: strField('paymentMethod'),
      quantity: numField('quantity'),
      customFieldValues: cfv && Object.keys(cfv).length > 0 ? cfv : undefined,
    },
  };
}

async function handleCart(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validation = validateCart(body);
  if (!validation.valid) {
    return corsResponse({ error: validation.error }, 400);
  }
  const data = validation.data;

  const phoneHash = await hashPhone(data.customerPhone);

  const payload: CartSavePayload = {
    campaignId: data.campaignId,
    mediaBuyerId: data.mediaBuyerId,
    customerName: data.customerName,
    customerPhoneHash: phoneHash,
    customerPhone: data.customerPhone,
    productId: data.productId,
    offerLabel: data.offerLabel,
    customerEmail: data.customerEmail,
    customerAddress: data.customerAddress,
    deliveryAddress: data.deliveryAddress,
    deliveryState: data.deliveryState,
    deliveryNotes: data.deliveryNotes,
    customerGender: data.customerGender,
    preferredDeliveryDate: data.preferredDeliveryDate,
    paymentMethod: data.paymentMethod,
    quantity: data.quantity,
    customFieldValues: data.customFieldValues,
  };

  const result = await forwardCartToApi(payload, env);

  if (result.ok) {
    const id = (result.data as { result?: { data?: { id: string } } })?.result?.data?.id;
    return corsResponse({ success: true, id });
  }

  return corsResponse(
    { error: (result.data as { error?: { message?: string } })?.error?.message ?? 'Failed to save cart' },
    500,
  );
}

// ── Submission Handler ─────────────────────────────────────────

async function handleSubmission(request: Request, env: Env): Promise<Response> {
  // 1. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON body' }, 400);
  }

  // 1a. Honeypot check. The form ships a hidden `yannis_website_url` input that real users
  // never see. Bots auto-fill every input they encounter, so if this field has any value
  // we silently drop the submission and return a fake "success" so the bot stops retrying.
  // This is the primary spam protection now that the Turnstile path is disabled.
  const honeypotValue = (body as Record<string, unknown>)['yannis_website_url'];
  if (typeof honeypotValue === 'string' && honeypotValue.trim().length > 0) {
    // Pretend everything worked — no order is created, no API call is made, no KV write.
    return corsResponse({ success: true, orderId: 'queued', alreadySubmitted: false }, 200);
  }

  // 2. Validate input
  const validation = validateSubmission(body);
  if (!validation.valid) {
    return corsResponse({ error: validation.error }, 400);
  }
  const data = validation.data;

  // 3. Rate limit by IP (with CAPTCHA challenge for moderate abuse)
  const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
  const rateLimitResult = await checkRateLimit(clientIp, env);

  if (rateLimitResult === 'blocked') {
    return corsResponse(
      { error: 'Too many submissions. Please wait a few minutes and try again.' },
      429,
    );
  }

  // CAPTCHA path is intentionally disabled — we use a honeypot field for bot protection
  // instead (see step 1a). The rate limiter still hard-blocks at RATE_LIMIT_MAX_REQUESTS,
  // so abusive IPs get 429 once they cross 5 submissions in 5 minutes. The intermediate
  // 'captcha_required' state now falls through to normal processing because we'd otherwise
  // have to ship a CAPTCHA widget, and we don't want to register for one. If you ever wire
  // up Turnstile or hCaptcha later, restore the verification block here.
  if (rateLimitResult === 'captcha_required') {
    // No-op: let the request through. Honeypot + rate-limit hard cap handle abuse.
  }

  // 4. Dedup check (phone + product + mediaBuyerId within 6hr window).
  //    Per-MB scoping: same MB resubmits → short-circuit at edge (no API call).
  //    Different MB → KV miss here, API will record a cross_funnel_attempt row
  //    so the second MB can see their funnel got traction without creating a
  //    duplicate order or polluting CS/metrics.
  const productIds = data.items.map((item) => item.productId);
  const dupProduct = await checkDedup(data.customerPhone, productIds, env, data.mediaBuyerId);
  if (dupProduct) {
    return corsResponse(
      {
        success: true,
        message: 'Your order has already been submitted. No need to submit again.',
        alreadySubmitted: true,
      },
      200,
    );
  }

  // 5. Inventory budget cap check
  const soldOutProduct = await checkInventoryCap(productIds, env);
  if (soldOutProduct) {
    return corsResponse(
      { error: 'Sorry, this product is currently sold out.' },
      410,
    );
  }

  // 6. Hash phone number (never send raw phone to API)
  const phoneHash = await hashPhone(data.customerPhone);

  // 7. Build API payload (source: edge-form for audit trail traceability)
  const orderPayload: OrderCreatePayload = {
    campaignId: data.campaignId,
    mediaBuyerId: data.mediaBuyerId,
    customerName: data.customerName,
    customerPhoneHash: phoneHash,
    customerPhone: data.customerPhone,
    customerAddress: data.customerAddress,
    deliveryAddress: data.deliveryAddress,
    deliveryNotes: data.deliveryNotes,
    deliveryState: data.deliveryState,
    customerGender: data.customerGender,
    preferredDeliveryDate: data.preferredDeliveryDate,
    paymentMethod: data.paymentMethod,
    customerEmail: data.customerEmail,
    items: data.items,
    totalAmount: data.totalAmount,
    source: 'edge-form',
    cartId: data.cartId,
    customFields: data.customFields,
  };

  // 8. Forward to API: PAY_ONLINE → prepare Paystack (no order yet); else → orders.create
  const isPayOnline = data.paymentMethod === 'PAY_ONLINE';
  const apiResult = isPayOnline
    ? await forwardPreparePaystackToApi(orderPayload, env)
    : await forwardToApi(orderPayload, env);

  if (apiResult.ok) {
    const resultData = apiResult.data as {
      result?: {
        data?: { id?: string; authorizationUrl?: string; reference?: string; crossFunnelAttempt?: true };
      };
    };
    const orderId = resultData?.result?.data?.id;
    const authorizationUrl = resultData?.result?.data?.authorizationUrl;
    const crossFunnelAttempt = resultData?.result?.data?.crossFunnelAttempt === true;

    // Mark dedup so this same MB can't re-submit within the window.
    // Cross-funnel attempts also mark dedup so the form doesn't keep posting
    // through to the API on every retry.
    await markDedup(data.customerPhone, productIds, env, data.mediaBuyerId);

    if (crossFunnelAttempt) {
      // Original MB already won attribution — surface the same "already submitted"
      // UX as a same-MB duplicate. The DB row in cross_funnel_attempts is the only
      // place this collision is recorded; CS / metrics never see it.
      return corsResponse({
        success: true,
        message: 'Your order has already been submitted. No need to submit again.',
        alreadySubmitted: true,
      });
    }

    if (isPayOnline && authorizationUrl) {
      return corsResponse({
        success: true,
        message: 'Redirecting to payment...',
        authorizationUrl,
      });
    }

    return corsResponse({
      success: true,
      message: 'Order received successfully',
      orderId,
      ...(authorizationUrl ? { authorizationUrl } : {}),
    });
  }

  // PAY_ONLINE + 5xx/503: no QStash — ask user to retry
  if (isPayOnline && (apiResult.status >= 500 || apiResult.status === 503)) {
    const errorMessage = (apiResult.data as { error?: { message?: string } })?.error?.message
      ?? 'Payment service is temporarily unavailable. Please try again in a moment.';
    return corsResponse({ error: errorMessage }, 503);
  }

  // 9. API failed — try QStash failover (Pay on delivery only)
  if (apiResult.status >= 500 || apiResult.status === 503) {
    const buffered = await bufferToQStash(orderPayload, env);

    if (buffered) {
      // Mark dedup even for buffered orders
      await markDedup(data.customerPhone, productIds, env, data.mediaBuyerId);

      return corsResponse({
        success: true,
        message: 'Order received, processing shortly',
        buffered: true,
      });
    }

    // QStash also failed — last resort.
    // If we aborted waiting for the API, the request may still have completed server-side
    // (common cause of "order exists in CS but form shows an error").
    const timedOut = (apiResult.data as { timedOut?: boolean })?.timedOut === true;
    if (timedOut && !isPayOnline) {
      return corsResponse({
        success: true,
        message:
          'Your order may still be processing. Please do not submit again while you wait. If you do not hear from us shortly, wait a few minutes before trying once more.',
        pendingConfirmation: true,
      });
    }
    return corsResponse(
      { error: 'Our systems are temporarily busy. Please try again in a few moments.' },
      503,
    );
  }

  // 10. API returned a client error (4xx) — forward the error
  const errorMessage = (apiResult.data as { error?: { message?: string } })?.error?.message
    ?? 'Unable to process your order. Please check your details and try again.';
  return corsResponse({ error: errorMessage }, apiResult.status);
}

// ── Inventory Cache Update Handler (secured with API key) ─────

async function handleInventoryUpdate(request: Request, env: Env): Promise<Response> {
  // Verify API key if configured
  if (env.EDGE_API_KEY) {
    const apiKey = request.headers.get('X-Edge-Api-Key');
    if (apiKey !== env.EDGE_API_KEY) {
      return corsResponse({ error: 'Unauthorized' }, 401);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON' }, 400);
  }

  const updates = body as Array<{
    productId: string;
    total: number;
    pending: number;
    confirmed: number;
  }>;

  if (!Array.isArray(updates)) {
    return corsResponse({ error: 'Expected array of inventory updates' }, 400);
  }

  if (env.INVENTORY_CACHE) {
    for (const update of updates) {
      if (!update.productId) continue;
      await env.INVENTORY_CACHE.put(
        `stock:${update.productId}`,
        JSON.stringify({
          total: update.total,
          pending: update.pending,
          confirmed: update.confirmed,
        }),
        { expirationTtl: 300 }, // 5 min cache
      );
    }
  }

  return corsResponse({ success: true, updated: updates.length });
}
