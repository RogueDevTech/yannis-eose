# TASK.md — Yannis EOSE: Development Task Workflow

**Project:** Yannis EOSE (Enterprise Operations & Sales Engine)
**Version:** 1.0
**Date:** March 2026
**Status:** Ready for Sprint 1

---

## How To Use This Document

This file is the **build order** for Yannis EOSE. Each phase has dependencies — do not skip ahead. Each task has acceptance criteria — do not mark complete until every criterion is met.

**Priority Legend:**
- 🔴 CRITICAL — Blocks other tasks. Must be done first.
- 🟡 HIGH — Core functionality. Must be in the current phase.
- 🟢 STANDARD — Important but not blocking.
- 🔵 ENHANCEMENT — Can be deferred to a polish phase.

**Status Legend:**
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked (note the blocker)

---

## Phase 0: Project Scaffolding & Infrastructure

> **Goal:** A running monorepo with database, auth, and the audit trail working end-to-end.
> **No UI yet.** This phase is pure infrastructure. If this foundation is wrong, everything built on top will collapse.

---

### Task 0.1 — Monorepo Initialization 🔴
`[x]` Status: Complete
**Dependencies:** None

Set up the TurboRepo (pnpm) monorepo with the following workspace structure:

```
yannis-eose/
├── apps/
│   ├── web/                  # Remix PWA (all dashboards + 3PL rider views)
│   │   └── app/routes/
│   │       ├── admin/        # SuperAdmin module
│   │       ├── auth/         # Login/auth
│   │       ├── cs/           # Customer Service module
│   │       ├── finance/      # Finance module
│   │       ├── hr/           # HR & Payroll module
│   │       ├── logistics/    # Logistics module
│   │       ├── marketing/    # Marketing module
│   │       └── rider/        # 3PL Rider views (mobile-optimized)
│   ├── api/                  # NestJS backend
│   └── edge-worker/          # Cloudflare Worker
├── packages/
│   ├── shared/               # Drizzle schema, Zod validators, tRPC types, enums
│   ├── ui/                   # Shared Tailwind components
│   └── config/               # ESLint, TypeScript, Tailwind shared configs
└── turbo.json
```

**Structural Decisions:**
- **3PL Rider views** are a route group inside `apps/web` at `/rider/` — NOT a separate app. Single Vercel deployment.
- **No Docker.** Postgres 18 and Redis are accessed via cloud/remote connection strings in `.env` files.
- **pnpm** is the package manager (workspace protocol).

**Acceptance Criteria:**
- [x] `turbo dev` starts all apps simultaneously
- [x] TypeScript strict mode enabled in all workspaces
- [x] Shared package imports work across apps (e.g., `import { ORDER_STATUS } from '@yannis/shared'`)
- [x] Postgres 18 and Redis connection strings configured via `.env.example` files
- [x] ESLint + Prettier configured and consistent across all workspaces
- [x] `.env.example` files in each app with required environment variables documented

---

### Task 0.2 — Database Schema (Drizzle + Postgres 18) 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 0.1

Create the complete Drizzle ORM schema in `packages/shared/src/db/schema/`. Every table must use UUIDv7 primary keys and temporal versioning (valid_period tstzrange).

**Tables to create (in dependency order):**

1. `users` — id, name, email, password_hash, role (enum), status, capacity, created_at
2. `products` — id, name, description, sku, base_sale_price, cost_price, min_threshold, category, status
3. `stock_batches` — id, product_id, factory_cost, landing_cost, total_landed_cost, quantity, remaining_quantity, received_at
4. `logistics_providers` — id, name, contact_info, coverage_area, rate_card (JSONB), status
5. `logistics_locations` — id, provider_id, name, address, coordinates, status
6. `inventory_levels` — id, product_id, location_id, batch_id, stock_count, reserved_count, status
7. `offer_templates` — id, product_id, name, price, variants (JSONB), created_by, status
8. `campaigns` — id, media_buyer_id, name, product_ids, offer_template_id, form_config (JSONB), deployment_type (enum: snippet/iframe/hosted), status
9. `orders` — id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id, rider_id, status (enum), items (JSONB), customer_name, customer_phone_hash, customer_address, delivery_address, total_amount, landed_cost, delivery_fee, delivery_notes, parent_order_id (self-ref), created_at, confirmed_at, allocated_at, dispatched_at, delivered_at
10. `order_items` — id, order_id, product_id, quantity, unit_price, batch_id
11. `call_logs` — id, order_id, agent_id, call_token, duration_seconds, call_status, recording_url, transcript, started_at
12. `stock_movements` — id, product_id, movement_type (enum), quantity, from_location_id, to_location_id, reference_id, reason, actor_id, created_at
13. `stock_transfers` — id, product_id, quantity_sent, quantity_received, from_location_id, to_location_id, transfer_status (enum), shrinkage_reason, transfer_cost, created_at, verified_at
14. `marketing_funding` — id, sender_id, receiver_id, amount, receipt_url, status (enum), sent_at, verified_at
15. `ad_spend_logs` — id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date, created_at
16. `invoices` — id, reference_number (sequential), order_id, recipient_info (JSONB), line_items (JSONB), tax_rate, total_amount, status (enum), due_date, created_at
17. `commission_plans` — id, role, plan_name, rules (JSONB), effective_from, effective_to, created_by
18. `payout_records` — id, staff_id, period_start, period_end, base_salary, performance_bonus, add_ons_total, deductions_total, total_payout, status (enum), created_at
19. `earnings_adjustments` — id, staff_id, payout_id, amount, category (enum), reason, approved_by, created_at
20. `notifications` — id, user_id, type, title, body, data (JSONB), read, created_at

**Acceptance Criteria:**
- [ ] All 20 tables created with Drizzle schema definitions
- [ ] All primary keys use UUIDv7 (via `defaultRandom()` or custom UUIDv7 generator)
- [ ] All business tables have `valid_period` (tstzrange) for temporal versioning
- [ ] All enums defined as Postgres enums (order_status, movement_type, transfer_status, funding_status, invoice_status, payout_status, adjustment_category, deployment_type, user_role)
- [ ] Foreign key relationships correctly defined with `references()`
- [ ] Drizzle migration generates clean SQL
- [ ] Migration runs successfully against local Postgres 18

---

### Task 0.3 — Temporal Audit Trail (PostgreSQL Triggers) 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 0.2

Implement the immutable audit trail at the database level.

**Implementation Steps:**
1. Create a PostgreSQL function that reads `current_setting('yannis.current_user_id', true)` and stamps every new row version with the actor's UUID
2. Create triggers on ALL business tables that fire BEFORE INSERT and BEFORE UPDATE, capturing old_value and new_value
3. Create a history partitioning strategy for temporal tables (current rows in main table, historical versions in `_history` suffix tables)
4. Create a PostgreSQL function for "time travel" queries: given a table name, record ID, and timestamp, return the exact state of that record at that point in time

**Acceptance Criteria:**
- [ ] Inserting a row with `SET LOCAL yannis.current_user_id = 'test-uuid'` stamps the audit actor correctly
- [ ] Updating a row preserves the old version with its time range in the history table
- [ ] Time travel query returns correct historical state for any timestamp
- [ ] Attempting to UPDATE or DELETE a history table row fails with an error
- [ ] Failed/blocked access attempts (RLS violations) are logged
- [ ] Bulk operations create individual audit entries per record

---

### Task 0.4 — Authentication & Session Management 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 0.2

Implement hybrid Redis-backed session authentication in NestJS.

**Implementation Steps:**
1. Create `AuthModule` in NestJS with login/logout endpoints
2. On login: validate credentials, generate a cryptographically random session token, store session in Redis with user data (id, role, permissions), set HTTP-only secure cookie
3. On every authenticated request: read cookie, look up session in Redis, attach user context to request
4. On logout: delete session from Redis immediately (instant revocation)
5. Create `@Roles()` decorator for route-level RBAC enforcement
6. Create an `AuditInterceptor` that wraps every mutating request in a transaction with `SET LOCAL yannis.current_user_id`

**Acceptance Criteria:**
- [ ] Login returns HTTP-only secure cookie with session token
- [ ] Session data stored in Redis with configurable TTL (default: 24 hours)
- [ ] Logout instantly invalidates session (subsequent requests with same cookie fail)
- [ ] `@Roles('SuperAdmin', 'Finance')` decorator correctly restricts endpoint access
- [ ] AuditInterceptor injects user_id into every Postgres transaction automatically
- [ ] SuperAdmin can "kill" any user's session (instant deactivation)
- [ ] Rate limiting: max 5 failed login attempts per IP per 15 minutes

---

### Task 0.5 — Row-Level Security (RLS) Policies 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 0.3, Task 0.4

Implement Postgres RLS policies so that even if the application layer has a bug, unauthorized data access is blocked at the database level.

**Policies to implement:**
1. `orders` — CS agents see only rows where `assigned_cs_id = current_user_id`. Media Buyers see only rows where `media_buyer_id = current_user_id`. Third-Party Logistics Managers see only rows where `logistics_location_id` belongs to their provider. Finance, Head of Logistics, SuperAdmin see all.
2. `products` — `cost_price` column excluded from default SELECT for all roles except SuperAdmin and Finance. (Use a security-barrier view or column-level grants.)
3. `inventory_levels` — Third-Party Logistics Managers see only their location. Warehouse Manager sees main warehouse. Head of Logistics and SuperAdmin see all.
4. `marketing_funding` — Media Buyers see only records where `receiver_id = current_user_id`. HoM sees records where `sender_id = current_user_id`. Finance and SuperAdmin see all.
5. `payout_records` — Staff see only their own records. HR and SuperAdmin see all.

**Acceptance Criteria:**
- [ ] CS agent querying orders table returns ONLY their assigned orders
- [ ] Media Buyer querying orders table returns ONLY orders from their campaigns
- [ ] Third-Party Logistics Manager sees only their location's inventory and orders
- [ ] Direct SQL query (bypassing NestJS) with a CS agent's session still enforces RLS
- [ ] SuperAdmin bypasses all RLS policies
- [ ] Column-level restriction: Media Buyer SELECT on products returns NULL for cost_price

---

### Task 0.6 — tRPC Setup & Shared Type Contract 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 0.1

Configure tRPC to share types between the NestJS API and Remix frontend.

**Implementation Steps:**
1. Install tRPC server in NestJS, tRPC client in Remix
2. Create the root `appRouter` in NestJS that merges all module routers
3. Export the `AppRouter` type from `packages/shared`
4. Configure Remix to import the type and create a typed tRPC client
5. Install `trpc-openapi` and configure it to auto-generate Swagger docs from tRPC routers
6. Set up Swagger UI at `/api/docs` for external consumers

**Acceptance Criteria:**
- [ ] Calling `trpc.orders.getById.useQuery({ id: '...' })` in Remix returns fully typed data
- [ ] Changing a field name in the NestJS router causes a TypeScript error in Remix at compile time
- [ ] Swagger UI accessible at `/api/docs` with all endpoints documented
- [ ] Zod input validators are shared between tRPC and Swagger
- [ ] All tRPC procedures use Zod for input validation (no unvalidated inputs)

---

### Task 0.7 — Socket.io Real-Time Infrastructure 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 0.4

Set up WebSocket infrastructure for live dashboard updates.

**Implementation Steps:**
1. Install and configure Socket.io in NestJS
2. Create authenticated WebSocket connections (validate session token on connection)
3. Create "rooms" per role: `admin`, `cs-{user_id}`, `finance`, `logistics`, `marketing-{user_id}`, `3pl-{location_id}`
4. Create an event emitter service that publishes events when key actions occur (order status change, new approval request, stock alert, etc.)
5. Configure Remix to connect to Socket.io and update dashboard data on events

**Acceptance Criteria:**
- [ ] Authenticated users connect to Socket.io with their session
- [ ] Users only receive events for their role-appropriate room
- [ ] Order status change in NestJS triggers a real-time update on the CS and Logistics dashboards
- [ ] New financial approval request triggers real-time notification on Finance dashboard
- [ ] Connection drops gracefully and reconnects automatically
- [ ] Maximum staleness of dashboard data: 60 seconds

---

## Phase 1: Core Order Flow (The Heartbeat)

> **Goal:** A customer can submit an order, a CS agent can confirm it, and the order moves through the lifecycle.
> This is the minimum viable flow that proves the architecture works end-to-end.

---

### Task 1.1 — Order Submission (Edge Worker) 🔴
`[ ]` Status: Not Started
**Dependencies:** Phase 0 complete

Build the Cloudflare Worker that receives form submissions at the Edge.

**Implementation Steps:**
1. Create the Edge Worker project in `apps/edge-worker/`
2. Implement the submission handler:
   - Rate limit: 3 per IP per 5 minutes (use Cloudflare KV or in-memory)
   - Dedup: hash `phone + product_id`, check Redis (or Cloudflare KV) for 6-hour window
   - Inventory cap: check `(pending + confirmed)` vs `(total_stock - 10%)` from Redis
   - Primary path: POST to NestJS API, return success
   - Failover path: if API unreachable (timeout >2000ms or 5xx), buffer in QStash
3. Implement the "Healer" sync: cron job that drains QStash buffer every 60 seconds when API is healthy
4. Implement customer phone number hashing before storage (never store raw phone at the Edge)

**Acceptance Criteria:**
- [ ] Form submission reaches NestJS and creates order with status UNPROCESSED
- [ ] Duplicate submission within 6 hours is flagged as POTENTIAL_DUPLICATE
- [ ] When API is artificially killed, order is buffered in QStash
- [ ] When API recovers, buffered orders sync within 60 seconds
- [ ] Inventory cap triggers "Sold Out" response when threshold is reached
- [ ] Rate limiter blocks 4th submission from same IP within 5 minutes
- [ ] Response time < 400ms for successful submission

---

### Task 1.2 — Sales Form Builder (Media Buyer) 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 0.6, Task 0.2

Build the form creation interface for Media Buyers.

**Implementation Steps:**
1. Create Offer Templates CRUD (Stock/Product Manager role only)
   - Select product, set price, configure variants, set allowed quantities
2. Create Campaign Form Builder (Media Buyer role)
   - Select from Offer Templates dropdown (CANNOT change price or product details)
   - Configure form fields: customer name, phone, address, delivery notes
   - Set campaign name, thank-you page URL
3. Generate unique `campaign_id` on creation
4. Generate 3 deployment outputs:
   - Shadow DOM `<script>` snippet
   - iFrame embed URL
   - Hosted page URL (`checkout.yannis.com/campaign-{id}`)
5. Create the hosted checkout page in Remix (public route, no auth required)

**Acceptance Criteria:**
- [ ] Stock Manager can create/edit Offer Templates with price and product details
- [ ] Media Buyer sees only a dropdown of approved templates (cannot type custom prices)
- [ ] Campaign creation generates all 3 deployment outputs
- [ ] Shadow DOM snippet renders correctly on an external test page
- [ ] iFrame renders correctly with proper sizing
- [ ] Hosted URL loads the form and submits successfully to the Edge Worker
- [ ] Form submissions include campaign_id and media_buyer_id for attribution

---

### Task 1.3 — CS Dashboard & Weighted Dispatch 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 1.1, Task 0.7

Build the CS agent's workspace and the automatic order assignment system.

**Implementation Steps:**
1. Create the dispatch service in NestJS:
   - On new UNPROCESSED order: query active CS agents, count pending orders per agent
   - Assign to agent with lowest `active_pending_count`
   - If tied, assign to agent with oldest `last_action_timestamp` (most idle)
   - Respect agent capacity limits (set by Head of CS)
2. Create CS Agent dashboard in Remix:
   - Personal queue showing: order ID, customer name (masked phone), product, status, time in queue
   - Order detail panel (nested route — sidebar stays static)
   - "Call Customer" button (initiates VOIP — see Task 1.4)
   - Status update buttons with gates (see Task 1.4)
   - Order modification form (address, quantity, delivery time)
3. Create Head of CS dashboard:
   - Agent performance overview: pending count, calls made today, confirmation rate
   - Hot Swap interface: drag-and-drop or bulk-select reassignment
   - Agent status management: set Active/Inactive, set capacity

**Acceptance Criteria:**
- [ ] New orders auto-assign to the least-loaded active agent
- [ ] Agent with 2 pending orders receives the next order over agent with 5 pending
- [ ] CS agent sees ONLY their assigned orders (RLS enforced)
- [ ] Head of CS can reassign single or bulk orders between agents
- [ ] Reassignment logged in audit trail with actor and reason
- [ ] Agent going inactive (no action > 10 min) triggers notification to Head of CS
- [ ] Order detail panel loads without refreshing the sidebar (nested routing)

---

### Task 1.4 — VOIP Integration & Privacy Shield 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 1.3

Integrate Twilio/MessageBird for click-to-call with full lead masking.

**Implementation Steps:**
1. Create VOIP service in NestJS:
   - `initiateCall(order_id, agent_id)` → generates call_token, sends to VOIP provider
   - VOIP provider connects agent (WebRTC) to customer (PSTN) using the company's verified number
   - Agent browser receives WebRTC audio stream
2. Create VOIP webhook handler:
   - Receives: call_duration, call_status, recording_url
   - Stores call_log linked to order_id and agent_id
   - Emits Socket.io event to update the CS dashboard
3. Create the phone masking interceptor:
   - All API responses containing phone numbers are processed through a masking function
   - Output: `0803****1234` (first 4 digits + **** + last 4 digits)
   - Full number NEVER sent to frontend under any circumstances
4. Implement Status Lock logic:
   - "Confirm" button: disabled until call_log exists with duration > 15s
   - "No Answer" button: disabled until call_log exists (any duration) OR VOIP reports no_answer
   - "Cancel" button: always enabled, requires reason (min 10 chars)
5. Implement incoming call routing:
   - VOIP webhook for inbound calls → match phone number to order → route to assigned agent
   - PWA Web Push notification: "Incoming Call: Order #502"

**Acceptance Criteria:**
- [ ] Agent clicks "Call" → phone rings on customer's end → WebRTC audio in agent's browser
- [ ] Customer sees the company's verified business number on caller ID
- [ ] Agent NEVER sees full phone number in DOM, network tab, or console
- [ ] Call duration and status are logged in call_logs table
- [ ] "Confirm" button stays disabled until call_duration > 15 seconds
- [ ] "No Answer" button stays disabled until VOIP confirms a call attempt was made
- [ ] Incoming call from customer routes to the correct assigned agent
- [ ] Call recording URL stored (if recording enabled in config)
- [ ] ACCESS_EVENT logged in audit trail when agent clicks "Call"

---

### Task 1.5 — Order State Machine & Transitions 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 1.3

Implement the strict order lifecycle state machine.

**Implementation Steps:**
1. Create an `OrderStateMachine` service in NestJS that enforces all transition rules:
   - Validates: current_status + requested_new_status = allowed transition
   - Validates: all gates pass (call duration, reason notes, stock availability, etc.)
   - Executes: side effects (stock reservation, commission trigger, etc.)
   - Logs: audit trail entry with old_status, new_status, actor, timestamp
2. Create the transition endpoint: `trpc.orders.transition.mutate({ order_id, new_status, metadata })`
3. Implement version snapshotting for order modifications (address change, upsell, quantity change):
   - Store parent_order_id linking to the original
   - Temporal table preserves all previous versions
4. Implement partial delivery logic:
   - Split order into delivered portion and returned portion
   - Each portion follows its own status flow independently

**Acceptance Criteria:**
- [ ] UNPROCESSED → CONFIRMED requires call_duration > 15s (rejects otherwise)
- [ ] UNPROCESSED → DISPATCHED is rejected (cannot skip states)
- [ ] CONFIRMED → ALLOCATED checks 3PL stock availability
- [ ] Every transition creates an audit entry with actor_id and timestamp
- [ ] Order modification creates a version snapshot (original preserved in temporal table)
- [ ] Partial delivery splits order correctly with independent status flows
- [ ] Cancel requires mandatory reason note (min 10 chars) — empty reason rejected
- [ ] UI buttons for disallowed transitions are disabled (not just server-rejected)

---

## Phase 2: Inventory & Third-Party Logistics

> **Goal:** Stock is tracked accurately across all locations. Third-Party Logistics partners can verify transfers, manage riders, and handle returns.

---

### Task 2.1 — Product & Inventory Management 🔴
`[ ]` Status: Not Started
**Dependencies:** Phase 1 complete

**Implementation Steps:**
1. Create Product CRUD (Stock/Product Manager role):
   - Name, description, SKU, images, base_sale_price, cost_price, min_threshold, category
   - cost_price visible only to SuperAdmin and Finance (column-level security)
2. Create Stock Batch management:
   - Record new batch: product, factory_cost, landing_cost, quantity, received_date
   - System calculates total_landed_cost per unit
   - Track remaining_quantity per batch (decremented on FIFO basis)
3. Create Inventory Level views:
   - Per-location breakdown: Main Warehouse, each 3PL location
   - Per-status breakdown: Available, Reserved, In Transit, etc.
   - Low-stock alerts: auto-notify when quantity < min_threshold
4. Create Stock Movement logging:
   - Every movement creates a record: type, quantity, from, to, reference, reason, actor
   - Corrections require reversal movements (never delete)

**Acceptance Criteria:**
- [ ] Product created with all required fields
- [ ] cost_price returns NULL in API response for non-Finance/SuperAdmin roles
- [ ] New batch created with correct landed cost calculation
- [ ] FIFO: orders consume oldest batch first
- [ ] Batch remaining_quantity decrements correctly on order delivery
- [ ] Low-stock alert triggers when quantity drops below threshold
- [ ] Stock movement log is append-only (no deletions)
- [ ] Inventory exportable as CSV

---

### Task 2.2 — Third-Party Logistics Partner Management 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 2.1

**Implementation Steps:**
1. Create Logistics Provider CRUD (Head of Logistics / SuperAdmin):
   - Company name, contact, coverage area, rate card
2. Create Logistics Location CRUD:
   - Location name, address, GPS coordinates, linked provider
3. Create Third-Party Logistics Manager login and simplified dashboard:
   - Incoming transfers (pending verification)
   - Active orders assigned to their location
   - Rider management
   - Returns queue
   - Local stock levels
4. Create Third-Party Logistics Rider login and mobile-optimized views (route group `/rider/` inside `apps/web`):
   - Assigned deliveries list
   - Delivery confirmation (mark Delivered/Partial/Returned with GPS)
   - Offline capability (IndexedDB + background sync via PWA service worker)

**Acceptance Criteria:**
- [ ] Third-Party Logistics Manager sees ONLY their location's data (RLS enforced)
- [ ] Rider sees ONLY their assigned deliveries
- [ ] Rider PWA works offline (delivery marked, syncs when online)
- [ ] Offline sync includes GPS coordinates for fraud verification
- [ ] Third-Party Logistics Manager can assign/reassign riders to orders

---

### Task 2.3 — Dual-Entry Stock Transfer System 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 2.1, Task 2.2

**Implementation Steps:**
1. Create transfer initiation (Warehouse Manager / Head of Logistics):
   - Select product, quantity, destination 3PL location
   - System generates transfer_id, status: SENT
   - Stock: AVAILABLE → IN_TRANSIT_TO_3PL
2. Create transfer verification (Third-Party Logistics Manager):
   - Notification: "Incoming Transfer #TRF-2026-0042"
   - Manager enters received_quantity
   - If received = sent: status VERIFIED, stock → AVAILABLE_AT_3PL
   - If received < sent: status VERIFIED_WITH_DISCREPANCY
     - Manager selects reason codes for missing units (Damaged, Lost, etc.)
     - Shrinkage Alert auto-sent to CEO and Head of Logistics
     - Missing units logged as Operational Loss
3. Calculate internal fulfillment cost:
   - Transfer cost / received quantity = per-unit fulfillment cost
   - Added to the landed_cost for those units at that location

**Acceptance Criteria:**
- [ ] Transfer created, stock status changes to IN_TRANSIT_TO_3PL
- [ ] Stock is NOT available at 3PL until verification
- [ ] Verification with full quantity: all units become AVAILABLE_AT_3PL
- [ ] Verification with discrepancy: shrinkage logged, alert sent, reason required
- [ ] Fulfillment cost correctly calculated and added to unit COGS
- [ ] Transfer not verified after 48 hours triggers escalation alert
- [ ] Full audit trail for every step of the transfer

---

### Task 2.4 — Returns & Local Restock 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 2.3

**Implementation Steps:**
1. Create return processing flow (Third-Party Logistics Manager):
   - View returned items queue
   - For each item: assess condition → "Sellable" or "Damaged"
   - Sellable: RETURNED → RESTOCKED (added to local 3PL available stock)
   - Damaged: RETURNED → WRITTEN_OFF (logged as Operational Loss with damage note)
2. Create stock reconciliation form:
   - Third-Party Logistics Manager reports physical count discrepancy
   - Must select reason code per missing unit
   - Dispatch button LOCKED until reconciliation submitted
3. Link returns to Finance:
   - Written-off units appear in Operational Loss report
   - Restocked units update inventory and are available for next order

**Acceptance Criteria:**
- [ ] Returned item assessed as "Sellable" increments local 3PL stock
- [ ] Returned item assessed as "Damaged" creates a write-off entry
- [ ] Written-off cost appears in CEO's Operational Loss dashboard
- [ ] Ghost stock (discrepancy) locks the Dispatch button for that location
- [ ] Reconciliation form requires reason codes — submission unlocks Dispatch
- [ ] Every return and restock action logged in audit trail

---

## Phase 3: Marketing & Finance

> **Goal:** Full marketing cash flow tracking and financial transparency.

---

### Task 3.1 — Marketing Funding Ledger 🔴
`[ ]` Status: Not Started
**Dependencies:** Phase 1 complete

**Implementation Steps:**
1. Create "Create Funding Record" form (HoM):
   - Amount, payment method, recipient (Media Buyer), receipt upload (mandatory)
   - Status: SENT on creation
2. Create verification flow (Media Buyer):
   - PWA push notification on new funding
   - "Mark Received" → status: COMPLETED, internal balance increases
   - "Not Received" → status: DISPUTED, auto-alert to CEO and HoM
3. Create funding overview dashboard:
   - HoM sees: all sent funds, statuses, total disbursed
   - Media Buyer sees: received funds, available balance
   - Finance/SuperAdmin sees: all records across all buyers

**Acceptance Criteria:**
- [ ] HoM creates funding record with mandatory receipt upload
- [ ] Media Buyer receives PWA push notification
- [ ] "Mark Received" updates balance correctly
- [ ] "Not Received" triggers alert to CEO
- [ ] Media Buyer's total budget = SUM of COMPLETED funding records only
- [ ] Receipt images stored in R2/S3 and linked to the record
- [ ] Full audit trail on all funding status changes

---

### Task 3.2 — Ad Spend Logging & Performance Metrics 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 3.1, Task 1.2

**Implementation Steps:**
1. Create ad spend log form (Media Buyer):
   - Select product/campaign, date range, amount, screenshot upload (mandatory)
   - No screenshot = form submission blocked
2. Create automated metric calculations:
   - CPA = Total Ad Spend / Total Orders Created
   - True ROAS = Revenue from DELIVERED orders / Total Ad Spend
   - Delivery Rate = Delivered / Total Created
3. Create High CPA Warning system:
   - Configurable threshold per product/campaign (set by HoM or Finance)
   - Auto-alert when threshold exceeded
4. Create Media Buyer performance dashboard:
   - Personal stats: CPA, ROAS, delivery rate, order count
   - Campaign breakdown with per-campaign metrics

**Acceptance Criteria:**
- [ ] Ad spend entry rejected without screenshot upload
- [ ] CPA, ROAS, and Delivery Rate calculated correctly
- [ ] ROAS uses only DELIVERED order revenue (not all orders)
- [ ] High CPA threshold triggers alert to HoM
- [ ] Media Buyer sees own metrics only (RLS enforced)
- [ ] Performance dashboard updates in real-time via Socket.io

---

### Task 3.3 — Financial Core: True Profit Dashboard 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 2.1, Task 3.2

**Implementation Steps:**
1. Create the True Profit calculation engine:
   - Per order: Revenue - (Landed COGS + Delivery Fee + Ad Spend portion + Commission)
   - Per product: aggregate across all orders
   - Per campaign: aggregate across all orders from that campaign
   - Per Media Buyer: aggregate across all their campaigns
2. Create column-level security interceptor:
   - Strip cost_price, landed_cost, margin from responses for non-authorized roles
3. Create CEO Profit Dashboard:
   - Real-time revenue vs cost breakdown
   - Operational Loss (write-offs, shrinkage) as separate line
   - Third-Party Logistics balance (amount owed to each provider)
   - Per-product profitability ranking
4. Create Materialized Views for report performance:
   - Profit/Loss report must load in < 3 seconds for 100k records

**Acceptance Criteria:**
- [ ] True Profit per order matches manual calculation
- [ ] FIFO batch cost correctly applied (Batch A cost used before Batch B)
- [ ] Column-level security: Media Buyer API response has no cost fields
- [ ] CEO dashboard shows real-time profit with all cost layers
- [ ] Operational Loss appears as separate category
- [ ] Report loads in < 3 seconds with 100k order records
- [ ] Materialized views refresh on relevant data changes

---

### Task 3.4 — Centralized Approval Queue & Budget Tracking 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 3.3

**Implementation Steps:**
1. Create unified approval queue (Finance Officer):
   - All requests: media spend, procurement, logistics, ad-hoc
   - Sort by date, with urgent items flagged
   - Approve / Reject / Query — all require mandatory reason note
2. Implement approval constraints:
   - Cannot approve own requests
   - Locking mechanism prevents two officers acting on same request
3. Create budget tracker:
   - Budget limits per department/campaign (set by Finance)
   - Track: Total Budget, Approved, Committed, Remaining
   - Over-budget warning before approval (requires explicit override)

**Acceptance Criteria:**
- [ ] All request types appear in single unified queue
- [ ] Self-approval blocked (server rejects, not just UI hidden)
- [ ] Concurrent approval prevented (lock mechanism)
- [ ] Over-budget warning displayed, override requires explicit confirmation
- [ ] All approval decisions logged with actor and reason in audit trail

---

### Task 3.5 — Invoicing System 🟢
`[ ]` Status: Not Started
**Dependencies:** Task 3.3

**Implementation Steps:**
1. Create invoice generation:
   - Linked to order ID (auto-populate) or manual entry
   - Sequential reference: INV-2026-0001 (auto-generated, no manual override)
   - Line items, tax, total, recipient details, due date
2. Create invoice status flow: DRAFT → SENT → PAID / OVERDUE
3. Create PDF export (professional format)
4. Create invoice dashboard: outstanding, paid, overdue counts and totals

**Acceptance Criteria:**
- [ ] Reference numbers are sequential and auto-generated
- [ ] PDF export renders cleanly with all line items
- [ ] Status transitions logged in audit trail
- [ ] Overdue invoices auto-flagged after due date
- [ ] Dashboard totals match sum of individual invoices

---

## Phase 4: HR, Payroll & Commission Engine

> **Goal:** Automated, flexible compensation with full clawback support.

---

### Task 4.1 — Commission Plans & Rules Engine 🔴
`[ ]` Status: Not Started
**Dependencies:** Phase 3 complete

**Implementation Steps:**
1. Create commission_plans CRUD (HR Manager / SuperAdmin):
   - JSONB rules structure with: base_salary thresholds, performance multipliers, penalty rates
   - effective_from / effective_to dates (changes only apply to future periods)
2. Create the calculation engine:
   - Query delivered orders for the settlement period per staff member
   - Apply FIFO rule matching: base threshold first, then multipliers
   - Calculate delivery_rate from orders data
   - Apply penalties for returns
3. Support different plans per role (CS Agent, Media Buyer, etc.)
4. Allow HR to preview payout calculations before finalizing

**Acceptance Criteria:**
- [ ] JSONB rules correctly parsed and applied
- [ ] Base salary threshold works (20 delivered orders = base pay triggers)
- [ ] Performance bonus calculated correctly (per extra order × rate, if delivery_rate > threshold)
- [ ] Penalty for returns correctly deducted
- [ ] Rule changes after effective_from do NOT retroactively affect closed periods
- [ ] Different plans can be assigned to different roles
- [ ] HR can preview calculations before locking the period

---

### Task 4.2 — Settlement & Payout Generation 🔴
`[ ]` Status: Not Started
**Dependencies:** Task 4.1

**Implementation Steps:**
1. Create settlement window configuration (HR):
   - Options: Weekly, Bi-weekly, Monthly
   - Configurable start day
2. Create payout generation service:
   - Run at end of settlement period (manual trigger by HR or scheduled)
   - For each staff member: calculate base + bonus + add-ons - deductions
   - Generate DRAFT payout record
   - HR reviews and approves → status: APPROVED → PAID
3. Implement cross-month settlement:
   - Orders use DELIVERED_AT timestamp for period assignment
   - January order delivered February 3 → February settlement
4. Create staff payout view:
   - Breakdown: base salary, performance bonus, add-ons (itemized), deductions (itemized), total
   - Historical payouts with full breakdown

**Acceptance Criteria:**
- [ ] Settlement window configurable (weekly/bi-weekly/monthly)
- [ ] Payout correctly uses DELIVERED_AT date for period assignment
- [ ] Cross-month orders assigned to correct period
- [ ] DRAFT → APPROVED → PAID flow with HR review
- [ ] Staff sees itemized breakdown of their payout
- [ ] Historical payouts accessible with full detail

---

### Task 4.3 — Clawback Engine 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 4.2

**Implementation Steps:**
1. Create a trigger: when an order transitions to RETURNED, check if commission was previously paid
2. If yes: create PENDING_DEDUCTION for affected staff (Media Buyer AND CS Agent)
3. In next payout calculation: subtract pending deductions
4. Display clawbacks as negative line items in payout breakdown
5. Handle edge case: clawbacks exceeding earnings (cap at zero, no debt carried forward unless configured)

**Acceptance Criteria:**
- [ ] Returned order after payout creates PENDING_DEDUCTION records
- [ ] Next payout correctly subtracts deductions
- [ ] Clawback appears as distinct negative line item (not hidden in base pay)
- [ ] Deductions linked to specific order IDs for auditability
- [ ] Negative payout capped at zero (no debt) by default
- [ ] Full audit trail on all clawback events

---

### Task 4.4 — Add-on Earnings 🟢
`[ ]` Status: Not Started
**Dependencies:** Task 4.2

**Implementation Steps:**
1. Create add-on entry form (HR Manager):
   - Staff member, amount, category (OVERTIME/BONUS/SPECIAL_SERVICE/REIMBURSEMENT)
   - Mandatory reason text
   - Linked to a settlement period
2. Create approval flow:
   - HR creates → Admin approves
   - Approved add-ons included in payout calculation
3. Display as distinct line items in staff payout breakdown

**Acceptance Criteria:**
- [ ] Add-on created with category, amount, and reason
- [ ] Requires Admin approval before inclusion in payout
- [ ] Appears as separate line item: "Special Service Bonus: $5,000 (Approved by: Admin Tunde)"
- [ ] Unapproved add-ons do NOT appear in payout calculation
- [ ] Full audit trail on creation and approval

---

## Phase 5: Dashboard & Command Centre

> **Goal:** Every role sees a personalized, real-time dashboard on login.

---

### Task 5.1 — Role-Based Dashboard System 🔴
`[ ]` Status: Not Started
**Dependencies:** Phases 1-4 complete

Build the unified dashboard that renders different content based on the authenticated user's role.

**Dashboards to build:**

1. **SuperAdmin:** Platform-wide KPIs, revenue vs cost graph, critical alerts (red), quick links to all modules
2. **Head of CS:** Agent performance table, queue health metrics, Hot Swap interface, SLA timers
3. **CS Agent:** Personal queue, call button, order detail panel, today's performance stats
4. **Media Buyer:** Campaign performance, CPA/ROAS metrics, funding balance, payout history
5. **HoM:** All Media Buyer performance comparison, total budget vs spend, campaign ROI
6. **Finance Officer:** Approval queue, budget tracker, invoice summary, True Profit overview
7. **Head of Logistics:** All Third-Party Logistics performance, transfer status, delivery metrics
8. **Warehouse Manager:** Stock levels across locations, low-stock alerts, movement log, pending procurement
9. **Third-Party Logistics Manager:** Incoming transfers, active deliveries, returns queue, local stock
10. **Third-Party Logistics Rider:** Assigned deliveries, delivery confirmation interface (mobile-optimized)
11. **HR Manager:** Payout overview, pending approvals, commission rule management

**Acceptance Criteria:**
- [ ] Login redirects to role-appropriate dashboard automatically
- [ ] Each dashboard shows ONLY data the user is authorized to see
- [ ] All dashboards update in real-time via Socket.io (< 60s staleness)
- [ ] Critical alerts (SLA breaches, shrinkage, disputed funding) highlighted in red
- [ ] Click-through navigation from dashboard metrics to detailed views
- [ ] Dashboard renders within 2 seconds of login
- [ ] Mobile-responsive layout for all dashboards

---

### Task 5.2 — Notification System 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 5.1

**Implementation Steps:**
1. Create notification service in NestJS:
   - In-app notifications (stored in notifications table)
   - PWA Web Push notifications (for offline/minimized users)
   - Socket.io real-time push (for active users)
2. Create notification triggers for key events:
   - New order assigned (CS Agent)
   - Funding sent/received (HoM/Media Buyer)
   - Approval request (Finance)
   - SLA breach (Head of CS)
   - Shrinkage alert (CEO/Head of Logistics)
   - Low stock alert (Warehouse Manager)
   - Incoming call (CS Agent)
   - Payout generated (All staff)
3. Create notification UI:
   - Bell icon with unread count in global header
   - Dropdown list of recent notifications
   - Click-through to relevant record

**Acceptance Criteria:**
- [ ] In-app notifications appear in real-time
- [ ] PWA push works when browser is minimized
- [ ] Unread count badge updates correctly
- [ ] Clicking notification navigates to the relevant record
- [ ] Notifications respect RBAC (users only get notifications for their authorized data)

---

## Phase 6: Resilience & Hardening

> **Goal:** The system survives infrastructure failures and scales under load.

---

### Task 6.1 — Multi-CDN DNS Failover 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 1.1

**Implementation Steps:**
1. Configure DNS health checks (Route 53 or NS1)
2. Primary: Cloudflare Workers for form hosting
3. Secondary: Fastly or Akamai with identical form logic
4. Health check: if primary returns 5xx for > 60 seconds, auto-failover to secondary
5. Static fallback: bare HTML form on separate cloud storage (Azure Blob / GCS) with IndexedDB-based offline submission

**Acceptance Criteria:**
- [ ] DNS failover triggers within 60 seconds of primary failure
- [ ] Secondary CDN serves identical form functionality
- [ ] Static fallback captures orders in IndexedDB when all CDNs fail
- [ ] Orders from all paths eventually sync to primary database

---

### Task 6.2 — PWA Offline Capabilities 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 5.1

**Implementation Steps:**
1. Configure Service Worker in Remix for:
   - Static asset caching (app shell)
   - Background sync for pending mutations
   - Web Push notification handling
2. Rider-specific offline features:
   - Cache assigned deliveries in IndexedDB
   - Queue delivery confirmations with GPS + timestamp
   - Auto-sync on network recovery (within 30 seconds)
3. CS Agent offline features:
   - Cache current queue for viewing (read-only when offline)
   - Queue is refreshed on reconnection

**Acceptance Criteria:**
- [ ] App loads from cache when offline (app shell renders)
- [ ] Rider can mark deliveries offline — data syncs when online
- [ ] Synced data includes GPS coordinates and original offline timestamp
- [ ] CS agent can view cached queue offline (read-only)
- [ ] Background sync completes within 30 seconds of network recovery

---

### Task 6.3 — Load Testing & Performance Validation 🟢
`[ ]` Status: Not Started
**Dependencies:** All phases complete

**Implementation Steps:**
1. Set up load testing (k6 or Artillery)
2. Test scenarios:
   - 1,000 concurrent form submissions
   - 100 concurrent CS agents on dashboard
   - Profit report generation with 100k orders
3. Optimize with: database indexes, Materialized Views, Redis caching, connection pooling

**Acceptance Criteria:**
- [ ] Edge form handles 1,000 concurrent submissions without errors
- [ ] Dashboard serves 100 concurrent users with < 2s load time
- [ ] Profit report loads in < 3 seconds with 100k records
- [ ] All performance benchmarks from PRD.md met

---

## Phase 7: Polish & Launch Prep

> **Goal:** Production-ready quality, documentation, and deployment.

---

### Task 7.1 — End-to-End Testing 🔴
`[ ]` Status: Not Started
**Dependencies:** All phases complete

Write Playwright E2E tests covering every critical user flow:
1. Full order lifecycle: submission → CS confirm → allocate → dispatch → deliver
2. Partial delivery and return flow
3. Media Buyer: create campaign → form renders → order attributed correctly
4. Funding: HoM sends → MB verifies → balance updates
5. Finance: approval queue → approve/reject → audit logged
6. HR: payout generation → cross-month settlement → clawback
7. RBAC: unauthorized access blocked at every level

**Acceptance Criteria:**
- [ ] All 7 critical flows pass end-to-end
- [ ] Tests run in CI/CD pipeline
- [ ] RLS violations are tested (agent trying to access another agent's data)
- [ ] State machine violations tested (invalid transitions rejected)

---

### Task 7.2 — CI/CD Pipeline 🟡
`[ ]` Status: Not Started
**Dependencies:** Task 7.1

**Implementation Steps:**
1. GitHub Actions workflow:
   - Lint + type check on every PR
   - Unit tests on every PR
   - E2E tests on merge to main
   - Auto-deploy to staging on merge to main
   - Manual promotion to production
2. Preview environments: every PR branch gets a temporary URL
3. Database migration safety: migrations run in staging before production

**Acceptance Criteria:**
- [ ] PRs cannot merge without passing lint + types + unit tests
- [ ] E2E tests run automatically on merge to main
- [ ] Preview URLs generated for every PR
- [ ] Production deployment requires manual approval
- [ ] Database migrations are tested in staging first

---

### Task 7.3 — Documentation & Handoff 🟢
`[ ]` Status: Not Started
**Dependencies:** All tasks complete

1. API documentation: Swagger UI live at `/api/docs`
2. Developer onboarding guide: how to set up local environment
3. Architecture decision records (ADRs) for major technical choices
4. Runbook: common operations (kill a session, reconcile stock, generate manual payout)

**Acceptance Criteria:**
- [ ] Swagger docs are complete and accurate
- [ ] New developer can set up local environment in < 30 minutes following the guide
- [ ] Runbook covers all common operational scenarios

---

## Task Dependency Graph

```
Phase 0 (Foundation)
├── 0.1 Monorepo ──────────┐
├── 0.2 DB Schema ─────────┤
├── 0.3 Audit Trail ───────┤
├── 0.4 Auth/Sessions ─────┤
├── 0.5 RLS Policies ──────┤
├── 0.6 tRPC Setup ────────┤
└── 0.7 Socket.io ─────────┘
         │
Phase 1 (Core Order Flow)
├── 1.1 Edge Worker ────────┐
├── 1.2 Form Builder ───────┤
├── 1.3 CS Dashboard ───────┤
├── 1.4 VOIP Integration ──┤
└── 1.5 State Machine ─────┘
         │
    ┌────┴────┐
Phase 2      Phase 3
(Inventory)  (Finance)
├── 2.1      ├── 3.1 Funding
├── 2.2      ├── 3.2 Ad Spend
├── 2.3      ├── 3.3 True Profit
└── 2.4      ├── 3.4 Approvals
             └── 3.5 Invoicing
    └────┬────┘
         │
Phase 4 (HR/Payroll)
├── 4.1 Commission Rules
├── 4.2 Settlement
├── 4.3 Clawback
└── 4.4 Add-ons
         │
Phase 5 (Dashboards)
├── 5.1 Role Dashboards
└── 5.2 Notifications
         │
Phase 6 (Resilience)
├── 6.1 Multi-CDN
├── 6.2 PWA Offline
└── 6.3 Load Testing
         │
Phase 7 (Launch)
├── 7.1 E2E Tests
├── 7.2 CI/CD
└── 7.3 Documentation
```

---

## Quick Reference: What To Build First

If you are an AI agent starting this project, execute in this exact order:

1. `Task 0.1` — Get the monorepo running
2. `Task 0.2` — Create all database tables
3. `Task 0.3` — Set up temporal audit triggers
4. `Task 0.4` — Build auth and session management
5. `Task 0.5` — Apply RLS policies
6. `Task 0.6` — Wire up tRPC between NestJS and Remix
7. `Task 0.7` — Set up Socket.io
8. `Task 1.1` — Build the Edge Worker for order submission
9. `Task 1.3` — Build CS dashboard and dispatch
10. `Task 1.4` — Integrate VOIP
11. `Task 1.5` — Implement the order state machine

**After these 11 tasks, the core heartbeat of the system is functional.** Everything else extends from this foundation.