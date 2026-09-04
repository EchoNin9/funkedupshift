# ------------------------------------------------------------------------------
# AI video / lip-sync module. See docs/lipsync-design.md for the approved
# design and src/lambda/lipsync/ (routes.py, storage.py, media.py, secrets.py,
# runner.py, scheduling.py, maintenance.py, providers/) for the implementation
# this file deploys.
#
# Isolation is the security model, same precedent as infra/social.tf and
# infra/tools.tf: the lipsync Lambdas get their OWN IAM role with NO access to
# aws_dynamodb_table.main, aws_s3_bucket.media, Cognito, or the social
# module's own table/bucket -- everything declared elsewhere stays untouched
# and unreachable from this role.
#
# data.aws_caller_identity.current (main.tf) and data.aws_kms_alias.ssm
# (social.tf) are declared once and reused here (avoids duplicate data
# sources in the same root module -- see social.tf's own comment on the
# former).
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# DynamoDB — one item per job (src/lambda/lipsync/storage.py: PK=JOB#{jobId},
# SK=META).
# ------------------------------------------------------------------------------
resource "aws_dynamodb_table" "lipsyncJobs" {
  name         = "fus-lipsync-jobs"
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
    name = "statusKey"
    type = "S"
  }
  attribute {
    name = "updatedAt"
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

  # Sparse index: statusKey is only present while status is non-terminal
  # (queued/submitting/processing) -- see storage.transitionStatus. The
  # reconciliation sweep (maintenance.py) queries this to find jobs whose
  # async runner invoke or EventBridge check schedule was lost.
  global_secondary_index {
    name            = "byStatusTime"
    hash_key        = "statusKey"
    range_key       = "updatedAt"
    projection_type = "ALL"
  }

  # Reserved for a future per-creator list view / quota counter (see
  # docs/lipsync-design.md) -- v1's list endpoint is a full Scan (low
  # volume, admin-only table; see storage.listJobs's docstring) and does
  # not query this index yet.
  global_secondary_index {
    name            = "byCreator"
    hash_key        = "createdBy"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

# ------------------------------------------------------------------------------
# S3 — input uploads (uploads/{createdBy}/{kind}/{uuid}{ext}) and generated
# clips (outputs/{jobId}/{jobId}.mp4). Private; access is exclusively via
# presigned URLs (lipsync/media.py) or the lambdaLipsync role's direct
# Get/Put/Delete.
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "lipsyncMedia" {
  bucket = "fus-lipsync-media-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "lipsyncMedia" {
  bucket = aws_s3_bucket.lipsyncMedia.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lipsyncMedia" {
  bucket = aws_s3_bucket.lipsyncMedia.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Mirrors aws_s3_bucket_cors_configuration.socialMedia -- both frontends
# upload directly via presigned PUT, and the lipsync SPA reads the output
# clip's presigned GET URL directly into a <video> element.
resource "aws_s3_bucket_cors_configuration" "lipsyncMedia" {
  bucket = aws_s3_bucket.lipsyncMedia.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "lipsyncMedia" {
  bucket = aws_s3_bucket.lipsyncMedia.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # docs/lipsync-design.md's Compliance section: "90-day expiry matches the
  # social media bucket" -- applies to BOTH prefixes (inputs and the
  # generated clip itself), unlike social's bucket which only ever expires
  # uploads/.
  rule {
    id     = "expire-uploads"
    status = "Enabled"

    filter {
      prefix = "uploads/"
    }

    expiration {
      days = 90
    }
  }

  rule {
    id     = "expire-outputs"
    status = "Enabled"

    filter {
      prefix = "outputs/"
    }

    expiration {
      days = 90
    }
  }
}

# ------------------------------------------------------------------------------
# SNS — reconciliation alerts + daily heartbeat (src/lambda/lipsync/alerts.py).
# ------------------------------------------------------------------------------
resource "aws_sns_topic" "lipsyncAlerts" {
  name = "fus-lipsync-alerts"
}

resource "aws_sns_topic_subscription" "lipsyncAlertsEmail" {
  topic_arn = aws_sns_topic.lipsyncAlerts.arn
  protocol  = "email"
  endpoint  = var.lipsyncAlertEmail
}

# ------------------------------------------------------------------------------
# EventBridge Scheduler — dedicated group so IAM can be scoped to just these
# schedules. Individual one-shot check schedules (lipsync-chk-{jobId}-{n}) are
# created/deleted at RUNTIME via boto3 (lipsync/scheduling.py), NOT declared
# here -- same precedent as infra/social.tf's aws_scheduler_schedule_group.social.
# ------------------------------------------------------------------------------
resource "aws_scheduler_schedule_group" "lipsync" {
  name = "fus-lipsync"
}

# ------------------------------------------------------------------------------
# Lambda zip — lipsync/ + common/ only. Excludes every other feature
# directory (including social/) so this bundle can never import
# finance/tools/thumb/social code even by accident -- same isolation goal as
# infra/social.tf's data.archive_file.social.
# ------------------------------------------------------------------------------
data "archive_file" "lipsync" {
  type        = "zip"
  source_dir  = "${path.module}/../src/lambda"
  output_path = "${path.module}/build/lipsync.zip"
  excludes = [
    "**/__pycache__/**",
    "**/*.pyc",
    "api/**",
    "mcp/**",
    "thumb/**",
    "collector/**",
    "tools/**",
    "social/**",
    "tests/**",
    "requirements-test.txt",
  ]
}

# ------------------------------------------------------------------------------
# IAM — lambdaLipsync role, scoped ONLY to this file's resources. No access to
# aws_dynamodb_table.main, aws_s3_bucket.media, aws_dynamodb_table.socialPosts,
# aws_s3_bucket.socialMedia, Cognito, or anything else declared elsewhere.
# Shared by all three lipsync Lambdas below (api/runner/maintenance), same
# single-role precedent as infra/social.tf's lambdaSocial.
# ------------------------------------------------------------------------------
resource "aws_iam_role" "lambdaLipsync" {
  name = "fus-lipsync-lambda-role"

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

resource "aws_iam_role_policy" "lambdaLipsync" {
  name = "fus-lipsync-lambda"
  role = aws_iam_role.lambdaLipsync.id
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
          "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
          "dynamodb:Query", "dynamodb:Scan", "dynamodb:ConditionCheckItem",
        ]
        Resource = [aws_dynamodb_table.lipsyncJobs.arn, "${aws_dynamodb_table.lipsyncJobs.arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.lipsyncMedia.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.lipsyncMedia.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.lipsyncAlerts.arn
      },
      {
        # Read-only, scoped to the /funkedupshift/lipsync/* prefix. The
        # fal.ai API key parameter itself is NOT created by Terraform (set
        # manually by the repo owner, see docs/lipsync-design.md's
        # Credentials section) -- this is only the permission to read it.
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:parameter/funkedupshift/lipsync/*"
      },
      {
        # SecureString parameters under /funkedupshift/lipsync/* are
        # encrypted with the account's default aws/ssm managed key (no
        # dedicated CMK) -- kms:Decrypt is scoped to that key's real ARN
        # (data.aws_kms_alias.ssm, declared in social.tf and reused here --
        # see that data source's own comment for why the alias ARN itself
        # can't be granted) and further restricted with kms:ViaService so it
        # can only be exercised through SSM, never as a general-purpose
        # decrypt grant.
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = data.aws_kms_alias.ssm.target_key_arn
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.awsRegion}.amazonaws.com"
          }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["scheduler:CreateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"]
        Resource = "arn:aws:scheduler:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.lipsync.name}/*"
      },
      {
        # Lets EventBridge Scheduler assume lipsyncScheduler on this role's
        # behalf when create_schedule runs -- scoped to that one role, not a
        # blanket iam:PassRole.
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = aws_iam_role.lipsyncScheduler.arn
      },
      {
        # lipsyncApi invokes lipsyncRunner asynchronously right after
        # writing a job as `queued` (see routes.createJob /
        # _invokeRunnerAsync); a lost/denied invoke is tolerated (the daily
        # reconciliation sweep picks up any job that never advances) but
        # must not be the NORMAL path -- this grant is what makes the
        # normal path work.
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = local.lipsyncRunnerArn
      },
    ]
  })
}

# Assumed by EventBridge Scheduler to invoke the runner Lambda for each
# scheduled poll check. Scoped to invoke lipsyncRunner only.
resource "aws_iam_role" "lipsyncScheduler" {
  name = "fus-lipsync-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "lipsyncScheduler" {
  name = "fus-lipsync-scheduler"
  role = aws_iam_role.lipsyncScheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = local.lipsyncRunnerArn
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambdas — API (Gateway-triggered), runner (submit/poll worker, also the
# EventBridge Scheduler target), maintenance (daily reconcile + heartbeat).
# ------------------------------------------------------------------------------
locals {
  # lipsyncRunner's own environment needs its own ARN (to self-schedule the
  # next poll check via EventBridge Scheduler) -- referencing
  # aws_lambda_function.lipsyncRunner.arn from inside that same resource's
  # environment block is a self-reference Terraform can't resolve (see
  # infra/social.tf's identical local.socialPublisherArn comment for the
  # exact "Cycle: ..." error this sidesteps). Building the ARN from its
  # (static) function_name instead avoids the cycle entirely, and also lets
  # lipsyncApi reference the same value for its async invoke.
  lipsyncRunnerFunctionName = "fus-lipsync-runner"
  lipsyncRunnerArn          = "arn:aws:lambda:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:function:${local.lipsyncRunnerFunctionName}"

  lipsyncEnvVars = {
    LIPSYNC_TABLE                = aws_dynamodb_table.lipsyncJobs.name
    LIPSYNC_MEDIA_BUCKET         = aws_s3_bucket.lipsyncMedia.bucket
    LIPSYNC_ALERT_TOPIC_ARN      = aws_sns_topic.lipsyncAlerts.arn
    LIPSYNC_SCHEDULE_GROUP       = aws_scheduler_schedule_group.lipsync.name
    LIPSYNC_RUNNER_ARN           = local.lipsyncRunnerArn
    LIPSYNC_RUNNER_FUNCTION_NAME = local.lipsyncRunnerFunctionName
    LIPSYNC_SCHEDULER_ROLE_ARN   = aws_iam_role.lipsyncScheduler.arn
  }
}

resource "aws_lambda_function" "lipsyncApi" {
  filename         = data.archive_file.lipsync.output_path
  function_name    = "fus-lipsync-api"
  role             = aws_iam_role.lambdaLipsync.arn
  handler          = "lipsync.routes.handler"
  source_code_hash = data.archive_file.lipsync.output_base64sha256
  runtime          = "python3.13"
  timeout          = 30

  environment {
    variables = local.lipsyncEnvVars
  }
}

resource "aws_lambda_function" "lipsyncRunner" {
  filename         = data.archive_file.lipsync.output_path
  function_name    = local.lipsyncRunnerFunctionName
  role             = aws_iam_role.lambdaLipsync.arn
  handler          = "lipsync.runner.handler"
  source_code_hash = data.archive_file.lipsync.output_base64sha256
  runtime          = "python3.13"
  # Longer than social's publisher (120s): a single invocation can loop
  # through several immediate (sub-60s backoff) checks in-process (see
  # scheduling.createCheck's MIN_LEAD_SECONDS guard) and, on completion,
  # synchronously downloads the provider's output clip and re-uploads it to
  # our own bucket before returning.
  timeout = 300

  environment {
    variables = local.lipsyncEnvVars
  }
}

resource "aws_lambda_function" "lipsyncMaintenance" {
  filename         = data.archive_file.lipsync.output_path
  function_name    = "fus-lipsync-maintenance"
  role             = aws_iam_role.lambdaLipsync.arn
  handler          = "lipsync.maintenance.handler"
  source_code_hash = data.archive_file.lipsync.output_base64sha256
  runtime          = "python3.13"
  timeout          = 300

  environment {
    variables = local.lipsyncEnvVars
  }
}

# ------------------------------------------------------------------------------
# Daily reconciliation sweep -- the safety net, not the primary submit/poll
# mechanism (the runner's own async invoke + self-scheduled checks are
# primary). Mirrors infra/social.tf's aws_cloudwatch_event_rule.socialReconcile.
# ------------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "lipsyncReconcile" {
  name        = "fus-lipsync-reconcile-daily"
  description = "Trigger the lipsync maintenance lambda's reconcile job daily"
  # Offset from main.tf's collector_daily (06:00 UTC) and social.tf's
  # socialReconcile (06:15 UTC) / socialTokenRefresh (06:30 UTC) so none of
  # the unrelated daily jobs cold-start at the same instant.
  schedule_expression = "cron(45 6 * * ? *)"
}

resource "aws_cloudwatch_event_target" "lipsyncReconcileTarget" {
  rule      = aws_cloudwatch_event_rule.lipsyncReconcile.name
  target_id = "lipsyncMaintenance"
  arn       = aws_lambda_function.lipsyncMaintenance.arn
  input     = jsonencode({ job = "reconcile" })
}

resource "aws_lambda_permission" "allowEventbridgeLipsyncReconcile" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lipsyncMaintenance.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.lipsyncReconcile.arn
}

# ------------------------------------------------------------------------------
# API Gateway routes — reuse the existing HTTP API + Cognito JWT authorizer
# declared in infra/main.tf (aws_apigatewayv2_api.main,
# aws_apigatewayv2_authorizer.cognito), same precedent as infra/social.tf.
# Every route is admin-gated in lipsync/routes.py itself (Cognito group
# `admin`, read only from the JWT claims -- this Lambda's role has no access
# to the main table to look up custom groups). ALL SIX routes carry the JWT
# authorizer, including the {jobId}-parameterised ones, which is stricter
# than strictly required by test_route_coverage.py (that test only checks
# the three literal routes below) but matches the design doc's "All routes
# require the Cognito JWT authorizer and admin group membership."
# ------------------------------------------------------------------------------
resource "aws_apigatewayv2_integration" "lipsync" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.lipsyncApi.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "lipsyncMediaPresignPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /lipsync/media/presign"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "lipsyncJobsPost" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /lipsync/jobs"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "lipsyncJobsGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /lipsync/jobs"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "lipsyncJobGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /lipsync/jobs/{jobId}"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "lipsyncJobDelete" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /lipsync/jobs/{jobId}"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "lipsyncJobOutputGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /lipsync/jobs/{jobId}/output"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "lipsyncApiGateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lipsyncApi.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Note: the lipsyncAlertEmail variable lives in infra/variables.tf, and this
# module's outputs (lipsyncJobsTableName, lipsyncMediaBucketName,
# lipsyncAlertsTopicArn, lipsyncRunnerArn, lipsyncSchedulerRoleArn) live in
# infra/outputs.tf -- both are the established shared files for those
# declarations, so this file declares resources only.

# --- Budget routes -------------------------------------------------------------
# The module is open to any authenticated user; /lipsync/admin/* is additionally
# gated on the Cognito `admin` group inside the handler (routes.route checks the
# path prefix before dispatch). API Gateway only enforces the JWT.

resource "aws_apigatewayv2_route" "lipsyncBudgetGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /lipsync/budget"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "lipsyncAdminBudgetsGet" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /lipsync/admin/budgets"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "lipsyncAdminBudgetPut" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "PUT /lipsync/admin/budgets/{username}"
  target             = "integrations/${aws_apigatewayv2_integration.lipsync.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}
