# Database migrations in deploys

Yannis applies hand-written SQL from `packages/shared/drizzle/*.sql` in order, tracked in `_yannis_applied_migrations` (not Drizzle’s `meta/_journal.json`).

## Two layers (both are OK)

1. **Pre-start (recommended for EC2):** `infrastructure/deploy/run-migrations.sh` runs the same `runSqlMigrations` logic **before** `docker compose up`, using the freshly pulled API image. This is wired into `.github/workflows/deploy-dev.yml` after `docker compose pull`.

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

## Manual on EC2

```bash
cd /opt/yannis-eose
chmod +x run-migrations.sh
./run-migrations.sh
```

## GitHub Actions (manual migration-only)

Workflow: **EC2 — run database migrations** (`.github/workflows/ec2-run-migrations.yml`).

- **Actions → EC2 — run database migrations → Run workflow**
- Chooses the GitHub **environment** (e.g. `dev`) so it uses the same `EC2_HOST` / `EC2_SSH_KEY` / `AWS_ACCOUNT_ID` secrets as deploy.
- SSHs to EC2, `docker compose pull api`, then `./run-migrations.sh` so files match the latest pushed API image.

Full deploys on branch `dev` still run migrations automatically in **Deploy to Dev (EC2)** before `docker compose up`.
