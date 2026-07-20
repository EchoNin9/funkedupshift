# Tools Platform Phase 2 — Handoff & Build Instructions

**Written 2026-07-18 at the end of the phase-1/tools.e9.cx sessions.** Read
alongside `docs/tools-platform-phase1-handoff.md` (prior state), repo
`CLAUDE.md` (delegation workflow), and `.claude/skills/agent-delegate/`.
Everything in "State of the world" is verified live in production — do not
redo it. The numbered sections under "Build next" are the phase-2 scope.

---

## State of the world (verified, do not redo)

- **URL shortener** live on `fus.fyi` + `e9.cx` (+ `stage.fus.fyi`):
  isolated `fus-tools` Lambda (own role/zip, awscrt layer), `fus-tools`
  DDB table, CloudFront KVS, edge function
  `infra/cloudfront-functions/shortener-redirect.js`. Routes
  `POST/GET /s`, `GET|DELETE|PATCH /s/{code}` (Cognito JWT). FUNK-34 Done.
- **tools.e9.cx standalone site** live: `src/web/tools-site/` (own
  Vite+React app), `fus-tools-site` bucket + CloudFront `EF7OQ9243WH50`
  (`drhbn7kecev7u.cloudfront.net`), alias `tools.e9.cx`, shared `*.e9.cx`
  cert. Deployed by `.github/workflows/dev.yml` ONLY (env-shared — a push
  to `development` updates the LIVE site). FUNK-36 Done.
- **Two frontends, one backend** is the established pattern: each tool has
  a feature page in the SPA (`src/web/spa/src/features/<tool>/`) AND a card
  + view in the tools-site (`src/web/tools-site/src/App.tsx`). UI code is
  deliberately duplicated (different skins); request/response *shapes* are
  mirrored by hand in each app's local `api.ts`. Don't import across apps.
- **Auth:** both frontends use the same Cognito pool AND the same app
  client via the `window.auth` bootstrap (`src/web/auth.js`, copied into
  each dist at deploy; config placeholders inline in each `index.html`,
  sed-replaced by CI). tools-site gates every tool card: grayed + lock
  until signed in. No anonymous tool use (Adam's decision — kills the
  abuse/rate-limit problem).
- **Branding:** tools-site rewrites minted `fus.fyi` shortUrls to `e9.cx`
  client-side (`brand()` in `src/web/tools-site/src/api.ts`). Backend
  `SHORT_DOMAIN` stays `fus.fyi`.
- `e9.cx/` (bare root) 302s → `https://tools.e9.cx/`; `fus.fyi/` →
  funkedupshift.com. Host-checked in the edge function.
- **Open ticket:** FUNK-35 (decommission legacy us-west-2 shortener stack)
  — console/CLI work, not repo work.

## Hard-won gotchas (each of these cost a failed CI run or a review catch)

1. **S3 public bucket policy races BlockPublicPolicy** on first apply —
   `aws_s3_bucket_policy` needs `depends_on = [aws_s3_bucket_public_access_block.X]`
   or the PUT 403s. (Bit us on `fus-tools-site`.)
2. **CI's IAM policy allowlists exact named ARNs** —
   `data.aws_iam_policy_document.terraformManage` in `infra/main.tf`. Any
   new named bucket/table/function/layer/role MUST be added there in the
   same commit or `terraform apply` fails AccessDenied mid-apply (state
   half-created, messy).
3. **`test_route_coverage.py` cross-checks handler dispatches against
   `route_key`s in ALL `infra/*.tf`** — new API routes must land in both
   places or pytest fails.
4. **API GW CORS:** `allow_origins` is `["*"]` (no per-origin work needed),
   but `allow_methods` in `infra/main.tf` is an explicit list — check it
   when adding a new HTTP method (PATCH was once missing).
5. **Env-shared infra deploys live from `development`.** There is no
   staging for the tools platform. The shortener distro, edge function,
   and tools-site all go live on a dev push. Merge to `main` only rolls
   out the funkedupshift.com SPA.
6. **Repo hygiene:** `src/web/spa` tracks `node_modules` (10k+ files) and
   `dist` in git — pre-existing mess, do NOT copy it. `src/web/tools-site`
   has a proper `.gitignore`; keep it that way for anything new.
7. **Tests:** backend `python3.13 -m pytest src/lambda/tests -q` — 2
   pre-existing PIL failures in `test_api_handler.py` are the baseline.
   Frontend gate is `npm run build` (both apps), NOT `npm run typecheck`.
8. **The tools Lambda is isolated by design** (own role, own zip) — a hard
   guardrail from the phase-1 brief. Do NOT share the finance/api Lambda's
   role or zip. New tool backends go in `src/lambda/tools/`.
9. **CloudFront function runtime is js-2.0**: `kvs.get()` returns a
   Promise (handler must be async), use `secrets` not `random` idioms
   where applicable, KVS comment fields have a 128-char API limit.
10. **DNS for all tool domains is external** (ClouDNS, `pns1.cloudns.net`).
    Adam adds records by hand; Terraform only outputs targets. Any new
    hostname = a terraform output + a message to Adam.

## Process (how these sessions actually ran — follow it)

- **Delegation protocol** (CLAUDE.md): lead on the frontier model, Sonnet
  sidekicks. Recon first ("map how X works, change nothing"), then a
  spec-quality brief with constraints/edge cases/test matrix/"report diff +
  tests before committing". Recon killed two wrong assumptions in phase 1
  (thought we needed a new Cognito app client and CORS changes — needed
  neither). Cheap recon beats confident guessing.
- **Jira (FUNK project):** every work item gets a ticket — `claude` label,
  AC as a `- [ ]` checklist in the description, story points in
  `customfield_10016` (Fibonacci), transitions: To Do 11 / In Progress 21 /
  Done 31. Tick AC items as delivered; comment with commit SHAs and
  verification evidence; Done only after Adam's spot-check where one is
  listed.
- **Verify live, not just in CI:** after each deploy, curl the actual
  endpoints (status code + redirect target + bundle contents). Every claim
  in the tickets above is backed by a curl.
- Adam's manual steps (DNS records, alias detachments, staging sign-offs)
  gate everything around them — sequence your pushes so nothing goes out
  that depends on a manual step not yet done, and hand Adam exact
  record/target strings.

---

## Build next (phase-2 scope, in Adam's words + design guidance)

Every tool below must be usable in BOTH frontends (SPA feature page + nav
entry in `src/web/spa/src/config/modules.ts`, AND a card + view in
tools-site replacing one of the "coming soon" placeholders or adding new
cards). Auth-gated like the shortener. One FUNK ticket per tool.

### 1. DNS lookup tool (mxtoolbox-style)

- Look up **all common record types** for a domain: A, AAAA, CNAME, MX,
  TXT, NS, SOA, SRV, CAA, PTR (reverse), DNSKEY/DS if cheap. `ANY` is
  widely blocked upstream — query types individually and offer an
  "all types" mode that fans out.
- Needs a backend (browsers can't do raw DNS): add routes to the
  `fus-tools` Lambda, e.g. `GET /tools/dns?name=<domain>&type=<TYPE>`.
  Python stdlib can't do arbitrary record types — add `dnspython` to the
  tools Lambda zip (isolated zip, so no blast radius). Set a short
  resolver timeout and return structured JSON (record, TTL, value).
- Validate/normalize input server-side (it's a trust boundary): reject
  non-domain input, cap label length, strip trailing dots. Rate concern is
  low (auth-gated) but don't build an open resolver: only answer for the
  query the user typed, no recursion options.
- Remember gotchas #2 (no new named resources needed here), #3 (route
  coverage test), #4 (GET already allowed).

### 2. Imaging: downsize + crop

- Scope for now: **reduce filesize** (target-size or quality slider) and
  **crop**. Nothing else.
- Build it **fully client-side** (Canvas API: crop via drawImage, encode
  via `canvas.toBlob("image/jpeg"|"image/webp", quality)`; binary-search
  quality to hit a target filesize). No upload, no backend, no storage —
  faster, private, and zero infra. State this in the UI ("images never
  leave your browser") — it's a feature.
- If a future need forces server-side processing, the api Lambda already
  ships PIL (`fus-pillow-layer`) — but do not wire the tools UI to the
  api Lambda now (guardrail #8).

### 3. Text sharing by unique URL

- Mint a paste → unique URL; **expiry settable** (delete-now button,
  default 1 week). Same UX skeleton as the shortener's list/delete/expiry.
- **Hard requirement: data at rest must be stored in Canada.** The
  existing stack is NOT in ca-central-1, so this needs:
  - A new DynamoDB table in **ca-central-1** (new `provider` alias block
    in Terraform — first multi-region resource in this repo; plus gotcha
    #2: add the table ARN to the IAM allowlist, noting the region in the
    ARN).
  - The fus-tools Lambda can call ca-central-1 DDB cross-region (data at
    rest lands in Canada; Lambda region is compute, not storage). Encrypt
    at rest with the default DDB SSE at minimum.
  - DDB TTL for expiry (like the shortener), plus creator-only DELETE.
- **Read path is public by design** (share-by-URL): the view route must
  work WITHOUT auth. That means one API GW route with no JWT authorizer
  (e.g. `GET /tools/text/{id}`) — a first for this API; keep the response
  minimal (content + expiry) and make IDs long random (128-bit+,
  `secrets`-grade) so URLs aren't guessable. Mint/list/delete stay authed.
- Frontend: viewer page in both frontends (`/t/<id>` or similar). The SPA
  route must be reachable unauthenticated (check `modules.ts` gating —
  most routes assume auth).
- **File sharing (LATER, unless it falls out nearly free):** same expiry
  semantics, S3 bucket in **ca-central-1** (same at-rest rule), presigned
  PUT/GET, lifecycle rule aligned to expiry. It is NOT free (new bucket +
  IAM + lifecycle + size limits + content-type policing) — recommend
  shipping text-only first and designing the DDB item shape so a
  `kind: text|file` field can be added without migration. If Adam pushes
  for it now, treat it as its own ticket.

### 4. Password generator

- Copy the standard playbook (any of the many existing generators):
  length slider, char-class toggles (upper/lower/digits/symbols),
  exclude-ambiguous option, copy button, strength/entropy readout.
- **Client-side only, `crypto.getRandomValues`** (never `Math.random`).
  Zero backend, zero storage, nothing ever transmitted — say so in the UI.
- Rejection-sample per character or use modulo-unbiased selection; ensure
  at least one char from each enabled class. This is the smallest tool —
  good first card to ship, and a good sidekick warm-up task.

### Sequencing suggestion

Password gen (pure client, trivial) → imaging (pure client) → DNS lookup
(first backend addition, small) → text sharing (multi-region infra + first
unauthenticated route — the only genuinely new ground). One ticket, one
sidekick brief, one deploy each; verify live between tools since
`development` pushes hit production-facing surfaces (gotcha #5).
