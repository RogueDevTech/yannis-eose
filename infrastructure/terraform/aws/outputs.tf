locals {
  image_registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "platform" {
  value       = "aws"
  description = "Provider adapter identifier."
}

output "image_registry" {
  value       = local.image_registry
  description = "Shared image registry prefix consumed by the runtime compose."
}

output "runtime_env_secret_name" {
  value       = aws_secretsmanager_secret.runtime_env.name
  description = "Provider-neutral name of the runtime env secret."
}

output "object_storage_provider" {
  value       = "s3"
  description = "Configured object storage provider."
}

output "object_storage_bucket" {
  value       = aws_s3_bucket.assets.bucket
  description = "Provider-neutral object storage bucket name."
}

output "object_storage_public_base_url" {
  value       = "https://${aws_s3_bucket.assets.bucket}.s3.${var.aws_region}.amazonaws.com"
  description = "Provider-neutral public base URL for objects."
}

output "vm_name" {
  value       = aws_instance.vm.tags.Name
  description = "EC2 instance name."
}

output "vm_public_ip" {
  value       = aws_instance.vm.public_ip
  description = "Public IP for SSH access."
}

output "vm_location" {
  value       = aws_instance.vm.availability_zone
  description = "Provider-neutral VM location identifier."
}

output "api_repository_name" {
  value       = aws_ecr_repository.api.name
  description = "API repository name."
}

output "web_repository_name" {
  value       = aws_ecr_repository.web.name
  description = "Web repository name."
}

output "suggested_runtime_env" {
  value = {
    ASSET_ENV_PREFIX               = var.environment
    AWS_REGION                     = var.aws_region
    CORS_ORIGIN                    = "https://${var.public_web_hostname}"
    DEPLOY_PLATFORM                = "aws"
    EDGE_WORKER_URL                = "https://<your-edge-worker-domain>"
    OBJECT_STORAGE_BUCKET          = aws_s3_bucket.assets.bucket
    OBJECT_STORAGE_PROVIDER        = "s3"
    OBJECT_STORAGE_PUBLIC_BASE_URL = "https://${aws_s3_bucket.assets.bucket}.s3.${var.aws_region}.amazonaws.com"
    PUBLIC_API_URL                 = "https://${var.public_api_hostname}"
    REDIS_URL                      = "redis://<external-redis-endpoint>"
    SESSION_COOKIE_DOMAIN          = ".roguedevtech.com"
  }
  description = "Suggested runtime env keys to store in the Secrets Manager .env secret."
}
