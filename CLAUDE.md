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
│   ├── web/                  # Remix PWA (all dashboards + 3PL rider views)
│   │   └── app/routes/
│   │       ├── admin/        # SuperAdmin module
│   │       ├── auth/         # Login/auth
│   │       ├── cs/           # Customer Service module
│   │       ├── finance/      # Finance module
│   │       ├── hr/           # HR & Payroll module
│   │       ├── logistics/    # Logistics module
│   │       ├── marketing/    # Marketing module
│   │       └── rider/        # 3PL Rider views (mobile-optimized PWA routes)
│   ├── api/                  # NestJS backend (business logic, tRPC routers)
│   └── edge-worker/          # Cloudflare Worker (form submission + circuit breaker)
├── packages/
│   ├── shared/               # Drizzle schema, Zod validators, tRPC types, enums
│   ├── ui/                   # Shared Tailwind components
│   └── config/               # ESLint, TypeScript, Tailwind configs
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

---

## The Order Lifecycle (The Most Critical State Machine)

This is the heartbeat of the entire system. Every module connects to this flow. Get this wrong and everything breaks.

```
UNPROCESSED → CS_ENGAGED → CONFIRMED → ALLOCATED → DISPATCHED → IN_TRANSIT → DELIVERED → COMPLETED
                                                                                    |
                                                                              PARTIALLY_DELIVERED
                                                                                    |
                                                                               RETURNED
                                                                                    |
                                                                           RESTOCKED / WRITTEN_OFF
```

### State Transition Rules (Enforce as Hard Constraints)

| From | To | Trigger | Gate (Must Pass) | Side Effect |
|---|---|---|---|---|
| — | UNPROCESSED | Edge form submission | Dedup check (phone+product, 6hr window) | None — stock not touched yet |
| UNPROCESSED | CS_ENGAGED | CS agent clicks Call | Agent must have capacity (pending < max) | Order locked to agent for 15 min |
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
- Implement weighted dispatch: new orders go to the CS agent with the lowest active_pending_count, not round-robin by total history
- The Confirm and No Answer buttons must be DISABLED in the UI until the system receives a VOIP webhook confirming call_duration > 15 seconds for that specific order
- Head of CS can Hot Swap — select orders from one agent and mass-reassign to another
- When CS updates an order (address change, quantity change, upsell), the system creates a VERSION SNAPSHOT, not an in-place edit. The original data is preserved in the temporal table. The order history timeline shows every change with the agent's name and timestamp

### When Building the Inventory Module
- Inventory is tracked by LOCATION (Main Warehouse, 3PL Location A, 3PL Location B, etc.)
- Product creation supports optional initial stock: quantity + location. When provided, creates a FIFO batch using cost price as factory cost (landing = 0). Restock via Inventory → Stock Intake.
- Use FIFO batch costing: each stock intake is a separate batch with its own landed cost
- Stock states per unit: AVAILABLE, RESERVED, ALLOCATED_TO_3PL, IN_TRANSIT, DELIVERED, RETURNED, WRITTEN_OFF
- The Virtual Buffer means the Sales Module sees 10% less stock than actually exists, preventing overselling during high-traffic bursts
- Ghost Stock prevention: if a 3PL physical count does not match the digital record, the Dispatch button for that location is LOCKED until a Stock Reconciliation form is submitted with mandatory reason codes (Damaged, Lost, Expired, Theft)

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
| SuperAdmin | Everything | Yes | Via audit log only | Yes | Yes |
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

## What NOT To Do

- Do NOT use localStorage or sessionStorage for anything security-sensitive. Sessions live in Redis
- Do NOT expose raw phone numbers in any API response, log, or error message — ever
- Do NOT use auto-incrementing IDs — use UUIDv7
- Do NOT skip the actor injection (SET LOCAL yannis.current_user_id) on any write operation
- Do NOT allow state skipping in the order lifecycle — enforce the state machine
- Do NOT use TypeORM — use Drizzle. TypeORM reflection-based types are unreliable for this level of data integrity
- Do NOT hardcode commission rules — they must be dynamic JSONB configs editable by HR
- Do NOT build a separate mobile app or a separate rider app — use PWA route groups within `apps/web` with offline sync
- Do NOT store files locally — use Cloudflare R2 or S3 for all uploads (receipts, screenshots, invoices)
- Do NOT implement the audit trail at the application level — it must be at the PostgreSQL trigger level using temporal tables

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

## When In Doubt

1. Check the PRD.md for the exact requirement
2. Check the TASK.md for the current sprint priority
3. If the PRD does not cover it, ask — do not assume
4. If you are choosing between fast but fragile and slower but auditable — always choose auditable
5. Every feature you build should answer: "If the CEO asks who did this and when, can the system answer in under 3 seconds?"