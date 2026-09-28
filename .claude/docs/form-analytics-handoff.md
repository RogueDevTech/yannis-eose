# Form Analytics: Architecture Handoff

This spec describes how the Yannis EOSE platform built analytics for its public order forms. Use it as the blueprint for building the same system in another app. It explains what we built and why, so you can adapt the design to a different stack. You don't have to copy it line for line.

Reference stack (ours): Cloudflare Worker renders the public form, NestJS + tRPC API, Drizzle ORM, PostgreSQL, Remix frontend with recharts. None of the design depends on these choices.

---

## 1. What it answers

For every public form (we call them "campaigns"), the system answers:

1. How many people **viewed** the form (all loads, and unique visitors)
2. How long they **stayed** on it (average dwell time)
3. How many **started** filling it in (a partial entry was saved)
4. How many **ordered**, how many orders were **confirmed**, and how many were **delivered**
5. **Conversion** per form (orders / unique views)
6. **Attribution coverage**: what share of orders can be traced back to a tracked view
7. **Where every entry went**: became an order, is still in progress, was abandoned, or was blocked as a duplicate

---

## 2. Core principles (keep these regardless of stack)

1. **Telemetry must never break the product.** The tracking code sits next to the revenue-critical form submit. Every layer is fire-and-forget: `try/catch` around everything, errors swallowed, always return success. If tracking fails, the form behaves exactly as it would without tracking.
2. **One anonymous visitor ID ties everything together.** It is generated in the browser, sent with the view beacon, and carried along on the partial-entry save and the final order submit. Attribution is a **read-time join** on this ID. Nothing is written back into the order pipeline.
3. **Store raw events and aggregate at read time.** One row per form load. Unique visitors are counted as `COUNT(DISTINCT session_id)` when the report is queried. There are no pre-aggregated counters to drift out of sync.
4. **Attributed funnel.** Every funnel stage below "views" is restricted to sessions that have a tracked view. Without this rule, orders placed before tracking existed flood the funnel and conversion goes above 100%.
5. **Same scope everywhere.** Every query (views, carts, orders, and any subqueries) applies the same user/team/branch/company scope. An unscoped subquery leaks data across tenants. We shipped this bug once and caught it in review.
6. **Server resolves ownership.** The client beacon sends `campaignId` and optionally `mediaBuyerId`, but the server looks up the owner and branch from the campaign itself. Values sent by the client are only hints and are never used for scoping.

---

## 3. Data model

### 3.1 `campaign_views` (new telemetry table)

One row per form load.

```sql
CREATE TABLE campaign_views (
  id              uuid PRIMARY KEY,            -- UUIDv7 (time-ordered; used for "latest row")
  campaign_id     uuid NOT NULL REFERENCES campaigns(id),
  media_buyer_id  uuid REFERENCES users(id),   -- copied from campaign at view time
  branch_id       uuid REFERENCES branches(id),-- copied from campaign at view time
  session_id      text NOT NULL,               -- anonymous visitor id from the browser
  viewed_at       timestamptz NOT NULL DEFAULT now(),
  dwell_ms        integer,                     -- NULL until the leave-beacon arrives
  deployment_type text,                        -- 'hosted' | 'iframe' | 'embedded' | 'fallback'
  referrer        text,
  user_agent      text,
  country         text,                        -- from CDN geo header (CF-IPCountry)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON campaign_views (campaign_id);
CREATE INDEX ON campaign_views (viewed_at);
CREATE INDEX ON campaign_views (session_id);
CREATE INDEX ON campaign_views (branch_id);
CREATE INDEX ON campaign_views (media_buyer_id);
CREATE INDEX ON campaign_views (campaign_id, viewed_at);
```

Design notes:
- **The owner and tenant columns are denormalised** (`media_buyer_id`, `branch_id`), so reports can be scoped without joining to `campaigns`. They are copied from the campaign when the view is recorded.
- **This table has no audit or history tracking.** Our business tables are system-versioned with history triggers. This one is deliberately excluded because it holds high-volume telemetry, not auditable business data. Writes are bare inserts with no actor context.
- `deployment_type` is plain text, not an enum. The worker's values don't match the app enum's casing, and `fallback` isn't an enum value.

### 3.2 Attribution keys on existing tables

```sql
ALTER TABLE orders            ADD COLUMN session_id text;  -- nullable
ALTER TABLE cart_abandonments ADD COLUMN session_id text;  -- nullable (partial entries)
CREATE INDEX ON orders (session_id);
CREATE INDEX ON cart_abandonments (session_id);
```

Both columns are nullable and optional. An order with no `session_id` is still a valid order. It just can't be attributed to a view.

> If your tables have history/audit twins that copy rows by position, add the column to the twin table in the same migration. Otherwise every UPDATE will fail.

### 3.3 Other tables the reports read

| Table | Role in analytics |
|---|---|
| `campaigns` | The form. Has `media_buyer_id`, `branch_id`, `product_ids`, and `name` |
| `cart_abandonments` | A partial entry, saved shortly after the visitor types a valid phone number. `status` is one of `PENDING` / `CONVERTED` / `ABANDONED` |
| `orders` | A submitted order, with a status lifecycle (`UNPROCESSED` → … → `CONFIRMED` → … → `DELIVERED` → `REMITTED`, or `DELETED`) |
| `cross_funnel_attempts` | A submission that the duplicate guard refused (same phone and product within the window). It never creates a cart or an order |

---

## 4. Ingestion flow

```
Browser (public form)
  │  on load:  sendBeacon POST /track-view {sessionId, campaignId, mediaBuyerId, deploymentType}
  │  on leave: sendBeacon POST /track-view {sessionId, dwellMs}
  ▼
Edge worker  /track-view
  │  parse JSON (drop silently if bad), require sessionId
  │  forward to API with Referer / User-Agent / CF-IPCountry headers
  │  ALWAYS respond 204, regardless of outcome
  ▼
API  marketing.trackView  (public procedure, zod-validated)
  │  if dwellMs present  → recordFormDwell(sessionId, dwellMs)
  │  elif campaignId     → recordFormView({...})
  │  wrapped in try/catch → always returns { ok: true }
  ▼
Postgres  campaign_views
  └─ (optional) emit realtime "form:view" event to dashboard rooms
```

### 4.1 Browser beacon (runs inside the form page)

```js
try {
  // Persist the visitor id so a refresh or return visit reuses it:
  // raw views (+1 per load) vs unique views (COUNT DISTINCT) stay meaningful.
  var vid = null;
  try {
    vid = localStorage.getItem('app_vid');
    if (!vid && crypto.randomUUID) {
      vid = crypto.randomUUID();
      localStorage.setItem('app_vid', vid);
    }
  } catch (e) {
    vid = crypto.randomUUID ? crypto.randomUUID() : null; // private mode fallback
  }
  var start = Date.now();
  window.__appSessionId = vid || undefined;   // picked up by cart-save + submit

  if (vid && navigator.sendBeacon) {
    navigator.sendBeacon(BASE + '/track-view', JSON.stringify({
      sessionId: vid, campaignId: CAMPAIGN_ID, mediaBuyerId: MB_ID, deploymentType: MODE
    }));
  }

  var sent = false;
  var leave = function () {
    if (sent || !vid || !navigator.sendBeacon) return;
    sent = true;
    try {
      navigator.sendBeacon(BASE + '/track-view',
        JSON.stringify({ sessionId: vid, dwellMs: Date.now() - start }));
    } catch (e) {}
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') leave();
  });
  window.addEventListener('pagehide', leave);
} catch (e) { /* tracking must never break the form */ }
```

Rules:
- Use `navigator.sendBeacon` only. Never use `fetch`/`await`, because the beacon must never block rendering or submission.
- Listen for `visibilitychange` (hidden) and `pagehide`. `unload`/`beforeunload` are unreliable on mobile.
- The partial-entry save and the order submit add `sessionId: window.__appSessionId` to their payloads **only if it is set**. Their validators accept it as optional.
- For embedded forms (a script on a third-party site), `BASE` must be the absolute worker URL. Relative paths would hit the host site.

### 4.2 Edge endpoint

- A separate route, fully isolated from the order-intake route.
- **Await** the forward to the API before responding 204. Don't use `ctx.waitUntil`: on Cloudflare the isolate can be evicted before deferred work finishes, and views were recorded only intermittently. The browser already treats the beacon as async, so the added latency is invisible to the visitor. Bound the forward with an abort timeout.
- Forward the CDN's `Referer`, `User-Agent`, and `CF-IPCountry` headers so the API can enrich the row.

### 4.3 API: record view

```ts
async recordFormView(input) {
  try {
    // Authoritative owner/tenant from the campaign, never from the client.
    const [c] = await db.select({ mediaBuyerId, branchId }).from(campaigns)
      .where(eq(campaigns.id, input.campaignId)).limit(1);
    if (!c) return;                       // unknown campaign: drop silently
    await db.insert(campaignViews).values({
      id: uuidv7(), campaignId: input.campaignId,
      mediaBuyerId: c.mediaBuyerId, branchId: c.branchId,
      sessionId: input.sessionId, dwellMs: null,
      deploymentType, referrer, userAgent, country,
    });
    events.emitFormView({ campaignId, mediaBuyerId: c.mediaBuyerId, branchId: c.branchId }); // best-effort
  } catch (err) { logger.debug(...); }   // NEVER throw
}
```

### 4.4 API: record dwell

```ts
async recordFormDwell(sessionId, dwellMs) {
  try {
    // A refresh creates multiple rows with the same session_id.
    // Stamp ONLY the newest open row, or one visit's dwell is counted
    // several times in AVG(dwell_ms).
    const [latest] = await db.select({ id }).from(campaignViews)
      .where(and(eq(sessionId, sessionId), isNull(dwellMs)))
      .orderBy(desc(id))            // UUIDv7 is time-ordered
      .limit(1);
    if (!latest) return;
    await db.update(campaignViews).set({ dwellMs, updatedAt: new Date() })
      .where(eq(id, latest.id));
  } catch { /* swallow */ }
}
```

Input validation on the public endpoint: `sessionId` string 1–128 chars, `campaignId`/`mediaBuyerId` optional UUIDs, `deploymentType` at most 32 chars, `dwellMs` a non-negative integer of at most 86,400,000 (24h).

---

## 5. Reporting: `getFormAnalytics`

A single service method returns everything the dashboard needs. Signature:

```ts
getFormAnalytics(
  mediaBuyerId?,          // set → scope to one owner
  startDate?, endDate?,   // YYYY-MM-DD, interpreted in the business timezone
  branchId?,              // tenant scope
  supervisorScope?,       // { mediaBuyerIds: string[] } → scope to a team
  effectiveBranchIds?,    // company-level isolation (all branches in the company)
  opts?: { campaignId? }, // per-form drill-in: narrows EVERY query, on top of role scope
)
```

### 5.1 Scope builder (applied identically to each table)

```
if mediaBuyerId             → owner = mediaBuyerId
elif supervisorScope.ids    → owner IN (team ids)
else                        → branch scope (branchId, or IN effectiveBranchIds)
+ campaignId if drilling in
+ date range on that table's timestamp
```

Build `viewWhere`, `orderWhere` (also `status != 'DELETED'`), and `cartWhere` this way. For carts with branch-wide scope and no owner filter, restrict to the branch's campaign IDs so switching company stays isolated.

The `scopedViewSessionIds` subquery (`SELECT session_id FROM campaign_views WHERE viewWhere`) is the attribution set. **It must always use `viewWhere`.** Never use an unscoped `EXISTS` against `campaign_views`.

### 5.2 Queries (all independent, run in parallel)

| # | Output | Query |
|---|---|---|
| 1 | raw views, unique views, avg dwell | `COUNT(*)`, `COUNT(DISTINCT session_id)`, `AVG(dwell_ms) FILTER (WHERE dwell_ms IS NOT NULL)` on views |
| 2 | Started cart | `COUNT(DISTINCT carts.session_id)` where `cartWhere AND session_id IN scopedViewSessionIds` |
| 3 | Ordered / Confirmed / Delivered | on orders where `orderWhere AND session_id IN scopedViewSessionIds`: `COUNT(*)`, `COUNT(*) FILTER (status IN confirmed-or-beyond)`, `COUNT(*) FILTER (status IN ('DELIVERED','REMITTED'))` |
| 4 | Trend | views grouped by `date_trunc(unit, viewed_at AT TIME ZONE '<biz tz>')`: raw + unique. `unit = 'hour'` if start == end, else `'day'` |
| 5 | Top forms | group views by `campaign_id` only, with `MAX(campaign.name)` so a renamed or deleted campaign doesn't split into two rows. Order by unique views, limit 25 |
| 6 | Attribution numerator | orders in scope whose `session_id IN scopedViewSessionIds` |
| 7 | Attribution denominator | all orders in scope |
| 8 | Per-form table | per campaign: unique views, raw views, avg dwell, owner name |
| 9 | Per-form conversions | matched orders grouped by `orders.campaign_id` |

"Confirmed-or-beyond" = `CONFIRMED, AGENT_ASSIGNED, DISPATCHED, IN_TRANSIT, DELIVERED, PARTIALLY_DELIVERED, RETURNED, RESTOCKED, WRITTEN_OFF, REMITTED`. It matches the confirmation-rate definition used everywhere else in the app. Use your own app's equivalent.

### 5.3 Derived metrics

```
conversionRate      = min(1, ordered / uniqueViews)        // clamp: one session can place >1 order
attributionCoverage = matchedOrders / totalOrdersInScope   // how much of the business is tracked
per-form conversion = convertedForForm / uniqueViewsForForm
```

Funnel stages all count **distinct sessions** (Views → Started cart → Ordered → Confirmed → Delivered). If you count cart rows instead of sessions, the funnel can invert: more carts than views.

Product label per form: name the product if the form has exactly one, show "Mixed" if it has more than one, and show nothing if it has none. Show the owner's name next to each form only for team-wide viewers. For a single-owner viewer every form is theirs, so the name adds nothing.

### 5.4 Response shape

```ts
{
  statStrip: { rawLandings, uniqueLandings, avgDwellMs, conversionRate, attributionCoverage },
  funnel:    { formViews, startedCart, ordered, confirmed, delivered },
  trendUnit: 'hour' | 'day',
  timeSeries: [{ date, viewsRaw, viewsUnique }],
  topForms:   [{ campaignId, label, mediaBuyerName, count }],
  forms:      [{ campaignId, label, mediaBuyerName, productName, views, rawViews,
                 avgDwellMs, converted, conversionRate }],
  crossFunnel: { ... }   // duplicate-attempt stats, see §6
}
```

A single "page bundle" endpoint resolves the viewer's scope **once**, then runs `getFormAnalytics` and the cross-funnel stats in parallel and returns everything in one round trip.

---

## 6. Form Entries breakdown (where did every entry go?)

This one lives on the orders page rather than the analytics page. It answers a question the orders list alone can't: *"How many people entered the form, and what happened to each of them?"*

```
Became an order          n   ← cart_abandonments.status = CONVERTED
Still in cart pipeline   n   ← status = PENDING
Abandoned, no order      n   ← status = ABANDONED
Blocked as duplicate     n   ← cross_funnel_attempts rows (never created a cart)
─────────────────────────────
Total entries            n   = sum of the four
```

- The three cart statuses partition the table, and blocked attempts are a separate fourth destination. The lines always add up to the total, with no double counting and no gaps.
- Cart counts come from one grouped query (`GROUP BY status`), not three separate counts.
- Carts are dated by `updated_at`, because a cart is rewritten as the customer types and belongs to the day it was last touched. Blocked attempts are dated by `attempted_at`.
- The scope is the same as the neighbouring stats: owner, branch, company, and date.
- Label it **"Form Entries"**, never "Orders". It counts people who *started*, so it is intentionally larger than the order count.
- It is for display only. Never feed it into conversion or delivery rates. If it fails, return zeros so the page still loads.
- Each line links to the page that lists those records, keeping the active date range.

---

## 7. Frontend

**Analytics page** (`/marketing/analytics`), first item in the Marketing nav:
- **Stat strip:** All views, Unique views, Avg time on form, Conversion, Attribution coverage. Numbers roll up with a brief highlight when they increase, and the animation respects `prefers-reduced-motion`.
- **Funnel chart:** vertical bars getting shorter at each stage (Form views → Started cart → Ordered → Confirmed → Delivered), with step-to-step percentages.
- **Views trend:** line or area chart of raw and unique views, labelled by hour for a single day and by date otherwise.
- **Top forms:** donut of the top 6 plus "Other", with a scrollable ranked list beside it.
- **All forms table:** views, orders, conversion, and avg time. Each row links to the per-form drill-in and keeps the date filter.
- **Cross-funnel cards:** attempts, unique, cross-funnel, and resubmissions, plus a per-product table.
- **"View as data" toggle:** swaps every chart for its table, for accessibility and exact numbers.
- **Default date range:** today.

**Per-form drill-in** (`/marketing/analytics/:campaignId`): the same page component in `detail` mode. It hides the forms table and cross-funnel section and adds a back link. The server narrows every query to that campaign **on top of** the viewer's scope, so a user can never drill past what they are allowed to see.

**Role access:**
| Viewer | Scope |
|---|---|
| Individual owner (media buyer) | own forms only (server forces `mediaBuyerId = self`) |
| Team supervisor | their team's owner IDs |
| Head / admin | branch, or every branch in the selected company |

**Live updates:** the view recorder emits a `form:view` WebSocket event to scoped rooms (admin, all-marketing, per-owner). The page refetches on `form:view` and `order:new`, and falls back to 20s polling if the socket is down. A "Live" indicator appears in the header. All of this is best-effort and never affects recording.

**Data loading:** stream the bundle (render the shell, then await the data), cache it client-side for instant revisits, and provide a loading skeleton that matches the loaded layout.

---

## 8. Pitfalls we hit (avoid these)

1. **Unscoped attribution subquery.** `EXISTS (SELECT 1 FROM campaign_views WHERE session_id = o.session_id)` with no scope matched views from other branches and companies (seed data: 124 unscoped vs 109 correctly scoped). Always reuse `viewWhere`.
2. **Unattributed funnel.** Counting all orders in the period, instead of only those with a tracked-view session, pushed conversion above 100%, because historical orders outnumbered the new views.
3. **Dwell double-count.** Updating every row for a session on leave multiplied dwell after a refresh. Only update the newest open row.
4. **`waitUntil` dropped views** on the edge. Await the forward, bounded by a timeout.
5. **Grouping top forms by (id, name)** split renamed campaigns into two bars. Group by ID only and take `MAX(name)`.
6. **Timezone boundaries.** Bucket and filter dates in the business timezone (`AT TIME ZONE 'Africa/Lagos'` for us), not UTC, or "today" loses its first or last hour.
7. **History-table column drift.** When you add `session_id` to an audited table, also add it to its history twin in the same migration.
8. **Separate edge deploy.** The page and API ship on the normal deploy, but the beacon lives in the edge worker. Until the worker is deployed the page shows zeros. Plan it as a separate, explicit step.

---

## 9. Build order (suggested)

1. Migration: `campaign_views` + nullable `session_id` on orders/carts (+ history twins if any).
2. API ingestion: public `trackView` endpoint, plus `recordFormView` and `recordFormDwell`. Test that it always returns ok, even with garbage input.
3. Browser beacon + edge endpoint. Thread `sessionId` into the partial-entry save and submit payloads as an optional field.
4. Reporting service `getFormAnalytics` with the scope builder, and a page-bundle endpoint.
5. Analytics page: stat strip, funnel, trend, top forms, forms table, and loading skeleton.
6. Per-form drill-in route.
7. Form Entries breakdown tile on the orders page.
8. Live updates (WebSocket event + polling fallback).
9. Seed script with tagged, idempotent fake data (for example `referrer = 'seed:form-analytics'`, `session_id LIKE 'seed-%'`) and a cleanup block, for local testing.

Acceptance checks:
- Funnel stages never increase from one stage to the next, and conversion ≤ 100%.
- The strip total matches the "All forms" table totals for the same filters.
- A user in company A never sees views, carts, or orders from company B (test the attribution subquery in particular).
- Blocking the `/track-view` endpoint entirely leaves form submission unaffected.
