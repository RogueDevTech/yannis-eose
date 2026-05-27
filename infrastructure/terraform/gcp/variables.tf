variable "project_id" {
  description = "GCP project ID hosting the dev infrastructure."
  type        = string
}

variable "region" {
  description = "Primary region for Artifact Registry and Secret Manager."
  type        = string
  default     = "europe-west2"
}

variable "zone" {
  description = "Zone for the single dev Compute Engine VM."
  type        = string
  default     = "europe-west2-a"
}

variable "environment" {
  description = "Environment prefix used in resource names."
  type        = string
  default     = "dev"
}

variable "app_name" {
  description = "Base app slug used in resource names."
  type        = string
  default     = "yannis-eose"
}

variable "machine_type" {
  description = "Compute Engine machine type for the VM. Dev defaults to e2-small; prod overrides via tfvars (the app runs web + api + nginx + Docker, so prod needs real RAM)."
  type        = string
  default     = "e2-small"
}

variable "vm_boot_disk_size_gb" {
  description = "Boot disk size for the GCE VM."
  type        = number
  default     = 20
}

variable "vm_deletion_protection" {
  description = "When true, the VM cannot be deleted until this is flipped back to false. Dev leaves it off for easy teardown; prod sets it true via tfvars."
  type        = bool
  default     = false
}

variable "vm_image" {
  description = "Boot image for the GCE VM."
  type        = string
  default     = "projects/debian-cloud/global/images/family/debian-12"
}

variable "vm_admin_user" {
  description = "Linux username for the primary VM operator."
  type        = string
  default     = "deployer"
}

variable "ssh_public_key" {
  description = "Optional SSH public key to add to instance metadata for the admin user."
  type        = string
  default     = null
}

variable "assign_public_ip" {
  description = "Attach a public IP so GitHub Actions and operators can SSH into the VM."
  type        = bool
  default     = true
}

variable "create_ssh_firewall_rule" {
  description = "Whether Terraform should create an SSH firewall rule."
  type        = bool
  default     = true
}

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH to the VM."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "create_web_firewall_rule" {
  description = "Whether Terraform should open inbound 80/443 to the VM (required when DNS points directly at the VM IP instead of Cloudflare Tunnel)."
  type        = bool
  default     = true
}

variable "web_source_ranges" {
  description = "CIDR ranges allowed to reach HTTP/HTTPS on the VM. Open by default because Let's Encrypt HTTP-01 must reach :80 from the public internet."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# Reverse-proxy + TLS knobs live in `infrastructure/ansible/group_vars/`
# (web_upstream_port, api_upstream_port, provision_tls_certificate,
# tls_contact_email). Terraform only owns the infra layer here.

variable "network" {
  description = "VPC network name for the VM."
  type        = string
  default     = "default"
}

variable "subnetwork" {
  description = "Optional subnetwork self-link/name. Leave null for the network default."
  type        = string
  default     = null
}

variable "artifact_repository_id" {
  description = "Artifact Registry repository ID. Defaults to <environment>-<app_name>."
  type        = string
  default     = null
}

variable "runtime_env_secret_id" {
  description = "Secret Manager secret ID that stores the raw runtime .env file."
  type        = string
  default     = null
}

variable "bucket_name" {
  description = "Optional override for the public GCS bucket name."
  type        = string
  default     = null
}

variable "bucket_location" {
  description = "Location for the public GCS bucket."
  type        = string
  default     = "europe-west2"
}

variable "bucket_public_read" {
  description = "Whether to grant allUsers objectViewer so the app can store stable asset URLs."
  type        = bool
  default     = true
}

variable "bucket_cors_origins" {
  description = "Origins allowed to upload directly to the GCS bucket via signed URLs."
  type        = list(string)
  default     = []
}

variable "public_web_hostname" {
  description = "Cloudflare hostname that serves the web app. GCP defaults target the hqyannis.com zone (dev = `dev-office.hqyannis.com`, prod = `office.hqyannis.com`); AWS deploys stay on roguedevtech.com via the AWS tfvars."
  type        = string
  default     = "dev-office.hqyannis.com"
}

variable "public_api_hostname" {
  description = "Cloudflare hostname that serves the API. GCP defaults to the hqyannis.com zone; AWS stays on roguedevtech.com."
  type        = string
  default     = "dev-api-office.hqyannis.com"
}

# ──────────────────────────────────────────────────────────────────────────────
# Cloud SQL — all flags default to "off" so dev applies stay cheap. Prod opts
# in by setting `enable_cloud_sql = true` in `terraform.tfvars.prod`.
# ──────────────────────────────────────────────────────────────────────────────

variable "enable_cloud_sql" {
  description = "Provision a Postgres Cloud SQL instance. Off by default — dev should keep using local/Aiven Postgres. Prod sets this true in tfvars."
  type        = bool
  default     = false
}

variable "cloud_sql_instance_name" {
  description = "Override the Cloud SQL instance name. Defaults to '<environment>-<app_name>-pg'. Must be unique in the GCP project; deleted names are quarantined for 7 days before reuse."
  type        = string
  default     = null
}

variable "cloud_sql_postgres_version" {
  description = "Postgres major version. Default POSTGRES_18 matches the live yannis-eose-prod instance and CLAUDE.md. Override only if GCP rejects 18 in your region (rare)."
  type        = string
  default     = "POSTGRES_18"
}

variable "cloud_sql_tier" {
  description = "Cloud SQL machine tier. db-g1-small (shared core, 1.7 GB RAM, ~$25/mo Zonal) is the documented starting point — shared CPU = noisy-neighbour throttling risk under contention. If CS closers start seeing query lag during peak hours, bump to db-custom-1-3840 (1 dedicated vCPU + 3.75 GB RAM, ~$52/mo) — one tfvars change + 5-min restart, no schema migration needed."
  type        = string
  default     = "db-g1-small"
}

variable "cloud_sql_availability" {
  description = "ZONAL = single-zone (cheapest, ~$50/mo at the default tier). REGIONAL = multi-zone HA (doubles cost). Start ZONAL and flip to REGIONAL once revenue justifies it."
  type        = string
  default     = "ZONAL"

  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.cloud_sql_availability)
    error_message = "cloud_sql_availability must be ZONAL or REGIONAL."
  }
}

variable "cloud_sql_disk_size_gb" {
  description = "Initial SSD size in GB. Autoresize is on so this is just the starting point — match it to what `pg_dump` of the old DB actually weighs."
  type        = number
  default     = 10
}

variable "cloud_sql_disk_max_size_gb" {
  description = "Autoresize hard ceiling in GB. Stops a runaway INSERT loop from quietly growing the disk (and the bill) into the hundreds-of-GB range. Default of 20 GB is sized for the current <2 GB working set; raise deliberately when real data growth justifies it."
  type        = number
  default     = 20
}

variable "cloud_sql_pitr_enabled" {
  description = "Point-in-time recovery via write-ahead log retention. Off by default — the prod backup strategy uses Cloud SQL's free daily automated backups + a scheduled GCS export job (see Option B in the README), not PITR. Flip on if you need sub-day recovery granularity (adds ~$5/mo of WAL storage)."
  type        = bool
  default     = false
}

variable "cloud_sql_query_insights" {
  description = "Enable Query Insights. Off by default — adds cost and only useful while debugging slow queries. Flip on temporarily during perf work."
  type        = bool
  default     = false
}

variable "cloud_sql_deletion_protection" {
  description = "Block 'terraform destroy' from removing the instance. Always true in prod; set false in throwaway envs."
  type        = bool
  default     = true
}

variable "cloud_sql_db_name" {
  description = "Logical Postgres database to create on the instance. Defaults to 'yannis'."
  type        = string
  default     = null
}

variable "cloud_sql_db_user" {
  description = "Postgres role the app authenticates as. Defaults to 'yannis_app'. Postgres superuser stays the built-in 'postgres' role — don't reuse it for app traffic."
  type        = string
  default     = null
}

variable "cloud_sql_password_secret_id" {
  description = "Override the Secret Manager secret name that stores the app user's password. Defaults to '<instance>-app-password'."
  type        = string
  default     = null
}

variable "cloud_sql_authorized_cidrs" {
  description = "Extra CIDR blocks allowed to reach the public IP (operator laptops, CI runners). The VM's static IP is auto-added — don't list it here. Keep this list short and prefer /32 for individual machines."
  type        = list(string)
  default     = []
}
