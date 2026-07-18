# ------------------------------------------------------------------------------
# Tools platform / URL shortener (Phase 1) — docs/tools-platform-phase1-brief.md
#
# Isolated public-tool surface: own DynamoDB table, own Lambda + IAM role, own
# CloudFront distribution + Function + KeyValueStore. Reuses the existing
# API Gateway (aws_apigatewayv2_api.main) and Cognito authorizer only.
#
# echo9.net is DEFERRED — not referenced anywhere in this file.
# ------------------------------------------------------------------------------

variable "shortDomain" {
  description = "Primary short-link domain used to build shortUrl values (e.g. fus.fyi)."
  type        = string
  default     = "fus.fyi"
}

variable "toolsDynamoTableName" {
  description = "DynamoDB table name for the tools platform (URL shortener phase 1)."
  type        = string
  default     = "fus-tools"
}

variable "linkTtlDays" {
  description = "Days a minted short link stays live before it expires (mint stamps expiresAt = now + this)."
  type        = number
  default     = 30
}

# ------------------------------------------------------------------------------
# ACM certificate for the shortener domains (fus.fyi, e9.cx) — already
# requested by hand outside Terraform; imported here rather than recreated.
# DNS validation records are added externally (DNS for these domains is not
# hosted in this account's Route 53), so there is no aws_route53_record
# validation wiring — only a validation waiter that polls certificate status.
# ------------------------------------------------------------------------------
import {
  to = aws_acm_certificate.shortener
  id = "arn:aws:acm:us-east-1:452644920012:certificate/c20fb4dc-5697-49af-9e01-c7fcae531853"
}

resource "aws_acm_certificate" "shortener" {
  provider          = aws.us_east_1
  domain_name       = "fus.fyi"
  validation_method = "DNS"

  subject_alternative_names = [
    "*.fus.fyi",
    "e9.cx",
    "*.e9.cx",
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# No aws_route53_record validation records — DNS for fus.fyi / e9.cx is
# external and Adam adds the CNAME validation records by hand. This resource
# simply waits for ACM to report the certificate as ISSUED.
resource "aws_acm_certificate_validation" "shortener" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.shortener.arn
}

# ------------------------------------------------------------------------------
# DynamoDB table — source of truth for minted short links (own table, not the
# shared finance/app table; see guardrail in the brief, section 5.1).
# ------------------------------------------------------------------------------
resource "aws_dynamodb_table" "tools" {
  name         = var.toolsDynamoTableName
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "code"

  attribute {
    name = "code"
    type = "S"
  }

  attribute {
    name = "createdBy"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  # List a caller's own links: query byCreator where createdBy = <sub>,
  # newest first (ScanIndexForward=false on createdAt). See GET /s.
  global_secondary_index {
    name            = "byCreator"
    hash_key        = "createdBy"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # DynamoDB TTL cleans up expired links from the table itself. This is
  # independent of edge enforcement (see shortener-redirect.js) — TTL
  # deletion timing is "usually within 48 hours", not immediate, so the
  # CloudFront Function must not rely on rows being gone by expiresAt.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# ------------------------------------------------------------------------------
# CloudFront KeyValueStore — read-optimized edge projection of the table
# above (code -> destination URL). One store, shared by staging and
# production, matching the existing single-table/single-lambda pattern in
# this repo.
# ------------------------------------------------------------------------------
resource "aws_cloudfront_key_value_store" "tools" {
  name = "fus-tools-kvs"
  # API limit: comment must be <= 128 chars.
  comment = "URL shortener code->URL edge projection; source of truth is the ${var.toolsDynamoTableName} DynamoDB table."
}

resource "aws_cloudfront_function" "shortenerRedirect" {
  name    = "fus-shortener-redirect"
  runtime = "cloudfront-js-2.0"
  comment = "Resolve short codes from the tools KeyValueStore at the edge; redirect to funkedupshift.com on miss."
  publish = true
  code    = file("${path.module}/cloudfront-functions/shortener-redirect.js")

  key_value_store_associations = [aws_cloudfront_key_value_store.tools.arn]
}

# ------------------------------------------------------------------------------
# Tools Lambda — mint (POST /s) + metadata (GET /s/{code}). Own IAM role,
# own zip (excludes api/, mcp/, thumb/, tests/ so it can never import
# finance code even accidentally; common/ stays importable).
# ------------------------------------------------------------------------------
data "archive_file" "tools" {
  type        = "zip"
  source_dir  = "${path.module}/../src/lambda"
  output_path = "${path.module}/build/tools.zip"
  excludes = [
    "**/__pycache__/**",
    "**/*.pyc",
    "api/**",
    "mcp/**",
    "thumb/**",
    "tests/**",
  ]
}

# The CloudFront KeyValueStore data plane signs requests with SigV4A, which
# botocore only supports when the awscrt package is present — it is NOT in
# the Lambda runtime's bundled boto3 ("Missing Dependency ... pip install
# botocore[crt]"). Shipped as a layer, mirroring the pillow_layer pattern in
# main.tf. The generic python/ path works for any runtime version.
#
# dnspython rides in the same layer (GET /tools/dns, dnsLookup) — no
# per-feature layer proliferation; both packages are small and neither is in
# the base Lambda runtime.
resource "null_resource" "tools_crt_layer" {
  triggers = {
    requirements = "awscrt dnspython"
  }
  provisioner "local-exec" {
    command     = "mkdir -p build/tools_layer/python && python3 -m pip install awscrt dnspython -t build/tools_layer/python --quiet && cd build/tools_layer && zip -qr ../tools_crt_layer.zip python"
    working_dir = path.module
  }
}

resource "aws_lambda_layer_version" "toolsCrt" {
  filename            = "${path.module}/build/tools_crt_layer.zip"
  layer_name          = "fus-tools-crt-layer"
  compatible_runtimes = ["python3.13"]
  depends_on          = [null_resource.tools_crt_layer]
}

resource "aws_iam_role" "lambdaTools" {
  name = "fus-tools-lambda-role"

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

# Scoped ONLY to the tools table and the tools KeyValueStore — no access to
# the finance table, media bucket, or any other resource. This is the
# security boundary described in the brief (section 5.1): public tool
# traffic must never share an execution context or IAM identity with
# personal-finance data.
resource "aws_iam_role_policy" "lambdaTools" {
  name = "fus-tools-lambda"
  role = aws_iam_role.lambdaTools.id
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
          "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:ConditionCheckItem",
          "dynamodb:DeleteItem", "dynamodb:UpdateItem", "dynamodb:Query",
        ]
        # Query targets the byCreator GSI (GET /s), the rest target the base
        # table — both ARNs are listed so a single statement covers all of
        # them without granting anything beyond this table + its indexes.
        Resource = [aws_dynamodb_table.tools.arn, "${aws_dynamodb_table.tools.arn}/index/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudfront-keyvaluestore:DescribeKeyValueStore", "cloudfront-keyvaluestore:GetKey",
          "cloudfront-keyvaluestore:PutKey", "cloudfront-keyvaluestore:DeleteKey",
        ]
        Resource = aws_cloudfront_key_value_store.tools.arn
      }
    ]
  })
}

resource "aws_lambda_function" "tools" {
  filename         = data.archive_file.tools.output_path
  function_name    = "fus-tools"
  role             = aws_iam_role.lambdaTools.arn
  handler          = "tools.handler.handler"
  source_code_hash = data.archive_file.tools.output_base64sha256
  runtime          = "python3.13"
  timeout          = 15
  layers           = [aws_lambda_layer_version.toolsCrt.arn]

  environment {
    variables = {
      TOOLS_TABLE_NAME = aws_dynamodb_table.tools.name
      KVS_ARN          = aws_cloudfront_key_value_store.tools.arn
      SHORT_DOMAIN     = var.shortDomain
      LINK_TTL_DAYS    = tostring(var.linkTtlDays)
    }
  }
}

# ------------------------------------------------------------------------------
# API Gateway routes — reuse the existing HTTP API + Cognito JWT authorizer,
# following the isolated-lambda precedent set by the finances MCP server
# (infra/main.tf, aws_lambda_function.mcp) but with the tools-specific role
# and zip above.
# ------------------------------------------------------------------------------
resource "aws_apigatewayv2_integration" "tools" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.tools.invoke_arn
  payload_format_version = "2.0"
}

# Mint a short link (authenticated users only).
resource "aws_apigatewayv2_route" "toolsShortenPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /s"
  target             = "integrations/${aws_apigatewayv2_integration.tools.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Short link metadata/preview (authenticated users only). Public resolution
# is edge-only via the CloudFront Function + KeyValueStore above — this
# route is never on the redirect hot path.
resource "aws_apigatewayv2_route" "toolsShortenGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /s/{code}"
  target             = "integrations/${aws_apigatewayv2_integration.tools.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# List the caller's own short links (paginated, newest first).
resource "aws_apigatewayv2_route" "toolsShortenList" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /s"
  target             = "integrations/${aws_apigatewayv2_integration.tools.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Delete a short link (creator only).
resource "aws_apigatewayv2_route" "toolsShortenDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /s/{code}"
  target             = "integrations/${aws_apigatewayv2_integration.tools.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Adjust a short link's expiry (creator only).
resource "aws_apigatewayv2_route" "toolsShortenPatch" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PATCH /s/{code}"
  target             = "integrations/${aws_apigatewayv2_integration.tools.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# DNS lookup tool (mxtoolbox-style): one typed query per request, no
# recursion/resolver options exposed (authenticated users only).
resource "aws_apigatewayv2_route" "toolsDnsGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /tools/dns"
  target             = "integrations/${aws_apigatewayv2_integration.tools.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "toolsGateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tools.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ------------------------------------------------------------------------------
# Shortener CloudFront distribution — dedicated to fus.fyi / stage.fus.fyi
# (e9.cx joins after a later cutover; see commented alias below). Separate
# from the existing staging/production distributions in infra/cloudfront.tf,
# which are untouched by this file. CloudFront distributions have no base
# fee, so a second distribution costs nothing extra to run (see brief,
# section 2, "cost framing").
#
# The default (only) behavior runs the shortenerRedirect CloudFront
# Function on viewer-request, which answers every request itself (hit ->
# 301, miss -> 302 to the funkedupshift.com landing page). The origin below
# is a schema-required fallback that the function never actually routes to.
# ------------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "shortener" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Funkedupshift URL shortener (fus.fyi / stage.fus.fyi)"
  price_class     = "PriceClass_100"

  aliases = [
    "fus.fyi",
    "stage.fus.fyi",
    "e9.cx", # cutover 2026-07-17: detached from legacy distribution E1S4CU3NV8WOAL first.
  ]

  # Dummy fallback origin (production S3 website endpoint) — the
  # shortenerRedirect function answers every request itself, so this origin
  # is never actually reached in normal operation.
  origin {
    domain_name = aws_s3_bucket_website_configuration.websiteProduction.website_endpoint
    origin_id   = "dummy-fallback-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "dummy-fallback-origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.shortenerRedirect.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.shortener.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  depends_on = [aws_acm_certificate_validation.shortener]
}

# ------------------------------------------------------------------------------
# tools.e9.cx — standalone freetools.org-style frontend (Part A of the
# tools-site brief). Own S3 website bucket + CloudFront distribution, same
# copy-pattern as the staging/production sites in main.tf/cloudfront.tf, but
# env-shared: one bucket, one distro, no staging variant. Talks to the same
# API Gateway + Cognito app client as the SPA's /tools page — no backend
# changes here. CI (dev.yml) deploys this from the development branch only.
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "toolsSite" {
  bucket = var.toolsSiteBucket
}

resource "aws_s3_bucket_public_access_block" "toolsSite" {
  bucket = aws_s3_bucket.toolsSite.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "toolsSitePublicRead" {
  statement {
    sid       = "PublicReadGetObject"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.toolsSite.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "toolsSite" {
  bucket = aws_s3_bucket.toolsSite.id
  policy = data.aws_iam_policy_document.toolsSitePublicRead.json

  # Public policy PUT races BlockPublicPolicy unless the access block is
  # relaxed first (bit CI on the initial apply).
  depends_on = [aws_s3_bucket_public_access_block.toolsSite]
}

resource "aws_s3_bucket_website_configuration" "toolsSite" {
  bucket = aws_s3_bucket.toolsSite.id

  index_document {
    suffix = "index.html"
  }
  error_document {
    key = "index.html"
  }
}

resource "aws_cloudfront_distribution" "tools_site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "e9 tools standalone frontend (tools.e9.cx)"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  aliases = ["tools.e9.cx"]

  origin {
    domain_name = aws_s3_bucket_website_configuration.toolsSite.website_endpoint
    origin_id   = "S3-${aws_s3_bucket.toolsSite.id}"

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
    target_origin_id       = "S3-${aws_s3_bucket.toolsSite.id}"
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

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.shortener.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  depends_on = [aws_acm_certificate_validation.shortener]
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "shortenerCloudfrontDomain" {
  description = "CloudFront domain name for the shortener distribution (for Route 53 alias records, added externally)."
  value       = aws_cloudfront_distribution.shortener.domain_name
}

output "shortenerCertArn" {
  description = "ACM certificate ARN covering fus.fyi / e9.cx (imported, not created by this config)."
  value       = aws_acm_certificate_validation.shortener.certificate_arn
}

output "shortenerKvsArn" {
  description = "CloudFront KeyValueStore ARN for the URL shortener edge projection."
  value       = aws_cloudfront_key_value_store.tools.arn
}

output "toolsSiteBucketName" {
  description = "S3 bucket name for the tools.e9.cx frontend (CI deploy target)."
  value       = aws_s3_bucket.toolsSite.id
}

output "toolsSiteCloudfrontId" {
  description = "CloudFront distribution ID for tools.e9.cx (CI cache invalidation target)."
  value       = aws_cloudfront_distribution.tools_site.id
}

output "toolsSiteCloudfrontDomain" {
  description = "CloudFront domain name for tools.e9.cx (for the manual ClouDNS CNAME record)."
  value       = aws_cloudfront_distribution.tools_site.domain_name
}
