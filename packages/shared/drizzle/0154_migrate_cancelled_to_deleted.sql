-- Migration 0154: Move all CANCELLED orders to DELETED.
--
-- CEO directive 2026-05-23: CANCELLED is retired. All existing CANCELLED
-- orders become DELETED so there is one consistent status for removed orders.
-- Sets deleted_at for rows that don't have it yet (backward compat with
-- isNull(deleted_at) filters throughout the codebase).

UPDATE orders
SET status = 'DELETED',
    deleted_at = COALESCE(deleted_at, updated_at, NOW()),
    updated_at = NOW()
WHERE status = 'CANCELLED';
