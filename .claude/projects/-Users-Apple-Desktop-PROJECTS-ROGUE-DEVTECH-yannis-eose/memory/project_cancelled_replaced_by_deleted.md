---
name: CANCELLED replaced by DELETED
description: CEO directive 2026-05-23 — no more cancel order, only delete. CANCELLED is legacy-only for existing data. DELETED is permission-gated via orders.delete.
type: project
---

CEO directive 2026-05-23: the CANCELLED order flow is removed entirely. All new order removals use DELETED status.

**Why:** CEO wanted a single "delete" action instead of cancel. DELETED orders are excluded from all metrics/counts but stay in DB for audit. The cancel flow was confusing — "cancel" vs "delete" had unclear semantics.

**How to apply:**
- No new orders can transition to CANCELLED. The state machine only has `→ DELETED` transitions from pre-confirmation statuses.
- CANCELLED stays in the enum for backward compatibility with existing data. Legacy CANCELLED orders can be restored (`→ UNPROCESSED`) or deleted (`→ DELETED`) by Admin.
- `orders.delete` permission: Admin/SuperAdmin have it by default. HoCS does NOT get it in the template — they must request it and Admin must approve.
- All UI buttons say "Delete" not "Cancel". The "Deleted" tab replaces the "Cancelled" tab on all order pages.
- DELETED count shows in stat overview strips on Dashboard, CS Dashboard, Marketing Orders.
- Auto-callback exhaustion (3 max attempts) now transitions to DELETED instead of CANCELLED.
- Test-order purge cron transitions to DELETED (was already updated).
- **Transfer/shipment/invoice CANCELLED is unaffected** — those are separate domain statuses.
