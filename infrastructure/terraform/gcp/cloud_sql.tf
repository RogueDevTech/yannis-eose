# ──────────────────────────────────────────────────────────────────────────────
# Cloud SQL — Postgres for Yannis EOSE
#
# Why this file exists:
# Prod Postgres (`yannis-eose-prod`) was created manually in the GCP console,
# Regional HA on a tier that quietly burned through the free-trial credit.
# When the credit expired 2026-05-26 the bill jumped from ~$13 to ~$166/mo
# just for the DB. The legacy `yannis-eose-db-prod` instance was also
# over-provisioned and was deleted manually on 2026-05-27. This file replaces
# the live instance with a Terraform-managed one sized minimally to match the
# actual measured workload.
#
# Migration flow (safe — legacy `yannis-eose-prod` keeps running until you swap):
#   1. Set `enable_cloud_sql = true` in `terraform.tfvars.prod`.
#   2. `terraform apply` — creates a NEW, EMPTY instance. ~10 minutes.
#      The app keeps pointing at the legacy DB the whole time.
#   3. `pg_dump` from `yannis-eose-prod`, `pg_restore` into the new instance.
#   4. Update `DATABASE_URL` in Secret Manager (the runtime env secret) to
#      the new connection string — see `cloud_sql_database_url_template`.
#   5. Restart the VM containers so the app picks up the new URL.
#   6. Verify the app is healthy, then delete `yannis-eose-prod` manually in
#      the console (Terraform never knew about it, so it won't touch it).
#
# Cost knobs (defaults are tuned for "smallest-viable prod" — flip these in
# tfvars when budget allows):
#   • cloud_sql_tier             = db-g1-small        → shared core, 1.7 GB RAM (~$25/mo Zonal Enterprise)
#                                                       SHARED CPU = noisy-neighbour throttle risk. If you see
#                                                       query lag, bump to db-custom-1-3840 (1 dedicated vCPU,
#                                                       3.75 GB RAM, ~$52/mo) — one tfvars change + 5-min restart.
#   • cloud_sql_availability     = ZONAL              → no HA; flip to REGIONAL to double cost + add failover
#   • cloud_sql_disk_size_gb     = 10                 → starts small, auto-grows to the cap
#   • cloud_sql_disk_max_size_gb = 20                 → autoresize ceiling (sized for <2 GB working set)
#   • cloud_sql_pitr_enabled     = false              → backup strategy uses daily automated backups + scheduled
#                                                       GCS export, not PITR WAL retention
#   • cloud_sql_query_insights   = false              → off by default; turn on only while debugging
# ──────────────────────────────────────────────────────────────────────────────

locals {
  cloud_sql_enabled    = var.enable_cloud_sql
  cloud_sql_instance   = coalesce(var.cloud_sql_instance_name, "${local.name_prefix}-pg")
  cloud_sql_db_name    = coalesce(var.cloud_sql_db_name, "yannis")
  cloud_sql_db_user    = coalesce(var.cloud_sql_db_user, "yannis_app")
  cloud_sql_pwd_secret = coalesce(var.cloud_sql_password_secret_id, "${local.cloud_sql_instance}-app-password")

  # VM IP is the only authorized network by default — every other CIDR must be
  # opted in via `cloud_sql_authorized_cidrs`. Done this way so we don't
  # accidentally leave the DB open to the world if someone forgets to set the
  # variable.
  cloud_sql_vm_authorized = (
    var.assign_public_ip && local.cloud_sql_enabled
    ? [{ name = "${local.name_prefix}-vm", cidr = "${google_compute_address.vm_ip[0].address}/32" }]
    : []
  )
  cloud_sql_extra_authorized = [for cidr in var.cloud_sql_authorized_cidrs : {
    name = "operator-${replace(cidr, "/", "-")}"
    cidr = cidr
  }]
  cloud_sql_all_authorized = concat(local.cloud_sql_vm_authorized, local.cloud_sql_extra_authorized)
}

# Enable the Cloud SQL Admin API. Enabling is free; provisioning an instance
# is what costs money — and that's gated behind `enable_cloud_sql` below.
resource "google_project_service" "sqladmin" {
  count                      = local.cloud_sql_enabled ? 1 : 0
  project                    = var.project_id
  service                    = "sqladmin.googleapis.com"
  disable_dependent_services = false
}

# Strong random password, regenerated only if you change `keepers`. Stored in
# Secret Manager so the VM (and you, via `gcloud secrets versions access`) can
# read it without ever pasting it into a .tf file.
resource "random_password" "cloud_sql_app" {
  count   = local.cloud_sql_enabled ? 1 : 0
  length  = 32
  special = true
  # Avoid chars that need escaping in connection-string URIs.
  override_special = "-_.~"

  keepers = {
    instance = local.cloud_sql_instance
  }
}

resource "google_sql_database_instance" "prod_pg" {
  count               = local.cloud_sql_enabled ? 1 : 0
  name                = local.cloud_sql_instance
  database_version    = var.cloud_sql_postgres_version
  region              = var.region
  deletion_protection = var.cloud_sql_deletion_protection

  settings {
    tier              = var.cloud_sql_tier
    edition           = "ENTERPRISE"
    availability_type = var.cloud_sql_availability
    disk_type         = "PD_SSD"
    disk_size         = var.cloud_sql_disk_size_gb
    disk_autoresize   = true
    # Hard cap so a runaway write loop can't silently grow disk to TB-scale.
    disk_autoresize_limit = var.cloud_sql_disk_max_size_gb

    user_labels = local.vm_labels

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = var.cloud_sql_pitr_enabled
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      # ENCRYPTED_ONLY = clients must use SSL/TLS. No plaintext over the wire.
      ssl_mode = "ENCRYPTED_ONLY"

      dynamic "authorized_networks" {
        for_each = { for n in local.cloud_sql_all_authorized : n.name => n }
        content {
          name  = authorized_networks.value.name
          value = authorized_networks.value.cidr
        }
      }
    }

    # Sunday 04:00 UTC — quiet time for both UK and Nigeria operators.
    maintenance_window {
      day          = 7
      hour         = 4
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = var.cloud_sql_query_insights
      record_application_tags = false
      record_client_address   = false
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "off"
    }
  }

  depends_on = [google_project_service.sqladmin]
}

resource "google_sql_database" "app_db" {
  count    = local.cloud_sql_enabled ? 1 : 0
  name     = local.cloud_sql_db_name
  instance = google_sql_database_instance.prod_pg[0].name
  # UTF-8 is the only sensible default for a multi-language storefront.
  charset = "UTF8"
}

resource "google_sql_user" "app_user" {
  count    = local.cloud_sql_enabled ? 1 : 0
  name     = local.cloud_sql_db_user
  instance = google_sql_database_instance.prod_pg[0].name
  password = random_password.cloud_sql_app[0].result
}

# Secret Manager holds the generated password so the VM service account can
# fetch it the same way it fetches the runtime env. Versioned, so password
# rotation is just a new version.
resource "google_secret_manager_secret" "cloud_sql_password" {
  count     = local.cloud_sql_enabled ? 1 : 0
  secret_id = local.cloud_sql_pwd_secret
  replication {
    auto {}
  }
  labels = local.vm_labels

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "cloud_sql_password" {
  count       = local.cloud_sql_enabled ? 1 : 0
  secret      = google_secret_manager_secret.cloud_sql_password[0].id
  secret_data = random_password.cloud_sql_app[0].result
}

resource "google_secret_manager_secret_iam_member" "cloud_sql_password_runtime_access" {
  count     = local.cloud_sql_enabled ? 1 : 0
  secret_id = google_secret_manager_secret.cloud_sql_password[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm_runtime.email}"
}
