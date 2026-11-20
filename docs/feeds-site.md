# feed.e9.cx — feeds reader + Mox summary archive

Status: **design agreed, not started** (2026-11-19). Ticket: FUNK-99. This doc is the build brief:
a fresh session on another machine should be able to start from here without
re-running the exploration. Follow the delegation protocol in `CLAUDE.md`
(lead + Sonnet sidekick, feature branch → PR → `development`, fresh-context review).

---

## 1. Goal

A personal feed reader at **https://feed.e9.cx**, backed by the fus API and
gated by fus Cognito:

- Add **RSS / Atom / JSON Feed** sources by URL.
- Receive the **Mox agent's daily summaries** (OpenClaw) as first-class feeds,
  so there is a browsable archive of every daily run.
- Flow: **select feed → select day → view that day's items with clickable links.**
- **Star** any item; a Starred view lists them.
- Default view is the **list of feeds**; feeds are **pinnable** (same UX as
  modules in fus — pinned first).
- Single user (me) for now, but **data model must be multi-tenant ready**
  (everything keyed by Cognito `sub`; no "owner" env var shortcuts).

### Decisions already made (don't re-litigate)

| Decision | Choice |
|---|---|
| Hostname | `feed.e9.cx` is the target hostname (new site, not a reference) |
| Tenancy | Per-user data model; only one user today |
| Auth (UI) | fus Cognito (same user pool / hosted UI as fus and tools.e9.cx) |
| Auth (Mox publishing) | Per-user **API key** against the existing fus API (`X-Api-Key`) |
| Backend placement | New **isolated feature module** `src/lambda/feeds/`, routes on the existing fus HTTP API |
| Frontend placement | **Standalone Vite app** `src/web/feed-site/`, cloned from the `tools.e9.cx` template |
| OpenClaw changes | Made in the **live** `~/.openclaw` install, never in the `openclaw-home` backup repo (it's an automated snapshot; edits get overwritten) |

---

## 2. Background facts (from exploration — verified 2026-11-19)

### 2.1 Mox's daily runs (OpenClaw)

Mox = OpenClaw agent `main` (config `~/.openclaw/openclaw.json` →
`agents.entries.main`, workspace `~/.openclaw/workspace/main`).

**Correction to the original ask:** the daily runs do **not send email**. They
*read* mail/Todoist/calendar and post a summary to **Slack**. Three daily crons
(America/Los_Angeles, `sessionTarget: isolated`, `kind: agentTurn`):

| Cron name | Schedule | What it summarises | Delivered to |
|---|---|---|---|
| `todoist-daily-morning-summary` | `30 6 * * *` | Todoist overdue/today/7-day/inbox; every bullet is a Todoist link | Slack `#claw-mox` |
| `jinks-email-daily-morning-summary` | `30 7 * * *` | Personal inbox triage (ACTION / FYI / NOISE), calendar sync line, events line (+ separate events message with ticket links) | Slack `#claw-mox` |
| `family-email-daily-digest` | `45 7 * * *` | Family mailbox + calendar digest | Slack `#family-email` (jinks-crew workspace) |

- Inspect live definitions: `openclaw cron list` (source of truth is the
  `cron_jobs` table in `~/.openclaw/state/openclaw.sqlite`; prompt text is
  `payload.message`). Backup copy: `openclaw-home/automations/cron_jobs.json`.
- Output format is **Slack mrkdwn** (`*bold*`, `<url|text>` links, `•` bullets),
  delivered by the cron's `announce` mode.
- Mox can make HTTP calls: `exec` + `curl` is already used (Todoist API calls;
  token read from `~/.openclaw/todoist.token`). That is the pattern for publishing.
- Other agents' digests (out of scope for v1, easy follow-ups as more push feeds):
  Rally `squash-email-digest`, qwer `qwer-daily-newsletter` (qwer already writes
  `digest-*.html` files in `~/.openclaw/workspace-qwer/`).

**Backfill sources:** `openclaw cron runs <jobId> --json` has a `summary` field
with the posted text but retention is only a few days. Run receipts in sqlite are
metadata-only. **The realistic backfill source is Slack history** of
`#claw-mox` and `#family-email` (back to ~2026-09-20; family from ~2026-10-31).

### 2.2 funkedupshift patterns to copy

**Isolated module template** — `src/lambda/tools/` + `infra/tools.tf`, and
`src/lambda/social/` + `infra/social.tf` (richer: `routes.py` dispatch,
single-table `PK`/`SK`, sparse GSIs, maintenance Lambda with cron).

- Routing: literal if-chain `if method == "POST" and path == "/x"` (social uses
  `routes.py`). User id from `event.requestContext.authorizer.jwt.claims["sub"]`.
- Infra per module: own DynamoDB table, `archive_file` zip (excludes
  `api/** mcp/** thumb/** tests/**`), own IAM role scoped to its own table only,
  own Lambda (python3.13), shared `aws_apigatewayv2_integration` on
  `aws_apigatewayv2_api.main`, one `aws_apigatewayv2_route` per route with
  `authorization_type = "JWT"` + `aws_apigatewayv2_authorizer.cognito.id`,
  `aws_lambda_permission`.
- **`src/lambda/tests/test_route_coverage.py`**: add the new handler/routes file
  to `HANDLERS`. It regex-matches `method == "X"` and `path == "/y"` **on the same
  line** and requires `route_key = "X /y"` in `infra/*.tf`. A missing route = 404
  without CORS = "Failed to fetch" in the browser.

**Scheduled Lambdas:** `aws_cloudwatch_event_rule` + `_target` +
`aws_lambda_permission` (principal `events.amazonaws.com`). Examples:
`collector_daily` in `infra/main.tf`, `socialReconcile` in `infra/social.tf`
(constant input `{ job = "..." }`, handler dispatches on `job`). Stagger times
vs existing 06:00 / 06:15 / 06:30 UTC jobs.

**Python deps in a layer:** pattern is `null_resource.tools_crt_layer` in
`infra/tools.tf` (pip install into `build/.../python`, zip,
`aws_lambda_layer_version`). See gotchas §6.

**Standalone subdomain site template — `tools.e9.cx`:**
- `aws_s3_bucket.toolsSite` + `aws_cloudfront_distribution.tools_site`
  (`aliases = ["tools.e9.cx"]`) in `infra/tools.tf`; outputs bucket name +
  distribution id/domain for the manual DNS record.
- ACM cert (us-east-1, imported in `infra/tools.tf`) already covers
  **`*.e9.cx`** → `feed.e9.cx` needs no new cert.
- DNS for e9.cx is **ClouDNS (manual)**, not Route 53.
- Frontend: `src/web/tools-site/` (own Vite app, own `api.ts`, uses
  `window.auth.getAccessToken` from `src/web/auth.js`).
- CI: `.github/workflows/dev.yml` (~L108–134) builds it, writes `config.js` with
  placeholder substitution (API URL etc. from terraform outputs), `aws s3 sync`,
  CloudFront invalidation. Mirror this for feed-site (and the prod workflow).
- Cognito hosted-UI callback/logout URLs must include the new hostname (see
  `docs/custom-domains.md`, `docs/cognito-setup.md`).

**fus module registry + pins** (for the fus launcher tile, and as the UX model
for feed pinning):
- `src/web/spa/src/config/modules.ts` → `PUBLIC_MODULES` (fields: `id, label,
  path, section, minRole, visibility?, authOnly?, group, icon, description,
  launcher?`).
- `src/web/spa/src/hooks/usePins.ts` (optimistic, localStorage cache, debounced
  `PUT /profile {pins}`); `components/AppPage.tsx` `PinButton`;
  `features/home/Dashboard.tsx` renders pinned modules.
- Backend `validate_profile_prefs` doesn't check ids against the registry → a
  new module id needs no backend change.

**Machine-to-machine auth today:** only `POST /mcp` with a single env bearer
token (`MCP_BEARER_TOKEN`, `hmac.compare_digest`, route without JWT authorizer).
No per-user keys exist. CORS already allows the `X-Api-Key` header.
**Do not copy the single-env-token approach** — it isn't multi-tenant.

**No feed-parsing deps exist** (`feedparser` absent).

---

## 3. Design

### 3.1 Data model — table `fus-feeds` (single-table, `PK`/`SK`)

| Entity | PK | SK | Notes |
|---|---|---|---|
| Feed (subscription) | `USER#{sub}` | `FEED#{feedId}` | `title, kind (rss\|atom\|json\|push), url?, siteUrl?, pinned (bool), sortOrder, createdAt, lastFetchedAt, lastError?, etag?, lastModified?` |
| Item | `FEED#{feedId}` | `DAY#{yyyy-mm-dd}#ITEM#{itemHash}` | `title, link, summary/contentHtml, author?, publishedAt, fetchedAt, guid`; day = published date in the **user's timezone** (default America/Los_Angeles; store tz on user/feed) |
| Day index | `FEED#{feedId}` | `DAYIDX#{yyyy-mm-dd}` | `count` — cheap "which days have items" query for the day picker |
| Star | `USER#{sub}` | `STAR#{starredAt}#{feedId}#{itemHash}` | denormalised `title, link, feedTitle` so Starred view is one query |
| Star lookup | `USER#{sub}` | `STARREF#{feedId}#{itemSk}` | O(1) "is this starred?" + unstar |
| Seen | `USER#{sub}` | `SEEN#{seenAt}#{feedId}#{itemHash}` | FUNK-100; same denormalised fields as Star so the Seen view is one query |
| Seen lookup | `USER#{sub}` | `SEENREF#{feedId}#{itemSk}` | O(1) "has this been looked at?" + unmark (fetched in the *same* batch-get as `STARREF#`) |
| API key | `USER#{sub}` | `APIKEY#{keyId}` | `name, prefix, createdAt, lastUsedAt, revoked` (never the raw key) |
| API key lookup | `APIKEYHASH#{sha256}` | `META` | `sub, keyId` — ingest resolves key → user in one GetItem |

- `itemHash` = sha256 of (guid or link or title+published), truncated — dedupe key.
- Feed ownership: every read/write of `FEED#{id}` partitions must first verify
  `USER#{sub}/FEED#{id}` exists (no cross-tenant reads by guessing ids).
- GSI `byFetchDue` (sparse: only polled feeds): `fetchKey = "POLL"`,
  `nextFetchAt` — fetcher queries due feeds without scanning.
- Optional TTL on items (e.g. 400 days) — leave off for Mox push feeds (archive).
- Any numeric non-int written → `Decimal(str(v))` (gotcha: boto3 rejects float;
  MagicMock tests won't catch it — assert types).

### 3.2 API (on existing fus HTTP API; JWT unless noted)

| Method + path | Purpose |
|---|---|
| `GET /feeds` | list my feeds (pinned first, then sortOrder/title) |
| `POST /feeds` | add feed `{url}` → fetch+detect kind (rss/atom/json), title; or `{kind:"push", title}` |
| `PUT /feeds/{id}` | rename, pin/unpin, reorder |
| `DELETE /feeds/{id}` | delete feed + its items (batch delete) |
| `POST /feeds/{id}/refresh` | fetch now |
| `GET /feeds/{id}/days` | list days with items (+counts), newest first, paginated |
| `GET /feeds/{id}/days/{day}` | items for that day |
| `GET /feeds/stars` | my starred items, newest first, paginated |
| `PUT /feeds/stars` | star `{feedId, itemSk}` |
| `DELETE /feeds/stars` | unstar `{feedId, itemSk}` |
| `GET /feeds/seen` | my seen (looked-at) items, newest first, paginated |
| `PUT /feeds/seen` | mark seen `{feedId, itemSk}` |
| `DELETE /feeds/seen` | unmark seen `{feedId, itemSk}` |
| `GET /feeds/keys` / `POST /feeds/keys` / `DELETE /feeds/keys/{keyId}` | manage API keys; POST returns raw key **once** |
| `POST /feeds/ingest` | **no JWT; `X-Api-Key`**. Body `{feed: "mox-todoist", title?, date?, items:[{title, link?, contentMarkdown?|contentHtml?, guid?, publishedAt?}]}` → auto-creates push feed by slug for the key's user; idempotent on guid |

Notes:
- Literal routes (`/feeds`, `/feeds/stars`, `/feeds/seen`, `/feeds/keys`, `/feeds/ingest`) must
  be written as `method == "X" and path == "/y"` on one line so
  `test_route_coverage.py` sees them; each needs an `aws_apigatewayv2_route`.
  Path-param routes use `{id}` route keys in terraform.
- `/feeds/ingest` route: `authorization_type = "NONE"`; validate key by
  sha256 lookup + `hmac.compare_digest`; update `lastUsedAt`; size limits
  (e.g. ≤100 items, ≤256 KB body); rate-limit-ish guard.
- Fetching user-supplied URLs = **SSRF surface**: http/https only, resolve and
  reject private/link-local/metadata IPs (169.254.169.254 etc.), timeouts
  (connect 5s / total 10s), max response size (~5 MB), max redirects 3.
- Sanitise item HTML before storing or on render (allowlist tags; strip
  scripts/handlers; links `rel="noopener noreferrer" target="_blank"`).
- Slack mrkdwn from Mox: convert `<url|text>` → links, `*bold*`, `•` bullets →
  safe HTML (server-side on ingest, or client-side renderer — pick one, test it).

### 3.3 Fetcher

- Separate Lambda (or `job: "poll"` on the feeds Lambda) on EventBridge,
  **hourly** (`cron(7 * * * ? *)` — off the hour, away from existing jobs).
- Query `byFetchDue` for feeds due; per feed: conditional GET (ETag /
  Last-Modified), parse with **`feedparser`** (RSS/Atom) or `json` (JSON Feed
  1.1), upsert items with conditional put (dedupe), bump `DAYIDX` counts,
  set `nextFetchAt`, record `lastError` + backoff on failure.
- Bounded concurrency and per-invocation time budget (Lambda timeout ~5 min).

### 3.4 Frontend — `src/web/feed-site/` at feed.e9.cx

Clone the tools-site structure (Vite, own `api.ts`, `config.js` placeholders,
shared `src/web/auth.js` for Cognito).

- **Home = feed list.** Pinned feeds first (pin toggle like fus `PinButton`),
  unread/new-today count, last updated, error badge. "Add feed" (URL) dialog.
- **Feed view:** day picker (date strip of days that have items, from
  `/days`; jump-to-date calendar), newest day selected by default.
- **Day view:** items with clickable title links (open in new tab), source
  snippet / rendered Mox summary, star toggle on each item.
- **Starred view.**
- **Settings:** API keys (create → show once with copy button; revoke; last used).
- Mobile-first layout (phone width, no horizontal scroll); light/dark.
- Signed-out → Cognito hosted UI.

**fus side:** add a `PUBLIC_MODULES` entry (`id: "feeds"`, `authOnly: true`,
external link to `https://feed.e9.cx`, group `tools`) so it can be pinned on the
fus dashboard. Check how the registry handles external URLs (tools.e9.cx may
already have precedent); if not, add minimal support.

### 3.5 OpenClaw / Mox wiring (last phase)

1. Create an API key in feed.e9.cx settings → save to `~/.openclaw/feeds.token`
   (chmod 600; same pattern as `todoist.token`). Never commit it, never put it
   in the backup repo's secrets in plaintext.
2. Append a final step to each of the three cron prompts (edit the **live**
   cron via `openclaw` CLI, not the backup JSON): *after the Slack post
   succeeds*, publish the same summary text:
   ```bash
   curl -sS -X POST "$FEEDS_API/feeds/ingest" \
     -H "X-Api-Key: $(cat ~/.openclaw/feeds.token)" \
     -H "Content-Type: application/json" \
     --data @/tmp/mox-feed-payload.json
   ```
   with payload `{feed: "mox-todoist" | "mox-jinks-email" | "mox-family-email",
   title: "Mox · <name>", items: [{guid: "<job>-<yyyy-mm-dd>", title:
   "<name> — <date>", contentMarkdown: "<the posted Slack text>"}]}`.
   Publishing failure must **not** fail the run or block the Slack post — log
   and continue.
3. Verify next morning: three items appear under their feeds for today.
4. Let the 04:15 `openclaw-backup.sh` job carry the prompt changes into
   `openclaw-home` naturally.

### 3.6 Backfill (optional)

Script (not a Lambda) that reads Slack history of `#claw-mox` and
`#family-email` since 2026-09-20, classifies each Mox post into the three feeds
(by header/shape), and POSTs to `/feeds/ingest` with `guid = <job>-<date>` and
`publishedAt` = post time. Idempotent so it can be re-run.

---

## 4. Build plan (phases → one branch/PR each)

Every phase: branch `feature/FUNK-<n>-<slug>` off `development`, PR →
`development`, PR Check green, **fresh-context review** (CLAUDE.md), then merge.
**Infra caveat:** staging and prod share one terraform state; merging infra to
`development` applies it live (incl. prod). Keep phase 1 infra additive only.

### Phase 1 — backend module (`src/lambda/feeds/`, `infra/feeds.tf`)

```
TASK:        Build the isolated feeds module: table, Lambda, API routes, API keys,
             ingest endpoint, hourly fetcher — per docs/feeds-site.md §3.1–3.3.
CONSTRAINTS: Follow tools/ & social/ module patterns (own table + IAM role scoped
             to it, shared API integration, JWT authorizer except /feeds/ingest).
             feedparser via a layer AND requirements-test.txt (gotcha §6.1, §6.2).
             Multi-tenant: every query scoped by Cognito sub; ownership check on
             FEED# partitions. Decimal for non-int numbers. Additive infra only.
EDGE CASES:  duplicate items across polls; feeds with no guid; JSON Feed vs
             RSS vs Atom autodetect; malformed XML; 304 Not Modified; SSRF
             (private IPs, redirects to private IPs, file:// etc.); huge
             responses; ingest with bad/revoked key (401), oversize body (413),
             re-ingest same guid (no dupes); cross-user feedId access (404);
             timezone day bucketing around midnight LA.
TESTS:       src/lambda/tests/test_feeds_*.py — parsing (rss/atom/json fixtures),
             dedupe, day bucketing, ownership, API key create/hash/revoke/ingest,
             SSRF guard, routes; test_route_coverage.py updated and green.
             Assert Decimal types on writes.
DONE MEANS:  .venv/bin/python -m pytest src/lambda/tests -q fully green;
             terraform validate passes; route coverage passes.
REPORT BACK: diff + test results BEFORE committing.
```

### Phase 2 — feed.e9.cx site (`src/web/feed-site/` + infra + CI)

```
TASK:        Standalone Vite app at feed.e9.cx per §3.4, plus S3+CloudFront
             (clone tools_site), CI build/sync/invalidate in dev + prod workflows,
             fus PUBLIC_MODULES tile.
CONSTRAINTS: Reuse src/web/auth.js Cognito flow; config.js placeholders like
             tools-site; keep async-load ref targets mounted (gotcha §6.4);
             phone-width safe; light/dark.
EDGE CASES:  no feeds yet (empty state + add CTA); feed with error; day with 0
             items; very long Mox summaries; star/unstar optimistic revert on
             failure; signed-out redirect; API key shown once.
DONE MEANS:  feed-site builds in CI; fus `npm run build` green; manual check on
             staging after DNS + Cognito callback steps.
REPORT BACK: diff + build output BEFORE committing.
```

**Manual steps (owner):**
- ClouDNS CNAME `feed.e9.cx` → CloudFront distribution domain (terraform output).
- Add `https://feed.e9.cx` (callback + sign-out) to the Cognito app client
  (or via terraform if that's how callbacks are managed — check
  `docs/cognito-setup.md`).

### Phase 3 — Mox wiring (§3.5), then optional backfill (§3.6)

Done in the OpenClaw install on the machine that runs OpenClaw (not
necessarily the build machine). Use the `openclaw-*` skills for safety checks.

---

## 5. Open questions (decide during build, default in brackets)

- Polling interval per feed configurable? [no — hourly global, v1]
- Item retention for polled feeds? [keep forever v1; add TTL later]
- Read/unread tracking? [landed in FUNK-100: per-item server-side `seen` markers,
  an exact structural parallel of stars (`SEEN#`/`SEENREF#` rows per Cognito sub,
  `GET|PUT|DELETE /feeds/seen`); items expose `seen` alongside `starred`]
- Should qwer/Rally digests also push? [later — just new feed slugs]

---

## 6. Gotchas that apply here (from CLAUDE.md — re-read it)

1. New Python deps need **two homes**: the Lambda layer **and**
   `src/lambda/requirements-test.txt`.
2. `aws_lambda_layer_version` doesn't republish on zip rebuild — tie
   `source_code_hash` to the requirements trigger.
3. `gh run watch | tail` hides failures — check `gh run view --json conclusion`.
4. React: a ref target used by an async load handler must stay mounted.
5. MagicMock DynamoDB tests don't exercise boto3's serializer — `Decimal`, assert types.
6. When pinning an external contract (feed formats, ingest payload from Mox),
   test against real samples, not strings your code built.
7. zsh doesn't word-split unquoted vars — inline AWS flags.
