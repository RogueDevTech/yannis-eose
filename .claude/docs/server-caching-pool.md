# Server Caching + Postgres Pool (Locked)

Three layers protect API latency: (1) Redis read-through cache, (2) tuned postgres-js pool, (3) PageBundle procedures.

## Read-through Redis Cache

`CacheService.getOrSet(key, ttlSeconds, factory)` at `apps/api/src/common/cache/cache.service.ts`.

**Kill-switch:** `READ_THROUGH_CACHE_ENABLED` (default `true`). When false, bypasses Redis. **NEVER commit false to deployable env** — regresses reads from <50ms to 1-9s.

### Cached Endpoints

| Endpoint | TTL | Invalidation |
|---|---|---|
| `/auth/me` user bundle | 60s | every user/role/template/permissions write |
| `branches.list` | 15 min | branch CRUD |
| `roleTemplates.list` | Redis | role-template CRUD |
| `voip.isEnabled` | 60s | `voip.setEnabled` |
| `permissions.listCatalog` | 60s (in-memory) | none (boot-time) |
| `settings.getSystemSettings` | 60s | every settings mutation |
| `settings.getNotificationEmailConfig` | 5 min | update |
| `audit.actorFilterOptions` | 5 min | none |
| `users.getMyNotificationPreferences` | 5 min | update |
| `dashboard.ceoOverview` + time series | 60s | none |
| `messaging.*`, `products.*`, `logistics.*`, `orders.*` | varies | matching mutations |

### Wiring Pattern
1. `let xxxCacheService: CacheService | null = null;` + `export function setXxxCacheService(s: CacheService) { ... }`
2. Wire in `trpc.module.ts::onModuleInit`: `setXxxCacheService(this.cacheService)`
3. Define `invalidateXxxCache(...)` next to wrapper. Call from every mutation.
4. Query: `xxxCacheService.getOrSet(key, TTL, fetch)`. Fall back to direct `fetch()` when cache not init.

## Postgres Pool

`apps/api/src/database/database.module.ts`

| Setting | Value | Why |
|---|---|---|
| `max` | 30 (`PG_MAX_CONNECTIONS`) | At 20, dashboard burst saturated pool → 6-9s waits |
| `idle_timeout` | 300s | At 10s, every idle→click paid TLS handshake (200-500ms) |
| `max_lifetime` | 1800s | Rotates every 30 min, self-heals drift |
| `connect_timeout` | 30s | Cold-start DBs need >10s |
| `application_name` | `yannis-api` | `pg_stat_activity` debugging |
| Eager warmup | `max` parallel `SELECT 1`s at init | No TLS tax on first request |

Multi-process: set `PG_MAX_CONNECTIONS=10` per process. Boot log: `[PgPool] warmed 30 connections in <ms>ms`.

## Page Bundles

12 `*PageBundle` tRPC procedures replace 4-14 parallel HTTP calls with 1.

**In place:** Marketing (team, adSpend, disbursements, overview, funding, orders), Orders (csTeam, csOrders, tplDashboard, tplOrders), Inventory (tpl, admin), Finance (overview).

### Timing Logs
- `db > total` on bundle = healthy parallelization
- `db ≈ total` on single endpoint = slow query (missing index)
- `db = 0ms` with sub-50ms total = Redis cache hit

## Do NOT
- Do NOT commit `READ_THROUGH_CACHE_ENABLED=false` to any deployable env
- Do NOT add `getOrSet` without matching `invalidateXxxCache` in every mutation
- Do NOT lower `idle_timeout` to 10s, remove `max_lifetime`, or remove eager warmup
- Do NOT revert PageBundle back to N parallel `apiRequest` calls
- Do NOT read `db ≈ total` as "pool too small" — it means the query itself is slow
