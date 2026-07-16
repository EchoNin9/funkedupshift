# Planning Brief: Free-Tools Platform + URL Shortener (Phase 1)

**Audience:** an autonomous Claude Code agent (or Adam) picking this up start-to-finish on this repo — including from the CLI after a web session.
**Status:** decided by Adam (2026-07-16). This is a **planning brief**, not yet approved-to-build. Nothing here is implemented. Defaults marked *(default — overridable)* may be changed only by asking Adam first.

---

## 1. Mission

Stand up a self-hosted **free online tools site** — a near-clone of <https://www.freetools.org/> — inside this existing repo, reusing the current AWS footprint. The headline module and Phase-1 deliverable is a **URL shortener** served from Adam's own short domains, but the platform is designed from day one for **many additive tool modules** to follow.

**Primary motivations:** self-hosting the URL shortener on owned domains (`fus.fyi`, `e9.cx`), plus branding and demos.

### Phase-1 deliverables
1. **URL shortener, end to end:** mint short codes from the app, resolve/redirect them at the edge on the short domains.
2. **Shortener SPA module** in the existing React app, reachable at `funkedupshift.com/ca` **and** `echo9.net/ca`, both minting from the same global code space.
3. **Isolated backend** for the public tool surface (own Lambda + own DynamoDB table), sharing the existing cert / CloudFront / API Gateway but **not** the finance Lambda or finance table.
4. **Module scaffolding** so subsequent freetools.org-style tools are additive drop-ins.

Later phases (do not build in Phase 1): additional tool modules (e.g. converters, formatters, generators), per-tool analytics dashboards, custom aliases UI.

---

## 2. Decisions already locked (do not relitigate)

- **Repo:** build **in this repo** (`funkedupshift`), not a bespoke repo. Reuse one ACM cert, one CloudFront setup, one API Gateway. — *chosen 2026-07-16.*
- **Isolation:** the public tools/shortener surface gets its **own Lambda + own DynamoDB table**. Public anonymous traffic must never share execution context or keyspace with the personal-finance module/data. This is the security boundary — respect it.
- **Codes are global and domain-agnostic.** `fus.fyi/<code>` and `e9.cx/<code>` resolve to the **same** destination. The domain is pure branding/vanity and is fully interchangeable. Resolution never depends on which host was used.
- **Cost framing:** the goal is **one backend + one cert**, *not* "one CloudFront distribution." CloudFront distributions have no base fee — request/data cost is identical across 1 or N distros. Do not contort the design to avoid a second distribution if one is ever cleaner; do reuse the backend.

---

## 3. Current-state facts (verified against infra on 2026-07-16)

- **Two CloudFront distributions** (`aws_cloudfront_distribution.staging`, `.production` in `infra/cloudfront.tf`), each with a **single S3 website origin**. API Gateway is **not** behind CloudFront today.
- The React SPA calls **API Gateway directly** via a `window.API_BASE_URL` global (see `src/web/spa/src/**`).
- **One ACM cert** (`aws_acm_certificate.main`, us-east-1) already covers `funkedupshift.com`, `*.funkedupshift.com`, `funkedupshift.ca`, `*.funkedupshift.ca`.
- **One HTTP API Gateway** (`aws_apigatewayv2_api.main`, route-per-endpoint) → one Python Lambda (`aws_lambda_function.api`, `src/lambda/api/handler.py`) → single-table DynamoDB, Cognito JWT authorizer.
- Route 53 hosted zones exist for `.com` and `.ca` (`aws_route53_zone.com`, `.ca`). Domains driven by `var.domainCom` / `var.domainCa` / `var.stagingSubdomain`.
- Branch model: `development` → staging, `main` → production, deploy via GitHub Actions on push. (See `docs/ci-cd-and-environments.md`.)

**New domains to introduce:** `fus.fyi`, `e9.cx` (shortener front doors) and `echo9.net` (second tools brand).

---

## 4. Target architecture

### 4.1 Domains & certificate
- Add `fus.fyi`, `e9.cx`, `echo9.net` (plus `www.` / `*.` as wanted) to the existing cert as **SANs**, or a second us-east-1 cert if SAN count/DNS-zone ownership makes that cleaner *(default — extend existing cert)*.
- Add Route 53 hosted zones for the new domains **if** their DNS is to be managed here. **Open question — confirm where `fus.fyi`, `e9.cx`, `echo9.net` DNS currently lives** before wiring zones/validation.

### 4.2 CloudFront routing (host-based)
CloudFront cache behaviors match on **path only, not host**. To serve shortener domains and the tools app from one distribution, add a **CloudFront Function** (viewer-request) that branches on the `Host` header:
- `Host ∈ { fus.fyi, e9.cx }` → **shortener redirect** behavior.
- everything else (`funkedupshift.*`, `echo9.net`, `www.*`) → **tools SPA** (S3 origin, existing behavior).

Add the new domains as **aliases** on the production distribution (and staging equivalents on a staging host such as `stage.fus.fyi` *(default — overridable)*).

### 4.3 Shortener resolution (hot path — edge, no Lambda)
- Store `code → { url, meta }` in a **CloudFront KeyValueStore**.
- The CloudFront Function looks up the code and returns a **301** at the edge. **No Lambda / API Gateway hit on redirect.** This is the cheap, fast path and the whole reason the design favors edge KV.
- Cache/'404' behavior: unknown code → serve a branded 404 (redirect to a tools-site landing *(default — overridable)*).

### 4.4 Mint path (write — isolated backend)
- **New Lambda** (`src/lambda/tools/`) with its **own IAM role**, scoped only to its own table + the KeyValueStore write API. It must **not** have access to the finance table or finance resources.
- New **API Gateway routes** on the existing `main` API (e.g. `POST /s` to mint, `GET /s/{code}` for metadata/preview) → integrate to the tools Lambda. Auth: minting requires an authenticated user (Cognito) *(default — overridable)*; public resolution is edge-only and unauthenticated.
- **New DynamoDB table** for tool data + short links (source of truth; KeyValueStore is the read-optimized projection). Own table, not the single finance/app table.

### 4.5 Data model (shortener)
- **One flat, global code namespace.** Table PK = `code` (no brand prefix). KeyValueStore key = `code`.
- Code generation: random base62 (length ~7 *(default — overridable)*), collision-check on write; **global uniqueness enforced** (not per-brand). Any future custom-alias feature enforces the same global uniqueness.
- Record which brand/host **created** a code as metadata (analytics/demos only) — this **never** affects resolution.
- Write flow: mint → write DynamoDB (source of truth) → upsert KeyValueStore (edge projection). Keep them reconcilable (a backfill/repair path from table → KV).

### 4.6 Module pattern (for the freetools.org buildout)
- Each tool is a self-contained SPA feature under `src/web/spa/src/features/tools/<tool>/`, plus optional API route(s) on the tools Lambda.
- **Behavior is identical on every domain; the host only swaps branding chrome.** One backend, host-swappable skin. "More modules to come" = additive features, no infra churn per tool.

---

## 5. Guardrails

1. **Isolation is non-negotiable:** tools Lambda + tools table are separate from finance resources; tools IAM role cannot reach finance data. No shared execution context between public traffic and finance data.
2. **Additive only:** existing modules (Finances, Investing, Websites, etc.) must not change behavior. Existing CloudFront behavior for `funkedupshift.*` must be preserved.
3. **No secrets in git;** follow existing conventions (`variables.tf` `sensitive = true` + gitignored `terraform.tfvars`). Don't commit `__pycache__`, `dist/`, `node_modules/` churn.
4. **Branch/deploy:** work on `development` (auto-deploys staging). Adam verifies on staging before `main`. Do not push/merge `main`.
5. **Green gates before push:** `pytest src/lambda/tests/` (respecting known pre-existing failures), route-coverage test, and `npm run build` in `src/web/spa` all clean.

---

## 6. Suggested build order (Phase 1)
1. Cert SANs + Route 53 zones for new domains (confirm DNS ownership first).
2. DynamoDB tools table + KeyValueStore + tools Lambda + IAM role (Terraform).
3. CloudFront Function (host branch + edge redirect) + aliases on the distribution.
4. Mint API routes → tools Lambda; write-through to table + KV.
5. Shortener SPA module (mint UI) wired into `funkedupshift.com/ca` and `echo9.net/ca`.
6. End-to-end verify on staging: mint on both brands, resolve on both short domains, confirm interchangeability and global uniqueness.

---

## 7. Open questions to resolve before building
- **DNS ownership** of `fus.fyi`, `e9.cx`, `echo9.net` — Route 53 here, or elsewhere? Drives cert validation and zone wiring.
- **Staging shortener host** — e.g. `stage.fus.fyi`, or test via the raw CloudFront domain?
- **Minting auth** — authenticated users only, or a public/anonymous mint with rate limiting?
- **Code length / custom aliases** — default length, and whether Phase 1 includes user-chosen aliases.
- **Second cert vs. SANs** — depends on SAN count and per-zone DNS control.
