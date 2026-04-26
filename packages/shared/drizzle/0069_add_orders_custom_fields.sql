-- ============================================
-- 0069: Add `custom_fields` JSONB to orders + sync orders_history.
--
-- Why:
--   The marketing form builder lets Media Buyers add arbitrary fields to a campaign's
--   public form (e.g. "Shirt size", "How did you hear about us?"). Customer responses
--   to those fields land in `orders.custom_fields` as a JSON object keyed by the
--   field's stable id, e.g. { "<fieldId>": "Large", "<otherId>": ["Email","SMS"] }.
--   JSONB keeps writes cheap and avoids a separate `order_form_responses` table — we
--   never query by custom-field VALUE, only render by id alongside the order.
--
-- Both `orders` and `orders_history` get the column so the temporal capture trigger
-- doesn't fail on UPDATE/DELETE (matches the convention from earlier migrations).
-- ============================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS custom_fields jsonb;

ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS custom_fields jsonb;
