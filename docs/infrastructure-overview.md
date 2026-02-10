## Infrastructure Overview

All AWS resources for this project are defined in Terraform under the [`infra/`](../infra) directory.

This document gives a high-level view so you know what will be created when you run `terraform apply`.

### Core Components

- **Terraform backend**
  - S3 bucket for Terraform state: `<your-terraform-state-bucket>`.
  - DynamoDB table for state locking: `<your-terraform-lock-table>`.
  - Configured in [`infra/versions.tf`](../infra/versions.tf).
- **Networking & security**
  - IAM roles for:
    - Lambda functions.
    - GitHub Actions (staging + production deploy roles using OIDC).
  - Optional Route 53 hosted zones and ACM certificates if you configure custom domains.

### Application Resources

- **DynamoDB**
  - Single table whose name defaults to `fus-main` (or `var.dynamoTableName`).
  - Partition key: `PK` (String), sort key: `SK` (String).
  - GSIs for querying by entity type, tags, stars, groups, etc.\n  - See [`docs/data-model.md`](data-model.md) for details.

- **S3 buckets**
  - Staging website bucket: `var.websiteStagingBucket` (e.g. `<your-staging-website-bucket>`).
  - Production website bucket: `var.websiteProductionBucket` (e.g. `<your-production-website-bucket>`).
  - Media bucket for uploads (logos, images, videos): `var.mediaBucketName` (e.g. `<your-media-bucket-name>`).

- **CloudFront**
  - Distributions fronting the staging and production website buckets.
  - Optional custom domains (e.g. `<your-root-domain>`, `stage.<your-root-domain>`) and ACM certificates.
  - Cache invalidations are triggered by CI/CD; manual commands are documented in [`docs/custom-domains.md`](custom-domains.md).

- **API Gateway + Lambda**
  - API Gateway (HTTP API) named by `var.apiGatewayName` (defaults to `fus-api`).
  - Lambda function named by `var.lambdaApiFunctionName` (defaults to `fus-api`) implementing the HTTP API in `src/lambda/api/handler.py`.
  - Routes for:
    - Sites CRUD and logo upload/import.
    - Stars, comments, profiles.
    - Media endpoints.
    - Helper endpoints (e.g. AI-generated descriptions, internet dashboard).

- **Cognito**
  - User Pool named by `var.cognitoUserPoolName` (defaults to `fus-user-pool`).
  - App Client named by `var.cognitoAppClientName` (defaults to `fus-web`).
  - Optional Hosted UI domain using `var.cognitoDomainPrefix`.
  - Cognito groups (managed via console or automation) for `admin`, `manager`, and `user`.
  - JWTs from Cognito are used by API Gateway for authorization.

### Environments

Terraform supports two environments in a single configuration, differentiated mainly by:

- Website buckets (staging vs production).
- CloudFront distributions (staging vs production).
- IAM roles used by GitHub Actions:
  - Staging role for the `development` branch workflow.
  - Production role for the `main` branch workflow.

For how GitHub Actions wires into Terraform and S3, see:

- [`docs/ci-cd-and-environments.md`](ci-cd-and-environments.md)
- [`docs/github-actions-setup.md`](github-actions-setup.md)

### Variables and Customization

The main knobs for customizing the infrastructure live in [`infra/variables.tf`](../infra/variables.tf). Important ones include:

- `awsRegion` – `<your-aws-region>` (default: `us-east-1`).
- `terraformStateBucket` – `<your-terraform-state-bucket>`.
- `terraformStateLockTable` – `<your-terraform-lock-table>`.
- `websiteStagingBucket`, `websiteProductionBucket` – staging and production website buckets.
- `mediaBucketName` – media/upload bucket.
- `dynamoTableName` – DynamoDB table name.
- `domainCom`, `domainCa`, `stagingSubdomain` – custom domains for production/staging.

When in doubt, search `infra/` for the variable name to see where it is used.

