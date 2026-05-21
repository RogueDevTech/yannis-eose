locals {
  name_prefix           = "${var.environment}-${var.app_name}"
  artifact_repository   = coalesce(var.artifact_repository_id, local.name_prefix)
  runtime_env_secret_id = coalesce(var.runtime_env_secret_id, "${var.environment}-yannis-runtime-env")
  project_slug          = trim(replace(lower(var.project_id), "/[^a-z0-9-]/", "-"), "-")
  bucket_name           = coalesce(var.bucket_name, "${local.name_prefix}-${local.project_slug}-assets")

  enabled_services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com",
  ])

  vm_labels = {
    app         = "yannis"
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_project_service" "enabled" {
  for_each                   = local.enabled_services
  project                    = var.project_id
  service                    = each.value
  disable_dependent_services = false
}

resource "google_service_account" "vm_runtime" {
  account_id   = substr(replace("${local.name_prefix}-vm", "-", ""), 0, 28)
  display_name = "${local.name_prefix} runtime"
  depends_on   = [google_project_service.enabled]
}

resource "google_project_iam_member" "vm_runtime_roles" {
  for_each = toset([
    "roles/artifactregistry.reader",
    "roles/logging.logWriter",
    "roles/secretmanager.secretAccessor",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.vm_runtime.email}"
}

resource "google_secret_manager_secret" "runtime_env" {
  secret_id = local.runtime_env_secret_id
  replication {
    auto {}
  }

  labels = local.vm_labels
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = local.artifact_repository
  format        = "DOCKER"
  description   = "Docker images for ${local.name_prefix}"

  labels     = local.vm_labels
  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket" "assets" {
  name                        = local.bucket_name
  location                    = var.bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = var.bucket_public_read ? "inherited" : "enforced"
  force_destroy               = false

  labels = local.vm_labels

  dynamic "cors" {
    for_each = length(var.bucket_cors_origins) == 0 ? [] : [1]
    content {
      origin          = var.bucket_cors_origins
      method          = ["GET", "HEAD", "PUT"]
      response_header = ["Content-Type", "x-goog-resumable"]
      max_age_seconds = 3600
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "runtime_object_admin" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.vm_runtime.email}"
}

resource "google_storage_bucket_iam_member" "public_read" {
  count  = var.bucket_public_read ? 1 : 0
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_compute_address" "vm_ip" {
  count        = var.assign_public_ip ? 1 : 0
  name         = "${local.name_prefix}-ip"
  region       = var.region
  address_type = "EXTERNAL"

  labels     = local.vm_labels
  depends_on = [google_project_service.enabled]
}

resource "google_compute_firewall" "allow_ssh" {
  count   = var.create_ssh_firewall_rule && var.assign_public_ip ? 1 : 0
  name    = "${local.name_prefix}-allow-ssh"
  network = var.network

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.ssh_source_ranges
  target_tags   = ["${local.name_prefix}-ssh"]
}

resource "google_compute_firewall" "allow_web" {
  count   = var.create_web_firewall_rule && var.assign_public_ip ? 1 : 0
  name    = "${local.name_prefix}-allow-web"
  network = var.network

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = var.web_source_ranges
  target_tags   = ["${local.name_prefix}-web"]
}

resource "google_compute_instance" "vm" {
  name         = "${local.name_prefix}-vm"
  machine_type = var.machine_type
  zone         = var.zone

  # Lets `terraform apply` power the VM off when a change needs a stopped
  # instance — notably a `machine_type` resize. Without this the apply errors
  # out instead of performing the stop → resize → start.
  allow_stopping_for_update = true

  # Prod sets this true via tfvars so an errant apply / destroy can't tear the
  # box down. Flip the tfvars value to false when an intentional teardown is needed.
  deletion_protection = var.vm_deletion_protection

  tags = [
    "${local.name_prefix}-ssh",
    "${local.name_prefix}-web",
  ]

  boot_disk {
    initialize_params {
      image = var.vm_image
      size  = var.vm_boot_disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network    = var.network
    subnetwork = var.subnetwork

    dynamic "access_config" {
      for_each = var.assign_public_ip ? [1] : []
      content {
        nat_ip = google_compute_address.vm_ip[0].address
      }
    }
  }

  service_account {
    email  = google_service_account.vm_runtime.email
    scopes = ["cloud-platform"]
  }

  metadata = merge(
    {
      startup-script = templatefile("${path.module}/startup.sh.tftpl", {
        vm_admin_user = var.vm_admin_user
      })
    },
    var.ssh_public_key == null ? {} : {
      "ssh-keys" = "${var.vm_admin_user}:${trimspace(var.ssh_public_key)}"
    }
  )

  labels = local.vm_labels

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.vm_runtime_roles,
    google_storage_bucket_iam_member.runtime_object_admin,
  ]
}
