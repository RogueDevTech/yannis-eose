# Module Specs: CS, Edge Sales, Marketing

## Edge Sales Module

- Form hosted on Cloudflare Worker, NOT Remix server
- Idempotency: hash fingerprint + phone + timestamp to prevent double-submissions
- Circuit breaker: if API latency > 2000ms or 5xx, buffer order in QStash
- Inventory budget cap: query Redis for (pending + confirmed) count per product. If >= (total_stock - 10% buffer), Sold Out
- 3 deployment modes: Shadow DOM snippet, iframe, hosted URL
- Media Buyers select from pre-approved Offer Templates — CANNOT set prices

### Dedup (CEO directive 2026-04-27, migration 0079)

Per-Media-Buyer, not global. 6-hour `(phone + product)` dedup key in KV scoped by `mediaBuyerId`.
- Same MB resubmits → KV short-circuits with `alreadySubmitted: true`
- Different MB same phone+product within 6h → API inserts `cross_funnel_attempts` row (NOT an order), returns `{ crossFunnelAttempt: true }`
- Cross-funnel rows are NOT orders. Never in orders.list, CS queue, pipeline, profit, CPA/ROAS, commission, or MVs
- Phone stored as `customer_phone_hash` only (Pillar 2)
- tRPC: `marketing.listMyCrossFunnelAttempts`, `marketing.crossFunnelStats`
- Detection only for `orderSource === 'edge-form'` with `mediaBuyerId`
- Form UX: `alreadySubmitted` → inline message + disable submit + skip `successCallbackUrl` redirect

---

## CS Module

### Phone Security
- API responses mask phones: `0803****1234`. Raw number NEVER sent to frontend
- Call button sends call_token to VOIP provider — frontend never gets raw number

### Dispatch Modes
Four modes configurable by HoCS via `system_settings` (`CS_DISPATCH_STRATEGY.strategy`). **Default is `manual`** (CEO directive).
1. `manual` (DEFAULT): no auto-assignment. Orders land as UNPROCESSED, wait for HoCS/Admin to assign via Hot Swap
2. `load_balanced`: auto-push to agent with fewest pending, tie-break most idle
3. `performance`: prioritise agents with higher delivery + confirmation rates
4. `claim`: open pool, reps race to claim via `claimOrder()` with atomic Redis/Postgres lock

Claim cap (`CS_CLAIM_CAP.cap`, default 2): rep blocked if >= cap unconfirmed orders.

### CS Order Routing
When `load_balanced` or `performance` runs, `OrdersService.assignOrderToBestAvailableAgent` uses `cs_order_routing_rules` + `cs_order_routing_rule_targets`. Strategy `EQUAL` hashes orderId into target team; `WEIGHTED` spreads by weight. UI: `/admin/settings/cs-order-routing`.

### Confirm Gate (locked 2026-04-26)
Assigned CS closer: Confirm disabled until qualifying call (VOIP: `call_duration >= 15s`; manual: any call log).
**Overrides:** `isAdminLevel`, Branch Admin (same-branch), Head of CS (org-wide, any rep's call on that order).
Server: `orders.service.ts::validateTransitionGates`. UI: `OrderDetailPage.tsx`. Keep both in sync.

### Order Management
- Reassignment is management-only. CS closers CANNOT transfer orders. Only HoCS/SuperAdmin via Hot Swap.
- CS owns order end-to-end (rider-proxy model): allocates to 3PL, confirms delivery. REMITTED stays with accountant.
- `deliveryNote` and `deliveryProofUrl` both optional (CEO 2026-04-24).

### Share to 3PL (WhatsApp group flow)
- `whatsapp_group_link` on logistics locations. `WHATSAPP_GROUP` message channel.
- tRPC: `messaging.shareToLogistics({ orderId, locationId, templateId })`
- Copy+open pattern: groups can't carry `?text=` pre-fill. Do NOT try deep-link with text.
- Placeholders in `messaging.router.ts::ALLOWED_TEMPLATE_PLACEHOLDERS`

### CS Communication Panel
Three channels: Call (VOIP), SMS, WhatsApp (template-only). All through platform bridge. Every send writes `outbound_messages` + `order_timeline_events` in same transaction.

### Supervisor Mirror View
Socket.io `agent:state_update` broadcasts. Server stores in Redis. `supervisor:watching` event shows "Being Observed" indicator. Read-only.

### Mirror Mode (full-session impersonation)
Admin browses as another user — their role, branch, RLS, theme, font scale.

**Permission gate** (`authz.ts::canMirror`):
- SuperAdmin/Admin → anyone except admin-level
- HEAD_OF_CS → CS_CLOSER (any branch)
- HEAD_OF_MARKETING → MEDIA_BUYER (any branch)
- HEAD_OF_LOGISTICS → LOGISTICS_MANAGER/TPL_MANAGER/TPL_RIDER/STOCK_MANAGER
- Branch supervisors → supervised users on active branch
- HR_MANAGER → nobody. No self-mirror. No nesting.

**Read-only enforcement:** `blockMutationsWhileMirroring` root middleware rejects all tRPC mutations.

**Session:** `mirroredBy: { id, name, role } | null`. Target's identity used.

**Audit:** `mirror_sessions` table (permanent, never delete). Active sessions show pulsing badge.

**No side-effects:** Notifications `readOnly` flag, socket broadcasts check `data-mirror="1"`, DashboardLayout sets attribute.

**UI:** Green border overlay, "Exit mirror" pill in header, full-screen loader during transition.

### Order Timeline
Every state transition writes `order_timeline_events` in same transaction via `writeTimelineEvent()`. `OrderTimeline` component shared across all detail pages. Role filtering in tRPC procedure.

---

## Marketing Module

### Funding
- Funding Ledger: HoM creates record (SENT). MB marks COMPLETED or DISPUTED.
- Approve funding request = insert `marketing_funding` row in same transaction
- Two-section page layout (CEO 2026-04-26): Section 1 "Funds I've Received", Section 2 "Funds I Distribute" (HoM/Admin only)
- URL state: `?section=received|distributing&tab=transfers|requests`
- Metrics: Total Received, Current balance, Total Distributed, Pending Mark-Received, Disputed
- Disputed banner when disputes > 0

### Funding Request Notifications (locked)
- **MB requests** → notify HEAD_OF_MARKETING only
- **HoM requests** → notify SUPER_ADMIN + FINANCE_OFFICER only
- **Disputed** → notify SUPER_ADMIN + HEAD_OF_MARKETING

### Ad Spend
- Mandatory screenshot per entry
- Daily-grouped Add Expense (Phase 17, migration 0082): multi-line modal, batch write in `withActor` tx
- Accordion grouped by (date × MB). `platform` + `ad_url` columns.
- CPA = Total Ad Spend / Total Orders Created (all statuses)
- True ROAS = DELIVERED revenue / Total Ad Spend
