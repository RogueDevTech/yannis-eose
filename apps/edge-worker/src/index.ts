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
}

/** Validated cart form data (has raw customerPhone from form) */
interface CartFormData {
  campaignId: string;
  mediaBuyerId?: string;
  customerName: string;
  customerPhone: string;
  productId: string;
  offerLabel?: string;
}

interface CartSavePayload {
  campaignId: string;
  mediaBuyerId?: string;
  customerName: string;
  customerPhoneHash: string;
  productId: string;
  offerLabel?: string;
}

interface ProductOffer {
  label: string;
  qty: number;
  price: string;
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
    offers: ProductOffer[];
    variants?: unknown;
  }>;
  formConfig?: {
    heading?: string;
    subtitle?: string;
    buttonText?: string;
    accentColor?: string;
    successMessage?: string;
    showDeliveryAddress?: boolean;
    showDeliveryNotes?: boolean;
    showDeliveryState?: boolean;
    showGender?: boolean;
    showPreferredDeliveryDate?: boolean;
    showPaymentMethod?: boolean;
    deliveryStateOptions?: string[];
    preferredDeliveryDateOptions?: string[];
  };
}

// ── Constants ──────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_CAPTCHA_THRESHOLD = 3; // After 3 submissions, require CAPTCHA
const DEDUP_WINDOW_SECONDS = 21600; // 6 hours
const CIRCUIT_BREAKER_TIMEOUT_MS = 10000; // 10s production
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
const CAMPAIGN_CACHE_TTL = 300; // 5 min cache for campaign configs

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

async function dedupKey(phone: string, productId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`dedup:${phone}:${productId}`);
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

  if (!b['customerPhone'] || typeof b['customerPhone'] !== 'string' || (b['customerPhone'] as string).replace(/\D/g, '').length < 10) {
    return { valid: false, error: 'Valid phone number is required' };
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

async function verifyTurnstile(token: string, ip: string, env: Env): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true; // Skip if not configured
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
    });
    const result = await response.json() as { success: boolean };
    return result.success;
  } catch {
    return false;
  }
}

// ── Dedup Check ────────────────────────────────────────────────

async function checkDedup(phone: string, productIds: string[], env: Env): Promise<string | null> {
  if (!env.DEDUP_CACHE) return null; // KV not bound (local dev)
  for (const productId of productIds) {
    const key = await dedupKey(phone, productId);
    const existing = await env.DEDUP_CACHE.get(key);
    if (existing) {
      return productId;
    }
  }
  return null;
}

async function markDedup(phone: string, productIds: string[], env: Env): Promise<void> {
  if (!env.DEDUP_CACHE) return; // KV not bound (local dev)
  for (const productId of productIds) {
    const key = await dedupKey(phone, productId);
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
    return { ok: false, status: 503, data: { error: 'API unreachable' } };
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
    .yannis-form-card .offer-option{display:flex;align-items:center;gap:.75rem;padding:.75rem;border:2px solid #ddd;border-radius:8px;cursor:pointer;transition:border-color .2s,background .2s}
    .yannis-form-card .offer-option:hover{border-color:${accentColor}}
    .yannis-form-card .offer-option.selected{border-color:${accentColor};background:${accentColor}08}
    .yannis-form-card .offer-option input[type=radio]{accent-color:${accentColor};width:18px;height:18px;flex-shrink:0}
    .yannis-form-card .offer-label{font-weight:600;font-size:.875rem;flex:1}
    .yannis-form-card .offer-details{display:flex;align-items:center;gap:.5rem}
    .yannis-form-card .offer-qty{font-size:.75rem;color:#666;white-space:nowrap}
    .yannis-form-card .offer-price{color:${accentColor};font-weight:700;font-size:.875rem;white-space:nowrap}
    .yannis-form-card .offline-badge{display:inline-flex;align-items:center;gap:.25rem;padding:.25rem .5rem;background:#fef3c7;color:#92400e;border-radius:6px;font-size:.75rem;font-weight:600;margin-bottom:.75rem}
  `;
}

// ── Form Script (shared across all modes) ──────────────────────

function getFormScript(
  workerUrl: string,
  campaignId: string,
  products: CampaignConfig['products'],
  mediaBuyerId?: string,
): string {
  const mediaBuyerIdJson = mediaBuyerId ? `'${mediaBuyerId}'` : 'undefined';
  return `
    (function() {
      var form = document.getElementById('yannisOrderForm');
      var msg = document.getElementById('yannisMsg');
      var btn = document.getElementById('yannisSubmitBtn');
      var offlineBadge = document.getElementById('yannisOffline');
      var selectedProduct = null;
      var selectedOffer = null;
      var products = ${JSON.stringify(products)};

      function clearError() {
        msg.className = 'msg hidden';
        msg.textContent = '';
      }
      form.addEventListener('input', clearError);
      form.addEventListener('change', clearError);
      form.addEventListener('focusin', clearError);

      // Single-product: set product only, do not preselect offer
      var singleProductId = form.dataset.singleProduct;
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
        });
      });

      // Online/Offline detection
      var isOnline = navigator.onLine;
      function updateOnlineStatus() {
        isOnline = navigator.onLine;
        if (offlineBadge) offlineBadge.className = isOnline ? 'offline-badge hidden' : 'offline-badge';
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

      // Cart abandonment: save name+phone when both filled (debounced)
      var savedCartId = null;
      var cartSaveTimeout = null;
      var CART_DEBOUNCE_MS = 600;
      function maybeSaveCart() {
        if (!selectedProduct || !selectedOffer) return;
        var nameEl = form.querySelector('#customerName') || form.querySelector('[name="customerName"]');
        var phoneEl = form.querySelector('#customerPhone') || form.querySelector('[name="customerPhone"]');
        if (!nameEl || !phoneEl) return;
        var name = (nameEl.value || '').trim();
        var phone = (phoneEl.value || '').replace(/\\D/g, '');
        if (name.length < 2 || phone.length < 10) return;
        if (!isOnline) return;
        clearTimeout(cartSaveTimeout);
        cartSaveTimeout = setTimeout(function() {
          fetch('${workerUrl}/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaignId: '${campaignId}',
              mediaBuyerId: ${mediaBuyerIdJson},
              customerName: name,
              customerPhone: phoneEl.value,
              productId: selectedProduct,
              offerLabel: selectedOffer.label
            })
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d.id) savedCartId = d.id;
          }).catch(function() {});
        }, CART_DEBOUNCE_MS);
      }
      var nameInput = form.querySelector('#customerName') || form.querySelector('[name="customerName"]');
      var phoneInput = form.querySelector('#customerPhone') || form.querySelector('[name="customerPhone"]');
      if (nameInput) nameInput.addEventListener('input', maybeSaveCart);
      if (nameInput) nameInput.addEventListener('blur', maybeSaveCart);
      if (phoneInput) phoneInput.addEventListener('input', maybeSaveCart);
      if (phoneInput) phoneInput.addEventListener('blur', maybeSaveCart);

      var pmSelect = form.querySelector('#paymentMethod');
      if (pmSelect) {
        var emailWrap = document.getElementById('customerEmailWrap');
        var emailInput = document.getElementById('customerEmail');
        function togglePaymentEmail() {
          if (pmSelect.value === 'PAY_ONLINE') {
            if (emailWrap) emailWrap.classList.remove('hidden');
            if (emailInput) { emailInput.setAttribute('required', 'required'); }
          } else {
            if (emailWrap) emailWrap.classList.add('hidden');
            if (emailInput) { emailInput.removeAttribute('required'); emailInput.value = ''; }
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
        var orderData = {
          campaignId: '${campaignId}',
          mediaBuyerId: ${mediaBuyerIdJson},
          customerName: fd.get('customerName'),
          customerPhone: fd.get('customerPhone'),
          deliveryAddress: fd.get('deliveryAddress') || undefined,
          deliveryNotes: fd.get('deliveryNotes') || undefined,
          deliveryState: fd.get('deliveryState') || undefined,
          customerGender: fd.get('customerGender') || undefined,
          preferredDeliveryDate: fd.get('preferredDeliveryDate') || undefined,
          paymentMethod: paymentMethod === 'PAY_ONLINE' ? 'PAY_ONLINE' : 'PAY_ON_DELIVERY',
          customerEmail: paymentMethod === 'PAY_ONLINE' ? customerEmail : undefined,
          items: [{ productId: selectedProduct, quantity: selectedOffer.qty, unitPrice: selectedOffer.price, offerLabel: selectedOffer.label }],
          cartId: savedCartId || undefined,
          totalAmount: (selectedOffer.qty * parseFloat(selectedOffer.price)).toString()
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
            var authUrl = result.data.authorizationUrl;
            if (authUrl) {
              window.location.href = authUrl;
              return;
            }
            msg.className = 'msg msg-success';
            msg.textContent = result.data.message || 'Order received successfully! We will contact you shortly.';
            form.reset();
            selectedOffer = null;
          } else if (result.status === 423 && result.data.captchaRequired) {
            // Server requires CAPTCHA — load Turnstile widget
            var siteKey = result.data.turnstileSiteKey;
            if (!siteKey) { msg.className = 'msg msg-error'; msg.textContent = 'CAPTCHA required but not configured.'; return; }
            msg.className = 'msg msg-info';
            msg.textContent = 'Please complete the CAPTCHA below to verify you are human.';
            var captchaDiv = document.getElementById('yannisCaptcha');
            if (!captchaDiv) {
              captchaDiv = document.createElement('div');
              captchaDiv.id = 'yannisCaptcha';
              captchaDiv.style.marginBottom = '1rem';
              btn.parentNode.insertBefore(captchaDiv, btn);
            }
            captchaDiv.innerHTML = '';
            // Load Turnstile script if not already loaded
            if (!window.turnstile) {
              var s = document.createElement('script');
              s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
              s.async = true;
              window.onTurnstileLoad = function() {
                window.turnstile.render(captchaDiv, {
                  sitekey: siteKey,
                  callback: function(token) {
                    orderData.turnstileToken = token;
                    submitOrder(orderData).then(function(r2) {
                      if (r2.ok) {
                        msg.className = 'msg msg-success';
                        msg.textContent = r2.data.message || 'Order received successfully!';
                        form.reset(); quantity = 1; if (qtyVal) qtyVal.textContent = '1';
                        if (captchaDiv) captchaDiv.innerHTML = '';
                      } else {
                        msg.className = 'msg msg-error';
                        msg.textContent = r2.data.error || 'Submission failed. Please try again.';
                      }
                    });
                  }
                });
              };
              document.head.appendChild(s);
            } else {
              window.turnstile.render(captchaDiv, {
                sitekey: siteKey,
                callback: function(token) {
                  orderData.turnstileToken = token;
                  submitOrder(orderData).then(function(r2) {
                    if (r2.ok) {
                      msg.className = 'msg msg-success';
                      msg.textContent = r2.data.message || 'Order received successfully!';
                      form.reset(); quantity = 1; if (qtyVal) qtyVal.textContent = '1';
                      if (captchaDiv) captchaDiv.innerHTML = '';
                    } else {
                      msg.className = 'msg msg-error';
                      msg.textContent = r2.data.error || 'Submission failed. Please try again.';
                    }
                  });
                }
              });
            }
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
          btn.disabled = false;
          btn.textContent = form.dataset.btnText || 'Submit Order';
        });
      });
    })();
  `;
}

// ── Form HTML (shared inner content) ──────────────────────────

function getFormInnerHTML(config: CampaignConfig): string {
  const fc = config.formConfig ?? {};
  const heading = fc.heading ?? 'Place Your Order';
  const subtitle = fc.subtitle ?? 'Fill in your details below';
  const buttonText = fc.buttonText ?? 'Submit Order';

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
    const offersHtml = offers.map((o) =>
      `<label class="offer-option">
        <input type="radio" name="${radioName}" class="offer-radio"
          data-offer='${JSON.stringify({ label: o.label, qty: o.qty, price: o.price }).replace(/'/g, '&#39;')}'>
        <span class="offer-label">${escapeHtml(o.label)}</span>
        <span class="offer-details">
          <span class="offer-qty">${o.qty} unit${o.qty > 1 ? 's' : ''}</span>
          <span class="offer-price">${formatPrice(o.price)}</span>
        </span>
      </label>`
    ).join('\n');

    const display = hasSingleProduct ? 'flex' : 'none';
    return `<div id="offers-${p.id}" class="offer-group offer-selector" style="display:${display}">${offersHtml}</div>`;
  }).join('\n');

  // If single product, auto-set selectedProduct via hidden data attribute
  const firstProduct = config.products[0];
  const singleProductAttr = hasSingleProduct && firstProduct ? ` data-single-product="${firstProduct.id}"` : '';

  return `
    <h2>${escapeHtml(heading)}</h2>
    <p class="subtitle">${escapeHtml(subtitle)}</p>
    <div id="yannisOffline" class="offline-badge hidden">Offline</div>
    <div id="yannisMsg" class="msg hidden"></div>
    <form id="yannisOrderForm" data-btn-text="${escapeHtml(buttonText)}" data-show-payment-method="${fc.showPaymentMethod ? 'true' : 'false'}"${singleProductAttr}>
      ${!hasSingleProduct ? `<label>Select Product</label>
      <div class="product-selector">${productOptionsHtml}</div>` : ''}
      <label>Select Offer</label>
      ${offerGroupsHtml}
      <label for="customerName">Full Name</label>
      <input id="customerName" name="customerName" type="text" required minlength="2" placeholder="Your full name">
      <label for="customerPhone">Phone Number</label>
      <input id="customerPhone" name="customerPhone" type="tel" required placeholder="08012345678">
      ${fc.showGender ? `<label for="customerGender">Gender <span class="required">*</span></label>
      <select id="customerGender" name="customerGender" required>
        <option value="">Select gender...</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>` : ''}
      ${fc.showDeliveryState ? `<label for="deliveryState">Delivery State <span class="required">*</span></label>
      <select id="deliveryState" name="deliveryState" required>
        <option value="">Select state...</option>
        ${(fc.deliveryStateOptions && fc.deliveryStateOptions.length > 0
          ? fc.deliveryStateOptions
          : ['Lagos', 'Abuja (FCT)', 'Rivers', 'Oyo', 'Kano', 'Delta', 'Edo', 'Ogun', 'Anambra', 'Enugu', 'Kaduna', 'Imo', 'Abia', 'Kwara', 'Osun', 'Ondo', 'Ekiti', 'Bayelsa', 'Cross River', 'Akwa Ibom', 'Plateau', 'Benue', 'Nasarawa', 'Niger', 'Kogi', 'Taraba', 'Adamawa', 'Bauchi', 'Gombe', 'Borno', 'Yobe', 'Jigawa', 'Zamfara', 'Sokoto', 'Kebbi', 'Katsina', 'Ebonyi']
        ).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('\n')}
      </select>` : ''}
      ${fc.showDeliveryAddress !== false ? `<label for="deliveryAddress">Delivery Address</label>
      <textarea id="deliveryAddress" name="deliveryAddress" placeholder="Your delivery address"></textarea>` : ''}
      ${fc.showDeliveryNotes ? `<label for="deliveryNotes">Delivery Notes (optional)</label>
      <input id="deliveryNotes" name="deliveryNotes" type="text" placeholder="Any special instructions">` : ''}
      ${fc.showPreferredDeliveryDate ? `<label for="preferredDeliveryDate">When do you want to receive your order? <span class="required">*</span></label>
      <select id="preferredDeliveryDate" name="preferredDeliveryDate" required>
        <option value="">Select...</option>
        ${(fc.preferredDeliveryDateOptions && fc.preferredDeliveryDateOptions.length > 0
          ? fc.preferredDeliveryDateOptions
          : ['As soon as possible', 'Within 1-2 days', 'Within 3-5 days', 'Next week', 'Specific date (mention in notes)']
        ).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('\n')}
      </select>` : ''}
      ${fc.showPaymentMethod ? `<label for="paymentMethod">Payment method</label>
      <select id="paymentMethod" name="paymentMethod">
        <option value="">Select payment method...</option>
        <option value="PAY_ON_DELIVERY">Pay on delivery</option>
        <option value="PAY_ONLINE">Pay online (card / bank)</option>
      </select>
      <div id="customerEmailWrap" class="hidden">
        <label for="customerEmail">Email (for payment receipt) <span class="required">*</span></label>
        <input id="customerEmail" name="customerEmail" type="email" placeholder="your@email.com">
      </div>` : ''}
      <button type="submit" class="btn" id="yannisSubmitBtn">${escapeHtml(buttonText)}</button>
    </form>
  `;
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
  const accentColor = '#6366f1';
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
    <p class="subtitle">Fill in your details below</p>
    <div id="yannisOffline" class="offline-badge hidden">Offline</div>
    <div id="yannisMsg" class="msg hidden"></div>
    <form id="yannisOrderForm">
      <label for="customerName">Full Name</label>
      <input id="customerName" name="customerName" type="text" required minlength="2" placeholder="Your full name">
      <label for="customerPhone">Phone Number</label>
      <input id="customerPhone" name="customerPhone" type="tel" required placeholder="08012345678">
      <label for="deliveryAddress">Delivery Address</label>
      <textarea id="deliveryAddress" name="deliveryAddress" placeholder="Your delivery address"></textarea>
      <label for="deliveryNotes">Delivery Notes (optional)</label>
      <input id="deliveryNotes" name="deliveryNotes" type="text" placeholder="Any special instructions">
      <button type="submit" class="btn" id="yannisSubmitBtn">Submit Order</button>
    </form>
  </div>
  <script>
    ${getFormScript(workerUrl, campaignId, FALLBACK_PRODUCTS)}
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
  const accentColor = config.formConfig?.accentColor ?? '#6366f1';
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
    ${getFormScript(workerUrl, config.id, config.products, config.mediaBuyerId)}
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
  const accentColor = config.formConfig?.accentColor ?? '#6366f1';

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
  ${getFormScript(workerUrl, config.id, config.products, config.mediaBuyerId)}
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
  const accentColor = config.formConfig?.accentColor ?? '#6366f1';
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
    ${getFormScript(workerUrl, config.id, config.products, config.mediaBuyerId)}
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

  if (!b['customerPhone'] || typeof b['customerPhone'] !== 'string' || (b['customerPhone'] as string).replace(/\D/g, '').length < 10) {
    return { valid: false, error: 'Valid phone number is required' };
  }

  if (!b['productId'] || typeof b['productId'] !== 'string') {
    return { valid: false, error: 'Product ID is required' };
  }

  return {
    valid: true,
    data: {
      campaignId: b['campaignId'] as string,
      mediaBuyerId: typeof b['mediaBuyerId'] === 'string' ? b['mediaBuyerId'] : undefined,
      customerName: b['customerName'] as string,
      customerPhone: b['customerPhone'] as string,
      productId: b['productId'] as string,
      offerLabel: typeof b['offerLabel'] === 'string' ? b['offerLabel'] : undefined,
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
    productId: data.productId,
    offerLabel: data.offerLabel,
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

  if (rateLimitResult === 'captcha_required') {
    const turnstileToken = (body as Record<string, unknown>)['turnstileToken'] as string | undefined;
    if (!turnstileToken) {
      return corsResponse(
        {
          error: 'CAPTCHA verification required',
          captchaRequired: true,
          turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
        },
        423, // 423 = Locked — signals client to show CAPTCHA
      );
    }
    const captchaValid = await verifyTurnstile(turnstileToken, clientIp, env);
    if (!captchaValid) {
      return corsResponse(
        { error: 'CAPTCHA verification failed. Please try again.', captchaRequired: true },
        403,
      );
    }
  }

  // 4. Dedup check (phone + product within 6hr window)
  const productIds = data.items.map((item) => item.productId);
  const dupProduct = await checkDedup(data.customerPhone, productIds, env);
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
  };

  // 8. Forward to API: PAY_ONLINE → prepare Paystack (no order yet); else → orders.create
  const isPayOnline = data.paymentMethod === 'PAY_ONLINE';
  const apiResult = isPayOnline
    ? await forwardPreparePaystackToApi(orderPayload, env)
    : await forwardToApi(orderPayload, env);

  if (apiResult.ok) {
    // Success — mark dedup entries
    await markDedup(data.customerPhone, productIds, env);

    const resultData = apiResult.data as { result?: { data?: { id?: string; authorizationUrl?: string; reference?: string } } };
    const orderId = resultData?.result?.data?.id;
    const authorizationUrl = resultData?.result?.data?.authorizationUrl;

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
      await markDedup(data.customerPhone, productIds, env);

      return corsResponse({
        success: true,
        message: 'Order received, processing shortly',
        buffered: true,
      });
    }

    // QStash also failed — last resort: return a friendly message
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
