-- 0110_rename_order_status_values.sql
--
-- CEO directive 2026-05-04: rename two terminal-ish order-status values for
-- accuracy. The previous labels were operationally ambiguous:
--
--   COMPLETED → REMITTED
--     The order moves into this state when Finance confirms cash remittance
--     for the corresponding cash-on-delivery batch (see
--     "Cash Remittance — accountant-led flow" in CLAUDE.md). It is NOT the
--     same as DELIVERED (CS / Logistics confirmation that the customer
--     received the goods).
--
--   ALLOCATED → AGENT_ASSIGNED
--     The order is assigned to a 3PL location's agent for delivery.
--     "Allocated" was a stock-tracking term; "Agent assigned" matches what
--     ops actually says day-to-day and aligns with the existing
--     `assignedCsId` / `riderId` vocabulary on the order row.
--
-- Postgres 14+ supports `ALTER TYPE ... RENAME VALUE ...` atomically — every
-- existing row that referenced the old value automatically reads as the new
-- value after this runs. No data movement, no UPDATE, no history-table sync
-- needed (`*_history` tables share the same enum).
--
-- This migration ONLY touches `order_status`. Other enums that happen to
-- carry these strings (e.g. `funding_status` for transfers, `call_status`
-- for VOIP) keep their values — different semantics.

ALTER TYPE order_status RENAME VALUE 'COMPLETED' TO 'REMITTED';
ALTER TYPE order_status RENAME VALUE 'ALLOCATED' TO 'AGENT_ASSIGNED';
