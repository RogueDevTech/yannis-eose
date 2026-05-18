# Database migrations in deploys

Yannis applies hand-written SQL from `packages/shared/drizzle/*.sql` in order, tracked in `_yannis_applied_migrations` (not Drizzle’s `meta/_journal.json`).

## Two layers (both are OK)

1. **Pre-start (recommended for the selected dev VM):** `infrastructure/deploy/run-migrations.sh` runs the same `runSqlMigrations` logic **before** `docker compose up`, using the freshly pulled API image. This is wired into `.github/workflows/deploy-dev.yml` after `docker compose pull`.

2. **API bootstrap:** `MigrationRunnerService` still runs the same `runSqlMigrations` on app startup (unless `MIGRATIONS_AUTORUN=false`).

## Environment

- `DATABASE_URL` — must match the DB the app uses (and support SSL for managed Postgres, e.g. `sslmode=require` or `PGSSLMODE=require`).
- `MIGRATIONS_AUTORUN` — set to `false` only to debug a failed migration without a crash loop.
- `MIGRATIONS_ALLOW_ADOPTION` — set to `true` only for a **one-time** “adopt existing DB” bootstrap; do not leave on in production.

## Local (same as deploy runner)

```bash
pnpm db:migrate:app
```

Requires `DATABASE_URL` in the environment (or root `.env` if you load it yourself).

## Manual on the selected dev VM

```bash
cd /opt/yannis-eose
chmod +x run-migrations.sh
export COMPOSE_FILES="docker-compose.runtime.yml"
./run-migrations.sh
```

## GitHub Actions (manual migration-only)

Workflow: **Dev — run database migrations** (`.github/workflows/ec2-run-migrations.yml`).

- **Actions → Dev — run database migrations → Run workflow**
- Chooses the GitHub **environment** (e.g. `dev`) so it uses the same provider secrets as deploy.
- Selects the provider path from `DEPLOY_PLATFORM`, pulls the latest API image, then runs `./run-migrations.sh` with the shared runtime compose files.

Full deploys on branch `dev` still run migrations automatically in **Deploy to Dev** before `docker compose up`.
