---
name: Offer price is the line total — never multiply by quantity
description: unitPrice in order_items stores the offer/bundle price (the line total), not a per-unit price. Never multiply unitPrice × quantity.
type: project
---

`order_items.unitPrice` stores the **offer/bundle price** — the total the customer agreed to pay for that line. It is NOT a per-unit price.

Example: offer "3 for ₦135,000" → `quantity: 3`, `unitPrice: 135000`. The line total is ₦135,000, not ₦405,000.

**Why:** Offers are bundled discounts. The price the customer sees on the form IS the total. Dividing by quantity would produce a fake per-unit number that doesn't match any real price. Multiplying by quantity would overcharge the customer.

**How to apply:**
- Line total = `unitPrice` (not `unitPrice × quantity`)
- Order total = `SUM(unitPrice)` across all lines
- Display: show `unitPrice` as "Price", not "each". Show quantity as informational.
- This applies everywhere: order detail, CS dashboard, logistics, invoices, P&L, permission requests, CSV exports.
- Seed/test scripts that generate synthetic data without offers may still use per-unit pricing — those are self-consistent and don't go through the offer flow.
