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
  description = "Compute Engine machine type for the dev VM."
  type        = string
  default     = "e2-small"
}

variable "vm_boot_disk_size_gb" {
  description = "Boot disk size for the GCE VM."
  type        = number
  default     = 20
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
  description = "Cloudflare hostname that serves the web app."
  type        = string
  default     = "dev-yannis.roguedevtech.com"
}

variable "public_api_hostname" {
  description = "Cloudflare hostname that serves the API."
  type        = string
  default     = "api-dev-yannis.roguedevtech.com"
}
