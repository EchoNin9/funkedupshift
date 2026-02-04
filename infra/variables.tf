variable "awsRegion" {
  description = "AWS region for resources."
  type        = string
  default     = "us-east-1"
}

variable "awsProfile" {
  description = "AWS CLI profile for Terraform (e.g. echo9). Leave empty for default credential chain (CI/OIDC)."
  type        = string
  default     = ""
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
