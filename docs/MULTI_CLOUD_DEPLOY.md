# Multi-Cloud Deploy

Yannis EOSE now uses a **provider-selectable deployment system** with:

- one shared runtime contract
- one shared migration contract
- one shared object-storage contract
- separate provider adapters for AWS and GCP

## Selector

`deploy-dev.yml` and the manual migration workflow choose a provider from `DEPLOY_PLATFORM`.

Supported values:

- `gcp` — deploy to GCP only
- `aws` — deploy to AWS only
- **(empty / unset)** — deploy to **both** providers in parallel

## Shared Runtime Contract

Both providers must satisfy the same runtime shape:

- single VM
- Dockerized `web` + `api`
- external Redis
- ingress handled separately from the app deploy
- no VM-local nginx
- no VM-local Redis
- pre-start migrations before traffic cutover

Shared runtime files:

- `infrastructure/deploy/docker-compose.runtime.yml`
- `infrastructure/deploy/deploy-runtime.sh`
- `infrastructure/deploy/run-migrations.sh`

Optional ingress overlay:

- `infrastructure/deploy/docker-compose.runtime.tunnel.yml`

Provider wrappers:

- `infrastructure/deploy/deploy-gcp-dev.sh`
- `infrastructure/deploy/deploy-aws-dev.sh`
- `infrastructure/deploy/refresh-env-gcp.sh`
- `infrastructure/deploy/refresh-env-aws.sh`

Selector scripts:

- `infrastructure/deploy/deploy-dev.sh`
- `infrastructure/deploy/refresh-env.sh`

## Shared Runtime `.env` Contract

Common keys expected by the normalized runtime:

```dotenv
DATABASE_URL=postgres://...
REDIS_URL=redis://...
SESSION_SECRET=replace-me
SESSION_BUNDLE_SECRET=replace-me
# Hostnames are provider-specific. GCP deploys live on the hqyannis.com
# zone; AWS deploys stay on roguedevtech.com. Pick the matching row:
#
#   GCP dev:  SESSION_COOKIE_DOMAIN=.hqyannis.com
#             CORS_ORIGIN=https://dev-office.hqyannis.com
#             PUBLIC_API_URL=https://dev-api-office.hqyannis.com
#   GCP prod: SESSION_COOKIE_DOMAIN=.hqyannis.com
#             CORS_ORIGIN=https://office.hqyannis.com
#             PUBLIC_API_URL=https://api-office.hqyannis.com
#   AWS dev:  SESSION_COOKIE_DOMAIN=.roguedevtech.com
#             CORS_ORIGIN=https://yannis.roguedevtech.com
#             PUBLIC_API_URL=https://api-yannis.roguedevtech.com
SESSION_COOKIE_DOMAIN=.hqyannis.com
CORS_ORIGIN=https://dev-office.hqyannis.com
PUBLIC_API_URL=https://dev-api-office.hqyannis.com
EDGE_WORKER_URL=https://<your-edge-worker-domain>
OBJECT_STORAGE_PROVIDER=gcs
OBJECT_STORAGE_BUCKET=<bucket-name>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://<public-object-base-url>
ASSET_ENV_PREFIX=dev
```

Provider-specific additions:

- GCP: `GCP_PROJECT_ID`
- AWS/S3: `AWS_REGION`, optional `S3_ENDPOINT`, optional `S3_ACCESS_KEY_ID`, optional `S3_SECRET_ACCESS_KEY`

## Object Storage Contract

The app now builds asset keys through shared helpers and selects a storage adapter by provider.

Shared path rules:

- `dev/marketing/screenshots/...`
- `dev/finance/receipts/...`
- `dev/finance/invoices/...`
- `dev/logistics/delivery-proof/...`
- `dev/hr/onboarding-docs/...`
- `dev/products/images/uploads/...`
- `dev/products/gallery/<product-id>/...`

Shared env keys:

- `OBJECT_STORAGE_PROVIDER`
- `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_PUBLIC_BASE_URL`
- `ASSET_ENV_PREFIX`

Legacy `GCS_*` and `S3_*` keys are still accepted as fallbacks during the transition.

## Terraform Contract

Each provider adapter under `infrastructure/terraform/<provider>/` must expose the shared outputs described in:

- `infrastructure/terraform/README.md`

Today:

- `infrastructure/terraform/gcp/`
- `infrastructure/terraform/aws/`

## Workflow Contract

- `.github/workflows/deploy-dev.yml` builds once, then runs the selected provider job.
- `.github/workflows/ec2-run-migrations.yml` runs the provider-selected migration path.
- Provider-specific secrets stay isolated to provider-specific jobs.
