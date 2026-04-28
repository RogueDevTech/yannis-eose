-- Add CANCELLED to transfer_status enum so a Stock Manager / HoLogistics /
-- admin can reverse a transfer that was created in error. Cancelling adds the
-- units back to the source location, deducts them from the destination
-- (only when the destination still has at least the transferred quantity
-- available), and flips the row to CANCELLED. The history trigger keeps the
-- original RECEIVED row's audit footprint intact.

ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'CANCELLED';
