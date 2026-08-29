import { Redis } from '@upstash/redis/cloudflare';
import {
  DEFAULT_CAMPAIGN_FORM_ACCENT_HEX,
  normalizeCampaignFieldOrder,
  COUNTRY_PHONE_RULES,
  phoneRuleForCountry,
  normalizePhoneForHash,
} from '@yannis/shared';

/**
 * Yannis EOSE — Edge Worker
 *
 * Handles sales form submissions at the Cloudflare Edge.
 * Implements: rate limiting, circuit breaker with QStash failover, Upstash
 * Redis defense-in-depth (drained by per-minute cron), phone hashing, campaign
 * config loading, embed modes, and offline IndexedDB fallback.
 *
 * Duplicate-order protection is the API's job (`findRecentIdenticalOrder` in
 * OrdersService.create) — the edge no longer keeps its own KV dedup.
 */

export interface Env {
  API_URL: string;
  /**
   * Absolute origin the rendered form HTML and embed.js script should fetch
   * back at for `/cart` and `/submit`. Set this in `.dev.vars` to
   * `http://localhost:8787` so local previews don't accidentally POST to the
   * production worker. Leave unset in deployed envs — the worker falls back
   * to the request's Host header, which is correct on every CF route.
   */
  PUBLIC_WORKER_URL?: string;
  QSTASH_URL: string;
  QSTASH_TOKEN: string;
  EDGE_API_KEY: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  // Upstash Redis REST endpoint — used ONLY as a last-resort buffer when both
  // the API and QStash are unreachable. Drained back to the API by the
  // healer cron. Optional: if either is unset, Redis fallback is skipped.
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  RATE_LIMIT_CACHE: KVNamespace;
  CAMPAIGN_CACHE: KVNamespace;
}

// Redis queue config — single source of truth for keys + retry policy.
const REDIS_PENDING_KEY = 'edge:orders:pending';
const REDIS_DEAD_LETTER_KEY = 'edge:orders:dead-letter';
// In-flight list: each drained item lives here (moved atomically off pending)
// while its API replay is in progress, so a worker crash mid-replay can't drop
// it — the next cron reclaims anything left behind. See drainRedisQueue.
const REDIS_PROCESSING_KEY = 'edge:orders:processing';
const REDIS_CART_PENDING_KEY = 'edge:carts:pending';
const REDIS_CART_DEAD_LETTER_KEY = 'edge:carts:dead-letter';
const REDIS_CART_PROCESSING_KEY = 'edge:carts:processing';
const REDIS_MAX_ATTEMPTS = 6;          // ~6 minutes of retries at 1-per-minute cron
const REDIS_DRAIN_BATCH_SIZE = 20;     // max orders processed per cron tick (CPU budget)
const REDIS_CART_DRAIN_BATCH_SIZE = 30; // carts are smaller; allow a slightly larger batch

function getRedis(env: Env): Redis | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
}

interface QueuedOrder {
  payload: unknown;          // the OrderCreatePayload — kept loose to avoid coupling here
  attempts: number;
  firstQueuedAt: string;
  lastAttemptAt: string | null;
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
  /** Currency the order was placed in (frozen). Additive; API defaults to NGN. */
  currencyCode?: string;
  cartId?: string;
  /** Form-builder responses, keyed by `customField.id`. */
  customFields?: Record<string, CustomFieldValue>;
  /** Form Analytics attribution key (optional). Links the order back to a form view. */
  sessionId?: string;
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
  /** Currency the order was placed in (frozen). Additive; API defaults to NGN if absent. */
  currencyCode?: string;
  /** Identifies Edge Form as source for audit trail */
  source?: 'edge-form';
  /** Cart ID from prior cart save — marks cart as CONVERTED when order created */
  cartId?: string;
  /** Form-builder responses, keyed by `customField.id`. Persisted to `orders.custom_fields` JSONB. */
  customFields?: Record<string, CustomFieldValue>;
  /** Form Analytics attribution key (optional). Persisted to `orders.session_id`. */
  sessionId?: string;
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
  /** Frozen currency the customer selected (optional). Persisted to
   *  `cart_abandonments.currency_code`; drives country-scoped cart routing.
   *  STAMP-never-reject — absent defaults to NGN downstream. */
  currencyCode?: string;
  /** Form Analytics attribution key (optional). Persisted to `cart_abandonments.session_id`. */
  sessionId?: string;
}

/** Validated cart form data (has raw customerPhone from form) */
interface CartFormData extends ProgressiveCartFields {
  campaignId: string;
  mediaBuyerId?: string;
  customerName: string;
  customerPhone: string;
  /** Optional — phone-only capture before the customer picks a product. */
  productId?: string;
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
  /** Optional — phone-only capture before the customer picks a product. */
  productId?: string;
  offerLabel?: string;
}

interface ProductOffer {
  label: string;
  qty: number;
  price: string;
  imageUrls?: string[];
  /**
   * Multi-currency: price of this offer in non-default currencies (code → price
   * string). Absent/empty = base-only. A currency present here is "priced"; one
   * absent is hidden from the switcher for this offer. Additive — the base
   * `price` above is unchanged and always present.
   */
  pricesByCurrency?: Record<string, string>;
}

/** A currency available on the public form (base + any the offers are priced in). */
interface FormCurrency {
  code: string;
  symbol: string;
  precision: number;
  isDefault: boolean;
  /** The country this currency belongs to (for the country picker → currency link). */
  countryName?: string;
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
  /**
   * Active currencies for the company (base first). Present only when the API
   * has 2+ active currencies AND at least one offer is priced beyond base.
   * Absent/length<=1 → single-currency form, byte-identical to today.
   */
  currencies?: FormCurrency[];
  /** Region ("Delivery State") lists per configured country. Drives the country picker. */
  regionsByCountry?: Record<string, string[]>;
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
    /** When true, show a currency switcher; customer picks (priced currencies only). */
    allowMultiCurrency?: boolean;
    /** Single currency this form uses when allowMultiCurrency is false. Defaults to base. */
    pinnedCurrency?: string;
    /** When true, show a country picker; region list + currency follow the choice. */
    allowCountrySelection?: boolean;
    /** Default/starting country (locked country when allowCountrySelection is false). */
    deliveryCountry?: string;
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
const CIRCUIT_BREAKER_TIMEOUT_MS = 20000; // 20s production (slow API/cold start still completes; short timeout caused false "busy" after successful creates)
const CIRCUIT_BREAKER_TIMEOUT_LOCAL_MS = 30000; // 30s for localhost (cold starts, slow DB)

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

/**
 * Headers for any POST the edge forwards to the API's public order/cart
 * endpoints (`orders.create`, `cart.save`, `preparePaystackOrder`). The
 * `X-Edge-Api-Key` proves the request came from THIS worker — the API rejects
 * order-create traffic that lacks it, so the public tRPC endpoints can't be
 * hit directly to forge orders while bypassing the honeypot / rate limiter.
 *
 * Fail-safe: if EDGE_API_KEY isn't bound (e.g. before the secret is set on a
 * fresh env), we simply omit the header. The API's guard is also fail-open
 * when its own EDGE_API_KEY is unset, so Pillar-1 (forms never go offline)
 * holds during rollout; the gate activates only once BOTH sides have the key.
 */
function apiForwardHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.EDGE_API_KEY) headers['X-Edge-Api-Key'] = env.EDGE_API_KEY;
  return headers;
}

// 5 min cache for campaign configs. NOT shorter: every cache miss is a KV
// `put()`, and the account's daily KV write quota is a hard limit — a 60s TTL
// multiplied writes ~5x and helped exhaust it (which, before the best-effort
// guard in getCampaignConfig, broke the form entirely). The proper fix for
// "form shows stale offers after an edit" is an explicit purge on campaign
// update, NOT a shorter TTL.
const CAMPAIGN_CACHE_TTL = 300;

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
  // Country-aware canonicalization (shared with API/seed so hashes match).
  const normalized = normalizePhoneForHash(phone);
  const encoder = new TextEncoder();
  const data = encoder.encode(`yannis:phone:${normalized}`);
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

  // Phone: STAMP-never-reject (multi-country, edge-freeze rule). The public form
  // enforces the per-country format client-side; here we only reject obvious
  // junk (too few / too many digits) so a valid Ghanaian/other-country number is
  // never blocked at intake (a 4xx here = a lost order). Nigerian numbers are a
  // subset of 7-15 digits, so they pass exactly as before.
  {
    const phoneStr = typeof b['customerPhone'] === 'string' ? (b['customerPhone'] as string).trim() : '';
    const digitCount = phoneStr.replace(/\D/g, '').length;
    if (digitCount < 7 || digitCount > 15) {
      return {
        valid: false,
        error: 'Enter a valid phone number.',
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

  // Delivery address and state are always required (CEO directive 2026-05-26).
  const deliveryAddress = typeof b['deliveryAddress'] === 'string' ? (b['deliveryAddress'] as string).trim() : '';
  if (!deliveryAddress) {
    return { valid: false, error: 'Delivery address is required.' };
  }
  const deliveryState = typeof b['deliveryState'] === 'string' ? (b['deliveryState'] as string).trim() : '';
  if (!deliveryState) {
    return { valid: false, error: 'Delivery state is required.' };
  }

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
      // Additive, never-reject: pass through the currency code if present (max 5 chars,
      // uppercased); the API defaults to NGN when absent.
      currencyCode: typeof b['currencyCode'] === 'string' && b['currencyCode'].length <= 5 ? b['currencyCode'].toUpperCase() : undefined,
      cartId: typeof b['cartId'] === 'string' ? b['cartId'] : undefined,
      customFields,
      sessionId: typeof b['sessionId'] === 'string' ? b['sessionId'] : undefined,
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

  try {
    await env.RATE_LIMIT_CACHE.put(key, String(count + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
    });
  } catch (kvErr) {
    // KV write quota may be exhausted — non-fatal. The submission still
    // proceeds; rate limiting degrades to the API's own throttle layer.
    console.error(`[rate-limit] KV put skipped: ${kvErr instanceof Error ? kvErr.message : String(kvErr)}`);
  }

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

// ── Campaign Config Fetcher ────────────────────────────────────

async function getCampaignConfig(campaignId: string, env: Env): Promise<CampaignConfig | null> {
  // Check KV cache first — best-effort read so a KV outage doesn't prevent
  // the form from rendering (falls through to a live API call).
  const cacheKey = `campaign:${campaignId}`;
  try {
    const cached = env.CAMPAIGN_CACHE ? await env.CAMPAIGN_CACHE.get(cacheKey) : null;
    if (cached) {
      return JSON.parse(cached) as CampaignConfig;
    }
  } catch (cacheReadErr) {
    console.error(
      `[campaign] cache read skipped (non-fatal): ${cacheReadErr instanceof Error ? cacheReadErr.message : String(cacheReadErr)}`,
    );
  }

  // Fetch from API
  const encodedInput = encodeURIComponent(JSON.stringify({ campaignId }));
  const apiUrl = `${env.API_URL}/trpc/marketing.getPublic?input=${encodedInput}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), getApiTimeoutMs(env.API_URL));

    const response = await fetch(apiUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[campaign] ${apiUrl} -> HTTP ${response.status}; body: ${body.slice(0, 240)}`);
      return null;
    }

    const result = await response.json() as { result?: { data?: CampaignConfig } };
    const config = result?.result?.data;
    if (!config) {
      console.error(`[campaign] ${apiUrl} -> 200 but no result.data in body`);
      return null;
    }

    // Cache successful configs — STRICTLY best-effort. A KV write failure
    // (most commonly the account's daily KV `put()` quota being exhausted)
    // must NEVER discard a config we already fetched successfully: doing so
    // drops the public form to the offer-less fallback even though the API
    // call worked. Isolated catch so a cache miss can't abort the render path.
    if (env.CAMPAIGN_CACHE) {
      try {
        await env.CAMPAIGN_CACHE.put(cacheKey, JSON.stringify(config), {
          expirationTtl: CAMPAIGN_CACHE_TTL,
        });
      } catch (cacheErr) {
        console.error(
          `[campaign] cache write skipped (non-fatal): ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`,
        );
      }
    }

    return config;
  } catch (err) {
    console.error(
      `[campaign] ${apiUrl} -> fetch threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return null;
  }
}

// ── Forward Cart to API ───────────────────────────────────────

async function forwardCartToApi(
  payload: CartSavePayload,
  env: Env,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getApiTimeoutMs(env.API_URL));

  try {
    const response = await fetch(`${env.API_URL}/trpc/cart.save`, {
      method: 'POST',
      headers: apiForwardHeaders(env),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[edge] cart.save failed', response.status, JSON.stringify(data));
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      isTimeout ? '[edge] cart.save timed out' : '[edge] cart.save unreachable:',
      err,
    );
    return { ok: false, status: 503, data: { error: 'API unreachable', timedOut: isTimeout } };
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
      headers: apiForwardHeaders(env),
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
      headers: apiForwardHeaders(env),
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

// Worker paths QStash calls when a buffered message exhausts all retries. The
// original payload is then persisted to the Redis dead-letter list instead of
// being silently dropped (Pillar-1: never lose a paid/placed order).
const QSTASH_FAILED_ORDER_PATH = '/qstash/failed/order';
const QSTASH_FAILED_CART_PATH = '/qstash/failed/cart';

/**
 * Build the `Upstash-Failure-Callback` header. QStash invokes this URL after
 * the last retry fails, so an exhausted order is captured for manual replay
 * rather than vanishing. Requires a public worker origin — if PUBLIC_WORKER_URL
 * is unset (can't self-address), we omit the header and fall back to today's
 * behavior (QStash still retries; only the terminal capture is skipped).
 */
function qstashFailureCallbackHeader(env: Env, path: string): Record<string, string> {
  const origin = env.PUBLIC_WORKER_URL?.trim().replace(/\/+$/, '');
  if (!origin) return {};
  return { 'Upstash-Failure-Callback': `${origin}${path}` };
}

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
        // QStash strips its own auth and replays `Upstash-Forward-*` headers to
        // the destination as-is, so the edge key reaches orders.create on replay.
        ...(env.EDGE_API_KEY ? { 'Upstash-Forward-X-Edge-Api-Key': env.EDGE_API_KEY } : {}),
        ...qstashFailureCallbackHeader(env, QSTASH_FAILED_ORDER_PATH),
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function bufferCartToQStash(
  payload: CartSavePayload,
  env: Env,
): Promise<boolean> {
  if (!env.QSTASH_URL || !env.QSTASH_TOKEN) {
    return false;
  }

  try {
    const response = await fetch(`${env.QSTASH_URL}/v2/publish/${env.API_URL}/trpc/cart.save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.QSTASH_TOKEN}`,
        'Upstash-Retries': '3',
        'Upstash-Delay': '10s',
        // QStash replays `Upstash-Forward-*` headers to the destination as-is,
        // so the edge key reaches cart.save on replay.
        ...(env.EDGE_API_KEY ? { 'Upstash-Forward-X-Edge-Api-Key': env.EDGE_API_KEY } : {}),
        ...qstashFailureCallbackHeader(env, QSTASH_FAILED_CART_PATH),
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * True when the API rejected with the edge-auth gate (HTTP 401 +
 * "Edge authentication required."). This is an INFRASTRUCTURE failure disguised
 * as a client error: the order is valid, the API is simply mis-keyed relative to
 * the worker. We treat it like a 5xx (buffer to QStash/Redis) so a gate
 * misconfiguration can never silently drop revenue again. On QStash replay the
 * `Upstash-Forward-X-Edge-Api-Key` header is attached, so a replay that reaches a
 * correctly-keyed API succeeds. Matches the specific message so a genuine 4xx
 * (bad customer data → 400) is still forwarded as an error, never buffered.
 * See the 2026-08-04 form-freeze incident.
 */
function isEdgeAuthRejection(result: { status: number; data: unknown }): boolean {
  if (result.status !== 401) return false;
  const message = (result.data as { error?: { message?: string } })?.error?.message;
  return message === 'Edge authentication required.';
}

/**
 * Handle a QStash failure callback. QStash POSTs a JSON envelope after a
 * buffered message exhausts every retry; `body` is the base64-encoded original
 * request payload. We decode it and push the ORIGINAL order/cart onto the
 * Redis dead-letter list so a fully-exhausted submission is preserved for
 * manual replay instead of being silently lost (Pillar-1 revenue insurance).
 *
 * Always returns 200 — a non-2xx would make QStash retry the callback itself,
 * and there's nothing useful to retry. Failures are logged for alerting.
 */
async function handleQStashFailureCallback(
  request: Request,
  env: Env,
  deadLetterKey: string,
): Promise<Response> {
  try {
    const envelope = (await request.json().catch(() => null)) as
      | { body?: string; sourceMessageId?: string; status?: number }
      | null;
    // `body` is base64 of the original JSON payload we published.
    let originalPayload: unknown = null;
    if (envelope && typeof envelope.body === 'string') {
      try {
        originalPayload = JSON.parse(atob(envelope.body));
      } catch {
        originalPayload = null;
      }
    }

    const redis = getRedis(env);
    if (redis && originalPayload) {
      const queued: QueuedOrder = {
        payload: originalPayload as OrderCreatePayload,
        attempts: REDIS_MAX_ATTEMPTS,
        firstQueuedAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
      };
      await redis.rpush(deadLetterKey, JSON.stringify(queued));
      console.error(
        `[qstash-failed] exhausted message ${envelope?.sourceMessageId ?? '?'} ` +
          `(status ${envelope?.status ?? '?'}) dead-lettered to ${deadLetterKey}`,
      );
    } else {
      // No Redis or undecodable body — at least log the raw envelope so the
      // order isn't lost without a trace to reconstruct from.
      console.error(
        `[qstash-failed] could not dead-letter (redis=${!!redis}, payload=${!!originalPayload}); ` +
          `envelope: ${JSON.stringify(envelope).slice(0, 2000)}`,
      );
    }
  } catch (err) {
    console.error('[qstash-failed] callback handler threw:', err);
  }
  // Ack regardless so QStash doesn't retry the callback.
  return corsResponse({ received: true }, 200);
}

// ── Redis Failover (last-resort defense-in-depth) ───────────────
// Fires only when BOTH the direct API call AND QStash fail. Orders sit on a
// Redis list until the per-minute healer cron drains them back to the API.

async function bufferToRedis(payload: OrderCreatePayload, env: Env): Promise<boolean> {
  const redis = getRedis(env);
  if (!redis) return false;

  const queued: QueuedOrder = {
    payload,
    attempts: 0,
    firstQueuedAt: new Date().toISOString(),
    lastAttemptAt: null,
  };

  try {
    await redis.rpush(REDIS_PENDING_KEY, JSON.stringify(queued));
    return true;
  } catch (err) {
    console.error('[redis-failover] rpush failed:', err);
    return false;
  }
}

/**
 * Reclaim items left in a processing list by a worker that crashed mid-replay.
 * Moves everything from `processingKey` back to the tail of `pendingKey` so the
 * current drain retries them. Runs before each drain; normally a no-op.
 */
async function reclaimProcessing(
  redis: Redis,
  processingKey: string,
  pendingKey: string,
): Promise<void> {
  // Bounded loop: lmove one-at-a-time from processing head → pending tail until
  // the processing list is empty. Atomic per move, so safe to interrupt.
  for (let i = 0; i < REDIS_DRAIN_BATCH_SIZE * 4; i += 1) {
    const moved = await redis.lmove(processingKey, pendingKey, 'left', 'right');
    if (moved === null || moved === undefined) break;
  }
}

// Drain up to REDIS_DRAIN_BATCH_SIZE pending orders back to the API. Called
// from the healer cron when the API has been observed healthy. Each order
// gets up to REDIS_MAX_ATTEMPTS retries before being moved to a dead-letter
// list for manual replay. Order semantics: FIFO within attempts, but a
// retried order goes to the tail so it doesn't block fresh ones.
//
// Crash-safety (Pillar-1): each item is moved ATOMICALLY from the pending list
// to an in-flight "processing" list (lmove) before its API replay. It only
// leaves processing once its terminal outcome is recorded (drained / requeued /
// dead-lettered). If the worker dies mid-replay, the item survives in
// processing and the next cron's reclaimProcessing() puts it back — so an order
// can never vanish in the lpop→work→rpush gap that the old code had.
async function drainRedisQueue(env: Env): Promise<{ drained: number; requeued: number; deadLettered: number }> {
  const redis = getRedis(env);
  if (!redis) return { drained: 0, requeued: 0, deadLettered: 0 };

  // Recover anything a prior crashed run left in-flight.
  await reclaimProcessing(redis, REDIS_PROCESSING_KEY, REDIS_PENDING_KEY);

  let drained = 0;
  let requeued = 0;
  let deadLettered = 0;

  for (let i = 0; i < REDIS_DRAIN_BATCH_SIZE; i += 1) {
    // Atomically move the head of pending onto the processing list. The item is
    // never absent from Redis, so a crash here loses nothing.
    const raw = (await redis.lmove(REDIS_PENDING_KEY, REDIS_PROCESSING_KEY, 'left', 'right')) as
      | string
      | Record<string, unknown>
      | null;
    if (raw === null || raw === undefined) break;

    // `raw` is the exact value now sitting in the processing list; use it verbatim
    // for the lrem that removes it, so the match can't miss on re-serialization.
    const removeFromProcessing = async () => {
      await redis.lrem(REDIS_PROCESSING_KEY, 1, raw as string);
    };

    let queued: QueuedOrder;
    try {
      // Upstash REST returns parsed JSON when the stored value is JSON-shaped.
      queued = typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown as QueuedOrder);
    } catch {
      // Corrupt entry — dead-letter and move on rather than block the queue.
      await redis.rpush(REDIS_DEAD_LETTER_KEY, raw as string);
      await removeFromProcessing();
      deadLettered += 1;
      continue;
    }

    queued.attempts += 1;
    queued.lastAttemptAt = new Date().toISOString();

    const apiResult = await forwardToApi(queued.payload as OrderCreatePayload, env);

    if (apiResult.ok) {
      await removeFromProcessing();
      drained += 1;
      continue;
    }

    if (queued.attempts >= REDIS_MAX_ATTEMPTS) {
      await redis.rpush(REDIS_DEAD_LETTER_KEY, JSON.stringify(queued));
      await removeFromProcessing();
      deadLettered += 1;
      console.error(
        `[redis-drain] dead-lettered after ${queued.attempts} attempts (first queued ${queued.firstQueuedAt})`,
      );
      continue;
    }

    // Push back to the pending tail with incremented attempts so fresh orders
    // aren't blocked, THEN remove from processing. Re-queue before remove so a
    // crash between the two leaves a harmless duplicate (reclaimed + retried;
    // the API's idempotency check dedups) rather than a lost order.
    await redis.rpush(REDIS_PENDING_KEY, JSON.stringify(queued));
    await removeFromProcessing();
    requeued += 1;
  }

  return { drained, requeued, deadLettered };
}

async function bufferCartToRedis(payload: CartSavePayload, env: Env): Promise<boolean> {
  const redis = getRedis(env);
  if (!redis) return false;

  const queued: QueuedOrder = {
    payload,
    attempts: 0,
    firstQueuedAt: new Date().toISOString(),
    lastAttemptAt: null,
  };

  try {
    await redis.rpush(REDIS_CART_PENDING_KEY, JSON.stringify(queued));
    return true;
  } catch (err) {
    console.error('[redis-failover] cart rpush failed:', err);
    return false;
  }
}

// Same crash-safe processing-list pattern as drainRedisQueue (see there).
async function drainRedisCartQueue(env: Env): Promise<{ drained: number; requeued: number; deadLettered: number }> {
  const redis = getRedis(env);
  if (!redis) return { drained: 0, requeued: 0, deadLettered: 0 };

  await reclaimProcessing(redis, REDIS_CART_PROCESSING_KEY, REDIS_CART_PENDING_KEY);

  let drained = 0;
  let requeued = 0;
  let deadLettered = 0;

  for (let i = 0; i < REDIS_CART_DRAIN_BATCH_SIZE; i += 1) {
    const raw = (await redis.lmove(REDIS_CART_PENDING_KEY, REDIS_CART_PROCESSING_KEY, 'left', 'right')) as
      | string
      | Record<string, unknown>
      | null;
    if (raw === null || raw === undefined) break;

    const removeFromProcessing = async () => {
      await redis.lrem(REDIS_CART_PROCESSING_KEY, 1, raw as string);
    };

    let queued: QueuedOrder;
    try {
      queued = typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown as QueuedOrder);
    } catch {
      await redis.rpush(REDIS_CART_DEAD_LETTER_KEY, raw as string);
      await removeFromProcessing();
      deadLettered += 1;
      continue;
    }

    queued.attempts += 1;
    queued.lastAttemptAt = new Date().toISOString();

    const apiResult = await forwardCartToApi(queued.payload as CartSavePayload, env);

    if (apiResult.ok) {
      await removeFromProcessing();
      drained += 1;
      continue;
    }

    if (queued.attempts >= REDIS_MAX_ATTEMPTS) {
      await redis.rpush(REDIS_CART_DEAD_LETTER_KEY, JSON.stringify(queued));
      await removeFromProcessing();
      deadLettered += 1;
      console.error(
        `[redis-drain] cart dead-lettered after ${queued.attempts} attempts (first queued ${queued.firstQueuedAt})`,
      );
      continue;
    }

    await redis.rpush(REDIS_CART_PENDING_KEY, JSON.stringify(queued));
    await removeFromProcessing();
    requeued += 1;
  }

  return { drained, requeued, deadLettered };
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
    .yannis-form-card .field-error{color:#dc2626;font-size:.75rem;margin:-0.75rem 0 .75rem;display:block}
    .yannis-form-card input.input-error,.yannis-form-card textarea.input-error,.yannis-form-card select.input-error{border-color:#dc2626}
    .yannis-form-card .yd.input-error .yd-trigger{border-color:#dc2626}
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
    .yannis-form-card .radio-group,.yannis-form-card .checkbox-group{display:flex;flex-direction:column;gap:.5rem;margin-bottom:.75rem}
    .yannis-form-card .radio-option,.yannis-form-card .checkbox-option{display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.875rem;font-weight:500;color:#333;text-transform:none;letter-spacing:normal;margin-bottom:0}
    .yannis-form-card .radio-option input[type=radio],.yannis-form-card .checkbox-option input[type=checkbox]{accent-color:${accentColor};width:18px;height:18px;flex-shrink:0;margin:0;cursor:pointer}
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
    .yd{position:relative;margin-bottom:1rem}
    .yd-trigger{width:100%;padding:.625rem .75rem;border:1px solid #ddd;border-radius:8px;font-size:.875rem;font-family:inherit;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:border-color .2s;text-align:left;color:#111}
    .yd-trigger:focus{outline:none;border-color:${accentColor}}
    .yd-trigger.placeholder{color:#999}
    .yd-arrow{width:10px;height:10px;border-right:2px solid #999;border-bottom:2px solid #999;transform:rotate(45deg);flex-shrink:0;transition:transform .2s}
    .yd.open .yd-arrow{transform:rotate(-135deg)}
    .yd-panel{display:none;position:absolute;left:0;right:0;top:100%;margin-top:2px;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:50;max-height:240px;overflow:hidden;flex-direction:column}
    .yd.open .yd-panel{display:flex}
    .yd-search{padding:.5rem .75rem;border:none;border-bottom:1px solid #eee;font-size:.875rem;font-family:inherit;outline:none;width:100%;box-sizing:border-box;flex-shrink:0}
    .yd-search:focus{border-bottom-color:${accentColor}}
    .yd-list{overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1}
    .yd-opt{padding:.625rem .75rem;cursor:pointer;font-size:.875rem;transition:background .15s}
    .yd-opt:hover,.yd-opt:focus{background:#f3f4f6;outline:none}
    .yd-opt.active{background:${accentColor}12;color:${accentColor};font-weight:600}
    .yd-opt.hidden{display:none}
    .yd-empty{padding:.75rem;text-align:center;color:#999;font-size:.8125rem}
    @media (max-width:480px){
      body{padding:.5rem!important;align-items:flex-start}
      .yd-trigger{font-size:16px;padding:.5rem .625rem}
      .yd-search{font-size:16px}
      .yd-opt{padding:.75rem}
    }
  `;
}

// ── Form Script (shared across all modes) ──────────────────────

function getFormScript(
  workerUrl: string,
  campaignId: string,
  products: CampaignConfig['products'],
  mediaBuyerId?: string,
  formMode: 'hosted' | 'embedded' | 'iframe' | 'fallback' = 'hosted',
): string {
  // JSON-encode rather than raw single-quote wrap so a stray quote in the id
  // can't break out of the script string (defense-in-depth; ids are UUIDs).
  const mediaBuyerIdJson = mediaBuyerId ? safeJsonForScript(mediaBuyerId) : 'undefined';
  const campaignIdJson = safeJsonForScript(campaignId);
  // hosted / iframe / fallback are served BY the worker, so `/cart` and
  // `/submit` resolve to the same origin (= the worker) automatically. Only
  // embed.js runs inside a third-party page where relative paths would hit
  // the host site, so it needs the absolute worker URL.
  const endpointBase = formMode === 'embedded' ? workerUrl : '';
  return `
    (function() {
      // ── Form Analytics beacon (fire-and-forget) ──────────────────────────
      // Records a form landing + dwell time. FULLY isolated from the form: the
      // entire block is wrapped in try/catch, uses navigator.sendBeacon (never
      // fetch/await, so it cannot block or delay render or submit), and its
      // response is ignored. If crypto/sendBeacon is missing or anything throws,
      // it is skipped and the form behaves exactly as before. The generated
      // sessionId is stashed on window so /cart and /submit can (optionally) carry
      // it for view→order attribution; if it stays undefined, submission is
      // unaffected. This must NEVER be able to break the frozen intake path.
      try {
        // Persist the visitor id in localStorage so a refresh/return by the same
        // person REUSES it: "All form views" (COUNT(*)) still +1 per load, while
        // "Unique form views" (COUNT DISTINCT session_id) counts that person once.
        // localStorage access is wrapped — private mode / blocked storage falls back
        // to a fresh per-load id, which is still valid (just not deduped).
        var __yid = null;
        try {
          __yid = window.localStorage ? localStorage.getItem('yannis_vid') : null;
          if (!__yid && window.crypto && crypto.randomUUID) {
            __yid = crypto.randomUUID();
            if (window.localStorage) localStorage.setItem('yannis_vid', __yid);
          }
        } catch (e) {
          // storage blocked — fall back to a volatile per-load id
          __yid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
        }
        var __ystart = Date.now();
        window.__yannisSessionId = __yid || undefined;
        if (__yid && navigator.sendBeacon) {
          navigator.sendBeacon(${JSON.stringify(endpointBase)} + '/track-view',
            JSON.stringify({ sessionId: __yid, campaignId: ${campaignIdJson}, mediaBuyerId: ${mediaBuyerIdJson}, deploymentType: ${JSON.stringify(formMode)} }));
        }
        var __ysent = false;
        var __yleave = function() {
          if (__ysent || !__yid || !navigator.sendBeacon) return;
          __ysent = true;
          try {
            navigator.sendBeacon(${JSON.stringify(endpointBase)} + '/track-view',
              JSON.stringify({ sessionId: __yid, dwellMs: Date.now() - __ystart }));
          } catch (e) {}
        };
        document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') __yleave(); });
        window.addEventListener('pagehide', __yleave);
      } catch (e) { /* tracking must never break the form */ }

      var form = document.getElementById('yannisOrderForm');
      var msg = document.getElementById('yannisMsg');
      var btn = document.getElementById('yannisSubmitBtn');
      var selectedProduct = null;
      var selectedOffer = null;
      var products = ${safeJsonForScript(products)};
      var card = form ? form.closest('.yannis-form-card') : null;
      var singleProductId = form ? form.dataset.singleProduct : null;

      // ── Multi-currency (additive; no-op when single-currency) ──────────────
      var currencyList = [];
      try { currencyList = JSON.parse((form && form.dataset.currencyMeta) || '[]') || []; } catch (e) { currencyList = []; }
      var currentCurrency = (form && form.dataset.initialCurrency) || 'NGN';
      var baseCurrency = null;
      for (var _ci = 0; _ci < currencyList.length; _ci++) { if (currencyList[_ci].isDefault) { baseCurrency = currencyList[_ci]; break; } }
      if (!baseCurrency && currencyList.length) baseCurrency = currencyList[0];
      function currencyInfo(code) {
        for (var i = 0; i < currencyList.length; i++) { if (currencyList[i].code === code) return currencyList[i]; }
        return baseCurrency || { code: code, symbol: '', precision: 2, isDefault: true };
      }
      // Price of an offer in the current currency (base price when base/absent).
      function offerPrice(offer) {
        if (!offer) return '0';
        if (baseCurrency && currentCurrency === baseCurrency.code) return offer.price;
        if (offer.pricesByCurrency && offer.pricesByCurrency[currentCurrency] != null) return offer.pricesByCurrency[currentCurrency];
        return offer.price; // fall back to base price — never breaks submission
      }
      function formatMoneyClient(amount, code) {
        var info = currencyInfo(code);
        var num = parseFloat(amount);
        if (isNaN(num)) return String(amount);
        return (info.symbol || '') + num.toLocaleString('en-US');
      }
      // Re-render every visible offer price + total to the current currency.
      function rerenderCurrencyPrices() {
        var radios = document.querySelectorAll('.offer-radio');
        for (var i = 0; i < radios.length; i++) {
          var r = radios[i];
          var od = null; try { od = JSON.parse(r.dataset.offer); } catch (e) { od = null; }
          if (!od) continue;
          var span = r.closest('.offer-option') ? r.closest('.offer-option').querySelector('.offer-price') : null;
          if (span) span.textContent = formatMoneyClient(offerPrice(od), currentCurrency);
        }
      }
      var successPanel = null;

      // Funnel navigation for success / payment redirects. In iframe mode the
      // form is sandboxed inside the customer's page — a plain window.location
      // would only move the iframe, so the thank-you page (and the Media
      // Buyer's conversion pixel on it) never gets a real top-level pageview.
      // Navigate the TOP window instead. Hosted / shadow-DOM / fallback modes
      // already run in the page itself, so window.location is correct there.
      function yannisGo(url) {
        ${
          formMode === 'iframe'
            ? 'try { (window.top || window).location.href = url; } catch (e) { window.location.href = url; }'
            : 'window.location.href = url;'
        }
      }

      function resetForAnotherOrder() {
        if (!form) return;
        // Re-enable cart saves for the new order and clear stale cart ID.
        cartSaveDisabled = false;
        savedCartId = null;
        form.reset();
        // Reset custom dropdowns back to placeholder state.
        document.querySelectorAll('[data-yd]').forEach(function(yd) { if (yd._ydReset) yd._ydReset(); });
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

      // Currency switcher — re-price the visible offers on change. Additive: only
      // present when the API supplied 2+ currencies and the MB enabled it.
      var currencySwitcherEl = document.getElementById('currencySwitcher');
      if (currencySwitcherEl) {
        currentCurrency = currencySwitcherEl.value || currentCurrency;
        currencySwitcherEl.addEventListener('change', function() {
          currentCurrency = currencySwitcherEl.value || currentCurrency;
          rerenderCurrencyPrices();
        });
      }
      // Initial paint in the starting currency (no-op for base/single-currency).
      if (currencyList.length > 1) rerenderCurrencyPrices();

      // ── Country-aware phone input ─────────────────────────────────────────
      // Apply the phone placeholder/pattern/hint for the selected country so a
      // Ghana form accepts Ghanaian numbers. Rules come from data-phone-rules
      // (COUNTRY_PHONE_RULES); unknown countries keep the current attributes.
      var _phoneRules = {};
      try { _phoneRules = JSON.parse((form && form.dataset.phoneRules) || '{}') || {}; } catch (e) { _phoneRules = {}; }
      function applyPhoneRule(country) {
        var rule = _phoneRules[country];
        if (!rule) return;
        var pEl = document.getElementById('customerPhone') || form.querySelector('[name="customerPhone"]');
        if (!pEl) return;
        pEl.setAttribute('placeholder', rule.example || '');
        pEl.setAttribute('pattern', '^' + (rule.pattern || '') + '$');
        pEl.setAttribute('title', 'Enter a valid ' + (rule.country || country) + ' phone number, e.g. ' + (rule.example || '') + ' or ' + (rule.exampleIntl || ''));
        pEl.setAttribute('data-phone-country', rule.country || country);
      }
      // Seed the phone rule from the form's initial country on load.
      try { applyPhoneRule((form && form.dataset.initialCountry) || ''); } catch (e) {}

      // ── Country picker (additive; no-op when single-country) ──────────────
      // Changing country rebuilds the Delivery State options and switches the
      // currency to that country's currency (which re-prices the offers).
      var countrySwitcherEl = document.getElementById('countrySwitcher');
      if (countrySwitcherEl) {
        var _csWrap = countrySwitcherEl.closest('.country-switcher');
        var _regionsByCountry = {};
        var _countryToCurrency = {};
        try { _regionsByCountry = JSON.parse((_csWrap && _csWrap.dataset.regions) || '{}') || {}; } catch (e) {}
        try { _countryToCurrency = JSON.parse((_csWrap && _csWrap.dataset.countryCurrency) || '{}') || {}; } catch (e) {}
        // Rebuild the Delivery State dropdown options for a country using the
        // widget's own _ydSetOptions hook (exposed in the [data-yd] init below).
        function applyCountryRegions(country) {
          var regions = _regionsByCountry[country] || [];
          var hidden = document.getElementById('deliveryState');
          if (!hidden) return;
          var yd = hidden.closest('[data-yd]');
          if (yd && yd._ydSetOptions) {
            yd._ydSetOptions(regions.map(function(r) { return { value: r, label: r }; }));
          }
        }
        countrySwitcherEl.addEventListener('change', function() {
          var country = countrySwitcherEl.value;
          applyCountryRegions(country);
          applyPhoneRule(country);
          // Switch currency to this country's currency (re-prices offers).
          var code = _countryToCurrency[country];
          if (code && currencySwitcherEl) {
            currencySwitcherEl.value = code;
            currentCurrency = code;
            rerenderCurrencyPrices();
          }
        });
      }

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
            fetch('${endpointBase}/submit', {
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
      var cartSaveInflight = null; // Promise of the in-flight cart save
      var cartSaveDisabled = false; // kill switch — set after successful submit
      var CART_DEBOUNCE_MS = 3000;
      var lastCartPayloadJson = ''; // dedup: skip save if payload is identical to last
      function isValidNgPhone(value) {
        return NG_PHONE_RE.test((value || '').trim());
      }
      function maybeSaveCart() {
        if (cartSaveDisabled) return;
        var nameEl = form.querySelector('#customerName') || form.querySelector('[name="customerName"]');
        var phoneEl = form.querySelector('#customerPhone') || form.querySelector('[name="customerPhone"]');
        if (!phoneEl) return;
        var name = nameEl ? (nameEl.value || '').trim() : '';
        // Gate on a real Nigerian phone only — product/offer/name are progressive.
        // Name is optional; defaults to "Unknown" on the API side.
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
        // Skip if a cart save is already in flight — the next debounce
        // tick after it completes will pick up the latest field values.
        if (cartSaveInflight) return;
        cartSaveTimeout = setTimeout(function() {
          if (cartSaveInflight) return; // double-check at fire time
          var payload = {
            campaignId: ${campaignIdJson},
            mediaBuyerId: ${mediaBuyerIdJson},
            customerPhone: phoneEl.value
          };
          // Progressive — include product/offer only once the customer selected them.
          if (selectedProduct) payload.productId = selectedProduct;
          if (selectedOffer && selectedOffer.label) payload.offerLabel = selectedOffer.label;
          // Name is optional — phone alone captures the cart.
          if (name.length >= 1) payload.customerName = name;
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
          // Frozen currency the customer selected. Stamped additively from the
          // same currentCurrency the ORDER payload uses (line ~2138), so a cart
          // and its eventual order share a currency. STAMP-never-reject: absent
          // is fine, the API defaults to NGN and never rejects on it.
          if (currentCurrency) payload.currencyCode = currentCurrency;
          // Form Analytics attribution — optional. Can't throw; if unset the API strips it.
          if (window.__yannisSessionId) payload.sessionId = window.__yannisSessionId;
          // Dedup: skip the network call if the payload is identical to the last
          // successful save. Avoids redundant /cart hits on progressive-capture
          // re-fires where nothing actually changed.
          var payloadJson = JSON.stringify(payload);
          if (payloadJson === lastCartPayloadJson) { return; }
          cartSaveInflight = fetch('${endpointBase}/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadJson
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d.id) {
              savedCartId = d.id;
            } else if (d.buffered && !savedCartId) {
              // Failover accepted the cart without an id yet — still unlock
              // progressive field listeners so later typing is not dropped.
              savedCartId = 'buffered';
            }
            lastCartPayloadJson = payloadJson;
            cartSaveInflight = null;
            // Fields may have changed while in-flight — schedule one more save.
            maybeSaveCart();
          }).catch(function() { cartSaveInflight = null; });
        }, CART_DEBOUNCE_MS);
      }
      // Trigger save on input/blur for every field the form might collect —
      // address, state, email, etc. — not just name/phone. The function gates
      // on name + valid phone before issuing a request, so empty progressive
      // fields are harmless. Use event delegation on the form so dynamically
      // rendered fields (custom builder fields) are covered automatically.
      // Flush any pending debounce immediately — used before form submit and on
      // page-leave events to maximise cart capture. Returns the in-flight
      // promise (if any) so callers can await it.
      function flushCartSave() {
        if (cartSaveDisabled) return cartSaveInflight;
        // If a debounce is pending, cancel it and fire immediately.
        if (cartSaveTimeout) {
          clearTimeout(cartSaveTimeout);
          cartSaveTimeout = null;
          // Re-invoke with debounce set to 0 so the setTimeout fires on the
          // next microtask. We temporarily override the debounce window.
          var origDebounce = CART_DEBOUNCE_MS;
          CART_DEBOUNCE_MS = 0;
          maybeSaveCart();
          CART_DEBOUNCE_MS = origDebounce;
        }
        return cartSaveInflight;
      }
      // Capture cart on page-leave — covers users who fill name+phone then
      // navigate away or close the tab before the debounce fires.
      function onPageLeave() { flushCartSave(); }
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') onPageLeave();
      });
      window.addEventListener('pagehide', onPageLeave);
      // Primary trigger: phone field input/blur fires the initial cart save.
      // Progressive trigger: other fields only fire maybeSaveCart after the
      // first cart has been saved (savedCartId is set), so typing in name/
      // address/etc. doesn't reset the debounce before the phone is even entered.
      var phoneInput2 = form.querySelector('#customerPhone') || form.querySelector('[name="customerPhone"]');
      if (phoneInput2) {
        phoneInput2.addEventListener('input', maybeSaveCart);
        phoneInput2.addEventListener('blur', maybeSaveCart);
      }
      // Name field also triggers — captures the name progressively after the
      // initial phone-only cart save.
      var nameInput2 = form.querySelector('#customerName') || form.querySelector('[name="customerName"]');
      if (nameInput2) {
        nameInput2.addEventListener('input', maybeSaveCart);
        nameInput2.addEventListener('blur', maybeSaveCart);
      }
      // All other fields: only trigger progressive updates after initial save.
      form.addEventListener('input', function(ev) {
        if (!savedCartId) return; // no cart yet — wait for phone
        var t = ev.target;
        if (t === phoneInput2 || t === nameInput2) return; // already handled above
        maybeSaveCart();
      });
      form.addEventListener('blur', function(ev) {
        if (!savedCartId) return;
        var t = ev.target;
        if (t === phoneInput2 || t === nameInput2) return;
        maybeSaveCart();
      }, true);
      // phoneInput is still consumed by the phone validation + sanitizer block
      // below — keep the local handle even though save listening is delegated to
      // the form element above.
      var phoneInput = form.querySelector('#customerPhone') || form.querySelector('[name="customerPhone"]');

      // Inline phone validation — show a friendly error below the input on blur
      // if the value is filled but invalid. Cleared on input.
      if (phoneInput) {
        var phoneError = document.createElement('p');
        phoneError.className = 'field-error';
        phoneError.style.cssText = 'color:#dc2626;font-size:0.875rem;margin:0.25rem 0 0;display:none;';
        // Country-aware hint: mirror the input's own title (set per country).
        function _phoneHint() {
          return phoneInput.getAttribute('title') || 'Enter a valid phone number.';
        }
        // Validate against the input's LIVE pattern (set per country), falling
        // back to the Nigerian validator if no pattern is present.
        function _phoneOk(v) {
          var pat = phoneInput.getAttribute('pattern');
          if (pat) {
            try { return new RegExp('^(?:' + pat + ')$').test(v); } catch (e) {}
          }
          return isValidNgPhone(v);
        }
        phoneError.textContent = _phoneHint();
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
          // Loosened cap so non-Nigerian numbers fit: E.164 max is 15 digits.
          // With a leading '+' the dial code is included, so allow up to 15;
          // without '+', a national number never exceeds ~13.
          var maxDigits = hadPlus ? 15 : 13;
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
          phoneError.textContent = _phoneHint();
          phoneError.style.display = v.length > 0 && !_phoneOk(v) ? '' : 'none';
        });
        phoneInput.addEventListener('input', function() {
          if (phoneError.style.display !== 'none') phoneError.style.display = 'none';
        });
      }

      // ── Custom phone field validation (same as main phone) ──
      document.querySelectorAll('[data-yannis-cf-type="phone"]').forEach(function(cfPhone) {
        var cfPhoneError = cfPhone.nextElementSibling;
        if (!cfPhoneError || !cfPhoneError.classList.contains('phone-error')) return;
        cfPhone.addEventListener('blur', function() {
          var v = (cfPhone.value || '').trim();
          cfPhoneError.style.display = v.length > 0 && !isValidNgPhone(v) ? '' : 'none';
        });
        cfPhone.addEventListener('input', function() {
          if (cfPhoneError.style.display !== 'none') cfPhoneError.style.display = 'none';
        });
      });

      // ── Custom dropdown (yd) initialisation ──
      document.querySelectorAll('[data-yd]').forEach(function(yd) {
        var trigger = yd.querySelector('.yd-trigger');
        var panel = yd.querySelector('.yd-panel');
        var label = yd.querySelector('.yd-label');
        var hidden = yd.querySelector('input[type="hidden"]');
        var search = yd.querySelector('.yd-search');
        var opts = yd.querySelectorAll('.yd-opt');

        function openPanel() {
          yd.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
          if (search) { search.value = ''; filterOpts(''); search.focus(); }
        }
        function closePanel() {
          yd.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
        }
        function selectOpt(opt) {
          var val = opt.getAttribute('data-value');
          hidden.value = val;
          label.textContent = opt.textContent;
          trigger.classList.remove('placeholder');
          opts.forEach(function(o) { o.classList.remove('active'); });
          opt.classList.add('active');
          closePanel();
          // Clear inline error on selection
          yd.classList.remove('input-error');
          var errEl = yd.nextElementSibling;
          if (errEl && errEl.classList.contains('field-error')) errEl.remove();
          // Fire change event so existing listeners (e.g. payment method → email toggle) work.
          var evt = document.createEvent('HTMLEvents');
          evt.initEvent('change', true, false);
          hidden.dispatchEvent(evt);
        }
        function resetDropdown() {
          hidden.value = '';
          label.textContent = trigger.getAttribute('data-placeholder') || label.textContent;
          trigger.classList.add('placeholder');
          opts.forEach(function(o) { o.classList.remove('active'); o.classList.remove('hidden'); });
          if (search) search.value = '';
        }
        function filterOpts(q) {
          var lower = q.toLowerCase();
          var anyVisible = false;
          opts.forEach(function(o) {
            var match = !lower || o.textContent.toLowerCase().indexOf(lower) !== -1;
            o.classList.toggle('hidden', !match);
            if (match) anyVisible = true;
          });
          var empty = yd.querySelector('.yd-empty');
          if (!anyVisible && !empty) {
            empty = document.createElement('div');
            empty.className = 'yd-empty';
            empty.textContent = 'No matches';
            yd.querySelector('.yd-list').appendChild(empty);
          } else if (anyVisible && empty) {
            empty.remove();
          }
        }

        // Store original placeholder for reset.
        trigger.setAttribute('data-placeholder', label.textContent);

        trigger.addEventListener('click', function(e) {
          e.preventDefault();
          if (yd.classList.contains('open')) { closePanel(); } else { openPanel(); }
        });
        opts.forEach(function(opt) {
          opt.addEventListener('click', function() { selectOpt(opt); });
        });
        if (search) {
          search.addEventListener('input', function() { filterOpts(search.value); });
          // Prevent form submit on Enter inside search.
          search.addEventListener('keydown', function(e) { if (e.key === 'Enter') e.preventDefault(); });
        }
        // Close on outside click.
        document.addEventListener('click', function(e) {
          if (!yd.contains(e.target)) closePanel();
        });
        // Expose reset for form.reset().
        yd._ydReset = resetDropdown;
        // Expose a rebuild hook so the country picker can swap this dropdown's
        // options (e.g. Delivery State to Ghana regions). Regenerates .yd-opt
        // nodes, refreshes the captured opts list, and rebinds click + reset.
        yd._ydSetOptions = function(newOptions) {
          var list = yd.querySelector('.yd-list');
          if (!list) return;
          // Remove existing options + any empty state.
          list.querySelectorAll('.yd-opt').forEach(function(o) { o.remove(); });
          var emptyEl = yd.querySelector('.yd-empty'); if (emptyEl) emptyEl.remove();
          (newOptions || []).forEach(function(o) {
            var d = document.createElement('div');
            d.className = 'yd-opt';
            d.setAttribute('role', 'option');
            d.setAttribute('data-value', o.value);
            d.textContent = o.label;
            list.appendChild(d);
          });
          // Refresh the captured opts list + rebind clicks.
          opts = yd.querySelectorAll('.yd-opt');
          opts.forEach(function(opt) { opt.addEventListener('click', function() { selectOpt(opt); }); });
          resetDropdown();
        };
      });

      // Clear inline errors on regular inputs when user starts typing
      form.querySelectorAll('input[required], textarea[required]').forEach(function(inp) {
        inp.addEventListener('input', function() {
          inp.classList.remove('input-error');
          var errEl = inp.nextElementSibling;
          if (errEl && errEl.classList.contains('field-error')) errEl.remove();
        });
      });

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
        // Flush any pending cart save so the cart row exists before the order
        // is created — this ensures savedCartId is populated and the API can
        // link the order to the cart. The flush is fire-and-forget (we don't
        // block submit on it) but with a 0ms debounce override it fires on the
        // next microtask, well ahead of the network round-trip for the order.
        flushCartSave();
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
        // Validate custom phone fields — same Nigerian phone check as the main phone.
        var cfPhoneInputs = form.querySelectorAll('[data-yannis-cf-type="phone"]');
        for (var pi = 0; pi < cfPhoneInputs.length; pi++) {
          var cfPh = cfPhoneInputs[pi];
          var cfPhVal = (cfPh.value || '').trim();
          if (cfPhVal.length > 0 && !isValidNgPhone(cfPhVal)) {
            var cfPhLabel = form.querySelector('label[for="' + cfPh.id + '"]');
            cfPhLabel = cfPhLabel ? cfPhLabel.textContent : 'Phone';
            msg.className = 'msg msg-error';
            msg.textContent = (cfPhLabel || 'Phone').replace(/\\s*\\*\\s*$/, '').trim() + ': enter a valid Nigerian phone number';
            btn.disabled = false;
            btn.textContent = form.dataset.btnText || 'Submit Order';
            cfPh.focus();
            return;
          }
        }

        // Validate required standard fields (hidden inputs from custom dropdowns
        // bypass native browser validation since we use e.preventDefault).
        // Clear previous inline errors
        var prevErrors = form.querySelectorAll('.field-error');
        for (var pe = 0; pe < prevErrors.length; pe++) prevErrors[pe].remove();
        var prevInvalid = form.querySelectorAll('.input-error');
        for (var pi2 = 0; pi2 < prevInvalid.length; pi2++) prevInvalid[pi2].classList.remove('input-error');

        var reqInputs = form.querySelectorAll('input[required], textarea[required], select[required]');
        var firstInvalid = null;
        var missingLabels = [];
        for (var ri = 0; ri < reqInputs.length; ri++) {
          var reqEl = reqInputs[ri];
          var reqVal = (reqEl.value || '').trim();
          if (!reqVal) {
            var fieldLabel = reqEl.name || 'field';
            var assocLabel = form.querySelector('label[for="' + reqEl.id + '"]');
            if (assocLabel) fieldLabel = assocLabel.textContent.replace(/\\s*\\*\\s*$/, '').trim();
            missingLabels.push(fieldLabel);
            // Add inline error below field
            var ydParent = reqEl.closest('[data-yd]');
            var errorEl = document.createElement('span');
            errorEl.className = 'field-error';
            errorEl.textContent = fieldLabel + ' is required.';
            if (ydParent) {
              ydParent.classList.add('input-error');
              ydParent.insertAdjacentElement('afterend', errorEl);
              if (!firstInvalid) firstInvalid = ydParent;
            } else {
              reqEl.classList.add('input-error');
              reqEl.insertAdjacentElement('afterend', errorEl);
              if (!firstInvalid) firstInvalid = reqEl;
            }
          }
        }
        if (missingLabels.length > 0) {
          msg.className = 'msg msg-error';
          msg.textContent = missingLabels.length === 1
            ? missingLabels[0] + ' is required.'
            : 'Please fill in: ' + missingLabels.join(', ') + '.';
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
          if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }

        // Kill further cart saves only after client validation passes —
        // otherwise a failed click would permanently stop abandonment capture.
        cartSaveDisabled = true;

        var orderData = {
          campaignId: ${campaignIdJson},
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
          // Currency-aware price (base price for base/single-currency → identical to
          // before). currencyCode is stamped additively; the API defaults it to NGN
          // if absent and NEVER rejects on it (edge-freeze rule).
          items: [{ productId: selectedProduct, quantity: selectedOffer.qty, unitPrice: offerPrice(selectedOffer), offerLabel: selectedOffer.label }],
          cartId: savedCartId || undefined,
          totalAmount: offerPrice(selectedOffer).toString(),
          currencyCode: currentCurrency || undefined,
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
          // Form Analytics attribution — optional. If unset, the API strips it; order is unaffected.
          sessionId: window.__yannisSessionId || undefined
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
          return fetch('${endpointBase}/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }).then(function(res) {
            return res.json().then(function(d) { return { ok: res.ok, status: res.status, data: d }; });
          });
        }

        // Wait for any in-flight cart save to finish so savedCartId is set
        // before we build the order payload. The promise resolves instantly if
        // nothing is in flight. Cap the wait at 2s to avoid blocking submit.
        var cartWait = cartSaveInflight
          ? Promise.race([cartSaveInflight, new Promise(function(r) { setTimeout(r, 2000); })])
          : Promise.resolve();
        cartWait.then(function() {
          // Re-read cartId after flush — it may have been set while we waited.
          orderData.cartId = savedCartId || undefined;
          return submitOrder(orderData);
        }).then(function(result) {
          if (result.ok) {
            // Kill cart saves — order is submitted, any further input/blur events
            // (including form.reset()) must NOT create or update cart rows.
            cartSaveDisabled = true;
            clearTimeout(cartSaveTimeout);
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
              yannisGo(authUrl);
              return;
            }
            // Optional Media Buyer success callback — redirects to their funnel's thank-you page.
            // Validated as a full URL on save; redirect only if it parses as http(s).
            var callbackUrl = (form.dataset.successCallback || '').trim();
            if (callbackUrl && /^https?:\\/\\//i.test(callbackUrl)) {
              yannisGo(callbackUrl);
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
            // Parse validation errors into friendly messages instead of showing raw JSON
            var rawError = result.data.error || '';
            var friendlyError = 'Something went wrong. Please try again.';
            if (typeof rawError === 'string' && rawError.length > 0) {
              try {
                var parsed = JSON.parse(rawError);
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].message) {
                  friendlyError = parsed.map(function(e) { return e.message; }).join('. ') + '.';
                } else {
                  friendlyError = rawError;
                }
              } catch(_) {
                friendlyError = rawError;
              }
            }
            msg.textContent = friendlyError;
            // Submit failed — keep capturing carts while the customer retries.
            cartSaveDisabled = false;
          }
        }).catch(function() {
          // Network failed — save offline
          cartSaveDisabled = false;
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
    // Delivery address + state are always shown — basic required fields.
    if (key === 'deliveryAddress') return true;
    if (key === 'deliveryState') return true;
    if (hasStandard) return standard.has(key);
    if (key === 'deliveryNotes') return fc.showDeliveryNotes === true;
    if (key === 'gender') return fc.showGender === true;
    if (key === 'preferredDeliveryDate') return fc.showPreferredDeliveryDate === true;
    if (key === 'customerEmail') return fc.showCustomerEmail === true;
    return fc.showPaymentMethod === true;
  };
  const requiredField = (key: StdFieldKey) => {
    // Delivery address + state are always required — basic required fields.
    if (key === 'deliveryAddress') return true;
    if (key === 'deliveryState') return true;
    if (hasStandard) return standard.get(key)?.required === true;
    if (key === 'deliveryNotes') return fc.requireDeliveryNotes === true;
    if (key === 'gender') return fc.requireGender === true;
    if (key === 'preferredDeliveryDate') return fc.requirePreferredDeliveryDate === true;
    if (key === 'customerEmail') return fc.requireCustomerEmail === true;
    return fc.requirePaymentMethod === true;
  };
  const standardLabel = (key: StdFieldKey) => standard.get(key)?.label ?? defaultStandardLabels[key];
  const showPaymentMethod = showField('paymentMethod');
  const showStandaloneEmail = showField('customerEmail');
  const showProductImages = fc.showProductImages !== false;

  // Multi-currency: switcher only appears when the API supplied 2+ currencies AND
  // the MB toggled it on. Otherwise everything below is single-currency (base),
  // byte-identical to today. `baseCurrency` is the default; `pinnedCurrency`
  // selects a single non-base currency when the switcher is off.
  const currencyList = Array.isArray(config.currencies) ? config.currencies : [];
  const baseCurrency = currencyList.find((c) => c.isDefault) ?? currencyList[0];
  const showCurrencySwitcher = currencyList.length > 1 && fc.allowMultiCurrency === true;
  // pinnedCurrency = the form's chosen DEFAULT/starting currency. Honoured whether
  // the switcher is on (customer starts here, can switch) or off (form stays here).
  const chosenCurrency = fc.pinnedCurrency
    ? currencyList.find((c) => c.code === fc.pinnedCurrency)?.code
    : undefined;
  // The currency the form STARTS in (and, when the switcher is off, stays in).
  const initialCurrency = chosenCurrency ?? baseCurrency?.code ?? 'NGN';

  // Country selection: a picker appears only when the API supplied region lists
  // for 2+ countries AND the MB toggled it on. Otherwise single-country (locked),
  // byte-identical to today. Picking a country swaps the delivery-state list and
  // (when priced) the currency.
  const regionsByCountry = (config.regionsByCountry ?? {}) as Record<string, string[]>;
  const countryList = Object.keys(regionsByCountry);
  const showCountrySwitcher = countryList.length > 1 && fc.allowCountrySelection === true;
  // The country the form STARTS in (locked country when the picker is off).
  const initialCountry =
    (fc.deliveryCountry && regionsByCountry[fc.deliveryCountry] ? fc.deliveryCountry : undefined) ??
    // Fall back to the base currency's country, else the first configured country.
    currencyList.find((c) => c.isDefault)?.countryName ??
    countryList[0] ??
    '';
  // Map country → currency code (for the picker's country→currency cascade).
  const countryToCurrency: Record<string, string> = {};
  for (const c of currencyList) {
    if (c.countryName && !countryToCurrency[c.countryName]) countryToCurrency[c.countryName] = c.code;
  }
  // Phone rule for the form's starting country (drives the input's placeholder,
  // pattern + hint). Client JS re-applies the matching rule on country change,
  // reading COUNTRY_PHONE_RULES from a data attribute (see data-phone-rules).
  const initialPhoneRule = phoneRuleForCountry(initialCountry);

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
      // Additive: `pricesByCurrency` rides along in data-offer so the client can
      // pick the price for the chosen currency. Absent for single-currency offers.
      const offerPayload: { label: string; qty: number; price: string; pricesByCurrency?: Record<string, string> } = {
        label: o.label,
        qty: o.qty,
        price: o.price,
      };
      const pbc = (o as ProductOffer).pricesByCurrency;
      if (pbc && Object.keys(pbc).length > 0) offerPayload.pricesByCurrency = pbc;
      return `<label class="offer-option">
        <input type="radio" name="${radioName}" class="offer-radio"
          data-offer='${JSON.stringify(offerPayload).replace(/'/g, '&#39;')}'>
        ${thumbHtml}
        <span class="offer-body">
          <span class="offer-label">${escapeHtml(o.label)}</span>
          <span class="offer-details">
            <span class="offer-qty">${o.qty} unit${o.qty > 1 ? 's' : ''}</span>
            <span class="offer-price" data-base-price="${escapeHtml(o.price)}">${formatPrice(o.price)}</span>
          </span>
        </span>
      </label>`;
    }).join('\n');

    const display = hasSingleProduct ? 'flex' : 'none';
    return `<div id="offers-${p.id}" class="offer-group offer-selector" style="display:${display}">${offersHtml}</div>`;
  }).join('\n');

  // The whole "Select Offer" block. Placed by its `offer` field-order token so
  // the form builder can position it anywhere (defaults to the bottom).
  // Currency switcher — rendered only when enabled; otherwise empty string (no
  // DOM change vs today). Options list every supplied currency by "SYMBOL CODE".
  const currencySwitcherHtml = showCurrencySwitcher
    ? `<div class="currency-switcher" style="margin-bottom:12px">
        <label for="currencySwitcher">Currency</label>
        <select id="currencySwitcher" name="currencySwitcher">
          ${currencyList
            .map(
              (c) =>
                `<option value="${escapeHtml(c.code)}"${c.code === initialCurrency ? ' selected' : ''}>${escapeHtml(c.symbol)} ${escapeHtml(c.code)}</option>`,
            )
            .join('')}
        </select>
      </div>`
    : '';

  // Country picker — customer chooses their country; the delivery-state list and
  // (when priced) the currency follow. Only when enabled; else no DOM change.
  const countrySwitcherHtml = showCountrySwitcher
    ? `<div class="country-switcher" style="margin-bottom:12px" data-regions='${escapeHtml(JSON.stringify(regionsByCountry))}' data-country-currency='${escapeHtml(JSON.stringify(countryToCurrency))}'>
        <label for="countrySwitcher">Country</label>
        <select id="countrySwitcher" name="countrySwitcher">
          ${countryList
            .map((country) => `<option value="${escapeHtml(country)}"${country === initialCountry ? ' selected' : ''}>${escapeHtml(country)}</option>`)
            .join('')}
        </select>
      </div>`
    : '';

  const offerSelectionHtml = `${countrySwitcherHtml}${currencySwitcherHtml}<label>Select Offer</label>
      ${offerGroupsHtml}`;

  // If single product, auto-set selectedProduct via hidden data attribute
  const firstProduct = config.products[0];
  const singleProductAttr = hasSingleProduct && firstProduct ? ` data-single-product="${firstProduct.id}"` : '';
  const orderedFormInfoHtml = resolvedFieldOrder
    .map((token) => {
      if (token === 'fixed.fullName') {
        return `<label for="customerName">Full Name</label>
      <input id="customerName" name="customerName" type="text" required minlength="2" placeholder="Your full name" autocomplete="one-time-code">`;
      }
      if (token === 'fixed.phoneNumber') {
        const pr = initialPhoneRule;
        const phoneTitle = `Enter a valid ${pr.country} phone number, e.g. ${pr.example} or ${pr.exampleIntl}`;
        return `<label for="customerPhone">Phone Number</label>
      <input id="customerPhone" name="customerPhone" type="tel" inputmode="tel" required placeholder="${escapeHtml(pr.example)}" maxlength="16" pattern="^${escapeHtml(pr.pattern)}$" title="${escapeHtml(phoneTitle)}" data-phone-country="${escapeHtml(pr.country)}" autocomplete="tel-national">`;
      }
      if (token === 'offer') {
        return offerSelectionHtml;
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
    <form id="yannisOrderForm" data-btn-text="${escapeHtml(buttonText)}" data-show-payment-method="${showPaymentMethod ? 'true' : 'false'}" data-show-customer-email="${showStandaloneEmail ? 'true' : 'false'}" data-require-customer-email="${requiredField('customerEmail') ? 'true' : 'false'}" data-success-callback="${escapeHtml(fc.successCallbackUrl ?? '')}" data-initial-currency="${escapeHtml(initialCurrency)}" data-currency-meta="${escapeHtml(JSON.stringify(currencyList))}" data-initial-country="${escapeHtml(initialCountry)}" data-phone-rules="${escapeHtml(JSON.stringify(COUNTRY_PHONE_RULES))}"${singleProductAttr}>
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
/**
 * Render a custom dropdown (replaces native <select> for consistent cross-device UX).
 * Uses a hidden input with the same name/id so fv() reads it unchanged.
 * `searchable` adds a filter input (useful for long lists like states).
 */
function renderCustomDropdown(
  id: string,
  name: string,
  placeholder: string,
  options: Array<{ value: string; label: string }>,
  opts: { required?: boolean; searchable?: boolean; cfAttr?: string; cfType?: string } = {},
): string {
  const optionsHtml = options
    .map((o) => `<div class="yd-opt" role="option" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`)
    .join('');
  const searchHtml = opts.searchable
    ? `<input type="text" class="yd-search" placeholder="Type to filter…" autocomplete="off">`
    : '';
  const cfAttrs = opts.cfAttr ? ` data-yannis-cf="${escapeHtml(opts.cfAttr)}" data-yannis-cf-type="${escapeHtml(opts.cfType || 'dropdown')}"` : '';
  return `<div class="yd" data-yd>
    <input type="hidden" id="${id}" name="${name}"${opts.required ? ' required' : ''}${cfAttrs}>
    <button type="button" class="yd-trigger placeholder" aria-haspopup="listbox" aria-expanded="false">
      <span class="yd-label">${escapeHtml(placeholder)}</span>
      <span class="yd-arrow"></span>
    </button>
    <div class="yd-panel" role="listbox">
      ${searchHtml}
      <div class="yd-list">${optionsHtml}</div>
    </div>
  </div>`;
}

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
    case 'gender': {
      const genderOpts = (fc.genderOptions && fc.genderOptions.length > 0 ? fc.genderOptions : ['Male', 'Female'])
        .map((o) => ({ value: o, label: o }));
      return `<label for="customerGender">${escapeHtml(field.label)}${requiredField('gender') ? ' <span class="required">*</span>' : ''}</label>
      ${renderCustomDropdown('customerGender', 'customerGender', 'Select gender...', genderOpts, { required: requiredField('gender') })}`;
    }
    case 'deliveryState': {
      const stateOpts = (fc.deliveryStateOptions && fc.deliveryStateOptions.length > 0
        ? fc.deliveryStateOptions
        : ['Lagos', 'Abuja (FCT)', 'Rivers', 'Oyo', 'Kano', 'Delta', 'Edo', 'Ogun', 'Anambra', 'Enugu', 'Kaduna', 'Imo', 'Abia', 'Kwara', 'Osun', 'Ondo', 'Ekiti', 'Bayelsa', 'Cross River', 'Akwa Ibom', 'Plateau', 'Benue', 'Nasarawa', 'Niger', 'Kogi', 'Taraba', 'Adamawa', 'Bauchi', 'Gombe', 'Borno', 'Yobe', 'Jigawa', 'Zamfara', 'Sokoto', 'Kebbi', 'Katsina', 'Ebonyi']
      ).map((o) => ({ value: o, label: o }));
      return `<label for="deliveryState">${escapeHtml(field.label)}${requiredField('deliveryState') ? ' <span class="required">*</span>' : ''}</label>
      ${renderCustomDropdown('deliveryState', 'deliveryState', 'Select state...', stateOpts, { required: requiredField('deliveryState'), searchable: true })}`;
    }
    case 'deliveryAddress':
      return `<label for="deliveryAddress">${escapeHtml(field.label)}${requiredField('deliveryAddress') ? ' <span class="required">*</span>' : ''}</label>
      <textarea id="deliveryAddress" name="deliveryAddress" placeholder="Your delivery address"${requiredField('deliveryAddress') ? ' required' : ''}></textarea>`;
    case 'deliveryNotes':
      return `<label for="deliveryNotes">${escapeHtml(field.label)}${requiredField('deliveryNotes') ? ' <span class="required">*</span>' : ' (optional)'}</label>
      <input id="deliveryNotes" name="deliveryNotes" type="text" placeholder="Any special instructions"${requiredField('deliveryNotes') ? ' required' : ''}>`;
    case 'preferredDeliveryDate': {
      const dateOpts = (fc.preferredDeliveryDateOptions && fc.preferredDeliveryDateOptions.length > 0
        ? fc.preferredDeliveryDateOptions
        : ['Today', 'Tomorrow', 'Specific date (mention in Notes)']
      ).map((o) => ({ value: o, label: o }));
      return `<label for="preferredDeliveryDate">${escapeHtml(field.label)}${requiredField('preferredDeliveryDate') ? ' <span class="required">*</span>' : ''}</label>
      ${renderCustomDropdown('preferredDeliveryDate', 'preferredDeliveryDate', 'Select...', dateOpts, { required: requiredField('preferredDeliveryDate') })}`;
    }
    case 'customerEmail':
      return `<label for="customerEmail">${escapeHtml(field.label)}${requiredField('customerEmail') ? ' <span class="required">*</span>' : ''}</label>
      <input id="customerEmail" name="customerEmail" type="email" placeholder="your@email.com"${requiredField('customerEmail') ? ' required' : ''}>`;
    case 'paymentMethod': {
      const pmOpts = [
        { value: 'PAY_ON_DELIVERY', label: 'Pay on delivery' },
        { value: 'PAY_ONLINE', label: 'Pay online (card / bank)' },
      ];
      return `<label for="paymentMethod">${escapeHtml(field.label)}${requiredField('paymentMethod') ? ' <span class="required">*</span>' : ''}</label>
      ${renderCustomDropdown('paymentMethod', 'paymentMethod', 'Select payment method...', pmOpts, { required: requiredField('paymentMethod') })}
      ${showStandaloneEmail ? '' : `<div id="customerEmailWrap" class="hidden">
        <label for="customerEmail">${escapeHtml(emailLabel)} (for payment receipt) <span class="required">*</span></label>
        <input id="customerEmail" name="customerEmail" type="email" placeholder="your@email.com">
      </div>`}`;
    }
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
        <input id="${id}" name="${id}" type="tel" inputmode="tel"
          autocomplete="tel"
          data-yannis-cf="${escapeHtml(field.id)}" data-yannis-cf-type="phone" ${required} ${placeholder}
          maxlength="14"
          pattern="^(0[789][0-9]{9}|\\+234[789][0-9]{9})$"
          title="Enter a valid Nigerian phone number, e.g. 08012345678 or +2348012345678"
          oninput="this.value = this.value.replace(/[^0-9+]/g, '')">
        <p class="phone-error" style="display:none;color:#dc2626;font-size:.75rem;margin:-0.5rem 0 0.75rem">Enter a valid Nigerian phone number</p>
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
      const cfOpts = (field.options ?? []).map((option: string) => ({ value: option, label: option }));
      const cfSearchable = cfOpts.length > 6;
      return `${labelHtml}
        ${renderCustomDropdown(id, id, field.placeholder || 'Select...', cfOpts, { required: field.required, searchable: cfSearchable, cfAttr: field.id, cfType: 'dropdown' })}
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

/**
 * `accentColor` comes straight from campaign form config (editable by media
 * buyers) and is interpolated RAW into a <style> block. HTML-escaping is the
 * wrong tool for a CSS context: an attacker could inject `red}</style><script>…`
 * to break out of the stylesheet and run script. accentColor only ever needs
 * to be a CSS color, so we allow-list color shapes and fall back to the default
 * on anything else. Nothing but a well-formed color value can reach the CSS.
 */
const SAFE_COLOR_RE =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$|^[a-zA-Z]{1,20}$/;
function sanitizeAccentColor(color: string | undefined): string {
  if (typeof color === 'string' && SAFE_COLOR_RE.test(color.trim())) {
    return color.trim();
  }
  return DEFAULT_CAMPAIGN_FORM_ACCENT_HEX;
}

/**
 * Serialize a value for embedding inside an inline <script> tag. Plain
 * JSON.stringify is unsafe there: a `</script>` sequence (or an HTML comment
 * opener) inside any string field — e.g. a product name a media buyer typed —
 * closes the script element early and lets the rest run as markup. We escape
 * the characters that can terminate/confuse the script context so the payload
 * survives only as data. Output is still valid JS (a JSON literal).
 */
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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
      <input id="customerName" name="customerName" type="text" required minlength="2" placeholder="Your full name" autocomplete="one-time-code">
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
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      // No HTML cache + debug header — local dev was getting stale form HTML
      // pointing at the production worker. Worker re-renders on every hit and
      // exposes the resolved workerUrl so you can verify in the network tab.
      'Cache-Control': 'no-store, must-revalidate',
      'X-Yannis-Worker-Url': workerUrl,
      ...CORS_HEADERS,
    },
  });
}

// ── Hosted Form Page (GET /form/:campaignId) ───────────────────

function renderHostedForm(config: CampaignConfig, workerUrl: string): Response {
  const accentColor = sanitizeAccentColor(config.formConfig?.accentColor);
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
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      'X-Yannis-Worker-Url': workerUrl,
      ...CORS_HEADERS,
    },
  });
}

// ── Embeddable Script (GET /embed.js?campaign=:id) ─────────────

function renderEmbedScript(config: CampaignConfig, workerUrl: string): Response {
  const accentColor = sanitizeAccentColor(config.formConfig?.accentColor);

  // Self-executing script that injects form into Shadow DOM.
  // Target the dedicated, campaign-scoped `#yannis-form-:id` div so the form
  // shrinks to its own content. Falls back to the legacy `#yannis-form` id
  // (older embeds) and finally the script's parent element. Attaching to the
  // host funnel section directly leaves dead space under the submit button.
  const js = `(function(){
  var CID = ${JSON.stringify(config.id)};
  var target = document.getElementById('yannis-form-' + CID)
    || document.getElementById('yannis-form')
    || document.currentScript.parentElement;
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
      'X-Yannis-Worker-Url': workerUrl,
      ...CORS_HEADERS,
    },
  });
}

// ── iFrame Form (GET /iframe/:campaignId) ──────────────────────

function renderIframeForm(config: CampaignConfig, workerUrl: string): Response {
  // Same as hosted but with iframe-friendly styles (no body centering)
  const accentColor = sanitizeAccentColor(config.formConfig?.accentColor);
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
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      'X-Yannis-Worker-Url': workerUrl,
      ...CORS_HEADERS,
    },
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

/**
 * Resolve the absolute URL the browser used to reach this worker, for use as
 * `workerUrl` in form HTML / embed.js so `/cart` and `/submit` go back to the
 * same origin the page was served from.
 *
 * Priority:
 *   1. `env.PUBLIC_WORKER_URL` — explicit override. Set this in `.dev.vars`
 *      to `http://localhost:8787` so local previews never POST to production
 *      regardless of how `wrangler dev` rewrites Host / request.url.
 *   2. `Host` header — the hostname the browser actually navigated to.
 *      Reliable on every Cloudflare route in deployed envs.
 *   3. `url.host` — final fallback.
 */
function resolveWorkerUrl(request: Request, url: URL, env: Env): string {
  const override = env.PUBLIC_WORKER_URL?.trim();
  if (override) return override.replace(/\/+$/, '');
  const host = request.headers.get('Host')?.trim() || url.host;
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host);
  const protocol = isLocal ? 'http:' : url.protocol;
  return `${protocol}//${host}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
      const workerUrl = resolveWorkerUrl(request, url, env);
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
      const workerUrl = resolveWorkerUrl(request, url, env);
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
      const workerUrl = resolveWorkerUrl(request, url, env);
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
    if (url.pathname === '/track-view' && request.method === 'POST') {
      return handleTrackView(request, env, ctx);
    }

    if (url.pathname === '/cart' && request.method === 'POST') {
      return handleCart(request, env);
    }

    // ── Order submission ─────────────────────────────────────
    if (url.pathname === '/submit' && request.method === 'POST') {
      return handleSubmission(request, env);
    }

    // ── QStash terminal-failure callbacks ─────────────────────
    // Called by QStash when a buffered order/cart exhausts all retries. Persists
    // the original payload to the Redis dead-letter list (Pillar-1 no-loss).
    if (url.pathname === QSTASH_FAILED_ORDER_PATH && request.method === 'POST') {
      return handleQStashFailureCallback(request, env, REDIS_DEAD_LETTER_KEY);
    }
    if (url.pathname === QSTASH_FAILED_CART_PATH && request.method === 'POST') {
      return handleQStashFailureCallback(request, env, REDIS_CART_DEAD_LETTER_KEY);
    }

    return corsResponse({ error: 'Not Found' }, 404);
  },

  /**
   * Healer cron — runs every 60 seconds.
   *
   * Responsibilities:
   *   1. Heartbeat — check API health, log status.
   *   2. Drain — when the API is healthy AND Upstash Redis is configured,
   *      pull buffered orders off `edge:orders:pending` and buffered carts
   *      off `edge:carts:pending` and replay them.
   *      Failed replays go back to the tail with an incremented attempts
   *      counter; after REDIS_MAX_ATTEMPTS they move to the matching
   *      dead-letter list for manual replay.
   *
   * QStash handles its own retries internally — the cron does not touch it.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const healthy = await isApiHealthy(env);
    if (!healthy) {
      console.log('[healer] API is unhealthy — buffers will continue holding orders/carts');
      return;
    }

    const result = await drainRedisQueue(env);
    if (result.drained || result.requeued || result.deadLettered) {
      console.log(
        `[healer] orders drained=${result.drained} requeued=${result.requeued} deadLettered=${result.deadLettered}`,
      );
    }

    const cartResult = await drainRedisCartQueue(env);
    if (cartResult.drained || cartResult.requeued || cartResult.deadLettered) {
      console.log(
        `[healer] carts drained=${cartResult.drained} requeued=${cartResult.requeued} deadLettered=${cartResult.deadLettered}`,
      );
    }

    if (
      !result.drained && !result.requeued && !result.deadLettered &&
      !cartResult.drained && !cartResult.requeued && !cartResult.deadLettered
    ) {
      console.log('[healer] API healthy, no pending orders/carts to drain');
    }
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

  // customerName is optional for cart saves — phone-first capture sends name
  // only after the user has typed it. Default to 'Unknown' so the row is valid.
  if (!b['customerName'] || typeof b['customerName'] !== 'string' || (b['customerName'] as string).trim().length < 1) {
    b['customerName'] = 'Unknown';
  }

  // Phone: STAMP-never-reject (multi-country, edge-freeze rule). The public form
  // enforces the per-country format client-side; here we only reject obvious
  // junk (too few / too many digits) so a valid Ghanaian/other-country number is
  // never blocked at intake (a 4xx here = a lost order). Nigerian numbers are a
  // subset of 7-15 digits, so they pass exactly as before.
  {
    const phoneStr = typeof b['customerPhone'] === 'string' ? (b['customerPhone'] as string).trim() : '';
    const digitCount = phoneStr.replace(/\D/g, '').length;
    if (digitCount < 7 || digitCount > 15) {
      return {
        valid: false,
        error: 'Enter a valid phone number.',
      };
    }
    b['customerPhone'] = phoneStr;
  }

  // Product is optional for phone-only capture. When present it must be a UUID string.
  const productId =
    typeof b['productId'] === 'string' && b['productId'].trim().length > 0
      ? (b['productId'] as string).trim()
      : undefined;

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
      productId,
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
      // Frozen currency (optional). Parsed identically to the ORDER path (line
      // ~497): <=5 chars, upper-cased, else dropped. Never rejects.
      currencyCode:
        typeof b['currencyCode'] === 'string' && b['currencyCode'].length <= 5
          ? b['currencyCode'].toUpperCase()
          : undefined,
      sessionId: typeof b['sessionId'] === 'string' ? b['sessionId'] : undefined,
    },
  };
}

/**
 * Form Analytics beacon endpoint — records form landings + dwell time.
 *
 * FULLY ISOLATED from the frozen intake path: this handler shares NO code with
 * handleSubmission / handleCart, and awaiting its forward here CANNOT slow order
 * submission (that runs on /submit and /cart, separate handlers). It ALWAYS
 * returns 204 (even on invalid JSON, a slow API, or a downstream failure — all
 * swallowed).
 *
 * Why AWAIT the forward instead of ctx.waitUntil: `waitUntil` work on a
 * fire-and-forget beacon is unreliable on Cloudflare — when the Worker returns,
 * the runtime may evict the isolate before the deferred fetch completes, so views
 * recorded only intermittently. Awaiting the forward before returning 204 makes
 * recording reliable. The beacon is already async from the browser's side
 * (navigator.sendBeacon), so this added latency is invisible to the user and only
 * affects the (ignored) beacon response. Still bounded by the abort timeout so a
 * hung API can never hold the request open.
 */
async function handleTrackView(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const noContent = new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noContent; // unparseable beacon — drop silently
    }
    const b = body as Record<string, unknown>;
    const sessionId = typeof b['sessionId'] === 'string' ? b['sessionId'] : null;
    if (!sessionId) return noContent; // sessionId is the only hard requirement

    const payload: Record<string, unknown> = { sessionId };
    if (typeof b['dwellMs'] === 'number') payload['dwellMs'] = b['dwellMs'];
    if (typeof b['campaignId'] === 'string') payload['campaignId'] = b['campaignId'];
    if (typeof b['mediaBuyerId'] === 'string') payload['mediaBuyerId'] = b['mediaBuyerId'];
    if (typeof b['deploymentType'] === 'string') payload['deploymentType'] = b['deploymentType'];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), getApiTimeoutMs(env.API_URL));
    try {
      // Forward CF geo/referrer so the API can enrich the view row.
      const headers = apiForwardHeaders(env);
      const referer = request.headers.get('Referer');
      const country = request.headers.get('CF-IPCountry');
      const ua = request.headers.get('User-Agent');
      if (referer) headers['Referer'] = referer;
      if (country) headers['CF-IPCountry'] = country;
      if (ua) headers['User-Agent'] = ua;
      // Awaited so the record actually completes before we respond (see docstring).
      await fetch(`${env.API_URL}/trpc/marketing.trackView`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // Absolutely nothing here may affect the response — telemetry is best-effort.
  }
  return noContent;
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
    currencyCode: data.currencyCode,
    sessionId: data.sessionId,
  };

  const result = await forwardCartToApi(payload, env);

  if (result.ok) {
    const id = (result.data as { result?: { data?: { id: string } } })?.result?.data?.id;
    return corsResponse({ success: true, id });
  }

  // API 5xx/unreachable — same failover ladder as orders: QStash → Redis healer.
  // An edge-auth 401 is a mis-key (not a bad cart), so fail it over the same way.
  // Return success when buffered so the form keeps progressive capture alive;
  // the cart id may be missing until the buffer drains.
  if (result.status >= 500 || result.status === 503 || isEdgeAuthRejection(result)) {
    const buffered = await bufferCartToQStash(payload, env);
    if (buffered) {
      return corsResponse({ success: true, buffered: true });
    }
    const redisBuffered = await bufferCartToRedis(payload, env);
    if (redisBuffered) {
      return corsResponse({ success: true, buffered: true, bufferedVia: 'redis' });
    }
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

  // 4. Hash phone number (never send raw phone to API).
  //    Duplicate submissions (double-tap / refresh / retry) are now caught by
  //    the API's idempotency check (`findRecentIdenticalOrder` in
  //    OrdersService.create) — the edge no longer keeps its own KV dedup.
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
    currencyCode: data.currencyCode,
    source: 'edge-form',
    cartId: data.cartId,
    customFields: data.customFields,
    sessionId: data.sessionId,
  };

  // 8. Forward to API: PAY_ONLINE → prepare Paystack (no order yet); else → orders.create
  const isPayOnline = data.paymentMethod === 'PAY_ONLINE';
  const apiResult = isPayOnline
    ? await forwardPreparePaystackToApi(orderPayload, env)
    : await forwardToApi(orderPayload, env);

  if (apiResult.ok) {
    const resultData = apiResult.data as {
      result?: {
        data?: { id?: string; authorizationUrl?: string; reference?: string; duplicateRecorded?: true; alreadySubmitted?: true };
      };
    };
    const orderId = resultData?.result?.data?.id;
    const authorizationUrl = resultData?.result?.data?.authorizationUrl;
    const duplicateRecorded = resultData?.result?.data?.duplicateRecorded === true;
    const alreadySubmitted = resultData?.result?.data?.alreadySubmitted === true;

    // Same-form rapid resubmit (within 2min): lock the form and tell the
    // customer their order was already received. No duplicate created.
    if (alreadySubmitted) {
      return corsResponse({
        success: true,
        orderId,
        alreadySubmitted: true,
        message: 'Your order has already been submitted. No need to submit again.',
      });
    }

    // Universal dedup (CEO 2026-05-26): duplicate submissions see the normal
    // success flow — pixel fires, successCallbackUrl redirect works. The
    // customer never knows it was a duplicate. The cross_funnel_attempts row
    // is recorded server-side for MB visibility.
    if (duplicateRecorded) {
      return corsResponse({
        success: true,
        orderId: 'queued',
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

  // An edge-auth 401 is a mis-key, not a bad order — fail it over like a 5xx
  // (buffer to QStash/Redis) so a gate slip never drops revenue. See
  // isEdgeAuthRejection + the 2026-08-04 incident.
  const isInfraFailure =
    apiResult.status >= 500 || apiResult.status === 503 || isEdgeAuthRejection(apiResult);

  // PAY_ONLINE + infra failure: no QStash (order created only after payment) —
  // ask the user to retry.
  if (isPayOnline && isInfraFailure) {
    const errorMessage = (apiResult.data as { error?: { message?: string } })?.error?.message
      ?? 'Payment service is temporarily unavailable. Please try again in a moment.';
    return corsResponse({ error: errorMessage }, 503);
  }

  // 9. API failed — try QStash failover (Pay on delivery only)
  if (isInfraFailure) {
    const buffered = await bufferToQStash(orderPayload, env);

    if (buffered) {
      return corsResponse({
        success: true,
        message: 'Order received, processing shortly',
        buffered: true,
      });
    }

    // 9b. QStash also failed — last-ditch Redis buffer (drained by healer cron).
    const redisBuffered = await bufferToRedis(orderPayload, env);
    if (redisBuffered) {
      return corsResponse({
        success: true,
        message: 'Order received, processing shortly',
        buffered: true,
        bufferedVia: 'redis',
      });
    }

    // All three buffers failed.
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

