# Terraform Provider Contract

Each provider adapter under `infrastructure/terraform/<provider>/` must expose the same
minimum contract so CI and docs can switch platforms without learning provider internals.

## Required Inputs

- environment / app naming inputs
- VM size/image/admin-user inputs
- runtime env secret container input
- public web/API hostname inputs
- object storage bucket/CORS/public-read inputs

## Required Outputs

- `platform`
- `image_registry`
- `runtime_env_secret_name`
- `object_storage_provider`
- `object_storage_bucket`
- `object_storage_public_base_url`
- `vm_name`
- `vm_public_ip`
- `vm_location`
- `suggested_runtime_env`

Provider-specific outputs are allowed, but deploy tooling should only depend on the shared
contract above.

## Adapters

- `gcp/` — Compute Engine + Artifact Registry + Secret Manager + GCS
- `aws/` — EC2 + ECR + Secrets Manager + S3
