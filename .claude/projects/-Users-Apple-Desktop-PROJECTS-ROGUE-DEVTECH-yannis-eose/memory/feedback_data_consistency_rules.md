---
name: Data consistency rules
description: Stat strips must match their list/table; cross-table totals only add graduated (DELIVERED/REMITTED) from secondary tables; never double-count across orders/cart_orders/follow_up_orders.
type: feedback
---

Stat strip numbers MUST match the table below them on the same page. When a number appears in two places, both must come from the same query or table.

**Why:** Multiple incidents of dashboard/page stat strips showing different numbers than the corresponding table due to different query flags (excludeGraduated, excludeCartGraduated, isFollowUp), different table sources (orders vs cart_orders), or missing pipeline counts (deliveredFollowUpCounts). CEO/HoCS flagged these as trust-breaking.

**How to apply:**
- When adding/modifying a stat strip, verify it uses the EXACT same WHERE conditions as the list on that page.
- Cross-table totals (orders + cart_orders + follow_up_orders): only add DELIVERED/REMITTED from secondary tables, never the full pipeline total.
- `getStatusCountsByOrderSource` for marketing strips: always pass `excludeFollowUps=true` + `excludeCartGraduated=true`.
- Dashboard `TotalOrdersStrip`: must include all four pipeline counts (orderCounts + followUpCounts + cartOrdersCounts + deliveredFollowUpCounts).
- The `excludeGraduated` flag on `orders.statusCounts` defaults to `true` — this can silently kill `delivered_follow_up` counts. Pass `excludeGraduated: false` when explicitly querying delivered follow-up orders.
