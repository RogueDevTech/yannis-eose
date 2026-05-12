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

## Apply

```bash
cd infrastructure/terraform/gcp
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

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
SESSION_COOKIE_DOMAIN=.roguedevtech.com
CORS_ORIGIN=https://dev-yannis.roguedevtech.com
PUBLIC_API_URL=https://api-dev-yannis.roguedevtech.com
EDGE_WORKER_URL=https://<your-edge-worker-domain>
GCP_PROJECT_ID=your-gcp-project-id
OBJECT_STORAGE_PROVIDER=gcs
OBJECT_STORAGE_BUCKET=<terraform object_storage_bucket output>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://storage.googleapis.com/<terraform object_storage_bucket output>
ASSET_ENV_PREFIX=dev
```

3. In Cloudflare or your preferred ingress layer, route:
   - `dev-yannis.roguedevtech.com` -> `http://web:3000`
   - `api-dev-yannis.roguedevtech.com` -> `http://api:4444`

The deploy workflow copies the shared runtime compose/scripts plus the GCP wrapper to `/opt/yannis-eose`, refreshes `.env`
from Secret Manager, logs into Artifact Registry, runs migrations, and starts the stack.

## Notes

- The bucket is public-read by default because the current app stores durable asset URLs.
- Redis is external by design for this dev setup.
- nginx is intentionally excluded from the VM runtime.
