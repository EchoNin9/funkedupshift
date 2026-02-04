output "githubStagingRoleArn" {
  description = "ARN of the IAM role for GitHub Actions (staging / development branch)."
  value       = aws_iam_role.githubStaging.arn
}

output "githubProductionRoleArn" {
  description = "ARN of the IAM role for GitHub Actions (production / main branch)."
  value       = aws_iam_role.githubProduction.arn
}

output "websiteStagingBucket" {
  description = "S3 bucket name for staging frontend."
  value       = aws_s3_bucket.websiteStaging.id
}

output "websiteStagingUrl" {
  description = "Staging website URL (S3 website endpoint)."
  value       = "http://${aws_s3_bucket_website_configuration.websiteStaging.website_endpoint}"
}

output "websiteProductionBucket" {
  description = "S3 bucket name for production frontend."
  value       = aws_s3_bucket.websiteProduction.id
}

output "websiteProductionUrl" {
  description = "Production website URL (S3 website endpoint)."
  value       = "http://${aws_s3_bucket_website_configuration.websiteProduction.website_endpoint}"
}
