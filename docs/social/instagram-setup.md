# Instagram setup — SSM parameters and first publish

Everything in phase 3 is deployed but **inert until these parameters exist**.
The code reads them by path, so no redeploy is needed after you write them —
`listAccounts()` discovers Instagram accounts the same way it discovers
Bluesky ones.

**These commands are for the account owner to run.** Claude does not handle
raw token values; it only ever asks for the parameter names to exist.

Every command needs `--profile echo9`. Region is `us-east-1`.

---

## 1. Per-account parameters

Repeat for each account. `{accountId}` is the short slug (Bluesky uses
`personal` and `public`); `{ig-user-id}` is the ~17-digit Instagram
professional account ID, which normally starts `17841`.

Get the ig-user-id from the Graph API Explorer with `pages_show_list` +
`instagram_basic`:

```
me/accounts?fields=name,instagram_business_account{id,username}
```

Use the nested `instagram_business_account.id` — **not** the Page ID beside it.

```bash
aws ssm put-parameter --profile echo9 --region us-east-1 \
  --name "/funkedupshift/social/instagram/{accountId}/ig-user-id" \
  --type String \
  --value "17841XXXXXXXXXXXX" \
  --overwrite
```

The access token is the **Page access token** for the Page linked to that
Instagram account — not a user token. Meta documents long-lived Page tokens as
non-expiring.

```bash
aws ssm put-parameter --profile echo9 --region us-east-1 \
  --name "/funkedupshift/social/instagram/{accountId}/access-token" \
  --type SecureString \
  --value "PASTE_PAGE_ACCESS_TOKEN" \
  --overwrite
```

## 2. Shared app credentials

Used by the monthly validator for `debug_token`. App ID is not secret; the
secret is.

```bash
aws ssm put-parameter --profile echo9 --region us-east-1 \
  --name "/funkedupshift/social/instagram/app-id" \
  --type String \
  --value "YOUR_APP_ID" \
  --overwrite
```

```bash
aws ssm put-parameter --profile echo9 --region us-east-1 \
  --name "/funkedupshift/social/instagram/app-secret" \
  --type SecureString \
  --value "PASTE_APP_SECRET" \
  --overwrite
```

## 3. Optional — long-lived user token

Only needed if you want the monthly job to actually *refresh* something. Page
tokens don't expire, so without this the job validates and reports rather than
refreshing. This is the one parameter the Lambda can overwrite itself.

```bash
aws ssm put-parameter --profile echo9 --region us-east-1 \
  --name "/funkedupshift/social/instagram/user-token" \
  --type SecureString \
  --value "PASTE_LONG_LIVED_USER_TOKEN" \
  --overwrite
```

## 4. Verify the wiring without publishing

Confirm the parameter names exist (prints names only, never values):

```bash
aws ssm get-parameters-by-path --profile echo9 --region us-east-1 \
  --path /funkedupshift/social/instagram --recursive \
  --query 'Parameters[].[Name,Type]' --output table
```

Then run the monthly validator on demand. It performs no publishing — it only
checks `debug_token`, probes each account, and emails the result via the
existing SNS topic. This is the safe way to prove the credentials work:

```bash
aws lambda invoke --profile echo9 --region us-east-1 \
  --function-name fus-social-token-refresh \
  --cli-binary-format raw-in-base64-out \
  --payload '{"job":"refresh_instagram_token"}' \
  /tmp/ig-token-check.json && cat /tmp/ig-token-check.json
```

A healthy result reports each account valid. Watch for:

- `is_valid: false` — wrong or revoked token
- missing `instagram_content_publish` — the scope that fails only at publish
  time, months later, if not caught here
- an account that validates but fails the liveness probe — the token is real
  but not for that `ig-user-id`

## 5. First publish — human step

**Claude does not publish to Instagram.** The first real post is run by the
account owner.

Once §4 is clean, schedule a post through the SPA at `/social`, or use the CLI:

```bash
.venv/bin/python scripts/social_schedule.py --action create \
  --account instagram:{accountId} \
  --text "first post from the scheduler" \
  --image "uploads/{path-returned-by-the-presign-route}/photo.jpg" \
  --at "2026-08-04T12:00:00Z" \
  --profile echo9
```

Constraints the API enforces, which differ from Bluesky:

| Rule | Instagram |
|---|---|
| Text-only post | **Not possible** — media is required |
| Image format | **JPEG only** (PNG/WebP fail server-side) |
| Image size / aspect | 8 MB, 4:5 to 1.91:1 |
| Caption | 2200 chars, 30 hashtags, 20 mentions |
| Carousel | max 10 items, may mix image and video |
| Video | MP4, max 300 MB, Reels 3s–15min |

For a Reel, expect the target to sit in `processing` while Meta transcodes.
That is normal: the publisher books an EventBridge re-check (60s for the first
five checks, then 300s) rather than blocking. The post is only marked
`published` once the container reports `FINISHED` and `media_publish`
succeeds.

## Notes

- Quota is read live from `content_publishing_limit` rather than hardcoded —
  Meta's docs disagree with themselves (100/24h in prose, 50 in the reference
  example). The first real call settles it for your account.
- Nothing here is required for Bluesky, which continues unchanged.
