# GitHub Actions deployment setup

After Terraform has created the IAM roles, configure the repository so workflows can assume those roles via OIDC (no long-lived AWS keys).

## 1. Get role ARNs from Terraform

From your machine (with AWS profile and Terraform state):

```bash
cd infra
terraform output githubStagingRoleArn
terraform output githubProductionRoleArn
```

## 2. Add repository variables

In GitHub: **Settings → Secrets and variables → Actions → Variables**.

Create these **variables** (not secrets; role ARNs are not sensitive):

| Name | Value | Used by |
|------|--------|---------|
| `AWS_ROLE_ARN_STAGING` | Output of `terraform output githubStagingRoleArn` | `dev.yml` (development branch) |
| `AWS_ROLE_ARN_PRODUCTION` | Output of `terraform output githubProductionRoleArn` | `main.yml` (main branch) |

Optional:

| Name | Value |
|------|--------|
| `AWS_REGION` | e.g. `us-east-1` (defaults to `us-east-1` if unset) |

## 3. Apply IAM changes once

The new website-deploy policies for the GitHub Actions roles are in Terraform. Apply them (e.g. locally) so the roles can deploy to the S3 website buckets:

```bash
cd infra
terraform plan -var="githubOrgRepo=YOUR_ORG/YOUR_REPO"
terraform apply -var="githubOrgRepo=YOUR_ORG/YOUR_REPO"
```

## 4. Branches and workflows

- **Push to `development`** → runs `.github/workflows/dev.yml` → assumes staging role → Terraform apply (staging) + S3 sync to staging website bucket.
- **Push to `main`** → runs `.github/workflows/main.yml` → assumes production role → Terraform apply (production) + S3 sync to production website bucket.

Ensure the default branch and any branch you push exist in the repo (`development` and `main`).

## 5. First run

1. Set the variables above.
2. Push to `development` or `main`; the corresponding workflow will run.
3. If the OIDC provider or roles were created in a different account/region, confirm the role ARNs and region match.

## Troubleshooting

- **"Could not assume role"** – Check that `AWS_ROLE_ARN_STAGING` / `AWS_ROLE_ARN_PRODUCTION` match the Terraform outputs and that the OIDC provider exists in the same account.
- **"Access Denied" on S3** – Re-run `terraform apply` so the website-deploy policy is attached to the role.
- **pytest fails** – Add or fix tests under `src/lambda/tests/`; the workflow runs `pytest src/lambda/tests -v` before Terraform.
