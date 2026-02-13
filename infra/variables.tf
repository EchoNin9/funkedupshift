variable "awsRegion" {
  description = "AWS region for resources."
  type        = string
  default     = "us-east-1"
}

variable "githubOrgRepo" {
  description = "GitHub org/repo for OIDC trust (e.g. EchoNin9/funkedupshift)."
  type        = string
}

variable "terraformStateBucket" {
  description = "S3 bucket name for Terraform state."
  type        = string
  default     = "fus-aws-s3-terraform-state"
}

variable "terraformStateLockTable" {
  description = "DynamoDB table name for Terraform state locking."
  type        = string
  default     = "fus-terraform-state-lock"
}

variable "websiteStagingBucket" {
  description = "S3 bucket name for staging frontend (JS website)."
  type        = string
  default     = "fus-website-staging"
}

variable "websiteProductionBucket" {
  description = "S3 bucket name for production frontend (JS website)."
  type        = string
  default     = "fus-website-production"
}

variable "dynamoTableName" {
  description = "DynamoDB table name (single table for sites, users, ratings, etc.)."
  type        = string
  default     = "fus-main"
}

variable "cognitoUserPoolName" {
  description = "Cognito User Pool name."
  type        = string
  default     = "fus-user-pool"
}

variable "cognitoAppClientName" {
  description = "Cognito User Pool App Client name (frontend)."
  type        = string
  default     = "fus-web"
}

variable "cognitoDomainPrefix" {
  description = "Cognito hosted UI domain prefix (e.g. fus-auth). Empty to skip domain."
  type        = string
  default     = "fus-auth"
}

variable "lambdaApiFunctionName" {
  description = "Lambda function name for the API handler."
  type        = string
  default     = "fus-api"
}

variable "apiGatewayName" {
  description = "API Gateway HTTP API name."
  type        = string
  default     = "fus-api"
}

variable "mediaBucketName" {
  description = "S3 bucket name for user uploads (logos, media)."
  type        = string
  default     = "fus-media"
}

# ------------------------------------------------------------------------------
# Custom domains (Route 53 + CloudFront)
# ------------------------------------------------------------------------------
variable "domainCom" {
  description = "Primary domain (e.g. funkedupshift.com)."
  type        = string
  default     = "funkedupshift.com"
}

variable "domainCa" {
  description = "Secondary domain (e.g. funkedupshift.ca)."
  type        = string
  default     = "funkedupshift.ca"
}

variable "stagingSubdomain" {
  description = "Subdomain for staging (e.g. stage)."
  type        = string
  default     = "stage"
}

variable "alphaVantageApiKey" {
  description = "Alpha Vantage API key for stock quotes (optional; Yahoo used if empty)."
  type        = string
  default     = ""
  sensitive   = true
}
