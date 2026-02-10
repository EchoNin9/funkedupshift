## Quickstart: Run Your Own Site Catalog

This guide shows how to deploy **your own instance** of this app using your own AWS account and GitHub repository.

It assumes:

- You can clone a repo and push to GitHub.
- You have basic AWS experience (IAM, S3, DynamoDB, Cognito, Route 53).
- You have the AWS CLI v2 and Terraform installed.

Throughout the docs, replace placeholders like:

- `<your-aws-profile>`
- `<your-aws-region>`
- `<your-github-org>`
- `<your-github-repo>`
- `<your-staging-website-bucket>`
- `<your-production-website-bucket>`
- `<your-media-bucket-name>`
- `<your-dynamodb-table-name>`

with values that make sense for your environment.

---

### 1. Prerequisites

On your local machine:

- **AWS CLI v2** installed and configured with a profile that has rights to create S3, DynamoDB, Lambda, API Gateway, Cognito, Route 53, and IAM resources:

  ```bash
  aws configure --profile <your-aws-profile>
  ```

- **Terraform** installed (version `>= 1.0`; CI uses `1.6`).
- **Python 3.12+** and `pip` (for running tests locally, optional).

In your AWS account:

- A region selected for all resources, e.g. `<your-aws-region>` (defaults to `us-east-1` in Terraform).

---

### 2. Clone the repo and inspect structure

Clone or fork this repository to your own GitHub account (e.g. `<your-github-org>/<your-github-repo>`), then on your machine:

```bash
git clone git@github.com:<your-github-org>/<your-github-repo>.git
cd <your-repo>
```

Key directories:

- `infra/` – Terraform for all AWS resources (DynamoDB, S3, CloudFront, Cognito, API Gateway, Lambda, IAM, Route 53).
- `src/lambda/` – Python Lambda handlers (API).
- `src/web/` – JavaScript/HTML/CSS frontend.
- `docs/` – Documentation (architecture, CI/CD, setup steps).

For an overview of the infrastructure modules, see [`docs/infrastructure-overview.md`](infrastructure-overview.md).

---

### 3. Bootstrap Terraform state backend (once per AWS account)

Terraform uses an S3 bucket and a DynamoDB table for state and locking. You only need to create these **once per AWS account**.

Follow the concrete examples in:

- [`docs/bootstrap-terraform-backend.md`](bootstrap-terraform-backend.md)

Then verify the backend configuration in `infra/versions.tf` matches your choices:

- `bucket = "<your-terraform-state-bucket>"`
- `dynamodb_table = "<your-terraform-lock-table>"`
- `region = "<your-aws-region>"`

> If you use the default values from `infra/variables.tf` you can keep the provided example names, or change them to your own.

---

### 4. Customize Terraform variables

Open [`infra/variables.tf`](../infra/variables.tf). Important variables (with suggested replacements) include:

- **Region**

  ```hcl
  variable "awsRegion" {
    default = "us-east-1" # change to <your-aws-region> if needed
  }
  ```

- **Terraform backend names** (if you changed them when bootstrapping):

  ```hcl
  variable "terraformStateBucket" {
    default = "<your-terraform-state-bucket>"
  }

  variable "terraformStateLockTable" {
    default = "<your-terraform-lock-table>"
  }
  ```

- **Website and media buckets**:

  ```hcl
  variable "websiteStagingBucket" {
    default = "<your-staging-website-bucket>"
  }

  variable "websiteProductionBucket" {
    default = "<your-production-website-bucket>"
  }

  variable "mediaBucketName" {
    default = "<your-media-bucket-name>"
  }
  ```

- **DynamoDB table**:

  ```hcl
  variable "dynamoTableName" {
    default = "<your-dynamodb-table-name>"
  }
  ```

- **Cognito** (you can keep the defaults or rename):

  ```hcl
  variable "cognitoUserPoolName"   { default = "<your-user-pool-name>" }
  variable "cognitoAppClientName"  { default = "<your-app-client-name>" }
  variable "cognitoDomainPrefix"   { default = "<your-auth-domain-prefix>" } # optional Hosted UI
  ```

- **Custom domains** (optional; see [`docs/custom-domains.md`](custom-domains.md)):

  ```hcl
  variable "domainCom"       { default = "<your-root-domain>" }          # e.g. example.com
  variable "domainCa"        { default = "<your-secondary-root-domain>" } # optional
  variable "stagingSubdomain"{ default = "<your-staging-subdomain>" }    # e.g. stage
  ```

You can also override these via a `terraform.tfvars` or `infra/terraform.tfvars` file instead of editing defaults.

---

### 5. First Terraform apply (staging + production infrastructure)

From the repo root:

```bash
cd infra
terraform init
terraform plan -var="githubOrgRepo=<your-github-org>/<your-github-repo>"
terraform apply -var="githubOrgRepo=<your-github-org>/<your-github-repo>"
```

This will create:

- DynamoDB table for sites, users, ratings, etc.
- S3 buckets for:
  - Staging website (`<your-staging-website-bucket>`)
  - Production website (`<your-production-website-bucket>`)
  - Media uploads (`<your-media-bucket-name>`)
- API Gateway (HTTP API) and Lambda API function.
- Cognito User Pool + App Client.
- CloudFront distributions for staging and production.
- IAM roles for GitHub Actions (staging + production).
- (Optionally) Route 53 hosted zones and ACM certificates if you set domains.

> You can start with **staging only** and use production later; the Terraform code supports both environments.

---

### 6. Configure Cognito (auth & roles)

Terraform will create a Cognito User Pool and App Client, but you may want to:

- Confirm callback URLs for the app (e.g. `https://<your-staging-subdomain>.<your-root-domain>/auth.html`).
- Create user accounts and assign them to groups:
  - `admin` – can add new sites and manage metadata.
  - `manager` – can manage more than basic users (depending on your policies).
  - `user` – can add their own ratings/notes.

For a more detailed walkthrough, see:

- [`docs/cognito-setup.md`](cognito-setup.md)

---

### 7. Frontend configuration & deployment

The GitHub Actions workflows will:

- Run tests for the Lambda code.
- Run `terraform plan/apply` in `infra/` using `githubOrgRepo=${{ github.repository }}`.
- Generate `src/web/config.js` using Terraform outputs:
  - `apiInvokeUrl`
  - `cognitoUserPoolId`
  - `cognitoClientId`
- Sync `src/web/` (or `src/web/dist` / `src/web/build` if present) to:
  - `<your-staging-website-bucket>` on `development` branch pushes.
  - `<your-production-website-bucket>` on `main` branch pushes.

You can also deploy manually from your machine:

```bash
cd infra
API_URL=$(terraform output -raw apiInvokeUrl)
POOL_ID=$(terraform output -raw cognitoUserPoolId)
CLIENT_ID=$(terraform output -raw cognitoClientId)

cat > ../src/web/config.js <<'CONFIGEOF'
window.API_BASE_URL = "API_URL_PLACEHOLDER";
window.COGNITO_USER_POOL_ID = "POOL_ID_PLACEHOLDER";
window.COGNITO_CLIENT_ID = "CLIENT_ID_PLACEHOLDER";
window.CATEGORIES_CACHE_KEY = "your_app_categories";
window.getCategoriesFromCache = function () { try { var r = localStorage.getItem(window.CATEGORIES_CACHE_KEY); return r ? JSON.parse(r) : []; } catch (e) { return []; } };
window.saveCategoriesToCache = function (cats) { try { if (!cats || !Array.isArray(cats)) return; var list = cats.map(function (c) { return { id: c.PK || c.id || "", name: c.name || c.PK || c.id || "" }; }); localStorage.setItem(window.CATEGORIES_CACHE_KEY, JSON.stringify(list)); } catch (e) {} };
CONFIGEOF

sed -i "s|API_URL_PLACEHOLDER|$API_URL|g; s|POOL_ID_PLACEHOLDER|$POOL_ID|g; s|CLIENT_ID_PLACEHOLDER|$CLIENT_ID|g" ../src/web/config.js

BUCKET=$(terraform output -raw websiteStagingBucket)
aws s3 sync ../src/web s3://$BUCKET/ --delete --profile <your-aws-profile>
```

> The exact config.js template is maintained in the GitHub Actions workflows under `.github/workflows/`.

For more details on CI/CD behavior, see:

- [`docs/ci-cd-and-environments.md`](ci-cd-and-environments.md)
- [`docs/github-actions-setup.md`](github-actions-setup.md)

---

### 8. Custom domains (optional)

If you want to use your own domain (e.g. `example.com`, `stage.example.com`):

- Set `domainCom`, `domainCa`, and `stagingSubdomain` in `infra/variables.tf`.
- Run `terraform apply` again.
- Delegate DNS from your domain registrar to the Route 53 hosted zone nameservers.

See:

- [`docs/custom-domains.md`](custom-domains.md)

---

### 9. Next steps and customization

Once your instance is running:

- Add yourself to the `admin` group in Cognito so you can create sites.
- Explore the data model in [`docs/data-model.md`](data-model.md) if you plan to extend the backend.
- Customize the frontend look and feel under `src/web/` (CSS, layout, components).
- Extend the API in `src/lambda/api/handler.py` with new routes (remember to add tests in `src/lambda/tests/`).

If you forked this repo from the original project, you can refer back to the funkedupshift-specific names in the docs as a concrete example of how to wire your own environment.

