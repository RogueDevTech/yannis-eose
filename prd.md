# PRD.md — Yannis EOSE: Complete Product Requirements Document

**Project:** Yannis EOSE (Enterprise Operations & Sales Engine)
**Version:** 1.0
**Date:** March 2026
**Status:** Architecture Locked — Ready for Development
**Audience:** AI Coding Agent / Senior Engineers

---

## 1. Executive Summary

Yannis EOSE is the core infrastructure for the Yannis ecosystem. It solves the "fragility" of traditional sales trackers by implementing a decoupled, edge-first architecture. It ensures that no lead is lost, no lead is stolen, and every cent of profit is accounted for across shipping, returns, and ad spend.

The platform replaces a legacy tool called **Sniper** — an e-commerce automation platform the client valued for its smooth operational flow, rich data per order, and quality automations. Sniper failed because it was never built for enterprise use: it crashed under concurrent users, had no audit trail, could not perform stock audits, produced unreliable financial records, and went down whenever AWS had outages.

Yannis EOSE must preserve what the client loved (smooth flow, granular detail, visible activity) while permanently solving what broke (accountability, scale, financial integrity, uptime).

---

## 2. The 4 Pillars of Integrity

Every feature, module, API endpoint, and UI component must serve at least one of these pillars.

### Pillar 1: Revenue Insurance (Zero-Downtime)
Sales forms must remain functional even during primary server outages. Orders are captured at the Edge (Cloudflare Workers) and buffered in durable queues (QStash/Durable Objects) if the primary API is unreachable. Multi-CDN DNS failover ensures that if Cloudflare itself goes down, traffic routes to a secondary provider (Fastly/Akamai). PWA Service Workers provide client-side offline form capture as a last resort. The system must never lose an order under any infrastructure failure scenario.

### Pillar 2: Lead Fortress (Anti-Theft)
All customer PII (phone numbers, addresses, emails) is masked by default in all API responses and UI views. Phone numbers appear as `0803****1234`. Customer communication happens exclusively through VOIP bridges (Twilio/MessageBird WebRTC) — agents click "Call" and the system connects them without ever exposing the raw number to the browser DOM, network tab, or console. Every access to unmasked PII is logged as an audited access event.

### Pillar 3: Financial Truth (Landed COGS)
Every product carries a layered cost structure calculated via FIFO batch costing:
- **Factory Cost:** Raw unit price from supplier
- **Landing Cost:** Freight, clearing, duties to main warehouse
- **Internal Fulfillment Cost:** Cost of moving stock from main warehouse to a Third-Party Logistics location
- **Final-Mile Delivery Fee:** Quoted cost from the Third-Party Logistics provider per delivery
- **Ad Spend:** Daily logged spend per Media Buyer per product
- **Commission:** Performance-based payout per delivered order

**True Net Profit = Sale Price − (Factory Cost + Landing Cost + Fulfillment Cost + Delivery Fee + Ad Spend + Commission)**

Only SuperAdmin and Finance Head roles can see cost_price, landed_cost, and margin fields. All other roles see revenue and commission data only.

### Pillar 4: Absolute Accountability (Temporal Audit)
Every mutation to every record is permanently logged at the PostgreSQL database level using System-Versioned Temporal Tables. Each transaction executes `SET LOCAL yannis.current_user_id = '<uuid>'` before any write. The audit captures: actor identity, action type, old value, new value, and precise timestamp. No user — including SuperAdmin — can delete or modify audit entries. The system can reconstruct the exact state of any record at any point in history ("time travel").

---

## 3. Tech Stack

| Layer | Technology | Version/Notes |
|---|---|---|
| Frontend | Remix (React) + Tailwind CSS | PWA-enabled, nested routing for CRM UX |
| Backend API | NestJS + TypeScript 5.x | Modular, decorator-based, DI container |
| Type Contract (Internal) | tRPC | Zero-generation type sharing between Remix and NestJS |
| Type Contract (External) | OpenAPI/Swagger via trpc-openapi | Auto-generated REST docs for third-party consumers |
| Database | PostgreSQL 18 | Temporal tables, UUIDv7, RLS, async I/O |
| ORM | Drizzle ORM | TypeScript-first, SQL-level precision |
| Cache & Sessions | Redis | Hybrid auth sessions, dedup cache, dispatch queue |
| Real-time | Socket.io | Live dashboard updates, call notifications |
| Edge Layer | Cloudflare Workers | Form hosting, circuit breaker, submission buffer |
| Durable Queue | Upstash QStash or Cloudflare Durable Objects | Order buffering during API downtime |
| VOIP | Twilio Voice API or MessageBird | WebRTC click-to-call, recording, transcription |
| File Storage | Cloudflare R2 or AWS S3 | Receipts, screenshots, invoices, recordings |
| Monorepo | TurboRepo (pnpm) | Shared packages for schemas, validators, UI |

---

## 4. Core Module Map

The system is divided into **7 interlocking functional modules** plus a **universal audit layer**:

| # | Module | Purpose |
|---|---|---|
| 1 | Edge Sales & Intake | High-availability order capture, deduplication, inventory budget caps |
| 2 | CS Command & Privacy | Secure call center, lead masking, weighted dispatch, VOIP integration |
| 3 | Inventory Management | Master stock control, FIFO batch costing, location tracking, virtual buffer |
| 4 | Third-Party Logistics Operations | Warehouse verification, rider delivery, returns, local restock |
| 5 | Marketing Governance | Funding ledger, ad spend logging, CPA/ROAS calculation |
| 6 | Financial Core | Landed COGS, true profit dashboard, budget tracking, invoicing |
| 7 | HR & Payroll | Commissions, settlement windows, clawbacks, add-on earnings |
| 8 | Temporal Audit Trail (Universal) | Immutable, system-versioned record of every action by every user |

---

## 5. User Roles & RBAC

### 5.1 Role Definitions

**SuperAdmin** — Full unrestricted access across all modules. User management, audit oversight, system configuration, dispute resolution. The only role that can see the complete global audit trail and all financial cost data.

**Head of Marketing (HoM)** — Manages the marketing team. Creates funding records for Media Buyers. Views campaign performance, ad spend, and Media Buyer ROI. Cannot see product cost/margin data.

**Media Buyer** — Plans and executes media campaigns. Creates sales forms from approved Offer Templates. Logs daily ad spend with mandatory screenshots. Views own orders, own campaigns, own payouts. Cannot set prices or see cost data.

**Head of CS** — Manages the customer service team. Views all CS agent performance metrics. Can Hot Swap (mass-reassign) orders between agents. Views SLA breach reports.

**CS Agent** — First line of contact for order confirmation. Receives auto-dispatched orders. Calls customers via VOIP bridge. Confirms, cancels, or updates orders. Can only see orders assigned to them. Never sees full phone numbers.

**Finance Officer** — Reviews and approves all financial requests (media spend, procurement, logistics reimbursements). Manages invoices. Views all cost data. Cannot approve their own requests.

**Head of Logistics** — Oversees all Third-Party Logistics partners and order fulfillment. Views all logistics operations across all locations. Manages Third-Party Logistics partner onboarding.

**Warehouse Manager** — Manages physical inventory at the main warehouse. Records stock arrivals, transfers to Third-Party Logistics locations, and procurement requests.

**Third-Party Logistics Manager** — External partner role. Manages their specific location only. Verifies incoming stock transfers. Assigns riders. Manages local returns and restocking.

**Third-Party Logistics Rider** — External partner role. Views only their assigned deliveries. Marks orders as Delivered, Partially Delivered, or Returned. Uses the offline-capable mobile PWA.

**HR Manager** — Configures commission rules. Manages settlement windows. Adds manual earnings adjustments. Views all staff payouts.

### 5.2 Permission Matrix

| Capability | SuperAdmin | HoM | Media Buyer | Head CS | CS Agent | Finance | Head Logistics | Warehouse Mgr | 3PL Manager | 3PL Rider | HR Manager |
|---|---|---|---|---|---|---|---|---|---|---|---|
| View all orders | Yes | No | Own only | CS orders | Assigned only | Yes (read) | Yes | No | Own location | Own assigned | No |
| See cost_price / margin | Yes | No | No | No | No | Yes | No | No | No | No | No |
| See full phone number | Audit only | No | No | No | No (VOIP) | No | No | No | No (masked) | No | No |
| Approve financial requests | Yes | No | No | No | No | Yes (not own) | No | No | No | No | No |
| Edit commission rules | Yes | No | No | No | No | No | No | No | No | No | Yes |
| Manage users | Yes | No | No | No | No | No | No | No | No | No | No |
| View global audit trail | Yes | No | No | No | No | No | No | No | No | No | No |
| Reassign CS orders | Yes | No | No | Yes | No | No | No | No | No | No | No |
| Transfer stock to 3PL | Yes | No | No | No | No | No | Yes | Yes | No | No | No |
| Verify received stock | No | No | No | No | No | No | No | No | Yes | No | No |
| Mark delivery status | No | No | No | No | No | No | No | No | No | Yes | No |
| Create funding record | No | Yes | No | No | No | No | No | No | No | No | No |
| Log ad spend | No | No | Yes | No | No | No | No | No | No | No | No |

---

## 6. Module 1: Edge Sales & Intake

### 6.1 Purpose
Capture customer orders with 100% uptime, prevent duplicate submissions, and enforce inventory limits automatically — even under infrastructure failures.

### 6.2 The Sales Form Builder

Media Buyers create sales forms to collect customer orders. They do NOT have free-form control over pricing or product details.

**Form Creation Flow:**
1. Media Buyer navigates to "Create Campaign Form"
2. They select products from a dropdown of **Offer Templates** — these are pre-configured by the Stock/Product Manager and include: product name, price, available variants, and allowed quantities
3. Media Buyer customizes: form fields (name, phone, address, delivery notes), thank-you page URL, campaign name
4. Media Buyer CANNOT change: product price, product description, product images, or any financial data
5. System generates a unique `campaign_id` and provides 3 deployment options:
   - **Shadow DOM Snippet:** A `<script>` tag that injects the form into the buyer's website using Shadow DOM (inherits fonts but protects internal styles)
   - **iFrame Embed:** A standard `<iframe>` URL for simple embedding
   - **Hosted URL:** A standalone page at `checkout.yannis.com/campaign-{id}` for buyers who want to share a direct link via WhatsApp/social

### 6.3 Order Submission Flow

```
Customer fills form → POST to Cloudflare Worker (Edge)
    → Step 1: Rate limit check (3 attempts per IP per 5 min)
    → Step 2: Deduplication check (hash phone+product in Redis, 6hr window)
        → If duplicate found: flag as POTENTIAL_DUPLICATE, still store, route to CS review queue
    → Step 3: Inventory budget cap check (query Redis: pending+confirmed vs total_stock-10%)
        → If over cap: return "Sold Out / Join Waitlist" response
    → Step 4: Attempt POST to NestJS API
        → If API responds 200: order created in Postgres, status = UNPROCESSED
        → If API timeout (>2000ms) or 5xx: activate circuit breaker
            → Buffer order in QStash/Durable Objects with timestamp
            → Return success to customer ("Order received!")
            → Background sync drains buffer every 60 seconds when API recovers
```

### 6.4 Edge Cases

**Ghost Orders (Double Submit):** Customer clicks Submit 5 times. The Edge Worker hashes `phone_number + product_id` and checks Redis. Second through fifth submissions are flagged as `POTENTIAL_DUPLICATE` and stored separately. CS agent sees a warning: "Another order from this customer exists (created 3m ago)" and can merge or dismiss.

**API Downtime:** If the primary NestJS API is completely unreachable, the Cloudflare Worker buffers orders in QStash. A "Healer" cron job checks the queue every 60 seconds. As soon as the API is back, it drains the queue into Postgres. The customer never sees an error — they always get "Order received!"

**Cloudflare Downtime:** DNS health checks (via Route 53 or NS1) detect Cloudflare failure. DNS automatically reroutes to a secondary CDN (Fastly/Akamai) hosting a static backup form within 60 seconds. The backup form uses browser `IndexedDB` to store submissions locally and syncs when any endpoint becomes reachable.

**Stock Exhaustion During Traffic Spike:** If 5,000 orders come in within 2 hours but only 500 units exist, the Redis inventory cap check activates when `(pending + confirmed) >= (total_stock - 10% buffer)`. All Media Buyer forms for that product automatically switch to "Pre-order" or "Sold Out" state. No overselling.

**Spam/Bot Prevention:** Rate limiting at the Edge: 3 submissions per IP per 5 minutes. After 3 failed attempts, a CAPTCHA is triggered. This protects the VOIP budget from bot-generated fake orders.

---

## 7. Module 2: CS Command & Privacy

### 7.1 Purpose
Securely confirm orders through outbound calls while protecting customer PII from internal theft. Distribute workload fairly across agents.

### 7.2 The Weighted Dispatch System

When a new order enters the system with status `UNPROCESSED`, it must be automatically assigned to a CS agent.

**Algorithm:**
1. Query all CS agents with status `ACTIVE` (currently on duty — managed by Head of CS)
2. For each active agent, count their `UNPROCESSED` + `CS_ENGAGED` orders (active pending workload)
3. Assign the new order to the agent with the **lowest active pending count**
4. If two agents are tied, assign to the one who has been idle longest (last_action_timestamp)
5. Head of CS can manually set agent capacity limits (e.g., max 15 pending orders per agent)

**The order is now visible in that agent's personal queue.**

### 7.3 The Call Flow (VOIP Privacy Bridge)

```
CS Agent sees order in queue (phone: 0803****1234)
    → Agent clicks "Call Customer" button
    → System logs ACCESS_EVENT in audit trail (agent_id, order_id, timestamp)
    → System sends call_token to VOIP provider (Twilio/MessageBird)
    → VOIP provider initiates WebRTC connection through agent's browser/headset
    → Customer's phone rings showing the company's verified business number
    → Call connects — agent talks to customer through browser
    → Call ends — VOIP webhook sends call metadata to NestJS:
        - call_duration (seconds)
        - call_status (completed, no_answer, busy, failed)
        - call_recording_url (if recording enabled)
        - timestamp
    → System stores call log linked to order_id
```

**The agent NEVER sees the full phone number at any point.** The call_token is a one-time reference that the VOIP provider resolves server-side.

### 7.4 Status Update Rules (The Status Lock)

After a call, the CS agent needs to update the order status. These transitions have hard gates:

| Action | UI State | Gate |
|---|---|---|
| "Confirm Order" button | DISABLED until call_duration > 15s | Prevents fake confirmations without actually calling |
| "No Answer" button | DISABLED until call_duration > 0s OR call_status = no_answer from VOIP | Prevents agents marking "No Answer" without dialing |
| "Cancel Order" button | Always enabled | Requires mandatory reason note (min 10 characters) |
| "Reschedule" button | Always enabled | Agent enters callback date/time |

### 7.5 Order Modification During Call

During the confirmation call, the customer may change their mind:

**Address Change:** CS agent updates the delivery address. The system creates a version snapshot — the original address is preserved in the temporal table. The order history timeline shows: "Address changed from [old] to [new] by Agent Amaka at 10:25 AM."

**Quantity Change / Upsell:** CS agent can add or remove products. The system recalculates the total and updates inventory reservation accordingly. If adding products, system checks stock availability in real-time. If stock is insufficient, the UI shows a warning.

**Delivery Scheduling:** CS agent records the customer's preferred delivery time and any special instructions.

### 7.6 Hot Swap (Manual Reassignment)

The Head of CS has a management dashboard showing all agents and their current workloads.

**Single Reassignment:** Head of CS can drag an order from Agent A to Agent B.
**Bulk Reassignment:** Head of CS can select multiple orders from Agent A (or select all) and reassign them to Agent B in one action.
**Auto-Reassignment Trigger:** If an agent has been inactive for > 10 minutes (no actions logged), the system flags them. Head of CS receives a notification suggesting reassignment.

Every reassignment is logged in the audit trail: "Order #XYZ transferred from Agent A to Agent B by Head of CS (Reason: Agent A Offline)."

### 7.7 Edge Cases

**Two Agents Call Same Customer:** Prevented by the dispatch system — each order is assigned to exactly one agent. The order is locked to that agent for 15 minutes after they click "Call". No other agent can see or access it during the lock period.

**Agent Fakes "No Answer":** The Status Lock prevents marking "No Answer" unless the VOIP log confirms a call attempt was actually made. If the VOIP log shows call_duration = 0 and call_status = no_answer, the system allows it (phone actually rang but nobody picked up). If there is NO call log at all, the button stays disabled.

**Customer Calls Back:** The VOIP system recognizes the incoming number and routes the call to the specific CS agent last assigned to that customer's order. A browser notification popup appears: "Incoming Call: Order #502 — Customer Adaeze." Agent clicks "Answer" and the WebRTC connection starts.

**PWA Incoming Calls:** Because the dashboard is a PWA, agents receive Web Push notifications for incoming calls even if the browser is minimized or the phone screen is off.

---

## 8. Module 3: Inventory Management

### 8.1 Purpose
Maintain a single source of truth for every physical unit in the Yannis ecosystem. Track stock by location, by cost batch, and by status — in real time.

### 8.2 Product & SKU Structure

Each product has:
- `product_id` (UUIDv7)
- `name`, `description`, `images` (managed by Stock/Product Manager)
- `sku` (unique stock-keeping unit code)
- `base_sale_price` (the price customers pay)
- `cost_price` (factory cost — HIDDEN from all roles except SuperAdmin and Finance Head)
- `min_threshold` (minimum stock level before triggering restock alert)
- `category`, `tags`, `status` (active/archived)

### 8.3 FIFO Batch Costing

Stock is received in batches. Each batch has its own cost profile:

```
Batch A: 100 units | Factory: $5.00 | Freight: $0.50 | Total Landed: $5.50/unit
Batch B: 200 units | Factory: $5.00 | Freight: $0.80 | Total Landed: $5.80/unit
```

When orders are fulfilled, the system uses FIFO (First-In, First-Out): Batch A units are sold first. Once Batch A is depleted, Batch B units begin selling. Profit calculations per order reflect the actual cost of the specific batch being sold.

### 8.4 Stock States

Each unit of inventory exists in exactly one state at any time:

| State | Meaning | Module Responsible |
|---|---|---|
| AVAILABLE | In warehouse/location, ready for sale | Inventory |
| RESERVED | Locked for a confirmed order, not yet shipped | CS (on Confirm) |
| ALLOCATED_TO_3PL | Assigned to a Third-Party Logistics location transfer | Logistics |
| IN_TRANSIT_TO_3PL | Being moved from warehouse to Third-Party Logistics | Logistics |
| AVAILABLE_AT_3PL | Verified received at Third-Party Logistics, ready for delivery | Third-Party Logistics |
| IN_TRANSIT_DELIVERY | Out for delivery with a rider | Third-Party Logistics |
| DELIVERED | Successfully delivered to customer | Third-Party Logistics |
| RETURNED | Came back from customer, pending assessment | Third-Party Logistics |
| RESTOCKED | Returned item verified sellable, back in inventory | Third-Party Logistics |
| WRITTEN_OFF | Returned item damaged/lost, logged as operational loss | Finance |

### 8.5 The Virtual Buffer

The Edge Sales Module does NOT see the real stock count. It sees: `available_stock - (available_stock * 0.10)`. This 10% buffer prevents overselling during high-traffic bursts where multiple orders are being processed simultaneously.

Example: If actual available stock = 100, the Edge Module sees 90. This means the form will show "Sold Out" when 90 orders are pending/confirmed, leaving a 10-unit safety margin.

### 8.6 Stock Movement Logging

Every single movement of physical stock is recorded as a `stock_movement` entry:

| Field | Description |
|---|---|
| movement_id | UUIDv7 |
| product_id | Which product |
| movement_type | INBOUND, OUTBOUND, TRANSFER, RETURN, WRITE_OFF, ADJUSTMENT |
| quantity | Positive integer (always positive — direction determined by type) |
| from_location | Origin (warehouse, 3PL location, or null for inbound) |
| to_location | Destination (warehouse, 3PL location, or null for outbound) |
| reference_id | Linked to purchase order, delivery note, or transfer ID |
| reason | Mandatory for ADJUSTMENT and WRITE_OFF types |
| actor_id | The user who logged this movement |
| timestamp | Auto-generated |

**Corrections:** No movement can ever be deleted. If a mistake is made, a REVERSAL movement must be created with a mandatory reason note.

### 8.7 Edge Cases

**Ghost Stock:** Third-Party Logistics Manager reports physical count of 45 but system shows 50. The Dispatch button for that location is LOCKED. The Third-Party Logistics Manager must submit a Stock Reconciliation form selecting reason codes for the 5 missing units (Damaged: 2, Lost: 3). Only after reconciliation is the Dispatch button unlocked. The discrepancy is logged as Operational Loss and appears in the CEO's True Profit dashboard.

**Low Stock Alert:** When any product at any location drops below its `min_threshold`, automatic notifications are sent to the Warehouse Manager and SuperAdmin. The alert includes: product name, current quantity, threshold value, and location.

**Stock Count Export:** Inventory data must be exportable as CSV at any time by Warehouse Manager, Head of Logistics, or SuperAdmin for external reporting and physical audit verification.

---

## 9. Module 4: Third-Party Logistics Operations

### 9.1 Purpose
Manage the relationship between Yannis and external logistics companies. Track stock transfers, verify deliveries, calculate logistics costs, and handle returns.

### 9.2 Third-Party Logistics Partner Onboarding

Each logistics company is registered in the system with:
- Company name, contact details, coverage area
- Rate card (delivery fee structure — per order, per distance, per weight, etc.)
- Assigned login credentials (Third-Party Logistics Manager role)
- Warehouse/hub locations

### 9.3 The Dual-Entry Stock Transfer

When the Main Warehouse sends stock to a Third-Party Logistics location:

```
Step 1: Warehouse Manager creates Transfer Record
    - Selects: product, quantity, destination 3PL location
    - System generates a unique transfer_id
    - Stock status: AVAILABLE → IN_TRANSIT_TO_3PL
    - Transfer status: SENT

Step 2: Physical goods move (trucks, couriers, etc.)

Step 3: Third-Party Logistics Manager receives notification: "Incoming Transfer #TRF-2026-0042: 100 units of Product X"
    - They physically count the received goods
    - They click "Verify & Receive" and enter: received_quantity = 98

Step 4: System processes verification
    - 98 units: IN_TRANSIT_TO_3PL → AVAILABLE_AT_3PL
    - 2 units: IN_TRANSIT_TO_3PL → SHRINKAGE
    - Shrinkage Alert auto-sent to CEO and Head of Logistics
    - Third-Party Logistics Manager must select reason code: Damaged (1), Lost in Transit (1)
    - Transfer status: VERIFIED_WITH_DISCREPANCY

Step 5: Internal Fulfillment Cost calculated
    - Cost of moving 100 units via this transfer = $50 (transport fee)
    - Per-unit fulfillment cost added to COGS: $50 / 98 received = $0.51/unit
    - This cost is added to the landed_cost for these specific units at this location
```

**The stock is NOT available for sale at the Third-Party Logistics location until Step 3 is completed.** This prevents selling stock that was never actually received.

### 9.4 Order Allocation to Third-Party Logistics

When an order is `CONFIRMED` by CS, the Logistics Manager allocates it to a Third-Party Logistics partner:

1. Logistics Manager views confirmed orders queue
2. Selects the most appropriate Third-Party Logistics location based on: proximity to customer, available stock, logistics cost
3. Enters the **Quoted Delivery Cost** (the fee the Third-Party Logistics charges for this delivery)
4. Order status: CONFIRMED → ALLOCATED
5. The order appears in the Third-Party Logistics Manager's dashboard
6. Third-Party Logistics Manager assigns a rider
7. Rider picks up → DISPATCHED
8. Rider confirms departure → IN_TRANSIT (GPS + timestamp logged)

### 9.5 Delivery Outcomes

**Successful Delivery:**
- Rider marks "Delivered"
- Must capture: OTP confirmation or recipient signature
- GPS coordinates logged
- Stock: DELIVERED (final — deducted from inventory)
- Commission triggered for Media Buyer and CS Agent
- Revenue recognized in Finance

**Partial Delivery:**
- Customer ordered 3 units, only accepts/pays for 2
- Rider marks "Partially Delivered" and enters: delivered_qty = 2, returned_qty = 1
- System splits: 2 units → DELIVERED, 1 unit → RETURNED
- Finance recalculates order total based on delivered quantity
- Commission is calculated on the delivered portion only

**Failed Delivery / Return:**
- Customer rejects the order entirely
- Rider marks "Returned" with mandatory reason: (Not home, Changed mind, Wrong item, Cannot pay, etc.)
- All units → RETURNED status
- Third-Party Logistics Manager assesses returned items:
  - "Sellable" → RESTOCKED at local Third-Party Logistics inventory (no return freight needed)
  - "Damaged" → WRITTEN_OFF (logged as Operational Loss with damage note)

### 9.6 Rider Offline Sync

Third-Party Logistics riders work in the field, often in areas with poor connectivity.

- The rider views are mobile-optimized PWA routes inside the main `apps/web` app (at `/rider/`), not a separate application
- Delivery confirmations are stored in IndexedDB with GPS coordinates and timestamps
- When the rider regains network, the PWA background syncs automatically
- Conflict resolution: last-write-wins with GPS verification (system checks that the GPS coordinates are geographically consistent with the delivery address to prevent fraudulent status updates)

### 9.7 Third-Party Logistics Cost Tracking

For every order delivered through a Third-Party Logistics partner, the system records:
- `delivery_fee`: the quoted cost for this specific delivery
- `logistics_provider_id`: which company handled it

This allows Finance to calculate:
- **Net Profit per Order:** Sale Price − (COGS + Delivery Fee + Ad Spend + Commission)
- **Third-Party Logistics Performance:** Average delivery cost, delivery success rate, average delivery time per partner
- **Third-Party Logistics Balance:** Running tally of what Yannis owes each logistics partner (sum of delivery fees for completed orders)

### 9.8 Edge Cases

**Third-Party Logistics Says They Never Received Stock:** The Dual-Entry system prevents this. The Transfer Record shows SENT with the Warehouse Manager's name and timestamp. If the Third-Party Logistics never clicks "Verify & Receive," the stock remains in IN_TRANSIT_TO_3PL status indefinitely and triggers an escalation alert after 48 hours.

**Rider Disappears with Stock:** If an order stays in DISPATCHED or IN_TRANSIT status beyond the expected delivery window (configurable), the system flags it for investigation. The Third-Party Logistics Manager receives an alert. The Head of Logistics sees it in their oversight dashboard.

---

## 10. Module 5: Marketing Governance

### 10.1 Purpose
Create a transparent, auditable ledger for all marketing funds and ad spend. Replace informal WhatsApp-based approvals with structured, receipt-backed records.

### 10.2 The Funding Ledger (Offline-to-Online)

Marketing funds are transferred offline (bank transfer, cash, mobile money). The system acts as the proof-of-record.

**Head of Marketing (HoM) Flow:**
1. HoM navigates to "Create Funding Record"
2. Enters: amount, currency, payment method, recipient (Media Buyer)
3. Uploads: receipt/screenshot of the bank transfer (mandatory — stored in R2/S3)
4. System creates record with status: `SENT`
5. Media Buyer receives PWA push notification: "HoM has sent $1,000. Please verify."

**Media Buyer Verification Flow:**
1. Media Buyer sees notification in their dashboard
2. Reviews the receipt image
3. Clicks "Mark Received" → status: `COMPLETED` → internal balance increases
4. OR clicks "Not Received" → status: `DISPUTED` → auto-alert to CEO and HoM

**Dispute Resolution:**
- If `DISPUTED`, the HoM's receipt is frozen in the audit trail for investigation
- SuperAdmin can review the funding record, the receipt image, and the audit log to resolve
- If the MB later receives the money, they can update status to `COMPLETED`

### 10.3 Ad Spend Logging

Media Buyers are required to log their daily advertising expenditure.

**Daily Log Entry:**
1. Media Buyer navigates to "Log Ad Spend"
2. Selects: product/campaign, date range the ads ran
3. Enters: total spend amount for that period
4. Uploads: MANDATORY screenshot of the Ads Manager dashboard (Meta, Google, TikTok, etc.)
5. System validates: screenshot is uploaded (no empty submissions)
6. Entry is stored with: media_buyer_id, product_id, spend_amount, screenshot_url, spend_date

**No screenshot = no log entry accepted.** This is a hard gate.

### 10.4 Performance Metrics (Automated)

The system calculates these metrics automatically based on logged data:

| Metric | Formula | Notes |
|---|---|---|
| CPA (Cost Per Acquisition) | Total Ad Spend / Total Orders Created | Includes ALL order statuses |
| True ROAS | Revenue from DELIVERED orders / Total Ad Spend | Only counts revenue from actually delivered orders |
| Delivery Rate | Delivered Orders / Total Orders Created | Per Media Buyer, per product, per campaign |
| Conversion Rate | Confirmed Orders / Total Orders Created | How well CS converts the buyer's leads |

**High CPA Warning:** If a Media Buyer's CPA exceeds a configurable threshold (set by HoM or Finance), the system auto-sends an alert to the Head of Marketing: "Media Buyer [name] — CPA for Product X is $45 (threshold: $20). Review ad performance."

### 10.5 Edge Cases

**Spend vs Reality Mismatch:** If a Media Buyer logs $500 spend but the system only shows 5 orders from their campaigns, the CPA is $100/order. If the configured alert threshold is $25, the HoM receives an immediate "High CPA Warning."

**Funding Double-Entry Prevention:** A funding record has two timestamps: `sent_at` (HoM action) and `verified_at` (MB action). The MB's total available budget = SUM of records where `status = COMPLETED` only. Unverified funds do NOT count toward their budget.

---

## 11. Module 6: Financial Core

### 11.1 Purpose
Provide real-time, accurate financial visibility across all operations. Calculate true profit, manage budgets, generate invoices, and ensure every financial action is audited.

### 11.2 The True Profit Calculation

For every delivered order, the system calculates:

```
Revenue = sale_price × delivered_quantity

Costs:
  + Factory Cost (from FIFO batch)
  + Landing Cost (freight/duty per batch)
  + Internal Fulfillment Cost (warehouse → 3PL transfer, amortized per unit)
  + Delivery Fee (quoted by Third-Party Logistics for this specific order)
  + Ad Spend (proportional: total_ad_spend / total_orders for this campaign)
  + Commission (Media Buyer commission + CS Agent commission for this order)

True Net Profit = Revenue - Total Costs
```

### 11.3 Column-Level Security

The following fields are STRIPPED from all API responses unless the requesting user has `SuperAdmin` or `Finance Head` role:
- `cost_price` (factory cost)
- `landed_cost` (total landed cost per unit)
- `margin` (calculated profit margin)
- `internal_fulfillment_cost`

This is enforced via a NestJS response interceptor, NOT frontend hiding. Even if someone inspects the network tab, these fields do not exist in the response payload for unauthorized roles.

### 11.4 Centralized Approval Queue

All financial requests from across the platform flow into a single queue for Finance Officers:
- Media spend requests (from Marketing module)
- Procurement requests (from Warehouse Manager)
- Logistics reimbursements (from Third-Party Logistics)
- Ad-hoc financial requests

**Approval Rules:**
- Finance Officers CANNOT approve requests they personally submitted
- Every approval or rejection requires a mandatory reason note (min 10 characters)
- A request cannot be acted on by two Finance Officers simultaneously (locking mechanism)
- Requests exceeding remaining budget trigger a warning — approval is still possible but requires explicit override with reason
- All decisions (approve/reject/query) are permanently logged in the audit trail

### 11.5 Budget Tracking

Finance Officers set budget limits per department or campaign. The budget tracker shows:
- Total Budget (set amount)
- Approved Spend (sum of approved requests)
- Committed Spend (approved but not yet paid)
- Remaining Budget

Over-budget warnings surface BEFORE approval (not after). The approver sees: "This request of $5,000 exceeds remaining budget of $3,200. Approve with override?"

### 11.6 Invoicing

- Invoices use sequential reference numbers: `INV-2026-0001`, `INV-2026-0002`, etc.
- Auto-generated, no manual override of reference numbers
- Status flow: `DRAFT` → `SENT` → `PAID` / `OVERDUE`
- Exportable as professional PDF
- Linked to order IDs or manual entries
- All invoice actions logged in audit trail

### 11.7 Edge Cases

**Operational Loss Tracking:** When stock is written off (damaged, lost, shrinkage), the cost of those units is tracked as Operational Loss (OPEX). This appears as a separate line in the CEO's profit dashboard, distinct from COGS.

**Third-Party Logistics Balance Sheet:** The system maintains a running balance per Third-Party Logistics partner: total delivery fees for completed orders minus any payments already made. Finance can see exactly how much is owed to each partner at any time.

---

## 12. Module 7: HR & Payroll

### 12.1 Purpose
Automate performance-based compensation with full flexibility for rule changes, manual adjustments, and cross-month settlement.

### 12.2 Commission Rules Engine

Commission rules are stored as JSONB in a `commission_plans` table. Each role can have its own plan.

**Example Media Buyer Commission Plan:**
```json
{
  "plan_name": "Standard MB Plan - Q1 2026",
  "role": "media_buyer",
  "rules": {
    "base_salary": {
      "threshold_type": "delivered_orders",
      "threshold_value": 20,
      "amount": 50000
    },
    "performance_bonus": {
      "trigger": "delivered_orders > base_threshold",
      "per_extra_order": 2500,
      "conditions": {
        "min_delivery_rate": 0.85
      }
    },
    "penalties": {
      "returned_order_deduction": 1500
    }
  },
  "effective_from": "2026-01-01",
  "effective_to": null
}
```

**How it works:**
- If a Media Buyer gets 20+ delivered orders in the settlement period, they earn base salary of 50,000
- For every order above 20, they earn 2,500 bonus — BUT only if their delivery rate is above 85%
- Each returned order deducts 1,500 from their payout
- HR can change these rules at any time without developer intervention
- Rules have `effective_from` dates — changes only apply to future settlement periods

### 12.3 Settlement Windows

The settlement period is CONFIGURABLE by HR: Weekly, Bi-weekly, or Monthly.

**Critical Rule: Commissions follow DELIVERED_AT, not CREATED_AT.**
- An order created January 28 but delivered February 3 → paid in the February settlement
- An order created February 1 but delivered January 31 (edge case: late API sync from offline rider) → paid in January settlement

### 12.4 The Clawback Engine

If an order that was already counted in a previous payout is later returned:

1. System creates a `PENDING_DEDUCTION` record linked to the original order and the affected staff members (Media Buyer AND CS Agent)
2. The deduction appears in the next settlement period as a negative line item
3. Payout calculation: `SUM(current_period_earnings) - SUM(pending_deductions) = final_payout`

**Example:**
- January payout: Media Buyer earned 75,000 (30 delivered orders)
- February 10: 3 January orders are returned
- February payout: Media Buyer earned 60,000 (24 delivered) MINUS 4,500 clawback (3 × 1,500) = 55,500

### 12.5 Add-on Earnings

HR can manually add bonus line items to any staff member's payout:

| Field | Description |
|---|---|
| staff_id | Who receives it |
| amount | The bonus amount |
| category | OVERTIME, PERFORMANCE_BONUS, SPECIAL_SERVICE, REIMBURSEMENT, OTHER |
| reason | Mandatory description |
| approved_by | Admin user who authorized it |
| period_id | Which settlement period it applies to |

**Display:** Every staff member's payout breakdown shows DISTINCT line items:
- Base Salary: 50,000
- Performance Bonus (12 extra orders × 2,500): 30,000
- Special Service Bonus: 5,000 (Approved by: Admin Tunde)
- Clawback (-2 returned orders × 1,500): -3,000
- **Total Payout: 82,000**

### 12.6 Edge Cases

**Rule Change Mid-Period:** If HR changes commission rules on February 15 and the settlement is monthly, the NEW rules only apply starting March 1. February is calculated entirely on the old rules. The `effective_from` date on the commission plan enforces this.

**Staff Termination Mid-Period:** If a Media Buyer leaves on February 20, their February payout is calculated based on orders delivered up to that date. Any pending clawbacks are still applied.

**Zero Payout Due to Clawbacks:** If clawbacks exceed earnings, the system shows a negative balance but does NOT create a "debt" — the balance resets to zero, and the excess is NOT carried forward (unless configured otherwise by HR).

---

## 13. Module 8: Temporal Audit Trail (Universal)

### 13.1 Purpose
Provide an immutable, queryable history of every action taken by every user on every record. Eliminate all "I didn't do it" disputes.

### 13.2 Implementation

The audit trail is NOT a separate application-level log table. It is built into PostgreSQL 18 using System-Versioned Temporal Tables.

**Every business table** (orders, inventory_levels, products, users, funding_records, ad_spend_logs, commission_plans, invoices, stock_movements) has temporal versioning enabled. This means:

- Every row has a `valid_period` (tstzrange) column
- When a row is updated, the old version is automatically moved to a history partition with its time range
- The current row gets a new time range starting "now"
- No data is ever truly deleted — "deleted" rows have their time range closed

**Actor tracking** is achieved through the `SET LOCAL yannis.current_user_id` pattern. A PostgreSQL trigger reads this session variable and stamps every new row version with the actor's UUID.

### 13.3 What Gets Logged

| Event Type | Example | Logged Data |
|---|---|---|
| Record creation | New order submitted | Creator ID, all initial field values, timestamp |
| Field update | Address changed | Editor ID, old value, new value, timestamp |
| Status change | Order CONFIRMED → ALLOCATED | Actor ID, old status, new status, timestamp |
| Financial action | Spend request approved | Approver ID, amount, decision reason, timestamp |
| Access event | CS agent clicked "Call" (phone number accessed) | Agent ID, order ID, data accessed, timestamp |
| Login/logout | User authenticated | User ID, IP address, device info, timestamp |
| Permission change | User role updated | Admin ID who made change, old role, new role |
| Failed access | Unauthorized data request blocked by RLS | User ID, attempted action, blocked resource |

### 13.4 Audit Trail UI

**Per-Record Timeline:** Every record (order, product, inventory item) has a "History" tab showing a vertical timeline of every change, with actor name, timestamp, old value, and new value.

**Global Audit View (SuperAdmin only):** Filterable by user, module, date range, action type. Exportable as CSV or PDF for compliance.

**Time Travel Query:** SuperAdmin can select any record and any timestamp to see "What did this record look like at [date/time]?" The system reconstructs the exact state from the temporal table.

### 13.5 Edge Cases

**Bulk Operations:** If a Head of CS reassigns 50 orders at once, the audit trail creates 50 individual entries (one per order), all with the same actor and timestamp but different record IDs.

**System-Generated Events:** Automated triggers (SLA breaches, stock alerts, clawback generation) are logged with actor = `SYSTEM` and include the trigger rule that caused them.

---

## 14. Dashboard & Command Centre

### 14.1 Purpose
First screen every user sees. Role-personalized, real-time, actionable.

### 14.2 Role-Based Dashboard Content

**SuperAdmin Dashboard:**
- Platform-wide KPIs: total active orders, open CS tickets, pending finance approvals, low-stock alerts
- Revenue vs Cost graph (real-time)
- Critical alerts highlighted in red (SLA breaches, shrinkage reports, disputed funding)
- Quick links to every module

**Head of CS Dashboard:**
- Agent performance: calls made, confirmation rate, average call duration
- Queue health: unassigned orders, SLA timers, escalation count
- Hot Swap interface for order reassignment

**CS Agent Dashboard:**
- Personal queue: pending calls, engaged orders, confirmed orders
- Call button and order detail panel (nested routing — sidebar stays static)
- Performance stats: today's calls, confirmation rate

**Media Buyer Dashboard:**
- Active campaigns and form performance
- Personal stats: orders generated, CPA, ROAS, delivery rate
- Funding balance and ad spend history
- Payout history with line-item breakdown

**Finance Officer Dashboard:**
- Centralized approval queue: all pending requests sorted by date
- Budget tracker: per department/campaign
- Invoice management: outstanding, paid, overdue
- True Profit summary

**Third-Party Logistics Manager Dashboard:**
- Incoming transfers (pending verification)
- Active deliveries by rider
- Returns queue (pending assessment)
- Local stock levels

**Warehouse Manager Dashboard:**
- Stock levels across all locations
- Low-stock alerts
- Pending procurement requests
- Stock movement log

### 14.3 Real-Time Updates

All dashboards update via Socket.io WebSocket connections. When any relevant event occurs (order status change, new approval request, stock movement), the affected dashboards receive a push update without page refresh. Maximum staleness: 60 seconds.

---

## 15. Non-Functional Requirements

### 15.1 Performance Targets

| Metric | Target |
|---|---|
| Edge Form Load | < 400ms |
| VOIP Connection | < 1.5 seconds |
| Dashboard Refresh | < 60 seconds staleness |
| Customer Search (CS) | < 3 seconds |
| Profit/Loss Report (100k records) | < 3 seconds (Materialized Views) |
| Order State Transition API | < 500ms |
| Offline Sync (Rider) | < 30 seconds after network recovery |

### 15.2 Security

- All data in transit: TLS 1.3
- All data at rest: AES-256 encryption
- Session management: Redis-backed with instant revocation capability
- Rate limiting: Edge-level (forms), API-level (authenticated endpoints)
- CORS: Strict origin whitelist
- Content Security Policy headers on all responses

### 15.3 Data Retention

- Audit trail: Permanent (never deleted)
- Order data: Permanent (archived after 2 years, still queryable)
- Call recordings: 90 days (configurable)
- Ad spend screenshots: 1 year
- Session data: 24 hours after logout

### 15.4 PWA Requirements

- Installable on mobile devices (manifest.json + service worker)
- Offline-capable for: rider delivery updates, CS queue viewing
- Web Push notifications for: incoming calls, new order assignments, funding alerts, SLA breaches
- Background sync for: delivery confirmations, call logs

---

## 16. Database Schema Overview

### 16.1 Core Tables

| Table | Key Fields | Temporal? | RLS? |
|---|---|---|---|
| users | id, name, email, role, status, capacity | Yes | Yes (role-based) |
| products | id, name, sku, base_sale_price, cost_price, min_threshold | Yes | Yes (cost fields restricted) |
| inventory_levels | id, product_id, location_id, stock_count, reserved_count, batch_id | Yes | Yes (location-based) |
| stock_batches | id, product_id, factory_cost, landing_cost, quantity, received_at | Yes | Yes (finance only for costs) |
| stock_movements | id, product_id, movement_type, quantity, from_location, to_location, reference_id, reason, actor_id | Yes | Yes |
| orders | id, campaign_id, media_buyer_id, assigned_cs_id, status, items, total_amount, landed_cost, delivery_fee, delivered_at, parent_order_id | Yes | Yes (role-based) |
| order_items | id, order_id, product_id, quantity, unit_price, batch_id | Yes | Yes |
| call_logs | id, order_id, agent_id, duration, status, recording_url, transcript | No | Yes |
| logistics_providers | id, name, contact, coverage_area, rate_card | Yes | Yes |
| logistics_locations | id, provider_id, name, address, coordinates | Yes | Yes |
| stock_transfers | id, product_id, quantity_sent, quantity_received, from_location, to_location, transfer_status, reason_code | Yes | Yes |
| marketing_funding | id, sender_id (HoM), receiver_id (MB), amount, receipt_url, status, sent_at, verified_at | Yes | Yes |
| ad_spend_logs | id, media_buyer_id, product_id, spend_amount, screenshot_url, spend_date | Yes | Yes |
| invoices | id, reference_number, order_id, recipient, line_items, tax, total, status, due_date | Yes | Yes |
| commission_plans | id, role, rules (JSONB), effective_from, effective_to | Yes | Yes |
| payout_records | id, staff_id, period_start, period_end, base_salary, performance_bonus, add_ons, deductions, total_payout | Yes | Yes |
| earnings_adjustments | id, staff_id, amount, category, reason, approved_by, period_id | Yes | Yes |
| campaigns | id, media_buyer_id, name, product_ids, offer_template_id, form_config, deployment_type | Yes | Yes |
| offer_templates | id, product_id, name, price, variants, created_by (Stock Manager) | Yes | Yes |

### 16.2 Key Relationships

- `orders.media_buyer_id` → `users.id` (who generated this lead)
- `orders.assigned_cs_id` → `users.id` (who confirmed this order)
- `orders.parent_order_id` → `orders.id` (self-reference for versioned/split orders)
- `order_items.batch_id` → `stock_batches.id` (which cost batch this unit came from)
- `stock_transfers.from_location` → `logistics_locations.id`
- `stock_transfers.to_location` → `logistics_locations.id`
- `marketing_funding.sender_id` → `users.id` (HoM)
- `marketing_funding.receiver_id` → `users.id` (Media Buyer)
- `payout_records.staff_id` → `users.id`

---

## 17. API Structure Overview

All internal communication uses tRPC. Each module has its own tRPC router:

```
trpc/
├── orders.router.ts          # CRUD, state transitions, assignment
├── inventory.router.ts       # Stock levels, movements, batch management
├── logistics.router.ts       # Transfers, allocations, delivery updates
├── marketing.router.ts       # Funding, ad spend, campaign management
├── finance.router.ts         # Approvals, budgets, invoices, profit queries
├── hr.router.ts              # Payouts, commission rules, adjustments
├── users.router.ts           # Auth, RBAC, user management
├── audit.router.ts           # Temporal queries, history views (read-only)
├── dashboard.router.ts       # Aggregated KPIs per role
└── notifications.router.ts   # Push notification management
```

All routers are also exposed as REST endpoints via `trpc-openapi` for external consumers, auto-generating Swagger documentation.

---

## 18. Glossary

| Term | Definition |
|---|---|
| EOSE | Enterprise Operations & Sales Engine |
| Third-Party Logistics (3PL) | External logistics company that handles storage and delivery |
| FIFO | First-In, First-Out — inventory costing method |
| COGS | Cost of Goods Sold |
| Landed Cost | Total cost to get a product to a sellable location (factory + freight + duty) |
| CPA | Cost Per Acquisition — ad spend per order generated |
| ROAS | Return on Ad Spend — revenue per dollar of advertising |
| RLS | Row-Level Security — database-enforced access control |
| UUIDv7 | Time-ordered unique identifier (better index performance than UUIDv4) |
| Temporal Table | PostgreSQL table that automatically tracks historical versions of every row |
| Circuit Breaker | Pattern that detects failures and redirects traffic to a backup system |
| Shadow DOM | Web API that encapsulates a form's internal styling from the host page |
| PWA | Progressive Web App — web app with native-like offline and notification capabilities |
| WebRTC | Web Real-Time Communication — browser-based voice/video protocol |
| Settlement Window | The time period over which commissions are calculated (weekly/bi-weekly/monthly) |
| Clawback | Deduction from future earnings to reverse a previously paid commission |
| Shrinkage | Inventory loss between warehouse and Third-Party Logistics (damaged, lost, stolen) |
| Virtual Buffer | 10% stock reserve hidden from the sales module to prevent overselling |