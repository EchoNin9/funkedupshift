# ------------------------------------------------------------------------------
# AWS Backup (FUNK-80): fus-main, fus-tools, fus-social-posts, fus-media.
# Daily/weekly/monthly rules, each copied to a ca-central-1 vault.
# Vault Lock is deliberately NOT here (separate ticket).
#
# Account-level Backup region settings (DynamoDB/S3 opt-in, DynamoDB advanced
# features) are ALREADY enabled in us-east-1 and ca-central-1, so no
# aws_backup_region_settings resource: it would manage the whole map and could
# clobber other projects' settings.
#
# ponytail: cost, est. ~$0.10-0.30/mo total: DynamoDB ~1 MB and fus-media ~0.8 GB
# at ~$0.05/GB-mo warm backup (S3 ~$0.05, DDB ~$0.10) x ~3 retained generations
# x 2 regions, plus cross-region transfer ~$0.02/GB. Dominated by the 0.8 GB S3 copies.
# ------------------------------------------------------------------------------
resource "aws_backup_vault" "dr" {
  name = "fus-dr-vault"
}

resource "aws_backup_vault" "drCa" {
  provider = aws.ca_central
  name     = "fus-dr-vault"
}

data "aws_iam_policy_document" "backupAssume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "fus-backup-role"
  assume_role_policy = data.aws_iam_policy_document.backupAssume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "AWSBackupServiceRolePolicyForBackup",
    "AWSBackupServiceRolePolicyForRestores",
    "AWSBackupServiceRolePolicyForS3Backup",
    "AWSBackupServiceRolePolicyForS3Restore",
  ])
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/${each.value}"
}

locals {
  backupRules = {
    daily   = { schedule = "cron(0 5 * * ? *)", days = 3 }
    weekly  = { schedule = "cron(0 6 ? * SUN *)", days = 14 }
    monthly = { schedule = "cron(0 7 1 * ? *)", days = 35 }
  }
}

resource "aws_backup_plan" "dr" {
  name = "fus-dr"

  dynamic "rule" {
    for_each = local.backupRules
    content {
      rule_name         = rule.key
      target_vault_name = aws_backup_vault.dr.name
      schedule          = rule.value.schedule
      start_window      = 60
      completion_window = 360

      lifecycle {
        delete_after = rule.value.days
      }

      copy_action {
        destination_vault_arn = aws_backup_vault.drCa.arn
        lifecycle {
          delete_after = rule.value.days
        }
      }
    }
  }
}

resource "aws_backup_selection" "dr" {
  name         = "fus-dr-resources"
  plan_id      = aws_backup_plan.dr.id
  iam_role_arn = aws_iam_role.backup.arn

  resources = [
    aws_dynamodb_table.main.arn,
    aws_dynamodb_table.tools.arn,
    aws_dynamodb_table.socialPosts.arn,
    aws_s3_bucket.media.arn,
  ]
}
