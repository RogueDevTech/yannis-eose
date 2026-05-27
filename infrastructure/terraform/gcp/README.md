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
DATABASE_URL=postgres://...                # prod Cloud SQL — see "Cloud SQL migration" section
REDIS_URL=redis://...                      # prod Redis (Aiven or Memorystore)
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

## Cloud SQL migration (replacing the manually-created prod DB)

The live prod instance `yannis-eose-prod` was created in the console at
Regional HA + dedicated vCPU — sized for the free-trial credit, not for the
actual ~1.24 vCPU continuous workload. When the credit expired 2026-05-26
the run-rate jumped to ~$166/mo for that one instance. A second legacy
instance `yannis-eose-db-prod` was deleted manually on 2026-05-27 (it was
never connected to the live app).

The Terraform `enable_cloud_sql = true` path creates a **new, separate,
minimally-sized** instance (`db-g1-small`, Zonal, ~$25/mo) side-by-side
with the live one, then you do a manual `pg_dump | pg_restore` and swap
`DATABASE_URL` in Secret Manager. The live instance is never touched by
Terraform — you delete it manually in the console once the new one is
verified.

**Shared-core caveat:** `db-g1-small` shares CPU with other Cloud SQL
tenants on the same physical host. Under noisy-neighbour contention GCP
can throttle the instance, slowing queries. If CS closers report lag
during peak hours, bump `cloud_sql_tier` to `db-custom-1-3840` (1
dedicated vCPU, ~$52/mo) — that's a one-line tfvars change followed by
a 5-minute restart. No schema work.

1. **Plan first.** Confirm Terraform will only *create* new SQL resources:

   ```bash
   terraform plan \
     -state=prod.tfstate \
     -var-file=terraform.tfvars.prod \
   | grep -E '(google_sql_|google_secret_manager_secret\.cloud_sql_|random_password\.cloud_sql_)'
   ```

   All lines should start with `+`. No `-` or `~` against any existing
   resource. If anything else shows up, stop and investigate.

2. **Apply.** Provisioning the instance takes ~10 minutes.

   ```bash
   terraform apply -state=prod.tfstate -var-file=terraform.tfvars.prod
   ```

3. **Capture the connection details.**

   ```bash
   terraform output -state=prod.tfstate cloud_sql_public_ip
   terraform output -state=prod.tfstate cloud_sql_database_name
   terraform output -state=prod.tfstate cloud_sql_user
   terraform output -state=prod.tfstate cloud_sql_password_secret_id

   # Fetch the generated app password (this is the only secret you don't see
   # in `terraform output`).
   gcloud secrets versions access latest \
     --secret="$(terraform output -raw -state=prod.tfstate cloud_sql_password_secret_id)" \
     --project="<prod-gcp-project-id>"
   ```

4. **Migrate the data.** From a machine that can reach the old DB AND the
   new one (your laptop after adding its IP to
   `cloud_sql_authorized_cidrs`, or the prod VM itself):

   ```bash
   OLD_URL='postgres://<old-user>:<old-pw>@<old-host>:5432/<old-db>?sslmode=require'
   NEW_URL='postgres://<new-user>:<new-pw>@<new-host>:5432/<new-db>?sslmode=require'

   # Dump (uses parallel jobs + custom format → faster restore).
   pg_dump --format=custom --no-owner --no-privileges \
     --jobs=4 --file=yannis-prod.dump "$OLD_URL"

   # Verify size before restoring — if this is wildly different from the
   # old instance's reported storage, something's wrong.
   ls -lh yannis-prod.dump

   # Restore.
   pg_restore --no-owner --no-privileges \
     --jobs=4 --dbname="$NEW_URL" yannis-prod.dump
   ```

5. **Sanity-check the new instance** before touching the runtime env:

   ```bash
   psql "$NEW_URL" -c 'SELECT COUNT(*) FROM orders;'
   psql "$NEW_URL" -c 'SELECT MAX(created_at) FROM orders;'
   # Compare with the old DB. The counts/timestamps should match (or be
   # very close, accounting for writes during the dump).
   ```

6. **Swap `DATABASE_URL` in the runtime env secret.** Grab the current
   secret, edit the line in place, push a new version:

   ```bash
   gcloud secrets versions access latest \
     --secret=prod-yannis-runtime-env \
     --project=<prod-gcp-project-id> > /tmp/runtime.env

   # Edit /tmp/runtime.env — change DATABASE_URL to the new connection string.
   # Then:
   gcloud secrets versions add prod-yannis-runtime-env \
     --data-file=/tmp/runtime.env \
     --project=<prod-gcp-project-id>
   shred -u /tmp/runtime.env   # or `rm -P` on macOS
   ```

7. **Reload the app.** SSH into the prod VM and restart the containers so
   the new env is picked up:

   ```bash
   ssh deployer@<prod-vm-ip>
   cd /opt/yannis-eose
   ./scripts/refresh-env.sh   # or whatever script your deploy wrapper uses
   docker compose restart api web
   docker compose logs -f api | head -50
   # Watch for: "Connected to database <new-db> @ <new-host>" or equivalent.
   ```

8. **Verify in the app.** Hit a read-heavy page (`/admin/sales/orders`), a
   write path (open + close an order), and the audit trail. Then watch GCP
   Monitoring on the new instance — CPU, connections, query latency
   should look normal.

9. **Decommission `yannis-eose-prod`.** Only after 24–48 hours of the new
   instance running clean:

   - Take a final on-demand backup of `yannis-eose-prod` (Console → Cloud
     SQL → `yannis-eose-prod` → Backups → Create backup). Export it to
     GCS for cold storage in case you ever need to roll back further than
     the new instance's own backup retention covers.
   - Delete `yannis-eose-prod` in the Console. Cloud SQL quarantines the
     name for 7 days before it can be reused — that's fine, the new
     instance has a different name (`prod-yannis-eose-pg`).

If anything goes wrong between steps 6 and 9 — just revert step 6 (push
the old `DATABASE_URL` back into the runtime env secret + restart the
containers). `yannis-eose-prod` is still running, untouched, the whole
time.

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
