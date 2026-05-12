variable "aws_region" {
  description = "AWS region hosting the dev infrastructure."
  type        = string
  default     = "eu-north-1"
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

variable "instance_type" {
  description = "EC2 instance type for the dev VM."
  type        = string
  default     = "t3.small"
}

variable "vm_admin_user" {
  description = "Linux username for the primary VM operator."
  type        = string
  default     = "ec2-user"
}

variable "ami_id" {
  description = "Optional override for the EC2 AMI ID."
  type        = string
  default     = null
}

variable "key_name" {
  description = "Optional EC2 key pair name for SSH."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Subnet ID for the dev EC2 instance."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID containing the dev subnet."
  type        = string
}

variable "assign_public_ip" {
  description = "Whether the EC2 instance should receive a public IP."
  type        = bool
  default     = true
}

variable "allowed_ssh_cidrs" {
  description = "CIDR ranges allowed to SSH to the VM."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "runtime_env_secret_name" {
  description = "Secrets Manager secret name for the runtime .env payload."
  type        = string
  default     = null
}

variable "bucket_name" {
  description = "Optional override for the public S3 bucket name."
  type        = string
  default     = null
}

variable "bucket_public_read" {
  description = "Whether to allow public GET access for object URLs."
  type        = bool
  default     = true
}

variable "bucket_cors_origins" {
  description = "Origins allowed to upload directly to S3 via signed URLs."
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
