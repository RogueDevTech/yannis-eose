# Duplicate Order Detection System

How Yannis EOSE detects and handles duplicate orders across all order types.

## Overview

The system has multiple layers of protection to prevent the same customer from having duplicate orders for the same product. These checks happen when orders are created, before delivery, during graduation, and every 2 hours via a background cleanup job.

**The core rule**: same customer phone number + same product = potential duplicate. If a customer orders a different product, it is never considered a duplicate, even if the phone number is the same.

**Order types covered**:
- Funnel orders (from landing page forms and imports)
- Offline orders (created manually by closers)
- Cart orders (recovered abandoned carts)
- Follow-up orders (re-engagement of past customers)
- Delivered follow-up orders (manually created for past customers)

All duplicate checks look across all order types to prevent cross-pipeline duplicates.


## Layer 1: Blocks New Orders at Creation

**When it runs**: every time a new order is submitted (landing page form, offline creation, or delivered follow-up creation)

### How it works
- Checks if an order already exists for the same phone number and the same product, created within the last **14 days**
- Looks across all order types (funnel, cart, follow-up)
- If a match is found, the new order is blocked and not created
- The media buyer who submitted the blocked order gets a cross-funnel attempt record so they can see their funnel caught a real lead

### Examples

**Blocked**: Azeez Jimoh (08104579148) ordered ARJUNA AND LASUNA on July 1. On July 10, the same phone number submits for ARJUNA AND LASUNA again via a different media buyer. The second order is blocked.

**Allowed (different product)**: Azeez Jimoh (08104579148) ordered ARJUNA AND LASUNA on July 1. On July 5, the same phone orders LIV T-550. Both go through because they are different products.

**Allowed (outside 14 days)**: Azeez Jimoh (08104579148) ordered ARJUNA AND LASUNA on June 1 and it was delivered and remitted. On June 20 (19 days later), the same phone orders ARJUNA AND LASUNA again. This goes through as a legitimate repeat purchase.

**Note on offline / active orders**: within the same 14-day window, Layer 1 also blocks closers from creating offline or delivered-follow-up orders when any non-deleted order (including still-active pipeline orders) already exists for that phone + product. There is no separate longer (e.g. 20-day) active-only guard.


## Layer 2: Cart Order Pre-Delivery Check

**When it runs**: when a cart order is about to be marked as DELIVERED

### How it works
- Before allowing the delivery, checks if the same customer (phone) already has a delivered order for the same product **at the same price** within the last **14 days**
- Price matching is required. A different price means a different offer, so it is not a duplicate

### Examples

**Blocked**: Dare Kolawole (07707101016) had an order for ARJUNA AND LASUNA at N60,000 delivered on July 15. A cart order for the same phone + ARJUNA AND LASUNA at N60,000 tries to be marked DELIVERED on July 20. Blocked because it matches on phone, product, and price.

**Allowed**: Same customer, but the cart order is at N45,000 (different offer). Allowed because the prices are different.


## Layer 3: Follow-Up Order Pre-Delivery Check

**When it runs**: when a follow-up order is about to be marked as DELIVERED

### How it works
- Before allowing the delivery, checks if the same customer (phone) already has a delivered order for the same product within the last **14 days**
- No price matching required (stricter than the cart order check)
- If a match is found, the delivery is blocked

### Example

**Blocked**: Charles (08033455302) had an order for LIV T-550 delivered on July 18. A follow-up order for the same phone + LIV T-550 tries to be marked DELIVERED on July 25. Blocked because the original was delivered within 14 days.


## Layer 4: Cart Order Graduation Guard

**When it runs**: when a delivered cart order is about to graduate (create a copy in the main orders table)

### How it works
- Before graduation, checks all order types for a delivered order with the same phone + product within 14 days
- If a duplicate is found, graduation is skipped and the cart order is marked as CONVERTED instead
- This is a safety net in case the pre-delivery check (Layer 2) missed something due to timing

### Example

A cart order for Simeon Iorungwa (07061641640) + ARJUNA AND LASUNA is DELIVERED and about to graduate. Meanwhile, a follow-up order for the same phone + ARJUNA AND LASUNA was also delivered. The cart order sees the follow-up as a duplicate and skips graduation, becoming CONVERTED.


## Layer 5: Follow-Up Order Graduation Guard

**When it runs**: when a delivered follow-up order is about to graduate (create a copy in the main orders table)

### How it works
- Same logic as Layer 4 but for follow-up orders
- Checks all order types for a delivered order with the same phone + product within 14 days
- If found, graduation is skipped and the follow-up order is marked as CONVERTED


## Layer 6: Cart Recovery Guard

**When it runs**: when the system pulls abandoned carts into the cart orders pipeline for CS to work

### How it works
- Before recovering an abandoned cart, checks all order types for an existing order with the same phone + product within **14 days**
- If a match is found, the abandoned cart is skipped and tagged with the reason
- CS can see why the cart was not recovered and which order blocked it

### Example

Borisade Flore (09044464462) submitted a cart form for ARJUNA AND LASUNA on July 10 and abandoned it. On July 12, the same customer called in and Olayinka Corr created an offline order for ARJUNA AND LASUNA. When the cart recovery job runs, it finds the offline order and skips the abandoned cart. The cart is tagged as "skipped: duplicate order exists".


## Layer 7: Background Cleanup (Every 2 Hours)

**When it runs**: automatically every 2 hours, scanning orders created in the last 48 hours

### How it works
- Finds orders in the main orders table where the same phone + product appears more than once within **14 days**
- Picks a winner based on which order is further along in the lifecycle. If tied, the oldest order wins
- **Early-stage duplicates** (Unprocessed, Assigned, Engaged): automatically deleted and removed from CS queues
- **Late-stage duplicates** (Confirmed and beyond): flagged with a "Duplicate" badge but NOT deleted, because stock may already be allocated. CS or HoCS must handle these manually
- Skips collapsing when the winner was already delivered/remitted **before** the loser was created (legitimate repeat purchase)

### Lifecycle ranking (winner has the higher rank)
1. Remitted (highest)
2. Delivered
3. Partially Delivered
4. In Transit
5. Dispatched
6. Agent Assigned
7. Confirmed
8. CS Engaged
9. CS Assigned
10. Unprocessed (lowest)

### Example

At 14:00, two landing page submissions arrive for Ezekiel Ogundu (08035085080) + ARJUNA AND LASUNA within seconds of each other from two different media buyers. At 16:00, the background job runs and finds the duplicate. The earlier submission wins. If the later one is still Unprocessed, it gets deleted. If it has already been Confirmed, it gets a "Duplicate" badge for HoCS to review.


## Layer 8: Test Order Cleanup (Every 2 Hours + Startup)

**When it runs**: every 2 hours and on system startup

This is not duplicate detection, but removes test data that could interfere with real orders.

### How it works
- Finds orders where the customer name contains the word "test" (case-insensitive, whole word only)
- Matches: "Test", "test 1", "Abraham test", "TEST2"
- Does NOT match: "Testimony", "Tester", "latest", "contest"
- Only deletes early-stage orders. If a test order has already been confirmed or moved stock, it is flagged for manual review instead
- Covers all order types: funnel, cart, and follow-up
- Maximum 200 orders cleaned per run as a safety limit


## Layer 9: Race Condition Prevention

**When it runs**: during every order creation

### How it works
- When two forms are submitted at the exact same time for the same phone number, the system uses a database lock to make sure they are processed one at a time
- The first submission goes through. The second one waits, then sees the first order already exists and blocks
- This prevents the situation where two identical orders both pass the duplicate check before either one is saved


## Duplicate Coverage by Order Type

| Order Type | At Creation | Before Delivery | At Graduation | Background Cleanup | Cart Recovery |
|------------|------------|----------------|--------------|-------------------|---------------|
| Funnel orders (landing page) | Layer 1 | N/A | N/A | Layer 7 | N/A |
| Offline orders | Layer 1 | N/A | N/A | Layer 7 | N/A |
| Cart orders | Layer 6 | Layer 2 | Layer 4 | N/A | Layer 6 |
| Follow-up orders | Created by system | Layer 3 | Layer 5 | N/A | N/A |
| Delivered follow-up (manual) | Layer 1 | N/A | N/A | Layer 7 | N/A |


## What is NOT a Duplicate

| Scenario | Duplicate? | Why |
|----------|-----------|-----|
| Same phone, **different product** | No | Product overlap is required |
| Same phone, same product, **more than 14 days apart** | No | Outside the dedup window. Treated as a repeat purchase |
| Same phone, same product, existing order **already delivered**, within 14 days of that order's creation | Yes at create | Layer 1 still blocks within 14 days of `created_at` |
| Same phone, same product, existing order **already delivered**, and new order created after delivery (cron path) | No for auto-delete | Background cleanup will not collapse a repeat purchase onto a pre-delivered winner |
| Same product, **different phone number** | No | Phone match is required |
| Same phone, same product, **different price** (cart orders only) | No | Cart checks require same price. Different price = different offer |


## How to Handle Flagged Duplicates

When the system flags a duplicate, CS, HoCS, or Admin can:

1. **Dismiss**: if the order is actually legitimate, dismiss the flag. Removes the "Duplicate" badge.
2. **Merge**: combine the duplicate into the winning order (transfers relevant data).
3. **Restore**: Admin/SuperAdmin can restore a deleted duplicate back to Unprocessed if it was wrongly caught.
4. **Leave flagged**: for visibility, especially on confirmed orders where stock review is needed.


## Time Windows Summary

| Check | Window | Notes |
|-------|--------|-------|
| New order creation | 14 days | Blocks creation if match found within 14 days (all statuses except cancelled/deleted) |
| Cart order before delivery | 14 days | Also requires same price |
| Follow-up order before delivery | 14 days | No price matching |
| Cart order graduation | 14 days | Safety net before creating copy |
| Follow-up order graduation | 14 days | Safety net before creating copy |
| Cart recovery (abandoned carts) | 14 days | Skips pull if match found |
| Background cleanup cron | 14 days | Runs every 2 hours, scans last 48 hours |
| Test order cleanup | No window | Matches "test" in customer name |
