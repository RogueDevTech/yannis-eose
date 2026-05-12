# Yannis EOSE — Operational Runbook

Common operational procedures for system administrators and support staff.

---

## 1. Session Management

### Kill a User's Session (Force Logout)

If a user account is compromised or an employee leaves, immediately invalidate all their sessions:

```bash
# Via API endpoint (requires SuperAdmin session cookie)
curl -X DELETE http://localhost:4444/auth/sessions/<userId> \
  -H "Cookie: yannis_session=<admin_session_token>"
```

Or via Redis directly:
```bash
redis-cli SMEMBERS "yannis:user_sessions:<userId>"
# Delete each session
redis-cli DEL "yannis:session:<sessionToken>"
redis-cli DEL "yannis:user_sessions:<userId>"
```

### View Active Sessions

```bash
redis-cli KEYS "yannis:session:*" | wc -l  # Count active sessions
redis-cli SMEMBERS "yannis:user_sessions:<userId>"  # Sessions for specific user
```

### Split web and API hostnames (login loop / “stays on login”)

The Remix app signs users in by calling the Nest API from the **server**, then **forwards** `Set-Cookie` from `/auth/login` to the browser. The session cookie name is `yannis_session`.

If production uses different subdomains (for example web `yannis.example.com` and API `api-yannis.example.com`):

1. Set **`SESSION_COOKIE_DOMAIN`** on the **API** to the **parent** domain with a leading dot, e.g. `.example.com`, so the cookie is valid for both hosts. Redeploy the API after changing it.
2. Optionally set the same **`SESSION_COOKIE_DOMAIN`** on the **web** app environment so `/auth/logout` can clear the cookie with a matching `Domain` (see `apps/web/app/routes/auth.logout/route.tsx`).
3. If login still fails with an on-screen message about “no session cookie”, check API logs and confirm the server-side `fetch` from web → API receives `Set-Cookie` (some misconfigured proxies strip it from **responses** to the app server).

The API logs a production warning when `SESSION_COOKIE_DOMAIN` is unset (`apps/api/src/main.ts`).

---

## Redis Environment Split (Dev)

- Local laptop development:
  - `apps/api/.env` should point to local Redis (for example `redis://127.0.0.1:6379`).
- Deployed dev on VM:
  - Redis stays external via `REDIS_URL`; it does **not** run inside the VM.
  - `/opt/yannis-eose/.env` is refreshed via `refresh-env.sh`, which dispatches to the active provider adapter.

### Redis Sanity Check (Local)

```bash
redis-cli -u "$REDIS_URL" ping
# Expected: PONG
```

### Redis Sanity Check (VM)

```bash
cd /opt/yannis-eose
grep '^REDIS_URL=' .env
docker compose -f docker-compose.runtime.yml -f docker-compose.runtime.tunnel.yml logs --tail=80 api | grep -i redis
docker compose -f docker-compose.runtime.yml -f docker-compose.runtime.tunnel.yml ps api web cloudflared
```

If the API logs show repeated Redis DNS/connection errors, Socket.io auth may fail and real-time notifications will lag.

---

## 2. Order Operations

### Force Transition an Order (Emergency)

Only SuperAdmin can force transitions. Use the admin UI at `/admin/orders/<id>`.

If the UI is unavailable, use the tRPC endpoint directly:
```bash
curl -X POST http://localhost:4444/trpc/orders.transition \
  -H "Content-Type: application/json" \
  -H "Cookie: yannis_session=<admin_session>" \
  -d '{"orderId":"<uuid>","newStatus":"CANCELLED","metadata":{"reason":"Emergency cancellation"}}'
```

### Bulk Cancel Orders

Navigate to `/admin/cs/orders`, select orders via checkboxes, click "Cancel Selected" in the bulk action toolbar.

### View Order Audit Trail

Navigate to `/admin/audit` and filter by record type "orders" and the specific order ID. All state transitions, field changes, and actor identities are permanently logged.

---

## 3. Inventory & Stock

### Add New Product (with Optional Initial Stock)

1. Navigate to `/admin/products` → "Add Product"
2. Fill in name, SKU, cost price, sale price, category, offers
3. Optionally set **Initial Stock Quantity** and **Initial Stock Location** to create a FIFO batch in one step (uses cost price as factory cost)
4. If no initial stock, add stock later via Inventory → Stock Intake

### Stock Intake (Restock Existing Product)

1. Navigate to `/admin/inventory`
2. Use the Stock Intake flow to add a new batch: product, location, quantity, factory cost, landing cost

### Stock Reconciliation

When physical count doesn't match digital records:

1. Navigate to `/admin/inventory`
2. Click "Reconciliation" for the affected location
3. Enter physical count per product
4. Select reason code per discrepancy (Damaged, Lost, Expired, Theft)
5. Submit — this unlocks the Dispatch button for that location

**Note**: Dispatch is locked for a location with unresolved discrepancies. This prevents shipping from incorrect stock.

### Force Unlock Dispatch

If the dispatch lock needs emergency override (SuperAdmin only):
1. Navigate to `/admin/inventory`
2. Submit a reconciliation with the current digital count (zero discrepancy)

### View FIFO Batch Costs

Navigate to `/admin/inventory` and click on a product to see batch breakdown:
- Each batch shows: factory cost, landing cost, quantity, remaining quantity
- Oldest batches are consumed first (FIFO)

---

## 4. Finance Operations

### Generate Manual Payout

1. Navigate to `/admin/hr`
2. Click "Generate Payouts"
3. Set the period start/end dates
4. Preview calculations for all staff
5. Approve individual payouts or approve all
6. Mark as PAID after bank transfer

### Refresh Materialized Views

If financial reports show stale data:
1. Navigate to `/admin/finance/overview`
2. Or call the tRPC endpoint:
```bash
curl -X POST http://localhost:4444/trpc/finance.refreshMaterializedViews \
  -H "Cookie: yannis_session=<admin_session>"
```

### Initialize Materialized Views (First Time)

```bash
curl -X POST http://localhost:4444/trpc/finance.initMaterializedViews \
  -H "Cookie: yannis_session=<admin_session>"
```

### Flag Overdue Invoices

Overdue invoices are automatically flagged when the finance page loads. To trigger manually:
```bash
curl -X POST http://localhost:4444/trpc/finance.flagOverdueInvoices \
  -H "Cookie: yannis_session=<admin_session>"
```

---

## 5. User Management

### Create a New User

1. Navigate to `/admin/users`
2. Click "Add User"
3. Fill in name, email, role, and temporary password
4. User will be required to change password on first login

### Change User Role

1. Navigate to `/admin/users`
2. Click on the user
3. Update their role
4. **Important**: Kill their active sessions after role change so RLS policies update

### Disable User Account

1. Navigate to `/admin/users`
2. Set status to INACTIVE
3. Kill all active sessions (see Section 1)

---

## 6. 3PL & Logistics

### Handle Shrinkage Alert

When a transfer verification reveals missing units:

1. Check the alert in `/admin/logistics`
2. Review the transfer details: sent quantity vs received quantity
3. Contact the 3PL partner for explanation
4. The discrepancy is already logged as operational loss in finance
5. If units are found later, create a manual stock adjustment

### Handle Rider Disappearance

When an order is stuck in DISPATCHED beyond the delivery window:

1. Check `/admin/logistics` for escalation alerts
2. Contact the 3PL manager for the assigned location
3. If rider is unreachable, reassign the order to another rider
4. If the package is lost, transition to RETURNED with reason "Lost in Transit"

### Handle 48-Hour Transfer Escalation

Transfers not verified within 48 hours trigger automatic alerts:

1. Check `/admin/logistics` for overdue transfers
2. Contact the receiving 3PL location
3. If unresponsive, escalate to Head of Logistics
4. Consider cancelling and re-initiating the transfer

---

## 7. Marketing Operations

### Handle High CPA Alert

When CPA exceeds threshold:

1. Check `/admin/marketing/funding` for CPA warnings
2. Review the specific campaign/product metrics
3. Compare actual leads vs ad spend
4. If fraudulent, freeze the media buyer's campaign
5. If legitimate, adjust the CPA threshold in settings

### Handle Disputed Funding

When a media buyer marks funding as "Not Received":

1. Alert is sent to CEO and Head of Marketing automatically
2. Check `/admin/marketing/funding` funding ledger
3. Verify with the payment provider/bank
4. If confirmed sent, work with the buyer to resolve
5. If error, cancel and re-send the funding

---

## 8. VOIP Operations

### Toggle VOIP Feature Flag

VOIP has a 3-tier behavior controlled by a feature flag:
- **Disabled**: Agents use manual call logging (MANUAL_CALL status)
- **Enabled + No Twilio creds**: Mock simulation mode (for development)
- **Enabled + Twilio configured**: Real Twilio Voice API calls

To toggle:
1. Navigate to `/admin/settings` → System tab
2. Toggle "VOIP Enabled" (SuperAdmin only)
3. Note: enabling validates Twilio env vars are present

Or via tRPC:
```bash
curl -X POST http://localhost:4444/trpc/voip.setEnabled \
  -H "Content-Type: application/json" \
  -H "Cookie: yannis_session=<admin_session>" \
  -d '{"enabled": true}'
```

### Check VOIP Status

```bash
curl http://localhost:4444/trpc/voip.isEnabled \
  -H "Cookie: yannis_session=<any_session>"
```

### Release Expired Order Locks

Orders are locked for 15 minutes when a call is initiated. If locks get stuck:
```bash
curl -X POST http://localhost:4444/trpc/voip.releaseExpiredLocks \
  -H "Cookie: yannis_session=<admin_session>"
```

### Required Twilio Environment Variables

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Verified business phone number |
| `TWILIO_TWIML_APP_SID` | TwiML application SID |
| `TWILIO_API_KEY_SID` | API key for access tokens |
| `TWILIO_API_KEY_SECRET` | API key secret |
| `VOIP_WEBHOOK_BASE_URL` | Public URL for Twilio status callbacks |

---

## 9. System Monitoring

### Check API Health

```bash
curl http://localhost:4444/trpc/health.ping
# Expected: {"result":{"data":"pong"}}
```

### Check Database Connection

```bash
curl http://localhost:4444/trpc/health.ping \
  -H "Cookie: yannis_session=<any_valid_session>"
# If this succeeds, both Redis (session) and Postgres (audit) are working
```

### Check Socket.io Connections

Socket.io connection status is visible in the frontend header as a green/red dot next to the notification bell.

### View Audit Log

Navigate to `/admin/audit` to see all system activity:
- Filter by table, action type, actor, date range
- Export as CSV for compliance reporting
- **Important**: Audit entries are immutable — they cannot be edited or deleted

---

## 10. Edge Worker Operations

### Check Edge Worker Status

```bash
cd apps/edge-worker
pnpm wrangler tail  # Stream live logs
```

### Deploy Edge Worker

```bash
cd apps/edge-worker
pnpm wrangler deploy
```

### Check QStash Buffer

If orders are being buffered (API downtime):
1. Check Upstash QStash dashboard for pending messages
2. Once API recovers, the healer cron drains the buffer automatically
3. Verify orders appeared in the system after recovery

---

## 11. PWA & Offline

### Force Service Worker Update

If users are stuck on an old version:
1. Deploy a new version of the web app
2. The SW will auto-update on the next visit
3. For immediate update, users can hard-refresh (Ctrl+Shift+R)

### Check Offline Sync Queue

Rider pending deliveries are stored in IndexedDB. If sync fails:
1. Check browser DevTools > Application > IndexedDB > `yannis-offline`
2. The `pendingActions` store shows queued items
3. Items auto-sync when the device comes back online
4. If stuck, the user can manually trigger sync from the offline indicator

---

## 12. Database Maintenance

### Run Migrations

```bash
cd packages/shared
pnpm db:migrate
```

### PostgreSQL connection limit (`53300`)

If the API logs `PostgresError: remaining connection slots are reserved for roles with the SUPERUSER attribute` (SQLSTATE `53300`), the database has hit **`max_connections`** for non-superuser roles. This is not an application bug: the server is refusing new TCP connections.

**Typical causes**

- Too many API / worker replicas each opening their own pool
- Other clients on the same instance (BI tools, `psql`, local dev against prod)
- A managed Postgres tier with a very low connection cap
- Leaked or long-held sessions (runaway scripts, stuck transactions)

**What the app already does**

- The Nest API [`database.module.ts`](../apps/api/src/database/database.module.ts) configures the `postgres` client with a **small pool** (`max: 3` per process). Exhaustion usually means **too many processes** or **too low a DB limit**, not a single rogue pool size.

**Mitigations (operations)**

1. On Postgres: inspect usage — `SELECT count(*), usename FROM pg_stat_activity GROUP BY 1,2 ORDER BY 1 DESC;` — identify who holds connections.
2. Raise **`max_connections`** or upgrade the instance tier (provider console / DBA).
3. Put a **connection pooler** (PgBouncer, Neon pooler, RDS Proxy) in front of the DB so many app instances share a smaller number of server connections.
4. Reduce horizontal scale temporarily or stop stray consumers sharing the same `DATABASE_URL`.

**Not sufficient alone**

- Changing only application code cannot raise the database’s global connection cap; coordination with infrastructure is required.

### View Table Sizes

```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

### Vacuum Analysis (Performance)

```sql
VACUUM ANALYZE orders;
VACUUM ANALYZE order_items;
VACUUM ANALYZE stock_movements;
```

### Check History Table Growth

```sql
SELECT relname, n_live_tup
FROM pg_stat_user_tables
WHERE relname LIKE '%_history'
ORDER BY n_live_tup DESC;
```

History tables grow with every update. They are append-only (immutable) by design.

---

## Emergency Contacts

| Role | Responsibility |
|------|---------------|
| SuperAdmin | Full system access, can kill sessions, force transitions |
| Head of CS | CS team escalations, order disputes |
| Head of Logistics | 3PL issues, transfer problems, rider issues |
| Head of Marketing | Campaign issues, funding disputes, CPA alerts |
| Finance Officer | Invoice issues, approval queue, budget overrides |
| HR Manager | Payroll issues, commission disputes, clawback questions |
