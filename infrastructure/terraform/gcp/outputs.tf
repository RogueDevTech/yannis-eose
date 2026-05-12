locals {
  artifact_registry_host = "${var.region}-docker.pkg.dev"
}

output "platform" {
  value       = "gcp"
  description = "Provider adapter identifier."
}

output "image_registry" {
  value       = "${local.artifact_registry_host}/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  description = "Shared image registry prefix consumed by the runtime compose."
}

output "runtime_env_secret_name" {
  value       = google_secret_manager_secret.runtime_env.secret_id
  description = "Provider-neutral name of the runtime env secret."
}

output "object_storage_provider" {
  value       = "gcs"
  description = "Configured object storage provider."
}

output "object_storage_bucket" {
  value       = google_storage_bucket.assets.name
  description = "Provider-neutral object storage bucket name."
}

output "object_storage_public_base_url" {
  value       = "https://storage.googleapis.com/${google_storage_bucket.assets.name}"
  description = "Provider-neutral public base URL for objects."
}

output "vm_location" {
  value       = google_compute_instance.vm.zone
  description = "Provider-neutral VM location identifier."
}

output "artifact_registry_host" {
  value       = local.artifact_registry_host
  description = "Artifact Registry hostname for docker login."
}

output "artifact_repository_id" {
  value       = google_artifact_registry_repository.images.repository_id
  description = "Artifact Registry repository ID for the dev images."
}

output "artifact_repository_path" {
  value       = "${local.artifact_registry_host}/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  description = "Full Docker repository path used by the deploy workflow."
}

output "runtime_env_secret_id" {
  value       = google_secret_manager_secret.runtime_env.secret_id
  description = "Secret Manager secret containing the raw runtime .env file."
}

output "bucket_name" {
  value       = google_storage_bucket.assets.name
  description = "Public GCS bucket for uploaded assets."
}

output "bucket_public_base_url" {
  value       = "https://storage.googleapis.com/${google_storage_bucket.assets.name}"
  description = "Default public base URL to use in runtime env."
}

output "vm_name" {
  value       = google_compute_instance.vm.name
  description = "Compute Engine VM name."
}

output "vm_zone" {
  value       = google_compute_instance.vm.zone
  description = "Compute Engine VM zone."
}

output "vm_public_ip" {
  value       = var.assign_public_ip ? google_compute_address.vm_ip[0].address : null
  description = "Public IP for SSH access when enabled."
}

output "runtime_service_account_email" {
  value       = google_service_account.vm_runtime.email
  description = "Service account attached to the dev runtime VM."
}

output "suggested_runtime_env" {
  value = {
    ASSET_ENV_PREFIX               = var.environment
    CORS_ORIGIN                    = "https://${var.public_web_hostname}"
    EDGE_WORKER_URL                = "https://<your-edge-worker-domain>"
    GCP_PROJECT_ID                 = var.project_id
    OBJECT_STORAGE_BUCKET          = google_storage_bucket.assets.name
    OBJECT_STORAGE_PROVIDER        = "gcs"
    OBJECT_STORAGE_PUBLIC_BASE_URL = "https://storage.googleapis.com/${google_storage_bucket.assets.name}"
    PUBLIC_API_URL                 = "https://${var.public_api_hostname}"
    REDIS_URL                      = "redis://<external-redis-endpoint>"
    RUNTIME_ENV_SECRET             = google_secret_manager_secret.runtime_env.secret_id
    SESSION_COOKIE_DOMAIN          = ".roguedevtech.com"
    DEPLOY_PLATFORM                = "gcp"
    CLOUDFLARE_TUNNEL_TOKEN        = "<cloudflare tunnel token>"
  }
  description = "Suggested runtime env keys to store in the Secret Manager .env secret."
}
