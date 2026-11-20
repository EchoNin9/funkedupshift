# Disaster recovery: funkedupshift

Status: **strategy, pending Adam's review** (2026-11-12). Implementation tickets: FUNK-80..84.
Audience: Adam, and an AI agent running recovery unattended. Runbooks in this folder are written
to be executed step by step; every step has a verify command and a stop condition.

## Targets

| | Target | Why |
|---|---|---|
| RPO, data corruption / bad deploy / mistaken delete | minutes (PITR, 3-day window) | cheapest low-RPO option |
| RPO, region loss (us-east-1) | ≤ 24 h | daily backup copied to ca-central-1 |
| RPO, ransomware / account takeover | ≤ 24 h | locked vault, deletion blocked even for root |
| RTO, any scenario | several days to a week | not mission critical; rebuild from repo + restore data |
| Cost | low, target < $3/month total | data is small (~1 MB DynamoDB, ~0.8 GB media) |

AZ loss needs no action: DynamoDB, S3, Lambda, Cognito and KMS are regional, multi-AZ services.

## What can't be rebuilt from git

Everything else (Lambdas, API, CloudFront, SPA, IAM, tools site) is rebuilt by `terraform apply` + CI.

| State | Where | Loss impact |
|---|---|---|
| `fus-main` DynamoDB (users, profiles, media metadata, vehicles, squash, finances, themes) | us-east-1 | catastrophic |
| `fus-media` S3 (user uploads, ~0.8 GB) | us-east-1 | catastrophic (thumbnails regenerable) |
| KMS key `alias/fus-finances` + the wrapped data-key items (`SK=BPF#DEK`) | us-east-1 | finance data permanently unreadable, **even from backups** |
| Cognito users (4) and their `sub`s | us-east-1 | every `USER#{sub}` item orphaned; a new pool issues new subs |
| `fus-tools` (shortener links; CloudFront KVS is a projection of it) | us-east-1 | links break |
| `fus-social-posts` (scheduling history) | us-east-1 | history lost |
| SSM `/funkedupshift/*` secrets (fal, Bluesky, Instagram, MCP token) | us-east-1 | re-obtainable from providers; re-auth needed |
| Terraform state | `fus-aws-s3-terraform-state` (versioned) | rebuild by import; painful but possible |
| Outside AWS: domain registrars, Route53 NS delegation, GitHub secrets (Android keystore!), Play/Bedrock console access | various | manual |

Ephemeral by design (no backup): `fus-textshare`, tools files bucket, lipsync media/jobs, CloudFront logs, website buckets.

## Strategy

### 1. Backups (FUNK-80)
- **PITR, 3-day window** on `fus-main` (enabled 2026-11-12, to be codified), `fus-tools`, `fus-social-posts`.
  Lipsync jobs: drop PITR (ephemeral).
- **Deletion protection** on those tables (free).
- **AWS Backup plan `fus-dr`**, vault `fus-dr-vault` (us-east-1), copies to `fus-dr-vault` in **ca-central-1**:
  | Rule | Schedule | Retention (both regions) |
  |---|---|---|
  | daily | 05:00 UTC | 3 days |
  | weekly | Sunday | 14 days |
  | monthly | 1st | 35 days |
  This gives restore points at roughly 1 day, 1 week, 2 weeks and 1 month back.
  Resources: the three tables + `fus-media`.
- **`fus-media` versioning** (required by AWS Backup for S3) with noncurrent versions expiring after 35 days.
- **Vault Lock, compliance mode** (min 3 / max 40 days) on both vaults: nobody, including the account root,
  can delete recovery points before they expire. This is the file-locker defence in a single account.
  ⚠ Irreversible after a 3-day cooling-off period. Requires Adam's explicit go-ahead.

### 2. Finance key survivability (FUNK-81)
- New **multi-Region** KMS key (primary us-east-1, replica ca-central-1). Existing single-Region keys
  can't be converted. Re-wrap each user's data key (`BPF#DEK`) under it: a few items; the encrypted
  finance values themselves don't change.
- Old key: disable, then schedule deletion after a verified restore drill.
- Remove `kms:ScheduleKeyDeletion` and `kms:PutKeyPolicy` from CI roles; key policy denies deletion
  scheduling to everyone except the account root.

### 3. Identity (FUNK-82)
- Daily export of Cognito users (sub, email, groups, created date; no passwords, which AWS can't export)
  into the backed-up table.
- `scripts/dr/remap_subs.py`: after recreating the pool, create users by email, then rewrite every
  `USER#{oldSub}` key and `userId` attribute to the new sub. The data keys are bound to userId in their
  KMS encryption context, so they must be re-wrapped during the remap. Users reset their passwords.

### 4. User-held copies (FUNK-83): "Back up your data"
Profile page button that builds a download for the signed-in user:
- Options: **records only** (default) or **records + files** (uploaded media).
- Records are decrypted server-side, so the user holds a readable copy.
- Archive layout:
  ```
  funkedupshift-backup-<date>/
    manifest.json        export date, user, app version, counts, sha256 per file
    data/<entity>.json   full fidelity, one file per entity type (re-importable)
    csv/<entity>.csv     spreadsheet-friendly copies for tabular data (transactions, accounts, vehicles, expenses, squash)
    files/...            only when "records + files" is selected
  ```
- Format: `.zip` default (opens everywhere), `.tar.bz2` option.
- Built async by Lambda into a private, 24 h-expiring S3 object, delivered by pre-signed URL.
  Rate-limited, and the request is logged without contents.

### 5. Blast radius (FUNK-84, with the runbooks)
- The staging deploy role has `AdministratorAccess` attached outside Terraform, so any push to
  `development` runs with admin over the whole account. Replace it with the same managed policy as production.
- CI roles lose delete rights on the backup vaults and the finance key (explicit deny).

## Runbooks (FUNK-84)
Written for unattended agent execution, each with preconditions, numbered commands, verify step, and
"stop and page Adam" conditions. Rehearsed once (restore drill into a scratch table) before being trusted.

| File | Scenario |
|---|---|
| `runbook-corruption.md` | bad deploy / migration / mistaken delete: PITR restore to a side table, diff, copy back only affected items |
| `runbook-region-loss.md` | us-east-1 down: terraform to ca-central-1, restore the copies, KMS replica, Cognito + sub remap, DNS |
| `runbook-ransomware.md` | account compromise: contain (revoke keys/sessions, rotate OIDC trust), audit CloudTrail, restore from the locked vault |
| `runbook-rebuild-secrets.md` | re-create every SSM parameter and GitHub secret from the provider side |
| `drill.md` | quarterly restore drill: checklist and last-run log |
