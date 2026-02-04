# Bootstrap Terraform state backend

Run these AWS CLI v2 commands once to create the state bucket and DynamoDB lock table. Uses profile `echo9` and region `us-east-1`. Adjust bucket/table names if your `infra/variables.tf` defaults differ.

## 1. Create S3 state bucket

```bash
aws s3api create-bucket \
  --bucket fus-aws-s3-terraform-state \
  --region us-east-1 \
  --profile echo9
```

Enable versioning (recommended for state):

```bash
aws s3api put-bucket-versioning \
  --bucket fus-aws-s3-terraform-state \
  --versioning-configuration Status=Enabled \
  --profile echo9
```

Optional – server-side encryption:

```bash
aws s3api put-bucket-encryption \
  --bucket fus-aws-s3-terraform-state \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  --profile echo9
```

## 2. Create DynamoDB lock table

Terraform uses DynamoDB for state locking (not a second bucket). The table must have a primary key `LockID` (String).

```bash
aws dynamodb create-table \
  --table-name fus-terraform-state-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1 \
  --profile echo9
```

After both exist, uncomment and set the backend in `infra/versions.tf`, then run `terraform init` (reinitialize) in `infra/`.

---

## 3. Import existing GitHub OIDC provider (if it already exists)

If `terraform apply` fails because the GitHub OIDC provider already exists in the account, import it so Terraform manages it:

```bash
cd infra
ACCOUNT_ID=$(aws sts get-caller-identity --profile echo9 --query Account --output text)
terraform import \
  -var="githubOrgRepo=EchoNin9/funkedupshift" \
  aws_iam_openid_connect_provider.github \
  "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
```

Then run `terraform apply` again.
