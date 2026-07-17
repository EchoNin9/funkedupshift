# Tools Platform Phase 1 — Handoff / Remaining Steps

**Written 2026-07-17 at the end of a working session.** Read alongside
`docs/tools-platform-phase1-brief.md` (the original plan) and repo `CLAUDE.md`
(delegation workflow). Everything below the "Done" line is verified deployed
and working; the numbered steps are what's left.

## Done (do not redo)

- URL shortener live end-to-end on `fus.fyi` + `stage.fus.fyi`:
  - `infra/tools.tf`: imported ACM cert
    (`arn:aws:acm:us-east-1:452644920012:certificate/c20fb4dc-5697-49af-9e01-c7fcae531853`,
    covers fus.fyi/*.fus.fyi/e9.cx/*.e9.cx, ISSUED), `fus-tools` DynamoDB
    table (TTL on `expiresAt`, `byCreator` GSI), KeyValueStore `fus-tools-kvs`
    (`arn:aws:cloudfront::452644920012:key-value-store/dfca2584-cbfc-4b7b-988b-280d66ee83e1`),
    isolated `fus-tools` Lambda (own role, own zip, awscrt layer
    `fus-tools-crt-layer` — KVS data plane needs SigV4A), shortener CloudFront
    distribution `d1ewzo3461g6sl.cloudfront.net`, routes
    `POST /s`, `GET /s`, `GET|DELETE|PATCH /s/{code}` (all Cognito JWT).
  - Edge redirect: `infra/cloudfront-functions/shortener-redirect.js` reads
    KVS JSON `{"u": url, "e": epochSeconds}`; expired or unknown → 302 to
    funkedupshift.com. Plain-string KVS values = legacy, treated non-expiring.
  - Expiry/list/delete/edit feature deployed (commit `a1f384e`): mint stamps
    `expiresAt = now + var.linkTtlDays` (default 30 d, never mint-settable);
    SPA "Your links" list at `/tools` with pagination, delete, expiry editor.
  - Legacy pre-expiry rows migrated (one-off script, 2026-07-17).
  - External DNS (ClouDNS, not Route 53): cert validation CNAMEs, `fus.fyi`
    apex ALIAS and `stage.fus.fyi` CNAME → `d1ewzo3461g6sl.cloudfront.net`
    all live and verified.

## Remaining steps

1. **Adam: staging sign-off.** Exercise `stage.funkedupshift.com/tools`:
   mint, list pagination (>20 links to see "Load more"), delete, expiry edit,
   and confirm resolution + expiry behavior on `fus.fyi/<code>`. Everything
   after this step waits on it.

2. **e9.cx cutover (decided: cut over fresh — old codes die, no migration).**
   The alias `e9.cx` is still attached to the *legacy* shortener distribution
   `E1S4CU3NV8WOAL` (separate old stack: REST API `7u4ew423li` in us-west-2 +
   its own cert; NOT in this repo's Terraform). CloudFront refuses the same
   alias on two distributions, so the order matters:
   1. Remove `e9.cx` (and `*.e9.cx` if present) from `E1S4CU3NV8WOAL`
      (console or `aws cloudfront update-distribution`; it's outside this
      repo's state).
   2. Uncomment the `"e9.cx"` alias line in `infra/tools.tf`
      (`aws_cloudfront_distribution.shortener`), push to `development`.
   3. Repoint `e9.cx` DNS (ClouDNS) from the old distribution's domain to
      `d1ewzo3461g6sl.cloudfront.net`; verify `https://e9.cx/<code>` 301s.
   4. Optionally decommission the old stack (its CloudFormation/SAM stack,
      REST API `7u4ew423li`, and its now-unused `e9.cx` cert).

3. **PR `development` → `main`** after staging sign-off. Never push `main`
   directly. Production CloudFront/S3 deploy is driven by `main.yml`; note
   the shortener infra is env-shared (one distro/table/KVS), so "production"
   here is really just the funkedupshift.com SPA rollout.

4. **Optional/housekeeping:**
   - No FUNK Jira ticket exists for any of this work — create one
     retroactively if it should be tracked (see jira-conventions memory).
   - KVS stale-entry sweep + DDB→KVS backfill job deliberately unbuilt
     (`ponytail:` comments mark the spots in `shortener-redirect.js` and
     `src/lambda/tools/handler.py`). Build only if KVS size or drift is
     observed.
   - `echo9.net` second brand **deferred by decision 2026-07-16**: apex hosts
     the legacy personal site (expired cert), `*.echo9.net` belongs to the
     9host project. Reconcile before ever adding it.
   - Later phases per the brief: more tool modules under
     `src/web/spa/src/features/tools/`, custom aliases, per-tool analytics.

## Gotchas a new agent must know

- Deploy = push to `development` (staging) / merge to `main` (prod); CI runs
  pytest → terraform apply → SPA build/sync. `pytest src/lambda/tests` has
  2 known PIL failures in `test_api_handler.py`; `npm run build` (not
  `typecheck`) is the frontend gate.
- `test_route_coverage.py` cross-checks handler dispatches against
  `route_key`s in **all** `infra/*.tf` — new routes must land in both places.
- API GW CORS `allow_methods` lives in `infra/main.tf` — PATCH was missing
  until 2026-07-17; check it when adding new HTTP methods.
- The `mcp` Lambda precedent in `main.tf` shares the finance role/zip — do
  NOT copy it for tools work; the tools Lambda's isolation (own role, own
  zip) is a hard guardrail from the brief.
- CI's own IAM policy (`terraformManage` in `main.tf`) allowlists exact
  role/function/table/layer ARNs — new named AWS resources must be added
  there or `terraform apply` fails with AccessDenied.
- DNS for fus.fyi/e9.cx is external (ClouDNS, `pns1.cloudns.net`) — Adam
  adds records by hand; Terraform only outputs targets
  (`shortenerCloudfrontDomain`).
