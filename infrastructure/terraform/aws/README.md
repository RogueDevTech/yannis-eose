# AWS Dev Terraform

This stack provisions the `aws` adapter for the shared dev runtime contract:

- a single EC2 VM
- two ECR repositories (`yannis-eose-api`, `yannis-eose-web`)
- an S3 bucket for uploaded assets
- a Secrets Manager secret that stores the runtime `.env`
- an instance profile with ECR, Secrets Manager, and S3 access

## Apply

```bash
cd infrastructure/terraform/aws
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

## Contract Outputs

This adapter exposes the shared outputs documented in
[`infrastructure/terraform/README.md`](/Users/Apple/Desktop/PROJECTS/ROGUE-DEVTECH/yannis-eose/infrastructure/terraform/README.md),
including:

- `platform`
- `image_registry`
- `runtime_env_secret_name`
- `object_storage_provider`
- `object_storage_bucket`
- `object_storage_public_base_url`
- `vm_name`
- `vm_public_ip`
- `vm_location`

## Runtime `.env`

Store a raw `.env` payload in the runtime secret, for example:

```dotenv
DEPLOY_PLATFORM=aws
DATABASE_URL=postgres://...
REDIS_URL=redis://...
SESSION_SECRET=replace-me
SESSION_BUNDLE_SECRET=replace-me
SESSION_COOKIE_DOMAIN=.roguedevtech.com
CORS_ORIGIN=https://dev-yannis.roguedevtech.com
PUBLIC_API_URL=https://api-dev-yannis.roguedevtech.com
EDGE_WORKER_URL=https://<your-edge-worker-domain>
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET=<terraform object_storage_bucket output>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://<terraform object_storage_bucket output>.s3.<region>.amazonaws.com
ASSET_ENV_PREFIX=dev
```

## Notes

- This adapter assumes the same normalized runtime shape as GCP: single VM, external Redis, ingress handled separately, no VM-local nginx, no VM-local Redis.
- The runtime compose still uses the shared files in `infrastructure/deploy/`.
