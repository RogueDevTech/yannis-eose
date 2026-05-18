# GCP Dev Adapter

This is the `gcp` adapter for the shared multi-cloud dev deploy contract:

- single `e2-small` GCE VM
- Dockerized `web` + `api`
- ingress handled outside the app deploy flow
- external Redis
- existing Cloud SQL URL
- GCS bucket for uploaded assets

## Hostnames

- Web: `dev-office.hqyannis.com`
- API: `dev-api-office.hqyannis.com`
- Form (edge worker): `dev-form.hqyannis.com` — deploy with `pnpm --filter @yannis/edge-worker exec wrangler deploy --env gcp-dev`

GCP deploys live on the `hqyannis.com` Cloudflare zone (dev + prod). AWS deploys remain on `roguedevtech.com` — the two providers do not share DNS. The app deploy itself only starts `web` and `api`; an optional nginx sidecar can be layered via `docker-compose.runtime.nginx.yml` when direct-IP HTTPS termination is needed (see `infrastructure/nginx/nginx.conf.template`).

## Runtime stack on the VM

The GCP adapter uses the shared runtime files:

- `infrastructure/deploy/docker-compose.runtime.yml`
- `infrastructure/deploy/deploy-runtime.sh`

If you want a VM-local tunnel sidecar, the optional overlay remains available at:

- `infrastructure/deploy/docker-compose.runtime.tunnel.yml`

Redis is intentionally not part of the compose stack.

## Runtime env secret

The VM expects a Secret Manager secret whose payload is a raw `.env` file. The deploy
workflow refreshes `/opt/yannis-eose/.env` from that secret before pulling images or
running migrations.

Minimum keys:

```dotenv
DEPLOY_PLATFORM=gcp
DATABASE_URL=postgres://...
REDIS_URL=redis://...
SESSION_SECRET=replace-me
SESSION_BUNDLE_SECRET=replace-me
SESSION_COOKIE_DOMAIN=.hqyannis.com
CORS_ORIGIN=https://dev-office.hqyannis.com
PUBLIC_API_URL=https://dev-api-office.hqyannis.com
EDGE_WORKER_URL=https://<your-edge-worker-domain>
GCP_PROJECT_ID=<your-gcp-project-id>
OBJECT_STORAGE_PROVIDER=gcs
OBJECT_STORAGE_BUCKET=<terraform object_storage_bucket output>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://storage.googleapis.com/<terraform object_storage_bucket output>
ASSET_ENV_PREFIX=dev
```

## Asset layout

Direct uploads and product image rehosting are now environment-prefixed and resource-scoped:

- `dev/marketing/screenshots/...`
- `dev/finance/receipts/...`
- `dev/finance/invoices/...`
- `dev/logistics/delivery-proof/...`
- `dev/hr/onboarding-docs/...`
- `dev/products/images/uploads/...`
- `dev/products/gallery/<product-id>/...`

## Deploy flow

1. Terraform creates the VM, Artifact Registry, GCS bucket, service account, and runtime secret container.
2. A secret version is added for the runtime `.env`.
3. `deploy-dev.yml` chooses the GCP adapter when `DEPLOY_PLATFORM=gcp`, pushes both images to Artifact Registry, copies the shared runtime assets plus GCP wrapper scripts to the VM, refreshes `.env`, runs migrations, and starts the stack.
4. The manual migration workflow chooses the same GCP adapter and reuses the same runtime compose + migration contract.
