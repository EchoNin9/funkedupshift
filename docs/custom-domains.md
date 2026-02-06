# Custom Domains (Route 53 + CloudFront)

## Overview

The site is served via CloudFront with custom domains and SSL:

| Environment | Domains |
|-------------|---------|
| **Production** | funkedupshift.com, www.funkedupshift.com, funkedupshift.ca, www.funkedupshift.ca |
| **Staging** | stage.funkedupshift.com, stage.funkedupshift.ca |

## After First Terraform Apply

1. **Delegate DNS to Route 53**  
   Terraform creates hosted zones for `funkedupshift.com` and `funkedupshift.ca`. At your domain registrar, update the nameservers to the Route 53 values:

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

If you use Cognito Hosted UI for sign-in, add your custom domains to the app client callback URLs in the AWS Console (or via Terraform):

- `https://funkedupshift.com/auth.html`
- `https://www.funkedupshift.com/auth.html`
- `https://funkedupshift.ca/auth.html`
- `https://www.funkedupshift.ca/auth.html`
- `https://stage.funkedupshift.com/auth.html`
- `https://stage.funkedupshift.ca/auth.html`

(Adjust paths if your auth page differs.)

## Cache Invalidation

CI/CD invalidates the CloudFront cache after each deploy. To invalidate manually:

```bash
# Staging
aws cloudfront create-invalidation --distribution-id $(terraform -chdir=infra output -raw cloudfrontStagingId) --paths "/*"

# Production
aws cloudfront create-invalidation --distribution-id $(terraform -chdir=infra output -raw cloudfrontProductionId) --paths "/*"
```
