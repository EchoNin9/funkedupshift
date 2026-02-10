# Custom Domains (Route 53 + CloudFront)

This project can serve your site behind CloudFront using **your own domains** (e.g. `example.com`, `stage.example.com`) with HTTPS.

The examples below are taken from the original project configuration and use:

- Root domains: `funkedupshift.com`, `funkedupshift.ca`
- Staging subdomain: `stage`

You should substitute your own values such as:

- `<your-root-domain>` (e.g. `example.com`)
- `<your-secondary-root-domain>` (optional, e.g. `example.ca`)
- `<your-staging-subdomain>` (e.g. `stage`)

## Overview

The site is served via CloudFront with custom domains and SSL.

### Generic mapping (your setup)

| Environment | Example domains                                             |
|-------------|------------------------------------------------------------|
| **Production** | `<your-root-domain>`, `www.<your-root-domain>`             |
| **Staging**    | `<your-staging-subdomain>.<your-root-domain>`             |
| (Optional)     | `<your-secondary-root-domain>`, `www.<your-secondary-root-domain>` |

Terraform variables in `infra/variables.tf` control these:

- `domainCom` – `<your-root-domain>`
- `domainCa` – `<your-secondary-root-domain>` (optional)
- `stagingSubdomain` – `<your-staging-subdomain>`

### Original funkedupshift example

| Environment | Domains |
|-------------|---------|
| **Production** | funkedupshift.com, www.funkedupshift.com, funkedupshift.ca, www.funkedupshift.ca |
| **Staging** | stage.funkedupshift.com, stage.funkedupshift.ca |

## After First Terraform Apply

1. **Delegate DNS to Route 53**  
   Terraform creates hosted zones for your domains (e.g. `<your-root-domain>` and `<your-secondary-root-domain>`). At your domain registrar, update the nameservers to the Route 53 values:

   ```bash
   terraform -chdir=infra output route53NameserversCom
   terraform -chdir=infra output route53NameserversCa
   ```

   Set these as the authoritative nameservers for each domain. Propagation can take up to 48 hours.

2. **ACM validation**  
   DNS validation records are created automatically. The certificate is issued once validation completes (usually within a few minutes).

3. **CloudFront**  
   Distributions are created and linked to the validated certificate. After DNS delegation, the custom domains will resolve and serve HTTPS.

## Cognito (if using Hosted UI)

If you use Cognito Hosted UI for sign-in, add your **own** domains to the app client callback URLs in the AWS Console (or via Terraform). For example:

- `https://<your-root-domain>/auth.html`
- `https://www.<your-root-domain>/auth.html`
- `https://<your-secondary-root-domain>/auth.html` (optional)
- `https://www.<your-secondary-root-domain>/auth.html` (optional)
- `https://<your-staging-subdomain>.<your-root-domain>/auth.html`

Adjust paths if your auth page differs.

## Cache Invalidation

CI/CD invalidates the CloudFront cache after each deploy. To invalidate manually:

```bash
# Staging
aws cloudfront create-invalidation --distribution-id $(terraform -chdir=infra output -raw cloudfrontStagingId) --paths "/*"

# Production
aws cloudfront create-invalidation --distribution-id $(terraform -chdir=infra output -raw cloudfrontProductionId) --paths "/*"
```
