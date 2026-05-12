locals {
  name_prefix         = "${var.environment}-${var.app_name}"
  runtime_secret_name = coalesce(var.runtime_env_secret_name, "${var.environment}-yannis-runtime-env")
  bucket_name         = coalesce(var.bucket_name, "${local.name_prefix}-${var.aws_region}-assets")
  api_repository_name = "yannis-eose-api"
  web_repository_name = "yannis-eose-web"
  common_tags = {
    App         = "yannis"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_caller_identity" "current" {}

data "aws_ssm_parameter" "amazon_linux_2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "vm_runtime" {
  statement {
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeRepositories",
    ]
    resources = [
      aws_ecr_repository.api.arn,
      aws_ecr_repository.web.arn,
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [aws_secretsmanager_secret.runtime_env.arn]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.assets.arn]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:PutObjectAcl",
    ]
    resources = ["${aws_s3_bucket.assets.arn}/*"]
  }
}

data "aws_iam_policy_document" "public_bucket_read" {
  statement {
    sid    = "PublicReadGetObject"
    effect = "Allow"
    actions = [
      "s3:GetObject",
    ]
    resources = ["${aws_s3_bucket.assets.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_ecr_repository" "api" {
  name                 = local.api_repository_name
  image_tag_mutability = "MUTABLE"
  force_delete         = false

  tags = local.common_tags
}

resource "aws_ecr_repository" "web" {
  name                 = local.web_repository_name
  image_tag_mutability = "MUTABLE"
  force_delete         = false

  tags = local.common_tags
}

resource "aws_secretsmanager_secret" "runtime_env" {
  name = local.runtime_secret_name
  tags = local.common_tags
}

resource "aws_s3_bucket" "assets" {
  bucket = local.bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  count  = length(var.bucket_cors_origins) == 0 ? 0 : 1
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD", "PUT"]
    allowed_origins = var.bucket_cors_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = !var.bucket_public_read
  restrict_public_buckets = !var.bucket_public_read
}

resource "aws_s3_bucket_policy" "public_read" {
  count  = var.bucket_public_read ? 1 : 0
  bucket = aws_s3_bucket.assets.id
  policy = data.aws_iam_policy_document.public_bucket_read.json

  depends_on = [aws_s3_bucket_public_access_block.assets]
}

resource "aws_iam_role" "vm_runtime" {
  name               = "${local.name_prefix}-vm-runtime"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy" "vm_runtime" {
  name   = "${local.name_prefix}-vm-runtime"
  role   = aws_iam_role.vm_runtime.id
  policy = data.aws_iam_policy_document.vm_runtime.json
}

resource "aws_iam_instance_profile" "vm_runtime" {
  name = "${local.name_prefix}-vm-runtime"
  role = aws_iam_role.vm_runtime.name
}

resource "aws_security_group" "vm" {
  name        = "${local.name_prefix}-vm"
  description = "SSH access for the ${local.name_prefix} VM"
  vpc_id      = var.vpc_id
  tags        = local.common_tags

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_ssh_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "vm" {
  ami                         = coalesce(var.ami_id, data.aws_ssm_parameter.amazon_linux_2023.value)
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.vm.id]
  key_name                    = var.key_name
  associate_public_ip_address = var.assign_public_ip
  iam_instance_profile        = aws_iam_instance_profile.vm_runtime.name
  user_data = templatefile("${path.module}/startup.sh.tftpl", {
    vm_admin_user = var.vm_admin_user
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vm"
  })
}
