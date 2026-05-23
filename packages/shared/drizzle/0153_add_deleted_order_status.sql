-- Migration 0153: Add DELETED order status + ORDER_DELETED timeline event.
--
-- CEO directive 2026-05-23: DELETED replaces the old CANCELLED flow entirely.
-- No new orders can be cancelled — CANCELLED is legacy-only for existing data.
--
-- DELETED = soft-removal from all metrics, dashboards, and counts.
--           Row stays in DB (audit trail preserved). Admin/SuperAdmin can restore.
--           Permission-gated via `orders.delete` — HoCS by default (requires Admin approval).
--
-- deleted_at is also set for backward compat with existing isNull(deleted_at) filters.

ALTER TYPE order_status ADD VALUE 'DELETED';

ALTER TYPE timeline_event_type ADD VALUE 'ORDER_DELETED';
