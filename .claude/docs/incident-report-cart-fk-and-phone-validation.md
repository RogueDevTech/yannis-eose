# Technical Incident Report: Silent Order Loss on a Public Intake Form

**Period:** 2026-09-15 to 2026-09-21
**Systems:** Cloudflare Worker (public order form) → NestJS/tRPC API → PostgreSQL
**Impact:** Orders rejected at insert; a separate defect disabled phone validation across 91% of campaigns.
**Status:** Both root causes fixed. One upstream fix still unmerged (see §7).

Written as a transferable postmortem. Two independent bug classes, both of which
reproduce in any system with the same shape: a public form writing to a normalised
relational schema with a draft/abandonment side table.

---

## 1. Architecture (the shape that matters)

```
Browser form (JS injected by a Cloudflare Worker)
  ├─ POST /cart    "draft" save, debounced ~3s after a valid phone is typed
  │                  → upsert into cart_abandonments (campaign_id, phone_hash)
  │                  → returns { id } ... OR { buffered: true } with NO id
  └─ POST /submit  final order
                     → insert into orders, carrying cart_id = the id from /cart
```

Two relevant design decisions:

- **`orders.cart_id`** is a foreign key to `cart_abandonments(id)`. Its only
  purpose is a CRM list filter ("Recovered from cart"). It carries no money, no
  lifecycle state, no reporting weight.
- **The worker never fails an order.** On API 5xx it buffers to a queue (QStash)
  and returns success. This is the revenue guarantee. It works for 5xx. It does
  **not** catch 4xx, because a 4xx is a deliberate rejection, not an outage.

Those two decisions are individually reasonable and jointly fatal. Hold that thought.

---

## 2. Bug #1 — A cosmetic foreign key destroying orders

### 2.1 The failure

Production threw `orders_cart_id_fkey` on the public intake path. The entire
order insert aborted. The customer saw an error on a fully completed form. Their
data survived only as a `cart_abandonments` row, which a cron promoted to the
"abandoned cart" queue five minutes later — indistinguishable from someone who
wandered off. **1 in 58 such customers ever came back.**

### 2.2 Root cause

```ts
// orders.service.ts — before
cartId: cartId ?? null,   // passed straight through to an FK-constrained column
```

The id arrived from the browser and went into an FK column unverified. If no
matching `cart_abandonments` row existed, Postgres rejected the whole INSERT.

### 2.3 How an id with no row is reachable on the happy path

This is the part worth internalising, because it looks impossible at first read.

1. Carts **upsert on `(campaign_id, phone_hash)`**, with the id generated
   server-side. Same phone + same campaign = same row, but the id is chosen by
   the API, not the client.
2. When the API is briefly 5xx, the worker's `/cart` returns `{ buffered: true }`
   **with no id**. The row is queued and lands later, possibly under a different id.
3. A form session that captured a real id from an *earlier* save **keeps it**.

So: save #1 succeeds and hands back id `A`. The customer edits a field. Save #2
is buffered during a blip. The customer submits. The order references id `A`,
whose row may have been superseded, or whose write is still in the queue. FK
violation → order destroyed.

Production evidence: a burst of failures **while 58 carts and 40 cart-linked
orders in the same two-hour window succeeded**. A narrow race, not an outage —
which is exactly why it was invisible in aggregate health metrics.

### 2.4 The fix (API side)

Verify before storing; degrade the tag, never the order.

```ts
private async resolveStorableCartId(cartId?: string | null): Promise<string | null> {
  if (!cartId) return null;
  try {
    const rows = await this.db
      .select({ id: schema.cartAbandonments.id })
      .from(schema.cartAbandonments)
      .where(eq(schema.cartAbandonments.id, cartId))
      .limit(1);
    if (rows.length > 0) return cartId;
    this.logger.warn(`cartId ${cartId} has no row — storing NULL so the order is not lost`);
    return null;
  } catch (err) {
    // A lookup FAILURE degrades the same way. An untagged order, never a lost one.
    this.logger.warn(`could not verify cartId ${cartId} — storing NULL`);
    return null;
  }
}
```

Cost: one indexed PK read. Applied at **all three** insert sites accepting a
cartId (public intake, offline create, delivered-follow-up) — not just the one
that was on fire.

Note the `catch`. If the *verification* fails, we still degrade to NULL. A guard
that can itself throw on the revenue path is not a guard.

### 2.5 The fix (client side) — the upstream half

One variable was doing two jobs:

```js
savedCartId = d.id;                              // real id
else if (d.buffered && !savedCartId)
  savedCartId = 'buffered';                      // sentinel, keeps progressive capture alive
...
cartId: savedCartId || undefined                 // ← sent on the ORDER
```

`savedCartId` answered *"does a cart exist yet?"* (gating progressive field
capture) **and** supplied *"which cart id goes on the order?"*. Those are
different questions. Split them:

- `savedCartId` — unchanged, still the "cart exists" gate, still set to `'buffered'`.
- `confirmedCartId` — set **only** from a real `d.id`, and the only value ever
  attached to an order. Cleared with `savedCartId` on reset so no stale id leaks
  into a second order.

Behaviour, traced case by case:

| Scenario | Before | After |
|---|---|---|
| Healthy, cart saved before submit | real cartId | unchanged |
| Healthy, save in flight at submit | real cartId | unchanged |
| **5xx, cart buffered** | **FK error, order rejected** | **order succeeds, loses tag** |
| 5xx buffered, later save succeeds | risk of stale id | real cartId |
| Cart save network error | no cartId | unchanged |
| Second order after reset | no stale id | unchanged |

Only the buffered path changes, from "order rejected" to "order succeeds without
a cosmetic filter tag".

---

## 3. Bug #2 — Phone validation silently disabled on 91% of campaigns

Three defects in three days, in the same subsystem. Chronology matters because
each was found by a human testing a live form, never by a test suite.

### 3.1 Defect A — `preventDefault()` bypassed native validation

The form rendered a correct `pattern` attribute on the phone input. The submit
handler called `e.preventDefault()`, which **bypasses native constraint
validation entirely**. The hand-written replacement check only tested for
emptiness. Malformed numbers reached the CRM as uncallable orders.

> **Generalise:** any `preventDefault()` submit handler silently discards every
> `required`, `pattern`, `min`, `max` and `type=email` on the form. If you
> intercept submit, you own validation. Audit every such handler.

Fixed client-side only. The server gate stays permissive (7–15 digits,
*stamp-never-reject*): a 4xx at intake is a lost order the buffer cannot catch.

### 3.2 Defect B — the country never resolved (the big one)

```ts
// before: country accepted ONLY if a region list contained it
const initialCountry = regionsByCountry[fc.deliveryCountry] ? fc.deliveryCountry : '';
```

`regionsByCountry` is derived from the campaign's **currencies**, and the
marketing service omits currencies entirely for single-currency campaigns (an
optimisation: "byte-identical to the single-currency world"). So a plain
single-currency campaign had no regions → country resolved to `''` →
`phoneRuleForCountry('')` returned the permissive international fallback
`\+?[0-9]{7,15}` → **almost any digits accepted**.

**414 of 456 active campaigns** were serving the permissive rule. Live check on
one campaign showed placeholder `+1234567890`, `data-initial-country=""`, and
`5665744473334` submitting with no error.

The bug is a **coupling of unrelated concerns**: regions drive a *Delivery State
dropdown*. The phone rule must not depend on them. Fix: fall back to the
campaign's own `deliveryCountry` before the currency/region fallbacks.

### 3.3 Defect C — two phone fields, two different rules

A **required** custom phone field (WhatsApp on most campaigns) validated with a
hardcoded Nigerian regex and no normalisation, while the main phone field had
been given country-awareness and leading-zero repair by the earlier fixes.

Result: on the *same form*, `8135123864` (a valid number typed without the trunk
zero) was **accepted by the phone field and rejected by WhatsApp**. Because that
field is required, the rejection **blocked the entire submit**. The customer
could not order at all.

Production signature, unassigned carts by status:

```
before Sep 15   only DELETED, 2–6/day        (normal)
Sep 15/16/17    UNPROCESSED 12 / 17 / 27     (a status never before seen unassigned)
```

Sep 15 is the day phone validation shipped. A blocked submit is *exactly* how a
completed form becomes an abandoned cart: the debounced cart save already wrote
the row, the cron promotes it, nobody works it. **We shipped a fix that created
a worse bug, and the only symptom was a rise in abandoned carts.**

### 3.4 Defect D — the config key kept vanishing

`formConfig.deliveryCountry` lives inside a **JSONB blob the campaign editor
rewrites wholesale**. A save from a UI holding a stale copy silently drops the
key. A backfill set it on 414 campaigns on Sep 16; **by Sep 21 three had already
lost it again**, and one live form served the permissive pattern for six days.

Fix: stop relying on stored config. **Derive** the country from the company's
default currency when the key is absent. The stored value still wins when
present (deliberate overrides survive), but there is nothing left for a UI write
to clobber. Return `undefined`, never `''`, when nothing resolves — an empty
string is indistinguishable from "no country" downstream and re-enables the
permissive rule.

### 3.5 Secondary findings from the same sweep

- **Leading-zero normalisation, not a wider pattern.** ~7% of orders drop the
  trunk zero. Widening the regex would have split the phone hash (bare 10-digit
  hashes one way, 0-prefixed another), silently breaking dedup, target groups
  and follow-ups. *Rewrite to the canonical form* instead: one customer, one hash.
- **An overlapping prefix leaked across countries.** One country's `0[2-9]`
  local pattern was a superset of two neighbours' ranges, so their numbers
  passed on its form. Verified with a 54×54 cross-country matrix.
- **Fallback direction matters.** On a regex that fails to compile, fall back to
  a *permissive* E.164 check, not a specific country's rule — the latter rejects
  an entire market.
- **Real junk rate was 0.60%, not the 7.65% a naive length check suggests.**
  98.8% of the "invalid" bucket was people dropping the leading zero. Measure
  before you reject.

---

## 4. The two structural lessons

### 4.1 Nothing optional may fail an order on a public intake path

The legacy PHP form this platform replaced wrote the order and the abandonment
row **independently**, so neither could break the other. It had no dedup, no
per-country validation, no referential integrity — and it lost fewer orders.

Our schema was *more correct* and *less reliable*. An FK on a decorative column
is a correctness win that buys a revenue loss.

**The rule:** on a public write path, audit every field. For each, ask *"if this
value is wrong, missing, or dangling, is the order still created?"* If the answer
is no and the field carries no money and no lifecycle meaning, it must degrade to
NULL. Never throw.

**Where to look in your own codebase:**
- FK columns on a public-intake table that reference a row written by a *different,
  earlier, possibly-async* request.
- `NOT NULL` + `DEFAULT`-less columns fed from client input.
- `CHECK` constraints on cosmetic or analytics fields.
- Unique constraints on anything a retry could collide with.
- Enum columns fed from client strings.
- Any `.parse()` / schema validation on an optional decorative field that throws
  rather than stripping.

A quick audit query for dangling references before you add the guard:

```sql
SELECT count(*) FROM orders o
LEFT JOIN cart_abandonments c ON c.id = o.cart_id
WHERE o.cart_id IS NOT NULL AND c.id IS NULL;
```

(If this returns 0 it proves nothing — the rows that would appear here were
never inserted. Look at your error logs for the constraint name instead.)

### 4.2 One validation rule, one helper, every field that shares a meaning

The legacy form validated phone and WhatsApp with the **identical** pattern.
Ours diverged, and the divergence blocked submits entirely. Every field of the
same semantic type must resolve its rule through **one** helper
(`normalisePhoneValue` + `isValidPhoneForInput` here), pinned by a test that
asserts the two fields agree.

Corollary: **simpler validation fails less.** One browser-enforced pattern
produced zero defects in years. Per-country validation with custom JS produced
four defects in six days. The capability is worth keeping — it requires
live-form testing before shipping, not just unit tests.

---

## 5. The observability failure (the most expensive part)

**When the form refuses a submit client-side, nothing is recorded anywhere.**
The handler `return`s before any `fetch`. Not a log line, not a DB row.

The customer's cart already exists (written ~3s after a valid phone), so five
minutes later the cron promotes it and it is **indistinguishable from a genuine
abandonment**. A column exists for exactly this purpose (`skip_reason`) and
nothing has ever written to it.

**Cost: roughly four days and six disproved theories**, because the evidence did
not exist. Every investigation had to infer from timestamps and joins. The one
fact that would have answered it in an hour — *which field blocked the submit* —
was never captured.

> **The rule: on a public form, a path that stops a customer must leave a trace.**
> Silent refusal is worse than a noisy one — it converts a ten-minute lookup into
> days of archaeology while the business watches cost-per-acquisition rise.

Minimum viable instrumentation, in priority order:

1. **Beacon on client-side submit failure**, recording the blocking field +
   campaign + session id. `navigator.sendBeacon` — fire-and-forget, survives
   page unload, cannot itself block the submit.
2. **Populate the skip-reason column** on the draft row, so an abandoned cart
   carries *why*.
3. **A counter per rejection reason**, so a validation change that starts
   blocking real customers shows up as a spike within minutes rather than as a
   vague rise in abandonment weeks later.

Also worth pre-empting: **a branch/queue with zero active assignees must alert.**
In this incident, 58 of 74 stuck carts turned out to sit in four branches with
**no staff assigned at all**. Orders arrived and routed correctly; nobody was
there to work them. That was a staffing problem misread as a code problem for
days. An "inbound queue with no consumer" alert would have separated the two
immediately.

---

## 6. Verification lessons

- **Verify regexes against the built bundle, never the source.** Here the form
  JS lives inside a TypeScript template literal: backticks or `${` in *any* text
  (comments included) terminate the string, and backslashes must be doubled
  (`\\+?` in source = `\+?` at runtime). A single-backslash "fix" once emitted
  `/^+?[0-9]{7,15}$/` — an invalid regex that would have killed the entire form
  script.
- **Every real defect in this incident was found by a human loading a live form.**
  None were caught by unit tests or bundle inspection. Unit tests pinned the
  behaviour *after* the fact; they never surfaced a bug. For a public revenue
  form, a smoke test against the deployed page is not optional.
- **Check the layer you are actually being asked about.** The first engineering
  response to the escalation was "the Cart Orders page is fine". The page *was*
  fine. The funnel feeding it was not.

---

## 7. Fix inventory and current state

| # | Fix | Layer | Merged |
|---|---|---|---|
| 704 | Client-side phone validation, country-aware; spec-table rule builder | Worker | ✅ |
| 709 | Resolve country from campaign config without requiring a region list | Worker | ✅ |
| 711 | `resolveStorableCartId` — verify FK before storing, at all 3 insert sites | API | ✅ |
| 713 | Custom phone fields share the main field's rule + normalisation | Worker | ✅ |
| 718 | Derive country from company default currency; `undefined` not `''` | API | ✅ |
| — | **`confirmedCartId` — never send an unconfirmed cart id** | **Worker** | **❌ unmerged** |

**Open item.** The upstream half of the cartId fix (§2.5) sits on
`fix/edge-form-unconfirmed-cart-id` and is **not on `dev`**. The API-side guard
(#711) means no order is lost either way, so this is a correctness/attribution
improvement rather than a revenue risk — but until it merges, buffered sessions
keep sending ids the API then discards, and those orders silently lose their
cart tag. It also **requires a manual worker deploy**; merging alone does not
ship it.

---

## 8. Checklist for auditing a similar system

**Public write path**
- [ ] List every column the public insert writes from client input.
- [ ] For each, confirm a wrong/missing/dangling value cannot abort the insert.
- [ ] Any FK referencing a row written by an earlier async request → verify-or-NULL.
- [ ] The guard itself must `catch` and degrade, not throw.
- [ ] Apply the guard at **every** insert site, not just the one in the incident.

**Validation**
- [ ] Does any submit handler call `preventDefault()`? If so, native validation
      is off — confirm the replacement checks every attribute it discarded.
- [ ] Do all fields of the same semantic type resolve through one shared helper?
- [ ] Pin it with a test asserting the fields agree on the same input.
- [ ] Normalise to a canonical form rather than widening the accepting pattern,
      wherever a hash or key is derived from the value.
- [ ] Check fallback direction: permissive on failure-to-resolve, never a
      specific locale's rule.
- [ ] Is any validation input stored in a JSONB/config blob a UI rewrites
      wholesale? Derive it instead, or it will silently vanish.

**Observability**
- [ ] Does a client-side rejection leave any trace? (Usually: no.)
- [ ] Add a beacon carrying the blocking field + campaign + session.
- [ ] Alert on a queue whose assignee count is zero.
- [ ] Alert on a constraint-violation error rate on any public path.

**Process**
- [ ] Smoke-test the deployed public form after every change to it.
- [ ] Verify regex/string literals against the built artefact.
- [ ] When asked why a number moved, check the layer that *produces* it, not the
      one that *displays* it.
