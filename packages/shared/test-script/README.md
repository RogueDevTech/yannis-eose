# Simulation Scripts

Four scripts that simulate the full order lifecycle against the live API. Run them in sequence to generate realistic test data without touching the UI.

## Prerequisites

- Database seeded (`pnpm db:seed -- --reset` from `packages/shared`)
- API running (`pnpm turbo dev` or `pnpm dev` from `apps/api`)
- `.env` at repo root with `DATABASE_URL` and optionally `API_URL`
- VOIP disabled (default) — CS simulation uses MANUAL_CALL mode

## Quick Start

```bash
# From packages/shared:

# 1. Create 30 orders (random customers, random campaigns)
pnpm simulate:orders

# 2. Process orders through CS (engage → call → confirm/cancel)
pnpm simulate:cs

# 3. Allocate confirmed orders to 3PL locations
pnpm simulate:logistics

# 4. Move allocated orders through delivery cycle to COMPLETED
pnpm simulate:3pl

# Or run all four in sequence:
pnpm simulate:all
```

## Environment Variables

All scripts load `.env` from the repo root. Every variable has a sensible default.

| Variable | Default | Script |
|---|---|---|
| `API_URL` | `http://localhost:4000` | All |
| `DATABASE_URL` | *(required)* | order-simulate |
| `SIMULATE_INTERVAL_MS` | `3000` | All (ms between each API request) |
| `SIMULATE_ORDER_COUNT` | `30` | order-simulate |
| `SIMULATE_CS_COUNT` | `20` | cs-simulation |
| `SIMULATE_LOGISTICS_COUNT` | `20` | logistics-simulation |
| `SIMULATE_3PL_COUNT` | `20` | 3pl-simulation |
| `SIMULATE_CS_EMAIL` | `kbshowkb+hocs@gmail.com` | cs-simulation |
| `SIMULATE_CS_PASSWORD` | `password123` | cs-simulation |
| `SIMULATE_LOGISTICS_EMAIL` | `kbshowkb+hol@gmail.com` | logistics-simulation |
| `SIMULATE_LOGISTICS_PASSWORD` | `password123` | logistics-simulation |
| `SIMULATE_3PL_EMAIL` | `kbshowkb+hol@gmail.com` | 3pl-simulation |
| `SIMULATE_3PL_PASSWORD` | `password123` | 3pl-simulation |

## What Each Script Does

### 1. order-simulate

- Queries the database for active campaigns and products
- Generates random Nigerian customers (name, phone, address) using Faker
- Creates orders via `orders.create` (public, no auth needed)
- Each order is tied to a real campaign and media buyer from the DB

### 2. cs-simulation

- Logs in as Head of CS
- Distributes all UNPROCESSED orders to CS agents
- For each order: calls `initiateCall` (auto-engages) then confirms (80%) or cancels (20%)
- Works with VOIP disabled — uses MANUAL_CALL log to satisfy the confirm gate

### 3. logistics-simulation

- Logs in as Head of Logistics
- Fetches all CONFIRMED orders and active, unlocked locations
- Allocates each order to a random 3PL location

### 4. 3pl-simulation

- Logs in as Head of Logistics
- For each ALLOCATED order, runs 4 transitions with 3s between each:
  - ALLOCATED → DISPATCHED (assigns a rider from the order's location)
  - DISPATCHED → IN_TRANSIT
  - IN_TRANSIT → DELIVERED (with GPS coordinates and proof URL)
  - DELIVERED → COMPLETED
- 5% of orders are randomly returned instead of delivered

## Error Handling

Scripts never crash on a single failed request. On any error (duplicate, validation, network), the error is logged and the script continues to the next item. A summary prints at the end showing success/failure counts.

## Examples

```bash
# Create 100 orders with 1s interval
SIMULATE_ORDER_COUNT=100 SIMULATE_INTERVAL_MS=1000 pnpm simulate:orders

# Process 50 orders through CS
SIMULATE_CS_COUNT=50 pnpm simulate:cs

# Point at a different API
API_URL=https://api.staging.example.com pnpm simulate:all
```

## File Layout

```
test-script/
├── lib/
│   └── api.ts                  # Shared helpers (login, trpcGet, trpcPost, sleep, hashPhone)
├── order-simulate.ts           # Order creation
├── cs-simulation.ts            # CS pipeline
├── logistics-simulation.ts     # Allocation
├── 3pl-simulation.ts           # Delivery cycle
└── README.md                   # This file
```
