# GCP Dev Terraform

This stack provisions the `dev-*` GCP baseline for Yannis EOSE:

- a single `e2-small` GCE VM
- Artifact Registry for `api` and `web` images
- a public GCS bucket for stable asset URLs
- a Secret Manager secret that stores the runtime `.env`
- a VM service account with access to Artifact Registry, Secret Manager, and the asset bucket

It is the `gcp` adapter for the shared Terraform contract documented in
[`infrastructure/terraform/README.md`](/Users/Apple/Desktop/PROJECTS/ROGUE-DEVTECH/yannis-eose/infrastructure/terraform/README.md).

## What Terraform creates

- `dev-yannis-eose-vm`
- `dev-yannis-eose` Artifact Registry repository
- `dev-yannis-runtime-env` Secret Manager secret
- `dev-*` public asset bucket

Cloudflare DNS/Tunnel resources are intentionally **not** created here. Hostname routing and any optional tunnel setup are managed outside this Terraform stack.

## Apply (dev)

```bash
cd infrastructure/terraform/gcp
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

## Apply (prod)

Prod uses the **same module** but a separate state file and a separate
tfvars so the dev apply can never touch prod resources. The starter values
target `office.hqyannis.com` (web) and `api-office.hqyannis.com` (api).

```bash
cd infrastructure/terraform/gcp
cp terraform.tfvars.prod.example terraform.tfvars.prod
# Edit terraform.tfvars.prod and fill in:
#   project_id      — the prod GCP project (separate from dev!)
#   ssh_public_key  — operator key for the prod VM
#   ssh_source_ranges — your office / VPN egress IP(s)

terraform init
terraform apply \
  -state=prod.tfstate \
  -var-file=terraform.tfvars.prod
```

The `prod.tfstate` lives next to `terraform.tfstate` (the dev state). Both
are `.gitignored`. Keep them backed up — Terraform cannot reconstruct
resource ownership without state.

### Prod runtime `.env` secret

After `terraform apply`, populate `prod-yannis-runtime-env` in Secret
Manager with the prod URLs:

```dotenv
DEPLOY_PLATFORM=gcp
NODE_ENV=production
DATABASE_URL=postgres://...                # prod Aiven Postgres
REDIS_URL=redis://...                      # prod Aiven Redis
SESSION_SECRET=<long random string>
SESSION_BUNDLE_SECRET=<long random string>
SESSION_COOKIE_DOMAIN=.hqyannis.com        # parent of office. + api-office.
CORS_ORIGIN=https://office.hqyannis.com
PUBLIC_API_URL=https://api-office.hqyannis.com
EDGE_WORKER_URL=https://<prod-edge-worker-domain>
GCP_PROJECT_ID=<prod-gcp-project-id>
OBJECT_STORAGE_PROVIDER=gcs
OBJECT_STORAGE_BUCKET=<terraform output object_storage_bucket>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://storage.googleapis.com/<bucket>
ASSET_ENV_PREFIX=prod
VAPID_PUBLIC_KEY=<generate fresh — DO NOT share with dev>
VAPID_PRIVATE_KEY=<generate fresh — DO NOT share with dev>
VAPID_SUBJECT=mailto:admin@hqyannis.com
SENDGRID_API_KEY=<prod key>
SENDGRID_FROM_EMAIL=noreply@hqyannis.com
```

Generate fresh secrets per environment — never copy session secrets or
VAPID keys from dev. Push it with:

```bash
gcloud secrets versions add prod-yannis-runtime-env \
  --data-file=prod.env \
  --project=<prod-gcp-project-id>
rm prod.env
```

### Prod DNS records

In Cloudflare (`hqyannis.com` zone), once the prod VM is up:

| Type | Name | Target | Proxy |
|---|---|---|---|
| A | `office` | `<prod-vm-external-ip>` | Proxied |
| A | `api-office` | `<prod-vm-external-ip>` | Proxied |

Or use Cloudflare Tunnel if the prod VM doesn't get a public IP — same
hostnames, but the Tunnel route map points the two names at
`http://web:3000` and `http://api:4444` respectively. See
[infrastructure/deploy/docker-compose.runtime.tunnel.yml](../../deploy/docker-compose.runtime.tunnel.yml).

### Edge worker

[apps/edge-worker/wrangler.toml](../../../apps/edge-worker/wrangler.toml)
needs an `[env.production]` block pointing at `api-office.hqyannis.com`.
Already added; deploy with `pnpm --filter @yannis/edge-worker exec wrangler deploy --env production`.

### Prod GitHub Actions workflow

There's no `deploy-prod.yml` yet — the equivalent of `deploy-dev.yml`
needs to be added, triggered on push to `main` (or tagged release), with
its own set of `PROD_*` secrets pointing at the prod project. Use the dev
workflow as a template once the prod tfvars + DNS are signed off.

## After `terraform apply`

1. Read the outputs for:
   - `image_registry`
   - `runtime_env_secret_name`
   - `object_storage_bucket`
   - `object_storage_public_base_url`
   - `vm_name`
   - `vm_location`
2. Add a **secret version** to the runtime env secret. The payload should be raw `.env`
   text, for example:

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
GCP_PROJECT_ID=your-gcp-project-id
OBJECT_STORAGE_PROVIDER=gcs
OBJECT_STORAGE_BUCKET=<terraform object_storage_bucket output>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://storage.googleapis.com/<terraform object_storage_bucket output>
ASSET_ENV_PREFIX=dev
```

3. In Cloudflare or your preferred ingress layer, route:
   - `dev-office.hqyannis.com` -> `http://web:3000`
   - `dev-api-office.hqyannis.com` -> `http://api:4444`

The deploy workflow copies the shared runtime compose/scripts plus the GCP wrapper to `/opt/yannis-eose`, refreshes `.env`
from Secret Manager, logs into Artifact Registry, runs migrations, and starts the stack.

## Notes

- The bucket is public-read by default because the current app stores durable asset URLs.
- Redis is external by design for this dev setup.
- nginx is intentionally excluded from the VM runtime.
