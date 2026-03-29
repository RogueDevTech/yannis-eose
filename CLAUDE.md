# CLAUDE.md — Yannis EOSE Agent Directive

## Identity & Context

You are a senior software engineer building **Yannis EOSE** (Enterprise Operations & Sales Engine) — a high-integrity ERP and sales platform for a performance marketing company. This is NOT a generic CRM. This is a **revenue protection system** that replaces a legacy tool called "Sniper" which failed under scale.

The client loved Sniper's smooth UX rhythm, granular data visibility, and automations. They left because it couldn't handle concurrent users, had no audit trail, couldn't do stock audits, and had messy financials. **Every decision you make must honor what they loved and fix what broke.**

---

## The 4 Non-Negotiable Pillars

Every line of code you write must serve at least one of these pillars. If your implementation weakens any pillar, stop and redesign.

### Pillar 1: Revenue Insurance (Zero-Downtime)
Sales forms must NEVER go offline. Even if the primary API server crashes, even if AWS has a regional outage, even if Cloudflare blinks — the system must capture orders. This is achieved through Edge-first submission (Cloudflare Workers), circuit breaker patterns (failover to QStash/Durable Objects), and PWA offline sync for field agents. Zero lost sales is the standard.

### Pillar 2: Lead Fortress (Anti-Theft)
Customer phone numbers and PII are the company's most valuable asset. Phone numbers are NEVER exposed in the browser DOM, network tab, console logs, or API responses to unauthorized roles. All customer communication happens through VOIP bridges (Twilio/MessageBird WebRTC). Agents click "Call" and the system connects them — they never see, copy, or export the raw number. If you are building any feature that touches customer contact data, mask it by default and require an audited access event to reveal it.

### Pillar 3: Financial Truth (Landed COGS)
Profit is not revenue minus a guess. Every product has a layered cost structure: Factory Cost + Freight/Duty (Landing Cost) + 3PL Handling Fee + Final-Mile Delivery Fee. Ad Spend is tracked per Media Buyer per product per day. Commission is calculated per delivered order. The CEO must see **real net cash profit** at any time, not estimates. Use FIFO (First-In, First-Out) batch costing for inventory — if Batch A costs $5/unit and Batch B costs $7/unit, the system sells Batch A first and calculates margin accordingly.

### Pillar 4: Absolute Accountability (Temporal Audit)
Every single mutation to any record — creation, update, status change, deletion — must be permanently logged with: the actor (user ID), the action, the old value, the new value, and a precise timestamp. This is implemented at the database level using PostgreSQL 18 System-Versioned Temporal Tables. No application-level audit log that can drift or be bypassed. Every transaction must execute `SET LOCAL yannis.current_user_id = '<uuid>'` before any write operation. No user, including SuperAdmin, can delete or modify an audit entry. The audit trail is permanent and immutable.

---

## Tech Stack (Locked — Do Not Deviate)

| Layer | Technology | Why |
|---|---|---|
| Frontend | Remix (React) + Tailwind CSS | Server-side Loaders/Actions, nested routing for CRM UX, automatic revalidation on mutation |
| PWA | Service Workers + Web Push | Offline sync for riders, background notifications for CS agents, always-on call alerts |
| Backend API | NestJS (Node.js) + TypeScript 5.x | Opinionated structure (Modules/Services/Controllers), Dependency Injection, decorator-based — agents can follow strict patterns without hallucinating file placement |
| Type Contract | tRPC (internal), OpenAPI/Swagger (external) | tRPC shares types between NestJS and Remix with zero generation step. Swagger is auto-generated from tRPC routers via trpc-openapi for future external consumers |
| Database | PostgreSQL 18 | Native temporal constraints (WITHOUT OVERLAPS), System-Versioned tables, UUIDv7 (timestamp-ordered), async I/O |
| ORM | Drizzle ORM | TypeScript-first, 1:1 SQL mapping, zero magic, inferred types that change based on select/include — no reflection or decorators |
| Cache/Sessions | Redis | Hybrid session management (instant revocation), sliding window deduplication cache, CS dispatch queue |
| Real-time | Socket.io (WebSockets) | Live dashboard updates, incoming call notifications, order status push |
| Edge/CDN | Cloudflare Workers | Sales form hosting, circuit breaker failover, DDoS protection |
| Queue/Buffer | Upstash QStash or Cloudflare Durable Objects | Order buffering during API downtime, retry logic |
| VOIP | Twilio Voice API / MessageBird (WebRTC) | Click-to-call, call recording, AI transcription, caller ID branding |
| File Storage | Cloudflare R2 or AWS S3 | Receipts, ad spend screenshots, invoice PDFs, call recordings |

---

## Architecture: Decoupled Monorepo

The frontend (Remix) and backend (NestJS) are **separate applications** in a single monorepo (TurboRepo with pnpm). They communicate exclusively via tRPC. They share types through a `packages/shared` workspace package containing Drizzle schemas, Zod validators, and tRPC router types.

```
yannis-eose/
├── apps/
│   ├── web/                  # Remix PWA (65+ routes, 29 feature modules)
│   │   └── app/
│   │       ├── routes/
│   │       │   ├── admin.*       # All admin modules (CS, Finance, Marketing, Logistics, Inventory, Products, etc.)
│   │       │   ├── auth.*        # Login/auth/forgot-password/reset-password
│   │       │   ├── hr.*          # HR & Payroll module
│   │       │   ├── rider.*       # 3PL Rider views (mobile-optimized PWA)
│   │       │   ├── tpl.*         # 3PL Partner dashboard (inventory, orders, remittances)
│   │       │   └── payment.*     # Payment pages (Paystack integration)
│   │       ├── features/         # Feature page components (by module)
│   │       ├── components/       # Layout + UI components (32+)
│   │       ├── hooks/            # React hooks (socket, VOIP, PWA, mobile, online status)
│   │       └── lib/              # Utilities (API client, S3 upload, CSV, PDF, offline sync)
│   ├── api/                  # NestJS backend (21 modules, 18 tRPC routers)
│   │   └── src/
│   │       ├── auth/         # Authentication + session management
│   │       ├── orders/       # Order service + state machine
│   │       ├── finance/      # Finance service + materialized views
│   │       ├── hr/           # HR + payroll + commission engine
│   │       ├── inventory/    # Inventory FIFO + stock management
│   │       ├── logistics/    # 3PL + transfers + escalation
│   │       ├── marketing/    # Campaigns + funding + metrics
│   │       ├── products/     # Product + category CRUD
│   │       ├── voip/         # VOIP integration (Twilio 3-tier)
│   │       ├── payments/     # Payment processing (Paystack)
│   │       ├── cart/         # Shopping cart
│   │       ├── settings/     # System settings (feature flags)
│   │       ├── notifications/ # Notification service
│   │       ├── events/       # Socket.io gateway + service
│   │       ├── trpc/         # tRPC routers + middleware + OpenAPI
│   │       └── common/       # Guards, decorators, interceptors
│   └── edge-worker/          # Cloudflare Worker (form submission + circuit breaker)
├── packages/
│   ├── shared/               # Drizzle schema (18 files), Zod validators (14 files), tRPC types, enums
│   ├── ui/                   # Shared Tailwind components
│   └── config/               # ESLint, TypeScript, Tailwind configs
├── docs/                     # Developer Guide, Runbook, ADRs
├── .github/workflows/        # CI/CD pipeline
└── turbo.json
```

**Note on 3PL Riders:** The rider dashboard is NOT a separate app. It lives inside `apps/web` as a route group (`/rider/`), with mobile-optimized layouts and PWA offline sync capabilities. This keeps deployment simple (single Vercel deployment) while still providing a dedicated mobile experience.

**Note on local dev databases:** Postgres 18 and Redis are accessed via cloud/remote connection strings configured in `.env` files. No Docker setup is required.

**Why separate API?** The project could grow. A mobile app may need the same API. Third-party logistics companies may need webhook access. External partners may need Swagger docs. Keeping the API independent ensures flexibility without rewriting.

---

## Database Principles

### UUIDv7 Everywhere
All primary keys use UUIDv7 (timestamp-ordered). This improves B-tree index performance and gives a free creation timestamp embedded in every ID. Never use auto-incrementing integers or UUIDv4.

### Temporal Tables (System-Versioned)
Every table that stores business data (orders, inventory, products, users, funding, ad_spend) must use PostgreSQL 18 system-versioned temporal logic. Every row has a `valid_period` (tstzrange) that records when that version of the row was true. When a row is updated, the old version is preserved with its time range. You can query the state of any record at any point in history.

### Row-Level Security (RLS)
Permissions are enforced at the database level, not just the application level. Even if the API has a bug, the database will block unauthorized access. Media Buyers can only see their own orders. CS agents can only see orders assigned to them. Finance can see all orders but only edit financial fields. Third-Party Logistics partners can only see orders allocated to their location.

### The Actor Injection Pattern
Every NestJS service method that performs a write operation must:
1. Begin a transaction
2. Execute `SET LOCAL yannis.current_user_id = '<authenticated_user_uuid>'`
3. Perform the write
4. Commit

This ensures the PostgreSQL trigger that manages the temporal audit trail knows WHO made the change. Never skip this step. Never hardcode a user ID.

### Numeric Columns, Temporal Triggers, and History Table Sync (Troubleshooting)

**Problem:** Drizzle/Postgres.js can serialize numeric values as text. The `yannis_capture_history_insert` trigger copies new rows into `*_history` tables. When numeric columns arrive as text, PostgreSQL errors: `column "X" is of type numeric but expression is of type text`.

**Three layers to fix:**

| Layer | Cause | Fix |
|-------|-------|-----|
| **API insert** | Drizzle sends numbers as strings | Use `sql\`${value}::numeric\`` for numeric columns in `.values()` or `.set()` |
| **Trigger** | Generic `EXECUTE ... USING NEW` loses numeric types in dynamic SQL | Add table-specific trigger with explicit `(NEW.column_name)::numeric` casts (see `0012_fix_capture_history_insert_numeric.sql` for products example) |
| **History schema** | `*_history` tables drift when main table is altered | When altering a main table, add migration to sync `*_history` (ADD COLUMN, DROP COLUMN, etc.) |

**Tables with numeric columns using the INSERT trigger:** orders, order_items, invoices, stock_batches, offer_templates, marketing_funding, ad_spend_logs, payout_records, earnings_adjustments, finance tables, hr tables.

**Avoid:** `String(value)` or `value.toFixed(2)` for numeric columns — use `sql\`${value}::numeric\`` or pass numbers and let the trigger cast. Reference: `packages/shared/drizzle/0012_fix_capture_history_insert_numeric.sql`, `apps/api/src/products/products.service.ts`.

---

## The Order Lifecycle (The Most Critical State Machine)

This is the heartbeat of the entire system. Every module connects to this flow. Get this wrong and everything breaks.

```
UNPROCESSED → CS_ASSIGNED → CS_ENGAGED → CONFIRMED → ALLOCATED → DISPATCHED → IN_TRANSIT → DELIVERED → COMPLETED
       |            |              |
       |            |              PARTIALLY_DELIVERED
       |            |              RETURNED
       |            |              RESTOCKED / WRITTEN_OFF
       |            CANCELLED
       CANCELLED
```

- **CS_ASSIGNED**: Set when the algorithm or Head of CS assigns an order to a sales agent; the agent has not yet clicked Engage. Transition to CS_ENGAGED when the agent engages (e.g. clicks Call).

### State Transition Rules (Enforce as Hard Constraints)

| From | To | Trigger | Gate (Must Pass) | Side Effect |
|---|---|---|---|---|
| — | UNPROCESSED | Edge form submission | Dedup check (phone+product, 6hr window) | None — stock not touched yet |
| UNPROCESSED | CS_ASSIGNED | Algorithm or HoS assigns order to agent | Agent has capacity | None — order in agent queue |
| UNPROCESSED | CS_ENGAGED | CS agent takes unassigned order | Agent must have capacity (pending < max) | Order locked to agent for 15 min |
| UNPROCESSED | CANCELLED | CS/HoS cancels | Mandatory reason note (min 10 chars) | None |
| CS_ASSIGNED | CS_ENGAGED | CS agent clicks Engage / Call | Agent must have capacity (pending < max) | Order locked to agent for 15 min |
| CS_ASSIGNED | CANCELLED | CS/HoS cancels | Mandatory reason note (min 10 chars) | None — stock was never reserved |
| CS_ENGAGED | CONFIRMED | CS clicks Confirm | VOIP call_duration > 15 seconds | Stock: Available → Reserved |
| CS_ENGAGED | CANCELLED | CS clicks Cancel | Mandatory reason note (min 10 chars) | None — stock was never reserved |
| CONFIRMED | ALLOCATED | Logistics assigns to 3PL | 3PL location must have available stock | Stock: Reserved → Allocated_to_3PL |
| ALLOCATED | DISPATCHED | 3PL rider picks up | Rider must be assigned | Stock: Allocated → In_Transit |
| DISPATCHED | IN_TRANSIT | Rider confirms departure | GPS ping logged | Delivery timer starts |
| IN_TRANSIT | DELIVERED | Rider confirms delivery | OTP or signature capture | Stock: Deducted. Commission: Triggered. Revenue: Recognized |
| IN_TRANSIT | PARTIALLY_DELIVERED | Rider marks partial | Must specify delivered qty vs returned qty | Split: delivered portion completes, returned portion enters return flow |
| IN_TRANSIT | RETURNED | Rider marks rejected | Mandatory return reason | Return flow begins |
| RETURNED | RESTOCKED | 3PL marks sellable | Quality check by 3PL manager | Stock: +1 at 3PL local inventory |
| RETURNED | WRITTEN_OFF | 3PL marks damaged | Mandatory damage note | Logged as Operational Loss in Finance |

**Hard rules:**
- Orders CANNOT skip states. UNPROCESSED cannot jump to DISPATCHED.
- Every state transition requires an authenticated actor (no system auto-progression without a named user, except UNPROCESSED which is created by the Edge Worker).
- Every state transition is permanently logged in the temporal audit trail.
- The UI must disable state-change buttons that violate the allowed transitions.

---

## Module-Specific Agent Instructions

### When Building the Edge Sales Module
- The form is hosted on a Cloudflare Worker, NOT on the Remix server
- Implement idempotency: hash fingerprint + phone + timestamp to prevent double-submissions
- Implement the circuit breaker: if NestJS API latency > 2000ms or returns 5xx, buffer the order in QStash
- Implement the inventory budget cap: query Redis for (pending + confirmed) count per product. If >= (total_stock - 10% buffer), return a Sold Out response to the form
- The form supports 3 deployment modes: Shadow DOM snippet, iframe, and hosted URL
- Media Buyers select from pre-approved Offer Templates (configured by Stock Manager). They CANNOT set prices or modify product details

### When Building the CS Module
- Phone numbers in API responses must be masked: 0803****1234. The full number is NEVER sent to the frontend
- The Call button sends a call_token to the VOIP provider, which connects the two parties. The frontend never receives the raw number
- Three dispatch modes configurable by HoCS via system_settings (`dispatch_mode`): `load_balanced` (default), `performance`, `claim`
  - `load_balanced` / `performance`: algorithm auto-pushes orders to agents
  - `claim`: orders sit in an open pool; reps race to claim them via `claimOrder()` with atomic Redis/Postgres lock
  - Claim cap (`claim_cap` system setting, default 2): rep blocked from claiming if they have ≥ cap unconfirmed orders — enforced server-side
- The Confirm and No Answer buttons must be DISABLED in the UI until the system receives a VOIP webhook confirming call_duration > 15 seconds for that specific order
- **Order reassignment is a management action only.** CS agents CANNOT transfer orders between themselves. Only HoCS and SuperAdmin can reassign via Hot Swap. The `order_transfer_requests` table and all agent-initiated transfer UI/procedures are REMOVED.
- Head of CS can Hot Swap — select orders from one agent and mass-reassign to another
- When CS updates an order (address change, quantity change, upsell), the system creates a VERSION SNAPSHOT, not an in-place edit. The original data is preserved in the temporal table. The order history timeline shows every change with the agent's name and timestamp

**CS Communication Panel (order detail page):**
- Three channels in one unified panel: Call (existing VOIP), SMS, WhatsApp
- SMS: rep types/selects message, platform sends via messaging bridge (Twilio SMS). Raw phone NEVER exposed.
- WhatsApp: one-click template messages only. Templates have placeholders (`{{customer_name}}`, `{{product_name}}`, `{{order_id}}`, `{{delivery_address}}`, `{{estimated_date}}`). Auto-filled from order data. Rep selects template → previews rendered message → sends. No custom freeform WhatsApp messages.
- All sends go through the platform bridge. Rep never sees the raw phone number.
- Every send is written to `outbound_messages` table AND triggers an `order_timeline_events` entry in the same transaction.
- Template management: HoCS/SuperAdmin create/edit/archive `message_templates` (branch-scoped). New NestJS module: `messaging/`. New tRPC router: `messaging.router.ts`.

**Supervisor Mirror View:**
- HoCS can open a read-only live view of any CS rep's current screen state
- CS rep broadcasts `agent:state_update` event via Socket.io on every route/panel change: `{ agentId, currentRoute, currentOrderId, currentPanel, lastActionAt }`
- Server stores last known agent state in Redis; relays to supervisor's room
- `supervisor:watching` event sent back to rep when mirror is opened — rep must see an "Being Observed" indicator in the UI (transparency requirement)
- Mirror View is strictly read-only. Supervisor cannot take actions through it.
- New Socket.io events: `agent:state_update`, `supervisor:watching`, `supervisor:stopped_watching`

**Order Lifecycle Timeline (shared across ALL order detail pages):**
- Every state transition service method MUST write an `order_timeline_events` row in the same transaction — never separately, never optionally
- Use the `writeTimelineEvent(tx, { orderId, eventType, actorId, actorName, description, metadata })` helper (to be built in `orders.service.ts`)
- `actor_name` is denormalized at write time (snapshot of name at moment of event) — do NOT join on users at query time
- The `OrderTimeline` component (`~/components/ui/order-timeline.tsx`) is shared across all role-specific order detail pages: CS, Logistics, Finance, 3PL, SuperAdmin
- Role filtering of visible event types is applied in the tRPC procedure (`orders.getTimeline`), not in the frontend component

### When Building the Inventory Module
- Inventory is tracked by LOCATION (Main Warehouse, 3PL Location A, 3PL Location B, etc.)
- Product creation supports optional initial stock: quantity + location. When provided, creates a FIFO batch using cost price as factory cost (landing = 0). Restock via Inventory → Stock Intake.
- Use FIFO batch costing: each stock intake is a separate batch with its own landed cost
- Stock states per unit: AVAILABLE, RESERVED, ALLOCATED_TO_3PL, IN_TRANSIT, DELIVERED, RETURNED, WRITTEN_OFF
- The Virtual Buffer means the Sales Module sees 10% less stock than actually exists, preventing overselling during high-traffic bursts
- Ghost Stock prevention: if a 3PL physical count does not match the digital record, the Dispatch button for that location is LOCKED until a Stock Reconciliation form is submitted with mandatory reason codes (Damaged, Lost, Expired, Theft)

### When Building the App Theme System
- 6 theme IDs: `system`, `light`, `dark`, `dim`, `ink`, `soft`
- `users.app_theme` is nullable — `null` means follow org default (`system_settings.client_ui_config.defaultTheme`)
- Always inline `getThemeBootScript()` in `root.tsx` BEFORE `<style>` tags to prevent theme flash on load
- `applyAppTheme(id)` sets `data-app-theme` attribute on `<html>` + adds/removes `dark` class
- `useAppTheme()` hook dispatches a custom `app-theme-change` event for cross-component sync
- Legacy migration: map `'neutral'` → `'dim'` and `'contrast'` → `'light'` on any read from localStorage
- Server persistence: call `users.updateMyAppTheme(appTheme)` via `trpc-browser.ts` (session-less fetch)

### When Building the Push Notification Center
The push system has four layers — all must be consistent:

**1. Mirror In-App → Push**
- In `notifications.service.ts`, after every `db.insert(notifications)`, call `sendPush(userId, { title, body, data: { url }, tag })`.
- Never fire push without also saving the in-app notification row first.

**2. Broadcast (`/admin/notifications/broadcast`)**
- Insert one `push_broadcasts` row, then fan out to all target users' subscriptions as `push_delivery_log` rows with status `SENT`.
- Role scope enforcement server-side: HoCS→CS_AGENT only, HoM→MEDIA_BUYER only, HoLogistics→RIDER+LOGISTICS_MANAGER only, SuperAdmin→all.
- The broadcast tRPC procedure must reject out-of-scope targets even if the client sends them.

**3. Automation Rules (`push_automation_rules` table)**
- `CRON` rules: registered with `@nestjs/schedule` `@Cron()` dynamically from DB at startup + on rule create/update/toggle.
- `EVENT` rules: checked inline in the relevant service method when the event fires (e.g. `ordersService` checks for `order_stuck` rules after status check).
- Placeholders in `title_template`/`body_template` resolved before send: `{{user_name}}`, `{{order_count}}`, `{{product_name}}`, etc.
- Active toggle: disabling a rule must unregister its cron job. Enabling must re-register it.

**4. Delivery Log + Ack**
- Every `sendPush()` call writes to `push_delivery_log` with status `SENT` or `FAILED` (on VAPID error).
- `POST /api/push/ack { logId, event: 'shown' | 'clicked' }` — called from service worker. No session auth, but validate `logId` exists. Updates `shown_at` / `clicked_at` and advances status.
- Stale `410 Gone` VAPID errors → delete the `push_subscriptions` row immediately.
- Resend: re-calls `sendPush()` with the same payload and creates a NEW `push_delivery_log` row (do not mutate the original failed row).

**Platform rules (always apply):**
- Android PWA installed + permission granted → lock screen delivery works.
- iOS 16.4+: MUST be added to Home Screen. Show install banner when `isIOS && !navigator.standalone`. Request notification permission only after banner interaction.
- Every push payload: `{ title, body, icon: '/icon-192.png', badge: '/badge-72.png', data: { url, logId }, tag }`.
- SW `push` handler: always call `self.registration.showNotification()` — never skip even if app is open.
- SW `notificationclick` handler: `clients.openWindow(data.url)` + POST to `/api/push/ack` with `clicked`.
- SW `push` handler: after `showNotification()`, POST to `/api/push/ack` with `shown`.

### When Building the Third-Party Logistics Module
- Third-Party Logistics partners get their OWN login and simplified dashboard (not the full internal UI)
- Dual-Entry Transfer: when Main Warehouse sends 100 units, those units are IN_TRANSIT — NOT available at the 3PL until the 3PL manager clicks Verify and Receive and inputs the actual received quantity
- If received qty < sent qty, the system auto-generates a Shrinkage Alert to the CEO and Head of Logistics
- Local Restock: when a return is marked Sellable by the 3PL, the unit goes directly back into that 3PL local available stock (no return-freight to main warehouse)
- Rider views live inside `apps/web` at the `/rider/` route group — NOT a separate app. Mobile-optimized layouts with PWA offline sync
- Rider Offline Sync: the rider PWA routes store delivery confirmations (with GPS + timestamp) in IndexedDB and syncs when back online. Use last-write-wins with GPS verification to prevent fraudulent timestamping

### When Building the Marketing Module
- Funding Ledger: HoM creates a funding record with amount + receipt image upload. Status starts as SENT. Media Buyer receives a PWA push notification and must click Mark Received (status becomes COMPLETED) or Not Received (status becomes DISPUTED, triggers alert to CEO)
- Ad Spend Logging: Media Buyers log daily spend per product with a MANDATORY Ads Manager screenshot. No screenshot = no log entry accepted
- CPA = Total Ad Spend / Total Orders Created (all statuses)
- True ROAS = Total Revenue from DELIVERED orders only / Total Ad Spend
- If a Media Buyer logged spend vs actual leads exceeds a configurable threshold, auto-alert the Head of Marketing (High CPA Warning)

**Funding Request Notification Rules (never change these):**
- **Media Buyer requests funding** → notify `HEAD_OF_MARKETING` only. HoM is the one who funds them — SuperAdmin and Finance do NOT get this notification.
- **Head of Marketing requests funding** → notify `SUPER_ADMIN` + `FINANCE_OFFICER` only. This is a disbursement request that Finance must act on.
- **Funding disputed** (Media Buyer marks Not Received) → notify `SUPER_ADMIN` + `HEAD_OF_MARKETING`.
- Implemented in `marketing.service.ts` → `createFundingRequest()`. The `if (requesterRole === 'HEAD_OF_MARKETING')` branch handles HoM; the `else` branch handles Media Buyers. Do NOT collapse these or add SuperAdmin/Finance to the Media Buyer branch.

### When Building the Finance Module
- The True Profit formula: Revenue - (Landed COGS + Ad Spend + 3PL Fee + Delivery Fee + Commission)
- Column-Level Security: cost_price, landed_cost, and margin fields are STRIPPED from API responses unless the authenticated user has SuperAdmin or FinanceHead role. Use a NestJS interceptor for this — not frontend hiding
- Invoices use sequential reference numbers (INV-2026-0001). Auto-generated. No manual override
- Budget tracking: Finance Officers set budget limits per department/campaign. Requests exceeding remaining budget trigger a warning (approval still possible but requires explicit override with reason)

### When Building the HR and Payroll Module
- Settlement Window is CONFIGURABLE by HR: Weekly, Bi-weekly, or Monthly
- Commissions are calculated based on DELIVERED_AT timestamp, NOT CREATED_AT. A January order delivered in February is paid in the February cycle
- Clawback Engine: if a delivered order is later returned, the system creates a PENDING_DEDUCTION for both the Media Buyer AND the CS agent. This is subtracted from their next payout as a negative line item
- Add-on Earnings: HR can add manual bonuses (Special Service, Extra Shift, Performance Bonus). Each add-on requires Admin approval and appears as a DISTINCT line item in the staff payout breakdown — not lumped into base pay
- Commission rules are stored as JSONB in a commission_plans table. The structure supports: base salary thresholds (if orders >= X, base = Y), performance multipliers (if delivery_rate > Z%, bonus = W per extra order), and category tags for different staff roles
- Every staff member (CS, Media Buyer, Logistics, etc.) can have their own pay structure. The system is flexible enough that rules can be changed at any time by HR without developer intervention

---

## RBAC Role Matrix

| Role | Dashboard Scope | Can See COGS? | Can See Full Phone? | Can Approve Finance? | Can Edit Commission Rules? |
|---|---|---|---|---|---|
| SuperAdmin | Everything (all branches) | Yes | Via audit log only | Yes | Yes |
| Branch Admin | Own branch — users, settings, reports | No | No | Branch only | No |
| Head of Marketing | Marketing + Media Buyer performance | No | No | No | No |
| Media Buyer | Own campaigns, own orders, own payouts | No | No | No | No |
| Head of CS | CS team performance, all CS orders | No | No | No | No |
| CS Agent | Own assigned orders only | No | No (masked + VOIP) | No | No |
| Finance Officer | All financial data, all orders (read) | Yes | No | Yes (not own requests) | No |
| Head of Logistics | All logistics, all 3PL locations | No | No | No | No |
| Logistics Manager | Assigned location orders | No | No | No | No |
| 3PL Manager | Own location orders + stock only | No | No | No | No |
| 3PL Rider | Own assigned deliveries only | No | No (masked) | No | No |
| Warehouse Manager | Inventory, stock movements, procurement | No | No | No | No |
| HR Manager | All staff payouts, commission configs | No | No | No | Yes |

---

## UI Component Reuse Rules (Non-Negotiable)

**The Platform has a shared component library. Every UI element must use it.**

### Component-First Rule
If a UI pattern appears in **2 or more places**, it must be a shared component in `apps/web/app/components/ui/`. Never duplicate raw Tailwind patterns across feature pages.

### When building new UI, always reach for these components first:

| Need | Use |
|---|---|
| Text input (any type) | `<TextInput />` |
| Multiline text | `<Textarea />` |
| Dropdown select | `<FormSelect />` |
| Amount / currency input | `<AmountInput />` |
| Search bar | `<SearchInput />` |
| Label + input + error wrapper | `<FormField />` (when using custom inputs) |
| Radio buttons | `<RadioGroup />` |
| Checkbox | `<Checkbox />` |
| Button | `<Button />` |
| Modal / dialog | `<Modal />` |
| Confirmation dialog | `<ConfirmActionModal />` |
| Tab navigation | `<Tabs />` |
| Page header (title + actions) | `<PageHeader />` |
| Stat card (KPI) | `<StatCard />` from `card.tsx` |
| Card / panel surface | `<Card />`, `<CardHeader />`, `<CardBody />`, `<CardFooter />` |
| Financial P&L rows | `<StatRow />`, `<StatRowGroup />` |
| Table with sticky header | `<DataTable />` |
| Empty list state | `<EmptyState />` |
| Pagination | `<Pagination />` |
| Status badge (generic) | `<StatusBadge />` |
| Order status badge | `<OrderStatusBadge />` |
| ₦ price display | `<NairaPrice />` |
| Filter pills / toggle group | `<FilterPills />` |
| Key/value detail rows | `<DescriptionList />` |
| Breadcrumb trail | `<Breadcrumb />` |
| Collapsible section | `<Collapsible />` |
| Accordion | `<Accordion />` |
| Toast notifications | `<ToastProvider />` + `useToast()` |
| File upload | `<FileUpload />` |
| Date range filter | `<DateFilterBar />` |
| Dropdown actions menu | `<ActionDropdown />` |
| Loading spinner | `<Spinner />` |

### When a new component IS needed
If you need a UI pattern that isn't in the list above **and** it will appear in 2+ places:
1. Create the component in `apps/web/app/components/ui/`
2. Add it to the table above in this CLAUDE.md
3. Use it immediately in all places it's needed

### Never do this
- Raw `<input className="border rounded...">` — use `<TextInput />`
- Raw `<select className="...">` — use `<FormSelect />`
- Inline `₦{value.toLocaleString()}` — use `<NairaPrice />`
- Manual `<div className="flex justify-between"><span>Label</span><span>Value</span></div>` rows — use `<StatRow />`
- Manual empty state divs with dashed borders — use `<EmptyState />`
- Manual pagination controls — use `<Pagination />`

---

## Code Quality Standards

### TypeScript Strictness
- `strict: true` in all tsconfig files
- No `any` type. Ever. Use `unknown` and narrow with Zod validation
- All API inputs validated with Zod schemas (defined in packages/shared)
- All API outputs typed through tRPC inference

### File Naming and Structure
- Domain-Driven Design: each module (orders, inventory, logistics, marketing, finance, hr) has its own folder with routes/, services/, schemas/, and validators/
- NestJS: one module per domain. Services contain business logic. Controllers are thin (just call services and return)
- Remix: one route file per page. Loaders fetch data. Actions handle mutations. Components render UI. No business logic in components

### Error Handling
- All database operations wrapped in try/catch with meaningful error messages
- All tRPC procedures use Zod input validation — invalid requests fail at the schema level before hitting business logic
- Edge Worker implements graceful degradation — never show a user a 500 error. Buffer the order and show "Order received, processing shortly"

### Testing Requirements
- Every state transition in the Order Lifecycle must have an integration test
- Every permission boundary (RLS) must have a test proving unauthorized access is blocked
- Every edge case documented in the PRD must have a corresponding test case

---

## Multi-Branch Architecture

### Branch Context in Every Write
Every write operation now sets TWO session variables before any mutation:
```sql
SET LOCAL yannis.current_user_id = '<user_uuid>';
SET LOCAL yannis.current_branch_id = '<branch_uuid>';
```
NestJS services must pass `branchId` alongside `actorId` in every write context. RLS policies on branch-scoped tables filter by `current_setting('yannis.current_branch_id', true)`.

### Branch-Scoped Tables
These tables carry `branch_id` and are filtered by RLS: `orders`, `campaigns`, `marketing_funding`, `ad_spend_logs`, `inventory_levels`, `commission_plans`, `payout_records`, `logistics_locations`, `message_templates`, `outbound_messages`, `order_timeline_events`.

**Products and `stock_batches` are NOT branch-scoped** — global catalog. Stock is tracked per branch via `inventory_levels.branch_id`.

### SuperAdmin / Global Finance Bypass
SuperAdmin and global Finance bypass branch RLS entirely. Their session `current_branch_id` is set to `NULL` and RLS policies treat NULL as "show all branches".

### Branch Switcher Session
If a user belongs to multiple branches, the active branch is stored in their Redis session as `currentBranchId`. The sidebar shows a branch selector. Switching branch calls `auth.switchBranch(branchId)` which updates the Redis session.

### New Module: `branches/`
- NestJS: `apps/api/src/branches/` — service, controller, module
- tRPC: `apps/api/src/trpc/routers/branches.router.ts`
- Schema: `packages/shared/src/db/schema/branches.ts`

---

## What NOT To Do

- Do NOT use localStorage or sessionStorage for anything security-sensitive. Sessions live in Redis
- Do NOT expose raw phone numbers in any API response, log, or error message — ever
- Do NOT use auto-incrementing IDs — use UUIDv7
- Do NOT skip the actor injection (`SET LOCAL yannis.current_user_id` AND `SET LOCAL yannis.current_branch_id`) on any write operation
- Do NOT allow state skipping in the order lifecycle — enforce the state machine
- Do NOT use TypeORM — use Drizzle. TypeORM reflection-based types are unreliable for this level of data integrity
- Do NOT hardcode commission rules — they must be dynamic JSONB configs editable by HR
- Do NOT build a separate mobile app or a separate rider app — use PWA route groups within `apps/web` with offline sync
- Do NOT store files locally — use Cloudflare R2 or S3 for all uploads (receipts, screenshots, invoices)
- Do NOT implement the audit trail at the application level — it must be at the PostgreSQL trigger level using temporal tables
- Do NOT use `String()` or `.toFixed(2)` for Drizzle inserts into `numeric` columns — use `sql\`${value}::numeric\`` to avoid trigger type errors
- Do NOT alter a main table without syncing its `*_history` table in the same migration (ADD/DROP columns)
- Do NOT create a new business-data table without a `branch_id` column (exception: products, stock_batches — global catalog)
- Do NOT allow CS agents to initiate order transfers between themselves — only HoCS and SuperAdmin can reassign orders
- Do NOT send raw phone numbers via SMS or WhatsApp — always route through the platform bridge
- Do NOT write `order_timeline_events` rows outside of the same database transaction as the triggering mutation — timeline events must be atomic with their state change
- Do NOT render the Mirror View with any interactive action buttons — it is read-only, always
- Do NOT fire a Web Push without first inserting the in-app notification row — push is always the mirror layer, not a standalone channel
- Do NOT send push from an automation EVENT rule outside the triggering service method's transaction — inline check only
- Do NOT delete a `push_delivery_log` row on failure — mark as `FAILED` and use resend flow
- Do NOT apply app theme changes only on the client — always sync to server via `users.updateMyAppTheme` so the preference survives session restoration
- Do NOT inline theme script AFTER stylesheets — it must be the first `<script>` in `<head>` to prevent flash of wrong theme

---

## Performance Benchmarks (Target)

| Metric | Target |
|---|---|
| Edge Form Load | < 400ms |
| VOIP Connection Latency | < 1.5 seconds |
| Dashboard Data Refresh (Socket.io) | < 60 seconds staleness |
| Customer Profile Search (CS) | < 3 seconds |
| Profit/Loss Report Generation | < 3 seconds for 100k records (use Materialized Views) |
| Order State Transition (API) | < 500ms |
| Offline Sync (Rider PWA) | Auto-sync within 30 seconds of network recovery |

---

## Current Implementation Status (March 2026)

The system is **97%+ complete**. All 7 core modules are fully built with backend services, tRPC routers, and frontend dashboards.

### What Is Built
- **22 NestJS modules** (auth, orders, finance, hr, inventory, logistics, marketing, products, voip, payments, cart, settings, notifications, events, audit, users, permission-requests, permissions, database, common, trpc, branches)
- **19 tRPC routers** (audit, branches, cart, dashboard, finance, health, hr, inventory, logistics, marketing, notifications, orders, permission-requests, product-categories, products, settings, users, voip + root index)
- **65+ Remix routes** across admin, auth, hr, rider, tpl, payment route groups
- **32 feature modules** in `apps/web/app/features/`
- **20 schema files** and **16 validator files** in `packages/shared`
- **55 SQL migrations** including temporal triggers, RLS, history tables, push notification tables, multi-branch schema
- **7 Playwright E2E specs** covering all critical user flows
- **CI/CD pipeline** (.github/workflows/ci.yml + deploy-dev.yml)
- **3 documentation guides** (Developer Guide, Runbook, ADRs)

### What Remains (Infrastructure Only)
- Task 6.1: Multi-CDN DNS Failover (requires DNS provider setup)
- Task 6.3: Load Testing (requires production-scale data)
- Edge Worker KV namespace provisioning (Cloudflare account setup)
- Twilio credential configuration (works in mock mode without)

### Phase 8 — Feature Batch 2 (COMPLETE as of March 2026)
- **Task 8.x: Order Lifecycle Timeline** ✅ — `order_timeline_events` table, `writeTimelineEvent()` helper, `orders.getTimeline` tRPC, `OrderTimeline` UI component
- **Task 9.x: Multi-Branch Architecture** ✅ — `branches` + `user_branches` schema, RLS updates with `yannis.current_branch_id`, branch session context, branch switcher UI, cross-branch reporting, `BRANCH_ADMIN` role
- **Task 10.1: Remove Agent Order Transfer** ✅ — `order_transfer_requests` table + procedures + UI removed
- **Task 11.x: CS Communication Panel** ✅ — `message_templates` + `outbound_messages` schema, `messaging.service.ts`, template management UI, unified call/SMS/WhatsApp comms panel
- **Task 12.x: Supervisor Mirror View** ✅ — `agent:state_update` Socket.io broadcasting, mirror view backend/UI, Team Live View, "Being Observed" indicator for agents
- **Task 13.x: Claim-Based Dispatch Mode** ✅ — `claimOrder()` with atomic Redis/Postgres lock, claim cap enforcement, Claim Queue UI, dispatch mode config in system settings

### Phase 14 — Push Notification Center (COMPLETE as of March 2026)
All 4 layers of the push system are fully operational:

**Schema (4 new tables):**
- `push_subscriptions` — browser VAPID device tokens per user
- `push_broadcasts` — admin-triggered audience broadcasts (branch-scoped optional)
- `push_automation_rules` — CRON/EVENT-based rules (temporal, toggleable, branch-scoped)
- `push_delivery_log` — per-attempt delivery tracking with SENT/SHOWN/CLICKED/FAILED status

**Backend:**
- `NotificationsService` extended with 20+ push methods: `savePushSubscription`, `sendPush`, `broadcastPush`, `fireAutomationRule`, `ackPush`, `resendPush`, `getDeliveryLog`, etc.
- `PushSchedulerService` (`apps/api/src/notifications/push-scheduler.service.ts`) — dynamic CRON job registry using `SchedulerRegistry`; loads all active CRON rules on module init, registers/unregisters jobs on toggle
- `PushController` (`apps/api/src/notifications/push.controller.ts`) — public `POST /push/ack` endpoint (no auth required, called from service worker); validates `logId`, updates `shown_at`/`clicked_at`
- Role-scoped broadcast enforcement: HoCS→CS_AGENT only, HoM→MEDIA_BUYER only, SuperAdmin→all

**Frontend:**
- `usePushSubscription()` hook — browser push register/unsubscribe, VAPID key conversion, calls `notifications.savePushSubscription` tRPC
- `PushPermissionModal` — non-dismissible blocking modal when push permission not granted (iOS gate)
- `IosInstallBanner` — educates iOS users to add PWA to home screen (required for lock-screen push on iOS 16.4+); dismisses up to 3× per session
- Notification panels: `NotificationsBroadcastPanel`, `NotificationsAutomationsPanel`, `NotificationsDeliveryLogPanel` (in `apps/web/app/features/notifications/panels/`)
- `SettingsPushPanel` — push preferences tab in Settings page

**Service Worker (`apps/web/public/sw.js` extended):**
- `push` event: always calls `showNotification()` even when app is open; POSTs `/push/ack` with `shown`
- `notificationclick` event: `clients.openWindow(data.url)` + POST `/push/ack` with `clicked`
- Push payload structure: `{ title, body, icon: '/icon-192.png', badge: '/badge-72.png', data: { url, logId }, tag }`

**Routes:**
- `/admin/notifications` — tabbed notification center (broadcast / automations / log)
- `/admin/notifications/broadcast`, `/admin/notifications/automations`, `/admin/notifications/log` — redirect helpers to tabs
- `/push/ack` — public service worker ack endpoint

### Phase 14 Supplement — Per-User App Theme (COMPLETE)
- 6 themes supported: system, light, dark, dim, ink, soft
- `users.app_theme` column (nullable — null follows org default from `system_settings.client_ui_config`)
- `migration 0055_users_app_theme.sql` adds column to `users` + `users_history`
- `theme.ts` library: `APP_THEMES`, `applyAppTheme()`, `persistAndApplyTheme()`, `getThemeBootScript()` (before-paint inline script to prevent flash)
- `useAppTheme()` hook: manage state + localStorage + server sync via `users.updateMyAppTheme`
- `useServerAppThemeSync.ts` hook: initial sync of server preference to client
- Boot script inlined in `root.tsx` before `<style>` to apply theme before first paint
- Legacy theme migration: `'neutral'` → `'dim'`, `'contrast'` → `'light'` on read
- `trpc-browser.ts` — browser-callable tRPC without session: `fetchClientConfig()`, `postUpdateMyAppTheme()`

### Additional Modules Beyond Original PRD
- **Payments module** (`apps/api/src/payments/`) — Paystack integration for online payments
- **Cart module** (`apps/api/src/cart/`) — Shopping cart for edge form orders
- **TPL dashboard** (`apps/web/app/routes/tpl.*`) — Dedicated 3PL partner portal with inventory, orders, remittances, notifications, settings
- **Delivery remittances** — 3PL delivery fee tracking and settlement
- **Delivery confirmation requests** — OTP/GPS verification system
- **Branches module** (`apps/api/src/branches/`) — Multi-branch management, user-branch assignments, switcher
- **Push Notification Center** — Full VAPID send path, automation rules engine, delivery log, service worker ack

---

## When In Doubt

1. Check the PRD.md for the exact requirement
2. Check the TASK.md for the current sprint priority
3. If the PRD does not cover it, ask — do not assume
4. If you are choosing between fast but fragile and slower but auditable — always choose auditable
5. Every feature you build should answer: "If the CEO asks who did this and when, can the system answer in under 3 seconds?"