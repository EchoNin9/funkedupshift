# Copy to terraform.tfvars and set values.
# terraform.tfvars is typically not committed (add to .gitignore if desired).

awsRegion     = "us-east-1"
githubOrgRepo = "EchoNin9/funkedupshift"

# Optional overrides for state backend (defaults in variables.tf)
terraformStateBucket     = "fus-aws-s3-terraform-state"
terraformStateLockTable  = "fus-terraform-state-lock"
