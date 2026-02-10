## Cognito Setup (Auth & Roles)

This app uses **AWS Cognito User Pools** for authentication and authorization. Terraform creates the core resources for you, but you may want to review and adjust some settings manually.

### 1. Identify Cognito resources

After running Terraform:

- In the AWS Console, go to **Cognito → User pools** and locate the pool named by:
  - `var.cognitoUserPoolName` (defaults to `fus-user-pool`).
- Within that pool, find the **App client** named by:
  - `var.cognitoAppClientName` (defaults to `fus-web`).

You can also get these values via Terraform outputs:

```bash
cd infra
terraform output cognitoUserPoolId
terraform output cognitoClientId
```

These are used by the frontend (`src/web/config.js`) to sign users in and obtain JWTs.

### 2. Configure callback URLs

If you use Cognito Hosted UI, configure the app client callback URLs to include your frontend domains. For example:

- Staging: `https://<your-staging-subdomain>.<your-root-domain>/auth.html`
- Production: `https://<your-root-domain>/auth.html`

In the AWS Console:

1. Open your User Pool.
2. Go to **App integration → App client settings** (or equivalent in the current console).
3. Add your callback URLs and sign-out URLs.
4. Ensure allowed OAuth flows/scopes match your needs (typically `code` flow with `openid`, `email`, `profile`).

If you are not using custom domains yet, you can use the default CloudFront URLs from Terraform outputs instead.

### 3. Create user groups (roles)

The app expects three primary roles, typically implemented as **Cognito groups**:

- `admin` – Full access to manage sites and metadata.
- `manager` – Elevated capabilities (e.g. managing categories or media) depending on your policy choices.
- `user` – Regular users who can add their own ratings, notes, and comments.

In the User Pool:

1. Go to **Users and groups → Groups**.
2. Create groups:
   - Name: `admin`
   - Name: `manager`
   - Name: `user`
3. Add yourself (and any collaborators) to the `admin` group so you can sign in and configure the app.

> Authorization checks in the Lambda/API layer read Cognito group membership from the JWT and enforce who can add sites vs. who can add their own metadata.

### 4. Connect Cognito to the API (authorizer)

Terraform wires API Gateway to use the Cognito User Pool as a JWT authorizer. You generally **do not** need to configure this manually if you are using the provided Terraform:

- API Gateway will validate tokens from your User Pool.
- Lambda handlers use claims (e.g. `sub`, `email`, `cognito:groups`) to identify the current user and their role.

If you customize the authorizer or use a different pool/app client:

- Update variables in `infra/variables.tf` and re-apply Terraform.
- Ensure the frontend `config.js` is regenerated with the new pool and client IDs.

### 5. Optional: Hosted UI custom domain

If you enable a Cognito Hosted UI custom domain:

1. Choose a prefix in `var.cognitoDomainPrefix` (e.g. `<your-auth-domain-prefix>`).
2. Re-run `terraform apply` so the domain resource is created.
3. Add the resulting domain (e.g. `https://<your-auth-domain-prefix>.auth.<your-aws-region>.amazoncognito.com`) to your app settings and frontend configuration as needed.

See also:

- [`docs/custom-domains.md`](custom-domains.md) for Route 53 and CloudFront custom domains.

