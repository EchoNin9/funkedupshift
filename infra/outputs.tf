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

output "dynamoTableName" {
  description = "DynamoDB main table name (single table)."
  value       = aws_dynamodb_table.main.name
}

output "dynamoTableArn" {
  description = "DynamoDB main table ARN (for Lambda IAM)."
  value       = aws_dynamodb_table.main.arn
}

output "cognitoUserPoolId" {
  description = "Cognito User Pool ID (for frontend and Lambda)."
  value       = aws_cognito_user_pool.main.id
}

output "cognitoUserPoolArn" {
  description = "Cognito User Pool ARN (for Lambda authorizer)."
  value       = aws_cognito_user_pool.main.arn
}

output "cognitoClientId" {
  description = "Cognito App Client ID (for frontend)."
  value       = aws_cognito_user_pool_client.web.id
}

output "cognitoDomain" {
  description = "Cognito hosted UI domain (if domain prefix set)."
  value       = length(aws_cognito_user_pool_domain.main) > 0 ? aws_cognito_user_pool_domain.main[0].domain : ""
}

output "cognitoHostedUiUrl" {
  description = "Cognito hosted UI base URL (login/signup)."
  value       = length(var.cognitoDomainPrefix) > 0 ? "https://${var.cognitoDomainPrefix}.auth.${var.awsRegion}.amazoncognito.com" : ""
}

output "apiInvokeUrl" {
  description = "API Gateway HTTP API invoke URL (for frontend)."
  value       = aws_apigatewayv2_stage.default.invoke_url
}
