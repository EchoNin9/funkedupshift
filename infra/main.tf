# Use default credential chain (env vars in CI, AWS_PROFILE locally).
provider "aws" {
  region = var.awsRegion
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
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/fus-api-lambda-role"
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
  # Lambda API function (for Terraform plan/apply)
  statement {
    sid       = "TerraformManageLambda"
    effect    = "Allow"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:function:${var.lambdaApiFunctionName}"]
  }
  # API Gateway HTTP API (for Terraform plan/apply)
  statement {
    sid       = "TerraformManageAPIGateway"
    effect    = "Allow"
    actions   = ["apigateway:*", "execute-api:*"]
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
        Action   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:BatchGetItem"]
        Resource = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
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
  timeout          = 30

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.main.name
      AWS_REGION = var.awsRegion
    }
  }
}

# ------------------------------------------------------------------------------
# API Gateway HTTP API
# ------------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "main" {
  name          = var.apiGatewayName
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["*"]
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

resource "aws_apigatewayv2_route" "sites" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /sites"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "sitesPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /sites"
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
