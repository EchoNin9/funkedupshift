# Agent Brief: Personal Finances app (Quicken B&P clone, Phase 1)

**Audience:** an autonomous Claude Code agent running start-to-finish in `--dangerously-skip-permissions` mode on this repo.
**Status:** approved by Adam (2026-07-07). Execute as written; defaults marked *(default — overridable)* may be changed only by asking Adam first.

---

## 1. Mission

Build **Phase 1** of a Quicken "Business & Personal finances" clone: the **Personal Finances** app. It **replaces the existing Financial dashboard page** (the watchlist/quotes page — the Investing module now covers tickers better). Business features (invoices, Schedule-C categories, business P&L) are **Phase 2 — do not build them**; leave the data model open to them, nothing more.

Phase 1 deliverables:

1. **Personal Finances SPA section** with four areas: **Dashboard** (net worth, balances, cash-flow summary), **Transactions** (list/search/filter/categorize + manual entry), **Budgets** (per-category with progress vs actual), **Insights** (spending breakdowns, period comparisons, cash-flow forecast).
2. **Era.app integration (hybrid, optional, read-only)** — when an Era API key is configured, Era feeds real accounts/balances/transactions/insights; without a key the app runs fully on local (DynamoDB) data. The key is a paid feature Adam may add or remove at any time — presence of `ERA_API_KEY` is the only switch.
3. **Sharing** — an owner can grant another named app user **read-only** access **per section** (dashboard / transactions / budgets / insights).
4. **Lambda MCP server** — a new lambda exposing the app's finance data (and Era read passthrough) as MCP tools over HTTP, so Adam's claude.ai / Claude Code / Claude Desktop can connect to it.
5. **AI via AWS Bedrock Claude Sonnet** for in-app insight summaries (see §7).

---

## 2. Hard guardrails (non-negotiable)

1. **Branch/deploy:** work on and push to `development` only. Never push/merge `main`. Never run `terraform apply`/`plan` against production; never touch the production workspace or `websiteProduction`/`githubProduction` resources. Pushing `development` auto-deploys staging + terraform apply via GitHub Actions — that is the only deploy mechanism you use.
2. **Era is strictly read-only, enforced in code:** the Era client module must implement *only* read/GET operations. No transaction edits, no account changes, no billing/subscription calls, no connection management. Do not add write methods "for later".
3. **Era key is optional at all times:** every Era-dependent code path checks key presence and degrades gracefully (empty state / local data). No crash, no blocked page, no failing tests when `ERA_API_KEY` is unset.
4. **AI cost caps, enforced in code:** `maxTokens ≤ 1024` per Bedrock call; exactly **one** model call per user action (no agentic loops, no retries-with-bigger-prompt, no fan-out); **no scheduled/background AI jobs**; prompt inputs truncated to a fixed char budget before the call. Claude Sonnet costs ~$3/$15 per MTok — roughly 100× Nova Micro.
5. **MCP endpoint is authenticated:** bearer token checked on every request (constant-time compare), token from a `sensitive` terraform var → lambda env. Never deploy it open. MCP tools are **read-only** *(default — overridable)*.
6. **Only additive changes to other modules.** Investing, Memes, Squash, Expenses, Websites, Media, etc. must not change behavior. The **only removal** in scope is the Financial dashboard retirement in §6.
7. **No secrets in git.** Keys go in `variables.tf` (`sensitive = true`) + `terraform.tfvars` (gitignored) → lambda env vars. Also do not commit `__pycache__`, `dist/`, or `node_modules/` churn — stage source, tests, tf, `package.json` + `package-lock.json` only (CI runs `npm ci && npm run build` itself).
8. **Green gates before push:** `python3.13 -m pytest src/lambda/tests/` passes (exactly 2 pre-existing PIL failures in `test_api_handler.py` are expected — any other failure is yours); `test_route_coverage.py` green; `npm run build` in `src/web/spa` clean.
9. **Stop condition:** after pushing and updating Jira, **stop**. Adam verifies on staging before anything moves to Done. Do not attempt to verify against production, and do not create follow-up PRs to `main`.

---

## 3. Repo conventions (follow exactly — FUNK-18 / commit `ad3adc4` "Investing" is the freshest full-stack example)

**Lambda API** (`src/lambda/api/`):
- One dispatcher: `handler.py` → `handler(event, context)` with literal `if method == X and path == Y:` chains. Feature logic in per-feature modules (`investing.py`, `financial.py`, …), imported lazily inside handler functions.
- Responses via `jsonResponse(body, statusCode)` from `common/response.py`.
- Auth helpers in handler.py: `getUserInfo(event)` (Cognito JWT claims), `_requireAuth(event)` → `(user, err)`, custom-group checks like `_canAccessInvesting` (pattern: admin → True, else `"X" in _getUserCustomGroups(user["userId"])`).
- **Every handler route literal needs a matching `aws_apigatewayv2_route` in `infra/main.tf`** — `tests/test_route_coverage.py` statically enforces this in both directions. Authenticated routes add `authorization_type = "JWT"` + `authorizer_id = aws_apigatewayv2_authorizer.cognito.id`.
- DynamoDB: single table, env `TABLE_NAME`, low-level `boto3.client("dynamodb")` typed items, `PK`/`SK` keys. External HTTP: stdlib `urllib.request` only (see `financial.py:_fetch_json`). No new pip dependencies in lambda — stdlib + boto3 only (there is no packaging step).
- Bedrock: copy `generate_description.py:summarize_with_bedrock` mechanics — `boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))`, `client.converse(modelId=..., messages=[{"role":"user","content":[{"text": prompt}]}], inferenceConfig={"maxTokens": N, "temperature": 0.3})`.
- Tests (`src/lambda/tests/`): pytest, build API-GW-v2 event dicts with `requestContext.authorizer.jwt.claims`, call `handler(event, None)`, `@patch` at the lazy-import path (`api.<module>.<fn>`) and `@patch("api.handler._getUserCustomGroups")` for group gates. Clone `test_investing_handlers.py`.

**SPA** (`src/web/spa/`): React 18 + react-router v6 + TS + Tailwind (Neon Pop theme) + framer-motion.
- Pages: `src/features/<feature>/`, lazy-loaded + `<Route>` in `src/shell/AppLayout.tsx`.
- Nav: entry in `src/config/modules.ts` (`PUBLIC_MODULES`, and the `financial` group in `MODULE_GROUPS`); visibility helpers in `src/shell/AuthContext.tsx`.
- API calls: `fetchWithAuth` from `src/utils/api.ts`; base URL via the local `getApiBaseUrl()` helper (copy from `features/investing/InvestingPage.tsx`).
- Charts: `lightweight-charts` is already installed (used by `CandleChart.tsx`). Reuse it for line/area charts (net worth, cash flow) rather than adding a chart library. Simple bars (budget progress) are plain divs + Tailwind.
- Verify UI renders (Adam checks staging in a browser; keep CSS consistent with existing pages — copy Investing/Financial page classes).

**Jira** (FUNK project, cloudId `08b84e85-bf34-4bdf-b5f7-f07f5c826cf8`): create an **Epic** ("Personal Finances app (B&PF phase 1)") plus stories sized with Fibonacci points, each with a `- [ ]` acceptance-criteria checklist and label `claude`. Move each story to In Progress when starting (transition id 21), comment work done, tick ACs as delivered. Leave stories in In Progress with a "ready for staging verification" comment at the end — Adam moves to Done. Reference issue keys in commit messages, e.g. `feat(finances): ... (FUNK-nn)`.

**Commits:** conventional style like existing history; end with `Co-Authored-By:` trailer per repo convention.

---

## 4. Data model (DynamoDB, single table — no new tables, no new GSIs)

| Item | PK | SK | Attributes |
|---|---|---|---|
| Manual account | `USER#{id}` | `BPF#ACCOUNT#{uuid}` | `name`, `kind` (checking/savings/credit/cash/asset/liability), `balance` (N), `currency`, `updatedAt` |
| Manual transaction | `USER#{id}` | `BPF#TXN#{date}#{uuid}` | `accountId`, `date` (ISO), `amount` (N, negative = spend), `payee`, `category`, `notes`, `business` (BOOL, always false in P1 — the phase-2 hook), `updatedAt` |
| Budgets | `USER#{id}` | `BPF#BUDGETS` | `budgets`: L of M `{category, monthlyLimit}` , `updatedAt` |
| Settings | `USER#{id}` | `BPF#SETTINGS` | `categories` (L of S, seeded with sensible defaults on first write), `updatedAt` |
| Share grant (owner side) | `USER#{ownerId}` | `BPF#SHARE#{granteeId}` | `granteeEmail`, `sections` (L of S ⊆ dashboard/transactions/budgets/insights), `createdAt` |
| Share mirror (grantee side) | `USER#{granteeId}` | `BPF#SHAREDWITH#{ownerId}` | `ownerEmail`, `sections`, `createdAt` |

- Transactions SK embeds the date → date-range queries are `Query` with `begins_with`/`BETWEEN` on SK, no GSI. `# ponytail:` per-user txn volume is small; add a GSI only if scans ever hurt.
- Share grant + mirror are written/deleted **together** (two `put_item`/`delete_item` calls; per-user data volume doesn't justify transactions, but use `TransactWriteItems` if trivial). The mirror exists so "shared with me" needs no GSI.
- Grantee resolution: the sharing UI takes an email; resolve to Cognito sub via the existing Cognito admin lookup patterns in handler.py (`COGNITO_USER_POOL_ID` env; see the admin users handlers ~`getUserGroups` for the boto3 `cognito-idp` usage). Unknown email → 404, no invite flow *(default — overridable)*.

Era data is **not persisted** in DynamoDB — fetched live per request, with an in-memory (module-level) cache per lambda container, TTL ~5 min. `# ponytail:` add a DynamoDB cache item only if Era rate limits bite on staging.

---

## 5. API routes (all JWT; access = any logged-in user — see gating note)

**Gating** *(default — overridable)*: Phase 1 is **login-only** (`_requireAuth`), NOT the Financial custom group — sharing is the access-control model, and grantees may not be group members. SPA visibility: `minRole: "user"`, `authOnly: true`.

Owner routes (`src/lambda/api/bpf.py`, handler fns + dispatch in `handler.py`, tf routes in `infra/main.tf`):

| Route | Purpose |
|---|---|
| `GET /finances/overview?owner=` | Dashboard payload: accounts + balances (local ∪ Era), net worth, 30-day cash-flow in/out. `owner` optional; when set, enforce share grant for section `dashboard`. |
| `GET /finances/accounts` / `POST /finances/accounts` / `PUT /finances/accounts/{id}` / `DELETE /finances/accounts/{id}` | Manual account CRUD. |
| `GET /finances/transactions?owner=&from=&to=&q=&category=` | Merged local + Era transactions (Era ones flagged `source: "era"`, read-only). Share-gated on `transactions` when `owner` set. |
| `POST /finances/transactions` / `PUT /finances/transactions/{id}` / `DELETE /finances/transactions/{id}` | Manual transaction CRUD (local only — never Era). |
| `GET /finances/budgets?owner=` / `PUT /finances/budgets` | Budgets list (with computed month-to-date actuals per category) / replace. Share-gated on `budgets`. |
| `GET /finances/insights?owner=&period=` | Spending by category, period-vs-period comparison, naive cash-flow forecast (see below). Era insights merged in when key present. Share-gated on `insights`. |
| `POST /finances/insights/summary` | AI: Bedrock Sonnet turns the computed insights payload into a short narrative (§7). Owner-only (no `owner=` param) *(default)*. |
| `GET /finances/shares` / `PUT /finances/shares` / `DELETE /finances/shares/{granteeId}` | Owner's grants: list / upsert `{email, sections}` / revoke. |
| `GET /finances/shared-with-me` | List of `{ownerId, ownerEmail, sections}` from mirror items. |
| `GET /finances/config` | `{eraConnected: bool}` + categories — lets the SPA render Era vs empty states. |

- Forecast: **computed, not AI** — average net flow of the last 3 months projected forward. `# ponytail:` naive projection; revisit if Adam wants Era's forecast surface to drive it.
- Share enforcement helper: `_resolveFinancesOwner(event, section)` → returns `(owner_user_id, err)`; when `owner` query param present and ≠ caller, require a grant item containing `section`. Grantees get **read routes only** — mutating routes never accept `owner=`.
- Path-parameter routes (`/finances/accounts/{id}` etc.): follow the `vehicles-expenses/{id}` pattern in handler.py dispatch and its `route_key = "PUT /vehicles-expenses/{id}"` tf blocks.
- Era-backed responses must set `eraConnected` so the UI can label live vs local data.

---

## 6. Retiring the Financial dashboard (the only removal in scope)

- **SPA:** delete routes + lazy imports for `features/financial/FinancialPage.tsx` and `features/financial/admin/FinancialAdminPage.tsx` from `AppLayout.tsx`; remove `financial` and `financial-admin` entries from `PUBLIC_MODULES` and the "Financial Dashboard"/"Financial Admin" links from `MODULE_GROUPS` (add "Finances" + keep "Investing"); remove the `financial` ADMIN_MODULES card. Delete the two page files. Keep `canAccessFinancialAdmin` etc. only if still referenced; otherwise remove.
- **API:** remove handlers + dispatch for `GET/PUT /financial/watchlist`, `GET /financial/quote`, `GET /financial/config`, `GET/PUT /admin/financial/default-symbols`, and their `aws_apigatewayv2_route` blocks in `infra/main.tf` (route-coverage test forces you to do both sides). Remove their tests (`test_financial_handlers.py` cases that cover removed routes).
- **Keep `src/lambda/api/financial.py`'s data functions** — `investing.py` imports `_fetch_json` from it, and `fetch_quote_yahoo` may still be referenced elsewhere; delete only what becomes dead (verify with grep before deleting anything from it).
- **Redirect:** add `<Route path="/financial" element={<Navigate to="/finances" replace />} />` so old links/bookmarks land on the new app.
- Note in the Jira story: watchlist DynamoDB items (`SK=FINANCIAL#WATCHLIST`, `FINANCIAL#CONFIG`) are orphaned, not deleted — leave data in place.

---

## 7. AI — Bedrock Claude Sonnet

- Model: **Claude Sonnet (latest)**. On Bedrock, Claude IDs carry the `anthropic.` prefix — expected ID **`anthropic.claude-sonnet-5`**. **Verify at build time** (bypass mode has AWS CLI): `aws bedrock list-foundation-models --by-provider anthropic --region us-east-1` (and `aws bedrock list-inference-profiles` — if invocation requires an inference profile, use the profile ID, typically `us.`-prefixed). Put the resolved ID in one constant `BEDROCK_MODEL_ID` in `bpf.py`.
- Invocation: same `converse()` pattern as `generate_description.py`. `inferenceConfig={"maxTokens": 1024, "temperature": 0.3}` max.
- IAM: widen `infra/main.tf` (~line 750) Bedrock statement — add a Resource for `arn:aws:bedrock:${var.awsRegion}::foundation-model/anthropic.claude-sonnet-*` (keep the nova-micro one; memes/description features still use it). If an inference profile is required, also allow `arn:aws:bedrock:${var.awsRegion}:*:inference-profile/*anthropic.claude-sonnet*` and `bedrock:InvokeModel` on the underlying regional foundation-model ARNs it fans out to.
- **Ops note for Jira:** Anthropic model access may need one-time enablement in the AWS Bedrock console — code + IAM can be complete while the first live call 403s. If staging invocation fails with an access error, comment it on the Jira story for Adam; do not weaken IAM to work around it.
- Use: `POST /finances/insights/summary` — prompt = "You are a personal-finance assistant. Using ONLY the data below, write a ≤150-word plain-language summary of this period's finances: notable category changes, budget overruns, cash-flow direction. End with 'Not financial advice.'" + the computed insights JSON (truncated to ~6000 chars). The MCP server may expose the same summary as a tool but must not add new AI surfaces.

---

## 8. Era.app integration (`src/lambda/api/era_client.py`)

- **Discovery first:** Era is MCP-first with a REST API for professional users. Fetch Era's developer docs (era.app — find the API/developers page) to learn base URL, auth header shape, and read endpoints for: accounts+balances, transactions (search/list), spending categories, insights (spending analysis, period comparison, cash-flow forecast). If docs are unreachable or the API surface can't be confirmed, **build the client against a documented-guess interface behind the flag and record exact findings + open questions in the Jira story** — the optional-key design means the app ships working regardless.
- Client shape: `is_connected()` (key present), `get_accounts()`, `get_transactions(from,to,q)`, `get_insights(period)` — **read-only, nothing else** (guardrail 2). stdlib `urllib` with auth header; 10s timeout; on any Era error log + return `None`/empty (never 500 the whole endpoint — degrade to local data with `eraConnected: false` for that response).
- Config: `variables.tf` → `eraApiKey` (`sensitive = true`, default `""`) → lambda env `ERA_API_KEY`, same pattern as `alphaVantageApiKey`. Add a placeholder line to `terraform.tfvars.example`. Module-level response cache with ~300s TTL keyed by (user-irrelevant — the key is account-scoped) endpoint+params.
- Era data merges: transactions tagged `"source": "era"` and immutable via the app; accounts tagged likewise; insights merged under an `era` key in the insights payload.

---

## 9. Lambda MCP server (`src/lambda/mcp/handler.py`, new lambda function)

- **New, separate lambda function** (not the api handler): terraform `aws_lambda_function.mcp` cloned from `aws_lambda_function.api` (python3.12, same source packaging mechanism — inspect how the api lambda's source is zipped in main.tf and mirror it; reuse the `lambdaApi` IAM role *(default — overridable)*), env: `TABLE_NAME`, `ERA_API_KEY`, `MCP_BEARER_TOKEN` (new sensitive tfvar `mcpBearerToken`), plus AWS_REGION built-in. New `aws_apigatewayv2_integration` + route `POST /mcp` on the existing gateway, **no JWT authorizer** (MCP clients can't do Cognito) — auth is the bearer token inside the lambda, checked with `hmac.compare_digest`.
- **Protocol:** implement minimal MCP over Streamable HTTP as plain JSON-RPC 2.0 handling — methods `initialize` (reply with `protocolVersion` echoing the client's, `capabilities: {"tools": {}}`, `serverInfo`), `notifications/initialized` (accept, 202/empty), `tools/list`, `tools/call`. Single JSON response per POST (no SSE streaming; return `Content-Type: application/json`). `# ponytail:` no MCP SDK dependency — lambdas are stdlib-only and the protocol subset is ~150 lines; upgrade path is packaging the `mcp` pip package if the subset falls short with real clients.
- **Identity:** the MCP server acts as **Adam** — single-user by design. `MCP_OWNER_USER_ID` env (sensitive-ish tfvar `mcpOwnerUserId`, Adam's Cognito sub) scopes all reads. `# ponytail:` single-owner token; per-user tokens if anyone else ever needs MCP.
- **Tools (all read-only)** — thin wrappers over the same `bpf.py` / `era_client.py` functions (import them; do not duplicate logic): `list_accounts`, `list_transactions(from,to,query,category)`, `get_budgets`, `get_insights(period)`, `get_dashboard_summary`, and `era_status`. Every tool result is the JSON payload as text content.
- Tests: `test_mcp_handler.py` — bad/missing token → 401; `initialize` handshake shape; `tools/list` returns the six tools; `tools/call` happy path with `bpf` functions patched; unknown method → JSON-RPC error. Check whether `test_route_coverage.py` parses only `api.handler` routes — if the `/mcp` route breaks its assumptions, extend the test's allowlist rather than weakening it.
- **Verification note for Jira:** after staging deploy, Adam connects a Claude client to `https://<staging-api>/mcp` with the bearer token; include the exact connection instructions (URL + `Authorization: Bearer <token>` header) in the story comment.

---

## 10. SPA — `src/web/spa/src/features/finances/`

- Route `/finances` with sub-routes (nested `<Route>`s): `/finances` (Dashboard), `/finances/transactions`, `/finances/budgets`, `/finances/insights`, `/finances/sharing`. A small tab bar inside the page (copy the Neon Pop pill/tab styling used elsewhere, e.g. Investing range selector).
- **Dashboard:** net-worth headline + per-account balance cards (Era-badged where applicable), 90-day net-worth/cash-flow line chart (`lightweight-charts` area/line series — reuse `CandleChart.tsx` patterns for mount/dispose/theme colors), income vs spend for current month.
- **Transactions:** filterable table (date range, text, category), add/edit/delete for manual transactions (modal or inline form; copy form styling from `FinancialPage`/`GeneralExpensesPage`), Era rows read-only with a badge.
- **Budgets:** per-category rows with limit input + progress bar (plain div bars) of month-to-date actual; over-budget rows highlighted (`text-red-400` family, consistent with existing gain/loss colors).
- **Insights:** category breakdown (bar list), this-period-vs-last comparison, forecast line, and an "AI summary" button → `POST /finances/insights/summary` → rendered text (mirror Investing's Analyze UX).
- **Sharing:** owner grants (email + section checkboxes, list + revoke) and a "Shared with me" list; selecting a shared owner switches the read views into `?owner=` mode with a visible "viewing X's finances (read-only)" banner and all edit affordances hidden.
- **Era states:** when `eraConnected` false, Era panels show a quiet "Connect Era (era.app) to sync accounts automatically — add ERA_API_KEY" empty state; everything local still works.
- Registration: lazy import + routes in `AppLayout.tsx`; `modules.ts` PUBLIC_MODULES entry `{id:"finances", label:"Finances", path:"/finances", section:"financial", minRole:"user", authOnly:true}`; MODULE_GROUPS `financial` group links = Finances + Investing (+ admin if kept). Section rename from "Financial" not required.

---

## 11. Execution order

1. Jira: epic + stories (suggested: ①retire financial dashboard, ②bpf backend local CRUD + routes, ③Era client + hybrid merge, ④sharing, ⑤AI summary + IAM, ⑥MCP lambda, ⑦SPA). Points relative within the epic; move ① In Progress.
2. Backend: `bpf.py` (accounts/txns/budgets/settings/shares + insights computation) → handler.py fns + dispatch → tf routes → tests. Run pytest.
3. `era_client.py` + hybrid merge + `finances/config` → tests (Era fns patched; plus one test that everything works with `ERA_API_KEY` unset).
4. AI summary route + Bedrock IAM widening (verify model ID via AWS CLI first).
5. MCP lambda + tf (function, integration, route, tfvars) + tests.
6. SPA feature + registration + Financial-dashboard retirement (do removal and replacement in the same commit so nav never dangles). `npm run build`.
7. Full pytest + build; commit per story (or logical chunks) with FUNK refs; push `development`.
8. Jira: tick delivered ACs, comment per story incl. MCP connection instructions, staging-verification checklist, and the two ops notes (Bedrock console model access; Era API key + `mcpBearerToken`/`mcpOwnerUserId` must be added to `terraform.tfvars` before those features light up). **Stop.**

## 12. Acceptance criteria (epic-level; distribute across stories)

- [ ] `/finances` replaces `/financial` (redirect in place); Investing untouched and still working
- [ ] All four sections functional with **no** Era key configured (manual accounts/transactions drive everything)
- [ ] With Era key configured: Era accounts/transactions/insights appear merged and badged; removing the key returns the app to local-only with no errors
- [ ] Manual account + transaction CRUD persists per user
- [ ] Budgets show month-to-date actuals computed from transactions; over-budget is visible
- [ ] Insights show category breakdown, period comparison, forecast; AI summary returns ≤150-word narrative ending "Not financial advice."
- [ ] Sharing: grantee sees exactly the granted sections, read-only, with owner banner; revocation takes effect; non-granted sections 403
- [ ] MCP: authenticated client completes initialize → tools/list → tools/call for all six tools; bad token → 401
- [ ] Era client contains no write operations; Bedrock calls capped at 1024 maxTokens, one call per action
- [ ] pytest green (2 known PIL failures only), route coverage green, SPA build clean
- [ ] Jira epic + stories with points, `claude` label, AC checklists; everything left In Progress for Adam's staging verification
