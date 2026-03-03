# Yannis EOSE — Architecture Decision Records

## ADR-001: Decoupled Monorepo (NestJS + Remix)

**Status**: Accepted
**Date**: March 2026

**Context**: The system needs a full-stack web application with potential future mobile app and third-party API consumers.

**Decision**: Separate NestJS API and Remix frontend in a TurboRepo monorepo, communicating via tRPC.

**Rationale**:
- **Type safety**: tRPC shares types between backend and frontend with zero code generation
- **Future flexibility**: The API can serve mobile apps, webhooks, and external partners via Swagger
- **Independent scaling**: API and frontend can be deployed and scaled independently
- **Developer experience**: TurboRepo handles parallel builds, caching, and dependency management

**Consequences**: Slightly more complexity than a monolithic Remix app, but the flexibility is worth it for an enterprise application.

---

## ADR-002: PostgreSQL 18 Temporal Tables for Audit Trail

**Status**: Accepted
**Date**: March 2026

**Context**: Every mutation must be permanently logged with actor, timestamp, old value, and new value. The client's previous system (Sniper) had no reliable audit trail.

**Decision**: Implement audit trail at the PostgreSQL trigger level using system-versioned temporal tables, not at the application level.

**Rationale**:
- **Cannot be bypassed**: Even direct SQL or a buggy API endpoint still triggers the audit
- **Performance**: PostgreSQL triggers are faster than application-level interceptors for audit
- **Compliance**: Temporal tables support "time travel" queries — view any record at any point in history
- **Immutability**: History tables have triggers that prevent UPDATE/DELETE

**Consequences**: Requires `SET LOCAL yannis.current_user_id` before every write operation. Added complexity in the NestJS `AuditInterceptor` and tRPC middleware.

---

## ADR-003: Redis-Backed Sessions (Not JWT)

**Status**: Accepted
**Date**: March 2026

**Context**: The system needs instant session revocation (e.g., kill a compromised account immediately).

**Decision**: HTTP-only secure cookies with session tokens stored in Redis, not JWT.

**Rationale**:
- **Instant revocation**: Delete the Redis key and the session is immediately invalid
- **No token refresh complexity**: Sessions have a sliding expiry on each request
- **Server-side control**: Can track all sessions per user, enforce concurrent session limits
- **SuperAdmin can kill any session**: `DELETE /auth/sessions/:userId`

**Consequences**: Requires Redis to be available for every authenticated request. Added Redis as a hard dependency.

---

## ADR-004: Drizzle ORM (Not TypeORM)

**Status**: Accepted
**Date**: March 2026

**Context**: Need a TypeScript ORM that provides 1:1 SQL mapping with full type inference.

**Decision**: Drizzle ORM over TypeORM, Prisma, or Knex.

**Rationale**:
- **TypeScript-first**: Types are inferred from schema definitions, not decorators
- **1:1 SQL mapping**: What you write is what executes — no magic, no lazy loading surprises
- **Lightweight**: No reflection or decorator metadata
- **Migration control**: SQL-based migrations that can be reviewed and modified

**Consequences**: Less "magic" than TypeORM/Prisma — developers must write more explicit queries. This is a feature, not a bug, for a financial system.

---

## ADR-005: tRPC Factory Pattern for NestJS Integration

**Status**: Accepted
**Date**: March 2026

**Context**: tRPC routers are plain functions, not NestJS injectable classes. NestJS services need to be accessible from tRPC procedures.

**Decision**: Use a factory/setter pattern where `TrpcModule.onModuleInit()` injects service instances into tRPC routers via `setXxxService()` functions.

**Rationale**:
- **Simplicity**: No custom NestJS-tRPC adapter library needed
- **Type safety**: Services are fully typed in procedures
- **Testable**: Services can be mocked by calling the setter with a mock

**Consequences**: Service instances are module-scoped singletons. The setter must be called before any procedure runs (handled by NestJS lifecycle).

---

## ADR-006: Client-Side PDF Generation (jsPDF)

**Status**: Accepted
**Date**: March 2026

**Context**: Invoice PDF export needed. Options: server-side (Puppeteer, wkhtmltopdf) vs client-side (jsPDF, pdfmake).

**Decision**: Client-side PDF generation using jsPDF.

**Rationale**:
- **No server load**: PDF is generated in the browser, not the API
- **No binary dependencies**: Puppeteer/wkhtmltopdf require system-level binaries
- **Instant**: No network round-trip for PDF generation
- **Offline capable**: Works even when the API is down (data already in browser)

**Consequences**: Limited formatting compared to HTML-to-PDF tools. Acceptable for invoices which have a structured, predictable layout.

---

## ADR-007: PWA Route Group (Not Separate App) for Riders

**Status**: Accepted
**Date**: March 2026

**Context**: 3PL riders need a mobile-optimized experience with offline sync.

**Decision**: Rider views are a route group inside `apps/web` at `/rider/`, not a separate React Native or standalone PWA app.

**Rationale**:
- **Single deployment**: One Vercel/Netlify deployment for all views
- **Shared code**: Auth, tRPC client, components are reused
- **PWA capabilities**: Service worker handles offline sync, background sync, push notifications
- **Cost**: No App Store fees or review process

**Consequences**: Limited to browser capabilities (no native GPS accuracy, no background location tracking). IndexedDB + Service Worker handle offline requirements adequately.

---

## ADR-008: FIFO Batch Costing for Inventory

**Status**: Accepted
**Date**: March 2026

**Context**: Products are purchased in multiple batches at different costs. Need to accurately calculate landed cost per order.

**Decision**: First-In-First-Out (FIFO) batch costing — oldest batches are consumed first.

**Rationale**:
- **Accounting standard**: FIFO is an accepted inventory valuation method
- **Accurate margins**: Each order's cost reflects the actual batch it was fulfilled from
- **Batch tracking**: `remaining_quantity` per batch enables precise stock level tracking
- **CEO requirement**: "Real net cash profit, not estimates"

**Consequences**: Slightly more complex than average costing. Requires batch-level tracking on every order fulfillment. The `consumeFifoBatch()` method in inventory service handles this automatically.

---

## ADR-009: Row-Level Security (RLS) at Database Level

**Status**: Accepted
**Date**: March 2026

**Context**: Multiple roles with different data access levels. Security must be enforced even if the application has bugs.

**Decision**: PostgreSQL RLS policies on all business tables, enforced via `FORCE ROW LEVEL SECURITY`.

**Rationale**:
- **Defense in depth**: Even a SQL injection or API bug cannot bypass RLS
- **Role isolation**: CS agents see only their orders, media buyers see only their campaigns
- **Column-level security**: `products_safe` view masks `cost_price` for non-privileged roles
- **Compliance**: Data access is auditable at the database level

**Consequences**: Requires setting `yannis.current_user_id` and `yannis.current_user_role` via `SET LOCAL` before every query. Added complexity in the interceptor layer.
