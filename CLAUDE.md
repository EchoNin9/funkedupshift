# CLAUDE.md — funkedupshift

Project instructions for Claude Code and Antigravity. Read automatically at session start in
**both** Claude Code web and CLI sessions, as well as Antigravity sessions working in this repo.

---

## /delegate — lead/sidekick delegation (default workflow)

This repo adopts the lead/sidekick delegation protocol. The canonical write-up is
`docs/delegation/README.md`; team-setup options are in `docs/delegation/team-setup.md`;
a headless demo is `docs/delegation/claude_agent_delegate_example.py`. The versioned
skill lives at `.claude/skills/agent-delegate/`.

When I say `/delegate` (optionally followed by a ticket key or task description) —
and, by default, on any **non-trivial** task in this repo — apply the DELEGATION
PROTOCOL:

- You are the **lead**; spawn subagents on the **Sonnet tier** (for Claude) or **flash/pro** (for Antigravity) as the **sidekick**.
  - Web sessions: use the Agent/Task tool with `model: sonnet`.
  - CLI/headless: `claude-sonnet-*` (e.g. `--sidekick claude-sonnet-4-6`, or your
    installed Sonnet id). The tier matters, not the exact point release.
  - Antigravity: use the `invoke_subagent` tool.
- **Exploration first, delegated.** Your first action on any non-trivial task is a
  sidekick handoff: *"Map how <area> is implemented. Change nothing. Report file
  paths and relevant snippets."* Don't read repo files yourself unless the report
  is insufficient.
- **Briefs, not dictation.** Delegate implementation with a spec-quality brief:
  constraints, edge cases, a test matrix, and an explicit definition of done. Never
  inline full file contents. End every brief with *"report the diff + test results
  before committing."*
- **Review cheaply** via `git diff` / `git show` only; don't pull the sidekick's
  files back into your context.
- **Fix via re-handoff,** not a lead-priced rewrite.
- **Know when NOT to delegate.** Short tasks and serial root-cause debugging —
  where the accumulated context *is* the work — you do solo. Say so and proceed.
- **The lead owns the session:** design decisions, final review, and the commit.

Also usable for non-coding work (planning, architecture, docs): delegate recon and
drafting, keep decisions in the main thread.

### Reusable brief template

```
TASK:        <one sentence>
CONSTRAINTS: <hard requirements — perf, compliance, naming, budget>
EDGE CASES:  <what must not break>
DONE MEANS:  <observable acceptance criteria>
REPORT BACK: <diff / summary / table> BEFORE finalizing. Do not commit/send/apply.
```

---

## PR review — fresh-context Claude reviewer (required before merge)

Codex PR review is **off** for this repo. Instead, before merging ANY PR
(feature → `development` or `development` → `main`):

1. **Spawn a separate, fresh agent** to review it: a new general-purpose agent
   whose only context is your review brief (web: Agent tool, not a fork of
   your session; CLI: a new headless session; Antigravity: `invoke_subagent`
   with fresh context). It must NOT inherit the lead's conversation,
   hypotheses or the sidekick's report: an anchored reviewer tends to confirm
   what it was told. Run it on the **lead's model tier**, not the Sonnet
   sidekick tier. Review is where quality matters.
2. **Give it the code, not your conclusion:** the PR number/branch and the base,
   and tell it to `git fetch` and read the diff itself
   (`git diff origin/<base>...origin/<head>`) plus whatever surrounding files it
   needs. Ask for correctness bugs, regressions, security issues, missing
   tests, and violations of this file's gotchas. Findings ranked by severity,
   each with file:line and a concrete failure scenario. Read-only: it changes
   nothing.
3. **Verify each finding before acting** (reviewers are wrong sometimes): fix
   real ones on the branch (re-run the review if the fix is non-trivial),
   and record dismissed ones with the reason.
4. **Record it in the PR body:** a line like
   `Fresh-context review: done, N findings (M fixed, K dismissed: <why>)`.
5. Merge only after review findings are resolved **and** PR Check is green.

Release PRs (`development` → `main`) that only promote already-reviewed
commits may use a lighter pass: `git fetch` then check that every PR in
`git log --merges origin/main..origin/development` has the review line in its
body; give anything that doesn't a full review.

---

## Fast vs full test commands (for delegated work)

Give these to the sidekick so it doesn't run the slow path on every iteration.

**Fast iteration (sidekick uses this while implementing):**
- Backend (Lambda): `pytest src/lambda/tests -q` — or a single file, e.g.
  `pytest src/lambda/tests/test_<feature>.py -q`
- Frontend (SPA): `cd src/web/spa && npm run build` (~8s; this is what CI gates on)

**Full verification (before opening a PR):**
- Backend: `pytest src/lambda/tests -v`
- Frontend: `cd src/web/spa && npm ci && npm run build`

**Known baselines (don't chase these):**
- `npm run typecheck` reports several pre-existing type errors and is **not** the
  gate — use `npm run build`. Any *new* failure you introduce is yours to fix.

**The pytest suite is otherwise fully green** — 1384 passing as of 2026-11-14.
There are no expected pytest failures (an old "2 pre-existing PIL failures"
note is long stale). Treat any pytest failure you see as real.

Running pytest: use the project venv if it exists
(`.venv/bin/python -m pytest src/lambda/tests -q`), otherwise
`python3 -m pytest src/lambda/tests -q` (cloud sessions have no `.venv`).
A bare `pytest`/`python` may hit a pyenv shim that lacks `dnspython` and fails
at collection on `test_tools_dns.py`.

`npm run build`'s prebuild step (`fetch-imgly-assets`) needs network access; in
a sandbox without it, run `npx vite build` in `src/web/spa` to check the build.

---

## Repo orientation (pointers, not a substitute for exploration)

- **Frontend:** React SPA in `src/web/spa/` (Vite) → S3 behind CloudFront.
- **API:** HTTP API Gateway → Python Lambda dispatcher `src/lambda/api/handler.py`
  (literal `method + path` chains; feature logic in per-feature modules).
- **Isolated feature modules:** some features live outside the main API with
  their own handler, table, bucket and `infra/<name>.tf` —
  `src/lambda/social/` (scheduling), `src/lambda/tools/` (shortener/DNS),
  `src/lambda/lipsync/` (AI video & lip-sync, see `docs/lipsync-design.md`).
  Adding a route to any of them needs a matching `aws_apigatewayv2_route`;
  `tests/test_route_coverage.py` fails otherwise.
- **Auth:** Cognito (JWT authorizer), groups `admin` / `manager` / `user`.
  Frontend naming trap: the Cognito group `admin` maps to the frontend
  `UserRole` value **`superadmin`** — there is no `"admin"` role literal.
- **Data:** single-table DynamoDB (`PK`/`SK` + GSIs).
- **Infra:** Terraform in `infra/`.
- **Branches/deploy:** NEVER commit directly to `development` or `main`. Every
  piece of work gets its own branch off `development`, named for the ticket:
  `feature/FUNK-<n>-<slug>` (or `fix/FUNK-<n>-<slug>`). Open a PR
  branch → `development`, wait for PR Check to pass, then merge. This keeps
  parallel agents/sessions from colliding. `development` auto-deploys staging
  (and the env-shared tools platform — i.e. LIVE tools.e9.cx); `main` is
  production. PRs go `development` → `main`. Don't push/merge `main` directly.
  **Infra caveat:** staging and prod deploys share ONE terraform state and
  each applies the whole config, so a merge to `development` applies its infra
  (incl. prod CloudFront/Lambda/API resources) immediately, and the last deploy
  to run wins. Treat infra changes as live on merge to `development` (FUNK-98
  tracks splitting state). Deploys serialize on the state lock
  (`-lock-timeout=30m`). If a killed run leaves the lock stuck, confirm no deploy
  is running, then `terraform force-unlock <LOCK_ID>` (ID from the error message).
  This applies to Claude Code and Antigravity alike.

- **Scaling note (sites/media):** list endpoints read the whole `byEntity`
  partition (ALL projection incl. `scrapedContent`) on every request. Fine at
  ~hundreds of items; see `docs/scaling-sites-media.md` (FUNK-93) before it grows.

Planning briefs and design docs live in `docs/`.

---

## Hard-won gotchas — phase-2 tools sessions (2026-07-18)

Additions to the phase-2 handoff doc's list; each of these cost a failed deploy
or a prod bug.

1. **New backend Python deps need TWO homes:** the tools Lambda layer
   (`null_resource.tools_crt_layer` in `infra/tools.tf`) AND
   `src/lambda/requirements-test.txt` (what CI's pytest env installs).
   Missing the second fails the deploy at the pytest step (dnspython bit us).
2. **`aws_lambda_layer_version` does not republish when the zip is rebuilt.**
   The resource has no `source_code_hash`, so changing the `null_resource`
   trigger rebuilds the zip but terraform sees no diff on the layer version —
   the Lambda keeps running the OLD layer (caused the /dns 500 in prod). Tie
   `source_code_hash` to the requirements trigger, or expect to republish
   manually.
3. **`gh run watch ... | tail` eats the exit code** — the pipeline exits with
   tail's status, so a failed deploy reads as success. Check the run's
   `conclusion` field explicitly (`gh run view --json conclusion`).
4. **React: a ref target used by an async load handler must stay mounted.**
   Conditionally rendering the canvas on state that the handler itself sets
   (`{meta && <canvas ref={...}/>}`) makes the first interaction a silent
   no-op (image tool first-file-pick bug — both frontends). Keep it mounted,
   hide with CSS.

---

## Hard-won gotchas — lipsync session (2026-08-17)

1. **fal.ai queue URLs are not one shape.** Submit uses the FULL model id
   (`POST /fal-ai/kling-video/ai-avatar/v2/pro`), but status and result key off
   the **owner/app prefix only** (`GET /fal-ai/kling-video/requests/{id}/status`).
   Using the full id on a poll returns **HTTP 405**. fal's own published
   OpenAPI schema documents the full path for all three operations and is
   **wrong** — verified against the live service (valid routes 401
   unauthenticated, invalid ones 405). This only bites model ids with more
   than two path segments, so a 2-segment model like `veed/lipsync` works end
   to end and hides the bug. See `lipsync/providers/fal.py::queueAppId`.
2. **A test that asserts the implementation's URL isn't a test.** The above
   shipped green because the test asserted exactly the string the code built.
   When pinning an external API's contract, verify the shape against the real
   service, not against your own code.
3. **`MagicMock`-backed DynamoDB tests never exercise boto3's serializer.**
   A raw Python `float` written to DynamoDB raises `TypeError: Float types are
   not supported` in production but passes every mocked test. Convert to
   `Decimal(str(v))` at the write choke point, and assert the *type*, not just
   numeric equality — a bare float passes `== 12.3`.
4. **zsh does not word-split unquoted variables** the way bash does. A bundled
   flag string (`R="--profile x --region y"; aws ... $R`) is passed as ONE
   argument and the command errors. Combined with `|| echo "NOT FOUND"` this
   reads as "resource missing" and can fake a failed deploy. Use inline flags.
