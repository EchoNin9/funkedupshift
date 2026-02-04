# Use default credential chain (env vars in CI, AWS_PROFILE locally).
provider "aws" {
  region = var.awsRegion
}

# ------------------------------------------------------------------------------
# GitHub OIDC provider (for Actions to assume IAM roles without long-lived keys)
# If this already exists in the account, import it: see docs/bootstrap-terraform-backend.md
# ------------------------------------------------------------------------------
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

# ------------------------------------------------------------------------------
# IAM role: GitHub Actions – Staging (development branch)
# ------------------------------------------------------------------------------
data "aws_iam_policy_document" "githubStagingAssume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.githubOrgRepo}:ref:refs/heads/development"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "githubStaging" {
  name               = "github-actions-funkedupshift-staging"
  assume_role_policy = data.aws_iam_policy_document.githubStagingAssume.json
}

# ------------------------------------------------------------------------------
# IAM role: GitHub Actions – Production (main branch)
# ------------------------------------------------------------------------------
data "aws_iam_policy_document" "githubProductionAssume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.githubOrgRepo}:ref:refs/heads/main"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "githubProduction" {
  name               = "github-actions-funkedupshift-production"
  assume_role_policy = data.aws_iam_policy_document.githubProductionAssume.json
}

# ------------------------------------------------------------------------------
# Policy: Terraform state (S3 + DynamoDB lock) – shared by both roles
# ------------------------------------------------------------------------------
data "aws_iam_policy_document" "terraformState" {
  statement {
    sid    = "TerraformStateS3"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket"
    ]
    resources = [
      "arn:aws:s3:::${var.terraformStateBucket}",
      "arn:aws:s3:::${var.terraformStateBucket}/*"
    ]
  }
  statement {
    sid    = "TerraformStateLock"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:ConditionCheckItem",
      "dynamodb:DescribeTable"
    ]
    resources = [
      "arn:aws:dynamodb:${var.awsRegion}:*:table/${var.terraformStateLockTable}"
    ]
  }
}

resource "aws_iam_policy" "terraformState" {
  name        = "github-actions-funkedupshift-terraform-state"
  description = "Terraform state bucket and lock table for funkedupshift GitHub Actions."
  policy      = data.aws_iam_policy_document.terraformState.json
}

resource "aws_iam_role_policy_attachment" "stagingTerraformState" {
  role       = aws_iam_role.githubStaging.name
  policy_arn = aws_iam_policy.terraformState.arn
}

resource "aws_iam_role_policy_attachment" "productionTerraformState" {
  role       = aws_iam_role.githubProduction.name
  policy_arn = aws_iam_policy.terraformState.arn
}

# ------------------------------------------------------------------------------
# Policy: Deploy frontend to website S3 buckets (for GitHub Actions)
# ------------------------------------------------------------------------------
data "aws_iam_policy_document" "websiteStagingDeploy" {
  statement {
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.websiteStaging.arn,
      "${aws_s3_bucket.websiteStaging.arn}/*"
    ]
  }
}

data "aws_iam_policy_document" "websiteProductionDeploy" {
  statement {
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.websiteProduction.arn,
      "${aws_s3_bucket.websiteProduction.arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "githubStagingWebsiteDeploy" {
  name   = "website-deploy"
  role   = aws_iam_role.githubStaging.id
  policy = data.aws_iam_policy_document.websiteStagingDeploy.json
}

resource "aws_iam_role_policy" "githubProductionWebsiteDeploy" {
  name   = "website-deploy"
  role   = aws_iam_role.githubProduction.id
  policy = data.aws_iam_policy_document.websiteProductionDeploy.json
}

# ------------------------------------------------------------------------------
# S3 website buckets (frontend hosting)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "websiteStaging" {
  bucket = var.websiteStagingBucket
}

resource "aws_s3_bucket_public_access_block" "websiteStaging" {
  bucket = aws_s3_bucket.websiteStaging.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets  = false
}

data "aws_iam_policy_document" "websiteStagingPublicRead" {
  statement {
    sid       = "PublicReadGetObject"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.websiteStaging.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "websiteStaging" {
  bucket = aws_s3_bucket.websiteStaging.id
  policy = data.aws_iam_policy_document.websiteStagingPublicRead.json
}

resource "aws_s3_bucket_website_configuration" "websiteStaging" {
  bucket = aws_s3_bucket.websiteStaging.id

  index_document {
    suffix = "index.html"
  }
  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket" "websiteProduction" {
  bucket = var.websiteProductionBucket
}

resource "aws_s3_bucket_public_access_block" "websiteProduction" {
  bucket = aws_s3_bucket.websiteProduction.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "websiteProductionPublicRead" {
  statement {
    sid       = "PublicReadGetObject"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.websiteProduction.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "websiteProduction" {
  bucket = aws_s3_bucket.websiteProduction.id
  policy = data.aws_iam_policy_document.websiteProductionPublicRead.json
}

resource "aws_s3_bucket_website_configuration" "websiteProduction" {
  bucket = aws_s3_bucket.websiteProduction.id

  index_document {
    suffix = "index.html"
  }
  error_document {
    key = "index.html"
  }
}
