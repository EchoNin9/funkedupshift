# ------------------------------------------------------------------------------
# Social scheduling module (Phase 2) — storage, scheduling, reconciliation,
# alerting. See src/lambda/social/ (phase-1 Bluesky publisher already lives
# there and is unchanged by this file).
#
# Isolation is the security model, same precedent as infra/tools.tf: the
# social Lambdas get their OWN IAM role with NO access to the main DynamoDB
# table (aws_dynamodb_table.main), the media bucket (aws_s3_bucket.media), or
# Cognito — everything in infra/main.tf stays untouched and unreachable from
# this role. No API Gateway routes yet (phase 4); the socialApi Lambda is
# direct-invoke only, same as phase 1.
#
# data.aws_caller_identity.current is declared once in main.tf and reused
# here (avoids a duplicate data source).
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# DynamoDB — single table, parent (META) + fan-out target items per post.
# See src/lambda/social/storage.py for the item shapes.
# ------------------------------------------------------------------------------
resource "aws_dynamodb_table" "socialPosts" {
  name         = "fus-social-posts"
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
    name = "scheduledAt"
    type = "S"
  }
  attribute {
    name = "monthKey"
    type = "S"
  }

  # Sparse index: statusKey is only present on a parent item while its
  # status == "pending" (removed on every terminal/derived status — see
  # storage.updateParentStatus). The reconciliation sweep queries this to
  # find posts whose one-shot EventBridge schedule never fired.
  global_secondary_index {
    name            = "byStatusTime"
    hash_key        = "statusKey"
    range_key       = "scheduledAt"
    projection_type = "ALL"
  }

  # Cheap "list this month's posts" for the phase-4 calendar view. Only
  # parent items carry monthKey, so this index is naturally parent-only too.
  global_secondary_index {
    name            = "byMonth"
    hash_key        = "monthKey"
    range_key       = "scheduledAt"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# ------------------------------------------------------------------------------
# S3 — media referenced by scheduled posts (uploads/{createdBy}/{postId}/{filename}).
# Private; access is exclusively via presigned URLs (social/media.py) or the
# lambdaSocial role's direct Get/Put/Delete.
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "socialMedia" {
  bucket = "fus-social-media-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "socialMedia" {
  bucket = aws_s3_bucket.socialMedia.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "socialMedia" {
  bucket = aws_s3_bucket.socialMedia.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Mirrors aws_s3_bucket_cors_configuration.media in main.tf — same
# allowed-origin shape (both frontends upload directly via presigned PUT).
resource "aws_s3_bucket_cors_configuration" "socialMedia" {
  bucket = aws_s3_bucket.socialMedia.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "socialMedia" {
  bucket = aws_s3_bucket.socialMedia.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

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
}

# ------------------------------------------------------------------------------
# SNS — publish failures + daily heartbeat (src/lambda/social/alerts.py).
# ------------------------------------------------------------------------------
resource "aws_sns_topic" "socialAlerts" {
  name = "fus-social-alerts"
}

resource "aws_sns_topic_subscription" "socialAlertsEmail" {
  topic_arn = aws_sns_topic.socialAlerts.arn
  protocol  = "email"
  endpoint  = var.socialAlertEmail
}

# ------------------------------------------------------------------------------
# EventBridge Scheduler — dedicated group so IAM can be scoped to just these
# schedules. Individual one-shot schedules (social-post-{postId}) are created
# and deleted at RUNTIME via boto3 (social/scheduling.py), NOT declared here —
# ActionAfterCompletion is a boto3 create_schedule parameter, not a Terraform
# argument on aws_scheduler_schedule.
# ------------------------------------------------------------------------------
resource "aws_scheduler_schedule_group" "social" {
  name = "fus-social"
}

# ------------------------------------------------------------------------------
# Lambda zip — social/ + common/ only. Excludes every other feature
# directory so this bundle can never import finance/tools/thumb code even by
# accident (same isolation goal as data.archive_file.tools in infra/tools.tf).
# ------------------------------------------------------------------------------
data "archive_file" "social" {
  type        = "zip"
  source_dir  = "${path.module}/../src/lambda"
  output_path = "${path.module}/build/social.zip"
  excludes = [
    "**/__pycache__/**",
    "**/*.pyc",
    "api/**",
    "mcp/**",
    "thumb/**",
    "collector/**",
    "tools/**",
    "tests/**",
    "requirements-test.txt",
  ]
}

# kms:Decrypt Resource elements in an IAM identity policy are matched
# against the CMK's actual key ARN, not an alias ARN — KMS resolves the
# alias to the key before the crypto operation is authorized, so granting
# "arn:aws:kms:...:alias/aws/ssm" would silently fail to authorize Decrypt.
# This data source resolves the alias to the real key ARN at plan time so
# the grant below actually works.
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

# ------------------------------------------------------------------------------
# IAM — lambdaSocial role, scoped ONLY to this file's resources. No access to
# aws_dynamodb_table.main, aws_s3_bucket.media, Cognito, or anything else
# declared in main.tf/tools.tf.
# ------------------------------------------------------------------------------
resource "aws_iam_role" "lambdaSocial" {
  name = "fus-social-lambda-role"

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

resource "aws_iam_role_policy" "lambdaSocial" {
  name = "fus-social-lambda"
  role = aws_iam_role.lambdaSocial.id
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
        Resource = [aws_dynamodb_table.socialPosts.arn, "${aws_dynamodb_table.socialPosts.arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.socialMedia.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.socialMedia.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.socialAlerts.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:parameter/funkedupshift/social/*"
      },
      {
        # SecureString parameters under /funkedupshift/social/* are
        # encrypted with the account's default aws/ssm managed key (no
        # dedicated CMK) — kms:Decrypt is scoped to that key's real ARN
        # (resolved via data.aws_kms_alias.ssm above, see its comment for
        # why the alias ARN itself can't be used here) and further
        # restricted with kms:ViaService so it can only be exercised
        # through SSM, never as a general-purpose decrypt grant.
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
        Resource = "arn:aws:scheduler:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.social.name}/*"
      },
      {
        # Lets EventBridge Scheduler assume socialScheduler on this role's
        # behalf when create_schedule runs — scoped to that one role, not a
        # blanket iam:PassRole.
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = aws_iam_role.socialScheduler.arn
      },
    ]
  })
}

# Assumed by EventBridge Scheduler to invoke the publisher Lambda. Scoped to
# invoke socialPublisher only — this role has no other permissions.
resource "aws_iam_role" "socialScheduler" {
  name = "fus-social-scheduler-role"

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

resource "aws_iam_role_policy" "socialScheduler" {
  name = "fus-social-scheduler"
  role = aws_iam_role.socialScheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.socialPublisher.arn
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambdas — API (direct-invoke, no gateway route yet), publisher (Scheduler
# target), maintenance (daily reconcile + heartbeat).
# ------------------------------------------------------------------------------
locals {
  # socialPublisher's own environment needs its own ARN (so the API lambda
  # and the scheduler target both agree on where to invoke) -- referencing
  # aws_lambda_function.socialPublisher.arn from inside that same resource's
  # environment block is a self-reference Terraform can't resolve (a real
  # "Cycle: aws_lambda_function.socialPublisher, local.socialEnvVars"
  # error at `terraform validate` if you try). Building the ARN from its
  # (static) function_name instead sidesteps the cycle entirely.
  socialPublisherFunctionName = "fus-social-publisher"
  socialPublisherArn          = "arn:aws:lambda:${var.awsRegion}:${data.aws_caller_identity.current.account_id}:function:${local.socialPublisherFunctionName}"

  socialEnvVars = {
    SOCIAL_TABLE              = aws_dynamodb_table.socialPosts.name
    SOCIAL_MEDIA_BUCKET       = aws_s3_bucket.socialMedia.bucket
    SOCIAL_ALERT_TOPIC_ARN    = aws_sns_topic.socialAlerts.arn
    SOCIAL_SCHEDULE_GROUP     = aws_scheduler_schedule_group.social.name
    SOCIAL_PUBLISHER_ARN      = local.socialPublisherArn
    SOCIAL_SCHEDULER_ROLE_ARN = aws_iam_role.socialScheduler.arn
  }
}

resource "aws_lambda_function" "socialApi" {
  filename         = data.archive_file.social.output_path
  function_name    = "fus-social-api"
  role             = aws_iam_role.lambdaSocial.arn
  handler          = "social.handler.handler"
  source_code_hash = data.archive_file.social.output_base64sha256
  runtime          = "python3.13"
  timeout          = 30

  environment {
    variables = local.socialEnvVars
  }
}

resource "aws_lambda_function" "socialPublisher" {
  filename         = data.archive_file.social.output_path
  function_name    = local.socialPublisherFunctionName
  role             = aws_iam_role.lambdaSocial.arn
  handler          = "social.publisher.handler"
  source_code_hash = data.archive_file.social.output_base64sha256
  runtime          = "python3.13"
  timeout          = 120

  environment {
    variables = local.socialEnvVars
  }
}

resource "aws_lambda_function" "socialMaintenance" {
  filename         = data.archive_file.social.output_path
  function_name    = "fus-social-maintenance"
  role             = aws_iam_role.lambdaSocial.arn
  handler          = "social.maintenance.handler"
  source_code_hash = data.archive_file.social.output_base64sha256
  runtime          = "python3.13"
  timeout          = 300

  environment {
    variables = local.socialEnvVars
  }
}

# ------------------------------------------------------------------------------
# Daily reconciliation sweep — the safety net, not the primary publish
# mechanism (EventBridge Scheduler one-shots above are primary). Mirrors the
# aws_cloudwatch_event_rule.collector_daily pattern in main.tf.
# ------------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "socialReconcile" {
  name        = "fus-social-reconcile-daily"
  description = "Trigger the social maintenance lambda's reconcile job daily"
  # Offset 15 minutes from collector_daily's 06:00 UTC (main.tf) so the two
  # unrelated daily jobs don't cold-start at the exact same instant.
  schedule_expression = "cron(15 6 * * ? *)"
}

resource "aws_cloudwatch_event_target" "socialReconcileTarget" {
  rule      = aws_cloudwatch_event_rule.socialReconcile.name
  target_id = "socialMaintenance"
  arn       = aws_lambda_function.socialMaintenance.arn
  input     = jsonencode({ job = "reconcile" })
}

resource "aws_lambda_permission" "allowEventbridgeSocialReconcile" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.socialMaintenance.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.socialReconcile.arn
}

# Note: the socialAlertEmail variable lives in infra/variables.tf, and this
# module's outputs (socialPostsTableName, socialMediaBucketName,
# socialAlertsTopicArn) live in infra/outputs.tf — both are the established
# shared files for those declarations, so this file declares resources only.
