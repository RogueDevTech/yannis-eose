-- Fix cart-recovered orders that were created with isFollowUp=false.
-- These orders were converted from carts but landed in the main CS queue
-- instead of the Follow-Up pipeline. Mark them as follow-up so they
-- disappear from the main queue and only appear in Follow-Up.
--
-- Scope: orders with orderSource='offline' AND a cart_id back-link
-- AND isFollowUp=false (the ones that slipped through before the fix).

UPDATE orders
SET is_follow_up = true,
    updated_at = NOW()
WHERE order_source = 'offline'
  AND cart_id IS NOT NULL
  AND is_follow_up = false
  AND deleted_at IS NULL;
