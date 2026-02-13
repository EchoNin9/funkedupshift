# Use default credential chain (env vars in CI, AWS_PROFILE locally).
provider "aws" {
  region = var.awsRegion
}

# ACM for CloudFront must be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}

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
# Policy: Terraform manage (read/write all managed resources for plan/apply)
# ------------------------------------------------------------------------------
data "aws_iam_policy_document" "terraformManage" {
  # IAM OIDC provider
  statement {
    sid    = "TerraformManageOIDC"
    effect = "Allow"
    actions = [
      "iam:GetOpenIDConnectProvider",
      "iam:CreateOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProvider",
      "iam:DeleteOpenIDConnectProvider"
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
    ]
  }
  # IAM managed policies (terraform state + terraform manage)
  statement {
    sid    = "TerraformManagePolicy"
    effect = "Allow"
    actions = [
      "iam:GetPolicy",
      "iam:CreatePolicy",
      "iam:DeletePolicy",
      "iam:GetPolicyVersion",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicyVersion"
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/github-actions-funkedupshift-terraform-state",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/github-actions-funkedupshift-terraform-manage"
    ]
  }
  # IAM roles (staging + production) and inline role policies
  statement {
    sid    = "TerraformManageRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:CreateRole",
      "iam:UpdateRole",
      "iam:DeleteRole",
      "iam:PassRole",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:GetRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy"
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-funkedupshift-staging",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-funkedupshift-production",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/fus-api-lambda-role",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/fus-thumb-lambda-role",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/fus-mediaconvert-role"
    ]
  }
  # S3 website buckets – full manage for Terraform (s3:* avoids provider refresh whack-a-mole)
  statement {
    sid    = "TerraformManageWebsiteBuckets"
    effect = "Allow"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${var.websiteStagingBucket}",
      "arn:aws:s3:::${var.websiteStagingBucket}/*",
      "arn:aws:s3:::${var.websiteProductionBucket}",
      "arn:aws:s3:::${var.websiteProductionBucket}/*"
    ]
  }
  # S3 media bucket (logos/uploads) – create and full manage
  statement {
    sid    = "TerraformManageMediaBucket"
    effect = "Allow"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${var.mediaBucketName}",
      "arn:aws:s3:::${var.mediaBucketName}/*"
    ]
  }
  # DynamoDB main table – full manage (covers DescribeContinuousBackups and any future provider APIs)
  statement {
    sid       = "TerraformManageDynamo"
    effect    = "Allow"
    actions   = ["dynamodb:*"]
    resources = [
      "arn:aws:dynamodb:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:table/${var.dynamoTableName}"
    ]
  }
  # Cognito User Pool – full manage (covers GetUserPoolMfaConfig and any future provider APIs)
  statement {
    sid       = "TerraformManageCognito"
    effect    = "Allow"
    actions   = ["cognito-idp:*"]
    resources = [
      "arn:aws:cognito-idp:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:userpool/*"
    ]
  }
  # Cognito User Pool Domain – domain APIs use resource * in IAM
  statement {
    sid       = "TerraformManageCognitoDomain"
    effect    = "Allow"
    actions   = ["cognito-idp:DescribeUserPoolDomain", "cognito-idp:CreateUserPoolDomain", "cognito-idp:DeleteUserPoolDomain"]
    resources = ["*"]
  }
  # Lambda functions (for Terraform plan/apply)
  statement {
    sid       = "TerraformManageLambda"
    effect    = "Allow"
    actions   = ["lambda:*"]
    resources = [
      "arn:aws:lambda:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:function:${var.lambdaApiFunctionName}",
      "arn:aws:lambda:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:function:fus-thumb",
      "arn:aws:lambda:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:layer:fus-pillow-layer",
      "arn:aws:lambda:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:layer:fus-pillow-layer:*"
    ]
  }
  # EventBridge, MediaConvert, IAM roles for thumb pipeline
  statement {
    sid       = "TerraformManageEventBridge"
    effect    = "Allow"
    actions   = ["events:*"]
    resources = ["*"]
  }
  statement {
    sid       = "TerraformManageMediaConvert"
    effect    = "Allow"
    actions   = ["mediaconvert:*"]
    resources = ["*"]
  }
  # API Gateway HTTP API (for Terraform plan/apply)
  statement {
    sid       = "TerraformManageAPIGateway"
    effect    = "Allow"
    actions   = ["apigateway:*", "execute-api:*"]
    resources = ["*"]
  }
  # CloudFront (for custom domains)
  statement {
    sid       = "TerraformManageCloudFront"
    effect    = "Allow"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }
  # ACM (certificates for CloudFront, must be us-east-1)
  statement {
    sid       = "TerraformManageACM"
    effect    = "Allow"
    actions   = ["acm:*"]
    resources = ["*"]
  }
  # Route 53 (hosted zones and records)
  statement {
    sid       = "TerraformManageRoute53"
    effect    = "Allow"
    actions   = ["route53:*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "terraformManage" {
  name        = "github-actions-funkedupshift-terraform-manage"
  description = "Allow GitHub Actions to run Terraform plan/apply on funkedupshift infra."
  policy      = data.aws_iam_policy_document.terraformManage.json
}

resource "aws_iam_role_policy_attachment" "stagingTerraformManage" {
  role       = aws_iam_role.githubStaging.name
  policy_arn = aws_iam_policy.terraformManage.arn
}

resource "aws_iam_role_policy_attachment" "productionTerraformManage" {
  role       = aws_iam_role.githubProduction.name
  policy_arn = aws_iam_policy.terraformManage.arn
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

# ------------------------------------------------------------------------------
# S3 media bucket (user uploads: site logos; presigned PUT/GET, Lambda delete)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "media" {
  bucket = var.mediaBucketName
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
  }
}

# ------------------------------------------------------------------------------
# DynamoDB single table (sites, user metadata, ratings, tags)
# ------------------------------------------------------------------------------
resource "aws_dynamodb_table" "main" {
  name         = var.dynamoTableName
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "entityType"
    type = "S"
  }
  attribute {
    name = "entitySk"
    type = "S"
  }
  attribute {
    name = "tag"
    type = "S"
  }
  attribute {
    name = "siteId"
    type = "S"
  }
  attribute {
    name = "starRating"
    type = "N"
  }
  attribute {
    name = "groupName"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "squashDate"
    type = "S"
  }
  attribute {
    name = "matchId"
    type = "S"
  }

  # List all sites: query GSI byEntity where entityType = SITE
  global_secondary_index {
    name            = "byEntity"
    hash_key        = "entityType"
    range_key       = "entitySk"
    projection_type = "ALL"
  }

  # Query sites by tag: query GSI byTag where tag = <tagValue>
  global_secondary_index {
    name            = "byTag"
    hash_key        = "tag"
    range_key       = "siteId"
    projection_type = "ALL"
  }

  # Query by star rating: query GSI byStars where starRating = 1..5
  global_secondary_index {
    name            = "byStars"
    hash_key        = "starRating"
    range_key       = "siteId"
    projection_type = "ALL"
  }

  # Query group members: query GSI byGroup where groupName = <name>
  global_secondary_index {
    name            = "byGroup"
    hash_key        = "groupName"
    range_key       = "userId"
    projection_type = "ALL"
  }

  # Query squash matches by date: query GSI bySquashDate where squashDate = YYYY-MM-DD
  global_secondary_index {
    name            = "bySquashDate"
    hash_key        = "squashDate"
    range_key       = "matchId"
    projection_type = "ALL"
  }
}

# ------------------------------------------------------------------------------
# Cognito User Pool (auth for admin / manager / user roles)
# ------------------------------------------------------------------------------
resource "aws_cognito_user_pool" "main" {
  name = var.cognitoUserPoolName

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols  = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
  }
  schema {
    name                = "preferred_username"
    attribute_data_type = "String"
    required            = false
    mutable             = true
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_LINK"
    email_subject       = "Funkedupshift - Verify your email"
    email_message       = "Please click the link to verify your email: {##Verify Email##}. Code: {####}"
  }

  mfa_configuration = "OFF"

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  lifecycle {
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = var.cognitoAppClientName
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  read_attributes  = ["email", "email_verified", "preferred_username"]
  write_attributes = ["email", "preferred_username"]
}

resource "aws_cognito_user_pool_domain" "main" {
  count        = length(var.cognitoDomainPrefix) > 0 ? 1 : 0
  domain       = var.cognitoDomainPrefix
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Admins can add new website items"
  precedence   = 1
}

resource "aws_cognito_user_group" "manager" {
  name         = "manager"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Managers"
  precedence   = 2
}

resource "aws_cognito_user_group" "user" {
  name         = "user"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Users can add own metadata and comments"
  precedence   = 3
}

# ------------------------------------------------------------------------------
# Lambda API handler (health, list sites)
# ------------------------------------------------------------------------------
data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../src/lambda"
  output_path = "${path.module}/build/api.zip"
  excludes    = ["**/__pycache__/**", "**/*.pyc"]
}

# Pillow layer for logo-from-url dimension check (min 100x100)
resource "null_resource" "pillow_layer" {
  triggers = {
    requirements = file("${path.module}/layer_requirements.txt")
  }
  provisioner "local-exec" {
    command = "mkdir -p build/layer/python/lib/python3.12/site-packages && python3 -m pip install -r ${path.module}/layer_requirements.txt -t build/layer/python/lib/python3.12/site-packages --quiet && cd build/layer && zip -r ../pillow_layer.zip python"
    working_dir = path.module
  }
}

resource "aws_lambda_layer_version" "pillow" {
  filename            = "${path.module}/build/pillow_layer.zip"
  layer_name          = "fus-pillow-layer"
  compatible_runtimes = ["python3.12"]
  depends_on          = [null_resource.pillow_layer]
}

resource "aws_iam_role" "lambdaApi" {
  name = "fus-api-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "lambdaApi" {
  name   = "fus-api-lambda"
  role   = aws_iam_role.lambdaApi.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect   = "Allow"
        Action   = [
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = [
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:ListUsers",
          "cognito-idp:AdminGetUser",
          "cognito-idp:ListGroups"
        ]
        Resource = [aws_cognito_user_pool.main.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.awsRegion}::foundation-model/amazon.nova-micro-*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.thumb.arn
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  filename         = data.archive_file.api.output_path
  function_name    = var.lambdaApiFunctionName
  role             = aws_iam_role.lambdaApi.arn
  handler          = "api.handler.handler"
  source_code_hash = data.archive_file.api.output_base64sha256
  runtime          = "python3.12"
  timeout          = 25
  layers           = [aws_lambda_layer_version.pillow.arn]

  environment {
    variables = {
      TABLE_NAME               = aws_dynamodb_table.main.name
      MEDIA_BUCKET             = aws_s3_bucket.media.id
      COGNITO_USER_POOL_ID     = aws_cognito_user_pool.main.id
      THUMB_FUNCTION_NAME      = aws_lambda_function.thumb.function_name
      ALPHA_VANTAGE_API_KEY    = var.alphaVantageApiKey
    }
  }
}

# ------------------------------------------------------------------------------
# Thumbnail Lambda (S3 trigger + MediaConvert completion)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "mediaconvert" {
  name = "fus-mediaconvert-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "mediaconvert.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "mediaconvert" {
  name   = "fus-mediaconvert-s3"
  role   = aws_iam_role.mediaconvert.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = "${aws_s3_bucket.media.arn}/*"
    }]
  })
}

resource "aws_iam_role" "lambdaThumb" {
  name = "fus-thumb-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambdaThumb" {
  name   = "fus-thumb-lambda"
  role   = aws_iam_role.lambdaThumb.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:CopyObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.main.arn
      },
      {
        Effect   = "Allow"
        Action   = ["mediaconvert:CreateJob", "mediaconvert:GetJob", "mediaconvert:DescribeEndpoints"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = aws_iam_role.mediaconvert.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "mediaconvert.amazonaws.com" }
        }
      }
    ]
  })
}

resource "aws_lambda_function" "thumb" {
  filename         = data.archive_file.api.output_path
  function_name    = "fus-thumb"
  role             = aws_iam_role.lambdaThumb.arn
  handler          = "thumb.handler.handler"
  source_code_hash = data.archive_file.api.output_base64sha256
  runtime          = "python3.12"
  timeout          = 120

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.main.name
      MEDIA_BUCKET         = aws_s3_bucket.media.id
      MEDIACONVERT_ROLE_ARN = aws_iam_role.mediaconvert.arn
    }
  }
}

resource "aws_lambda_permission" "thumb_s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.thumb.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.media.arn
}

resource "aws_s3_bucket_notification" "media" {
  bucket = aws_s3_bucket.media.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.thumb.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "media/images/"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.thumb.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "media/videos/"
  }

  depends_on = [aws_lambda_permission.thumb_s3]
}

resource "aws_cloudwatch_event_rule" "mediaconvert_complete" {
  name           = "fus-mediaconvert-complete"
  description    = "MediaConvert job state change"
  event_bus_name = "default"

  event_pattern = jsonencode({
    source      = ["aws.mediaconvert"]
    detail-type = ["MediaConvert Job State Change"]
    detail      = { status = ["COMPLETE", "ERROR"] }
  })
}

resource "aws_cloudwatch_event_target" "thumb" {
  rule      = aws_cloudwatch_event_rule.mediaconvert_complete.name
  target_id = "ThumbLambda"
  arn       = aws_lambda_function.thumb.arn
}

resource "aws_lambda_permission" "thumb_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.thumb.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.mediaconvert_complete.arn
}

# ------------------------------------------------------------------------------
# API Gateway HTTP API
# ------------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "main" {
  name          = var.apiGatewayName
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins      = ["*"]
    allow_methods      = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers      = ["Authorization", "Content-Type", "X-Amz-Date", "X-Api-Key", "X-Amz-Security-Token", "X-Impersonate-User", "X-Impersonate-Role"]
    expose_headers     = []
    allow_credentials  = false
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-authorizer"
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.awsRegion}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Branding: public logo metadata (no auth)
resource "aws_apigatewayv2_route" "brandingLogoGet" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /branding/logo"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Branding: admin-only logo upload
resource "aws_apigatewayv2_route" "brandingLogoPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /branding/logo"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "internetDashboard" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /internet-dashboard"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "ourProperties" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /recommended/highlights"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "highestRated" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /recommended/highest-rated"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "sites" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /sites"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Admin only: return all sites (no limit) for debugging
resource "aws_apigatewayv2_route" "sitesAll" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /sites/all"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "sitesPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Update existing site (admin only)
resource "aws_apigatewayv2_route" "sitesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Delete site (admin only)
resource "aws_apigatewayv2_route" "sitesDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Presigned URL for logo upload (admin only)
resource "aws_apigatewayv2_route" "sitesLogoUpload" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /sites/logo-upload"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Logo import from URL (download + store in S3, admin only)
resource "aws_apigatewayv2_route" "sitesLogoFromUrl" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /sites/logo-from-url"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Generate AI description (admin only)
resource "aws_apigatewayv2_route" "sitesGenerateDescription" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /sites/generate-description"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Current user info
resource "aws_apigatewayv2_route" "me" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /me"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Self-service group membership (any logged-in user)
resource "aws_apigatewayv2_route" "groupsList" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "meGroupsJoin" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /me/groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "meGroupsLeave" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /me/groups/{groupName}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# User profile (any logged-in user)
resource "aws_apigatewayv2_route" "profileGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /profile"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "profilePut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /profile"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "profileAvatarUpload" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /profile/avatar-upload"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "profileAvatarFromUrl" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /profile/avatar-from-url"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "profileAvatarDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /profile/avatar"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Set star rating
resource "aws_apigatewayv2_route" "starsPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /stars"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Categories (GET public for browse; POST/PUT/DELETE require auth)
resource "aws_apigatewayv2_route" "categoriesGet" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /categories"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "categoriesPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /categories"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "categoriesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /categories"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "categoriesDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /categories"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# OPTIONS routes for CORS preflight (HTTP API handles CORS automatically, but explicit routes ensure they work)
resource "aws_apigatewayv2_route" "sitesOptions" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "OPTIONS /sites"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Media section
resource "aws_apigatewayv2_route" "mediaGet" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /media"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "mediaGetAll" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /media/all"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /media"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /media"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /media"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaUpload" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /media/upload"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaThumbnailUpload" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /media/thumbnail-upload"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaRegenerateThumbnail" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /media/regenerate-thumbnail"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaStars" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /media/stars"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# GET public for browse; POST/PUT/DELETE require auth
resource "aws_apigatewayv2_route" "mediaCategoriesGet" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /media-categories"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "mediaCategoriesPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /media-categories"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaCategoriesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /media-categories"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mediaCategoriesDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /media-categories"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Memes: GET /memes/cache is public (guests view cache); GET /memes requires JWT (logged-in search/mine)
resource "aws_apigatewayv2_route" "memesCacheGet" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /memes/cache"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "memesGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /memes"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesTagsGet" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /memes/tags"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "memesPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /memes"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /memes"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /memes"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesUploadPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /memes/upload"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesValidateUrlPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /memes/validate-url"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesImportFromUrlPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /memes/import-from-url"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesGenerateTitlePost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /memes/generate-title"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "memesStarsPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /memes/stars"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Squash doubles section
resource "aws_apigatewayv2_route" "squashPlayersGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /squash/players"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "squashPlayersPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /squash/players"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "squashPlayersPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /squash/players"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "squashPlayersDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /squash/players"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "squashMatchesGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /squash/matches"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "squashMatchesPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /squash/matches"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "squashMatchesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /squash/matches"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "squashMatchesDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /squash/matches"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Financial section (Financial custom group required)
resource "aws_apigatewayv2_route" "financialWatchlistGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /financial/watchlist"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "financialWatchlistPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /financial/watchlist"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "financialQuoteGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /financial/quote"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "financialConfigGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /financial/config"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminFinancialDefaultSymbolsGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/financial/default-symbols"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminFinancialDefaultSymbolsPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /admin/financial/default-symbols"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Admin user & group management (SuperAdmin or Manager)
resource "aws_apigatewayv2_route" "adminUsersGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/users"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminUserGroupsGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/users/{username}/groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminUserGroupsPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /admin/users/{username}/groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminUserDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /admin/users/{username}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminUserGroupsDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /admin/users/{username}/groups/{groupName}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminGroupsGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminGroupsPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /admin/groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminGroupsPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /admin/groups/{name}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminGroupsDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /admin/groups/{name}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Admin roles (SuperAdmin only)
resource "aws_apigatewayv2_route" "adminRolesGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/roles"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminRolesPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /admin/roles"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminRolesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /admin/roles/{name}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminRolesDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /admin/roles/{name}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminInternetDashboardSitesGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/internet-dashboard/sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminInternetDashboardSitesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /admin/internet-dashboard/sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminOurPropertiesSitesGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/recommended/highlights/sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminOurPropertiesSitesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /admin/recommended/highlights/sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminOurPropertiesGenerate" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /admin/recommended/highlights/generate"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminHighestRatedSitesGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /admin/recommended/highest-rated/sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminHighestRatedSitesPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /admin/recommended/highest-rated/sites"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "adminHighestRatedGenerate" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /admin/recommended/highest-rated/generate"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apiGateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
