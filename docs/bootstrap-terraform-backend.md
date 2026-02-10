# Bootstrap Terraform state backend

This project uses an **S3 bucket** for Terraform state and a **DynamoDB table** for state locking. You only need to create these once per AWS account.

The examples below show how the original project bootstrapped its backend using:

- Bucket: `fus-aws-s3-terraform-state`
- Lock table: `fus-terraform-state-lock`
- AWS profile: `echo9`

You can either:

- Reuse these names, or
- Substitute your own, such as:
  - `<your-terraform-state-bucket>`
  - `<your-terraform-lock-table>`
  - `<your-aws-profile>`

Make sure the backend configuration in `infra/versions.tf` and the defaults in `infra/variables.tf` match your choices.

## 1. Create S3 state bucket

```bash
aws s3api create-bucket \
  --bucket <your-terraform-state-bucket> \
  --region <your-aws-region> \
  --profile <your-aws-profile>
```

Enable versioning (recommended for state):

```bash
aws s3api put-bucket-versioning \
  --bucket <your-terraform-state-bucket> \
  --versioning-configuration Status=Enabled \
  --profile <your-aws-profile>
```

Optional – server-side encryption:

```bash
aws s3api put-bucket-encryption \
  --bucket <your-terraform-state-bucket> \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  --profile <your-aws-profile>
```

## 2. Create DynamoDB lock table

Terraform uses DynamoDB for state locking (not a second bucket). The table must have a primary key `LockID` (String).

```bash
aws dynamodb create-table \
  --table-name <your-terraform-lock-table> \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region <your-aws-region> \
  --profile <your-aws-profile>
```

After both exist, uncomment and set the backend in `infra/versions.tf`, then run `terraform init` (reinitialize) in `infra/`.

---

## 3. Import existing GitHub OIDC provider (if it already exists)

If `terraform apply` fails because the GitHub OIDC provider already exists in the account, import it so Terraform manages it:

```bash
cd infra
ACCOUNT_ID=$(aws sts get-caller-identity --profile <your-aws-profile> --query Account --output text)
terraform import \
  -var="githubOrgRepo=<your-github-org>/<your-github-repo>" \
  aws_iam_openid_connect_provider.github \
  "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
```

Then run `terraform apply` again.
