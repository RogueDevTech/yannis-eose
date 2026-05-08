-- Cart abandonments: customer_phone column for CS click-to-call.
--
-- CEO directive 2026-05-08 — the dropped-off backlog is unactionable today
-- because cart_abandonments stores ONLY a SHA-256 phone hash (irreversible).
-- Ops can see who almost ordered but cannot reach them. Mirroring orders.customer_phone
-- here lets CS dial / WhatsApp / SMS abandoned-cart customers exactly the
-- way they reach order customers (Pillar 2: phone never leaves the API
-- except via the click-to-call reveal endpoint, which is per-actor audited).
--
-- Backfill: NULL for pre-directive rows. The reveal procedure returns
-- isDialable=false in that case and the UI hides the Call button.
--
-- Note: cart_abandonments is on the AUDIT-EXCLUDED list (migration 0119),
-- so there's no *_history table to sync and no trigger to update — just the
-- main table column.

ALTER TABLE cart_abandonments
  ADD COLUMN IF NOT EXISTS customer_phone text;
