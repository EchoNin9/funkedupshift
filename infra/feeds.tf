# ------------------------------------------------------------------------------
# Feeds reader + Mox summary archive module (FUNK-99 — docs/feeds-site.md).
#
# Isolated by design (same precedent as infra/tools.tf, infra/social.tf,
# infra/lipsync.tf): own DynamoDB table, own Lambda zip + layer, own IAM role
# scoped exclusively to fus-feeds. Reuses only aws_apigatewayv2_api.main and
# aws_apigatewayv2_authorizer.cognito.
# ------------------------------------------------------------------------------

variable "feedsDynamoTableName" {
  description = "DynamoDB table name for the feeds reader and Mox archive module."
  type        = string
  default     = "fus-feeds"
}

# ------------------------------------------------------------------------------
# DynamoDB — single-table (PK/SK), sparse byFetchDue GSI for polled feeds, TTL
# on rate-limit buckets, 3-day PITR + deletion protection for the Mox archive.
# ------------------------------------------------------------------------------
resource "aws_dynamodb_table" "feeds" {
  name         = var.feedsDynamoTableName
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
    name = "fetchKey"
    type = "S"
  }
  attribute {
    name = "nextFetchAt"
    type = "S"
  }

  global_secondary_index {
    name            = "byFetchDue"
    hash_key        = "fetchKey"
    range_key       = "nextFetchAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled                 = true
    recovery_period_in_days = 3
  }
  deletion_protection_enabled = true
}

# ------------------------------------------------------------------------------
# Lambda bundle + dependency layer (feedparser + nh3).
# ------------------------------------------------------------------------------
data "archive_file" "feeds" {
  type        = "zip"
  source_dir  = "${path.module}/../src/lambda"
  output_path = "${path.module}/build/feeds.zip"
  excludes = [
    "**/__pycache__/**",
    "**/*.pyc",
    "api/**",
    "mcp/**",
    "thumb/**",
    "collector/**",
    "tools/**",
    "social/**",
    "lipsync/**",
    "tests/**",
    "requirements-test.txt",
  ]
}

resource "null_resource" "feeds_layer" {
  triggers = {
    requirements = "feedparser==6.0.14 nh3==0.3.8"
    # Rebuild the zip on EVERY apply (CI runners are fresh); the layer version
    # only republishes when `requirements` changes (source_code_hash hashes that
    # string rather than this timestamp).
    always_run = timestamp()
  }
  provisioner "local-exec" {
    command     = "rm -rf build/feeds_layer build/feeds_layer.zip && mkdir -p build/feeds_layer/python && python3 -m pip install feedparser==6.0.14 nh3==0.3.8 --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.13 --implementation cp -t build/feeds_layer/python --quiet && cd build/feeds_layer && zip -qr ../feeds_layer.zip python"
    working_dir = path.module
  }
}

resource "aws_lambda_layer_version" "feeds" {
  filename            = "${path.module}/build/feeds_layer.zip"
  layer_name          = "fus-feeds-layer"
  compatible_runtimes = ["python3.13"]
  source_code_hash    = base64sha256(null_resource.feeds_layer.triggers.requirements)
  depends_on          = [null_resource.feeds_layer]
}

# ------------------------------------------------------------------------------
# IAM — scoped strictly to CloudWatch Logs + fus-feeds DynamoDB table & GSIs.
# ------------------------------------------------------------------------------
resource "aws_iam_role" "lambdaFeeds" {
  name = "fus-feeds-lambda-role"

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

resource "aws_iam_role_policy" "lambdaFeeds" {
  name = "fus-feeds-lambda"
  role = aws_iam_role.lambdaFeeds.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:ConditionCheckItem",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
        ]
        Resource = [aws_dynamodb_table.feeds.arn, "${aws_dynamodb_table.feeds.arn}/index/*"]
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambdas — separate short-timeout API Lambda and 5-min hourly fetcher Lambda.
# ------------------------------------------------------------------------------
resource "aws_lambda_function" "feedsApi" {
  filename         = data.archive_file.feeds.output_path
  function_name    = "fus-feeds"
  role             = aws_iam_role.lambdaFeeds.arn
  handler          = "feeds.routes.handler"
  source_code_hash = data.archive_file.feeds.output_base64sha256
  runtime          = "python3.13"
  timeout          = 25
  memory_size      = 256
  layers           = [aws_lambda_layer_version.feeds.arn]

  environment {
    variables = {
      FEEDS_TABLE = aws_dynamodb_table.feeds.name
    }
  }
}

resource "aws_lambda_function" "feedsFetcher" {
  filename         = data.archive_file.feeds.output_path
  function_name    = "fus-feeds-fetcher"
  role             = aws_iam_role.lambdaFeeds.arn
  handler          = "feeds.fetcher.handler"
  source_code_hash = data.archive_file.feeds.output_base64sha256
  runtime          = "python3.13"
  timeout          = 300
  memory_size      = 256
  layers           = [aws_lambda_layer_version.feeds.arn]

  environment {
    variables = {
      FEEDS_TABLE = aws_dynamodb_table.feeds.name
    }
  }
}

# ------------------------------------------------------------------------------
# Hourly EventBridge poll rule (minute 7 — staggered away from :00/:15/:30/:45).
# ------------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "feedsPoll" {
  name                = "fus-feeds-poll-hourly"
  description         = "Trigger the feeds fetcher lambda hourly to poll due RSS/Atom/JSON feeds"
  schedule_expression = "cron(7 * * * ? *)"
}

resource "aws_cloudwatch_event_target" "feedsPollTarget" {
  rule      = aws_cloudwatch_event_rule.feedsPoll.name
  target_id = "feedsFetcher"
  arn       = aws_lambda_function.feedsFetcher.arn
  input     = jsonencode({ job = "poll" })
}

resource "aws_lambda_permission" "allowEventbridgeFeedsPoll" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.feedsFetcher.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.feedsPoll.arn
}

# ------------------------------------------------------------------------------
# API Gateway HTTP API routes (16 JWT-protected + POST /feeds/ingest via X-Api-Key).
# ------------------------------------------------------------------------------
resource "aws_apigatewayv2_integration" "feeds" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.feedsApi.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "feedsList" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /feeds"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsCreate" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /feeds"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsOrderPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /feeds/order"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsUpdate" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /feeds/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /feeds/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsRefresh" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /feeds/{id}/refresh"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsDaysList" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /feeds/{id}/days"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsDayGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /feeds/{id}/days/{day}"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsStarsList" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /feeds/stars"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsStarsPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /feeds/stars"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsStarsDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /feeds/stars"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsKeysList" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /feeds/keys"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsKeysCreate" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /feeds/keys"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsKeysRevoke" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /feeds/keys/{keyId}"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsPrefsGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /feeds/prefs"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "feedsPrefsPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /feeds/prefs"
  target             = "integrations/${aws_apigatewayv2_integration.feeds.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Machine-to-machine ingest: no Cognito JWT authorizer (omitted per repo convention);
# authenticated in-Lambda via X-Api-Key SHA-256 lookup + hmac.compare_digest.
resource "aws_apigatewayv2_route" "feedsIngest" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /feeds/ingest"
  target    = "integrations/${aws_apigatewayv2_integration.feeds.id}"
}

resource "aws_lambda_permission" "feedsApiGateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.feedsApi.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ------------------------------------------------------------------------------
# feed.e9.cx — standalone feeds reader & Mox summary archive frontend.
# Bucket uses the `fus-<name>-<account_id>` naming convention so
# TerraformManageModuleBuckets in infra/main.tf covers it automatically without
# consuming characters in the size-capped inline IAM policy.
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "feedSite" {
  bucket = "fus-feed-site-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "feedSite" {
  bucket = aws_s3_bucket.feedSite.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "feedSitePublicRead" {
  statement {
    sid       = "PublicReadGetObject"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.feedSite.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "feedSite" {
  bucket     = aws_s3_bucket.feedSite.id
  policy     = data.aws_iam_policy_document.feedSitePublicRead.json
  depends_on = [aws_s3_bucket_public_access_block.feedSite]
}

resource "aws_s3_bucket_website_configuration" "feedSite" {
  bucket = aws_s3_bucket.feedSite.id

  index_document {
    suffix = "index.html"
  }
  error_document {
    key = "index.html"
  }
}

resource "aws_cloudfront_distribution" "feed_site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "e9 feeds reader standalone frontend (feed.e9.cx)"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  aliases = ["feed.e9.cx"]

  origin {
    domain_name = aws_s3_bucket_website_configuration.feedSite.website_endpoint
    origin_id   = "S3-${aws_s3_bucket.feedSite.id}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.feedSite.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.cloudfrontLogs.bucket_domain_name
    prefix          = "feed/"
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.shortener.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  depends_on = [
    aws_acm_certificate_validation.shortener,
    aws_s3_bucket_ownership_controls.cloudfrontLogs,
  ]
}

output "feedsTableName" {
  description = "DynamoDB table name for the feeds reader and Mox archive module."
  value       = aws_dynamodb_table.feeds.name
}

output "feedSiteBucketName" {
  description = "S3 bucket name for the feed.e9.cx frontend (CI deploy target)."
  value       = aws_s3_bucket.feedSite.id
}

output "feedSiteCloudfrontId" {
  description = "CloudFront distribution ID for feed.e9.cx (CI cache invalidation target)."
  value       = aws_cloudfront_distribution.feed_site.id
}

output "feedSiteCloudfrontDomain" {
  description = "CloudFront domain name for feed.e9.cx (for the manual ClouDNS CNAME record)."
  value       = aws_cloudfront_distribution.feed_site.domain_name
}
