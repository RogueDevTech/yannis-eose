# GCP Dev Terraform

This stack provisions the `dev-*` GCP baseline for Yannis EOSE:

- a single `e2-small` GCE VM (Docker installed via startup script)
- Artifact Registry for `api` and `web` images
- a public GCS bucket for stable asset URLs
- a Secret Manager secret that stores the runtime `.env`
- a VM service account with access to Artifact Registry, Secret Manager, and the asset bucket
- VPC firewall rules opening `tcp:22` (SSH) and `tcp:80,443` (web)

> Reverse proxy (nginx + Let's Encrypt) is **not** done here. Run [`infrastructure/ansible`](../../ansible/) after `terraform apply` to install and configure nginx + certbot on the VM. Clean split: Terraform creates the infra, Ansible configures the OS.

It is the `gcp` adapter for the shared Terraform contract documented in
[`infrastructure/terraform/README.md`](/Users/Apple/Desktop/PROJECTS/ROGUE-DEVTECH/yannis-eose/infrastructure/terraform/README.md).

## What Terraform creates

- `dev-yannis-eose-vm`
- `dev-yannis-eose-allow-ssh` firewall rule
- `dev-yannis-eose-allow-web` firewall rule (80/443)
- `dev-yannis-eose` Artifact Registry repository
- `dev-yannis-runtime-env` Secret Manager secret
- `dev-*` public asset bucket

Cloudflare DNS records are **not** created here — you point the `dev-office` / `dev-api-office` A records at the VM's external IP manually (or via a separate Cloudflare Terraform stack). The VM uses an nginx reverse proxy bound to 127.0.0.1 upstreams (web:3000, api:4444) provisioned by the startup script, so direct DNS A → VM IP is the supported topology. Cloudflare Tunnel is no longer used for the normalized dev baseline.

## Apply (dev)

```bash
cd infrastructure/terraform/gcp
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

Then run Ansible to install nginx + provision certs:

```bash
cd ../../ansible
ansible-playbook playbook.yml --limit dev
```

See [infrastructure/ansible/README.md](../../ansible/README.md) for the two-stage TLS flow (HTTP first → DNS update → flip `provision_tls_certificate` and re-run).

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

In Cloudflare (`hqyannis.com` zone), after the first apply (HTTP-only) and before the second apply that issues the cert:

| Type | Name | Target | Proxy |
|---|---|---|---|
| A | `office` | `<prod-vm-external-ip>` | DNS only |
| A | `api-office` | `<prod-vm-external-ip>` | DNS only |

Once Let's Encrypt has issued the cert (second apply with `provision_tls_certificate = true`), you can flip Proxy to **Proxied** if you want Cloudflare CDN/WAF in front. Keep `web_source_ranges = ["0.0.0.0/0"]` even when proxied — Cloudflare's egress IPs change, lock down via Cloudflare WAF rules instead of VPC firewall.

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

3. In Cloudflare, create `A` records for the two hostnames pointing at `vm_public_ip`:
   - `dev-office.hqyannis.com` → `<vm_public_ip>` (DNS only during initial cert issuance)
   - `dev-api-office.hqyannis.com` → `<vm_public_ip>` (DNS only during initial cert issuance)

   nginx on the VM (provisioned by the startup script) handles the Host-header routing → `127.0.0.1:3000` (web) and `127.0.0.1:4444` (api).

The deploy workflow copies the shared runtime compose/scripts plus the GCP wrapper to `/opt/yannis-eose`, refreshes `.env`
from Secret Manager, logs into Artifact Registry, runs migrations, and starts the stack.

## Notes

- The bucket is public-read by default because the current app stores durable asset URLs.
- Redis is external by design for this dev setup.
- nginx + certbot are installed and configured by [Ansible](../../ansible/), not Terraform. Cloudflare Tunnel is no longer used for this baseline.
- Reverse-proxy bootstrap is marker-guarded at `/var/lib/yannis-eose/nginx-bootstrapped` (managed by the Ansible playbook) so re-runs don't clobber certbot's SSL edits.
