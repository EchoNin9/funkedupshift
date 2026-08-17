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

**The pytest suite is otherwise fully green** — 896 passing as of 2026-08-17.
An older note here claimed "2 pre-existing PIL-related failures in
`test_api_handler.py`"; that is **stale** and those failures no longer occur.
Treat any pytest failure you see as real rather than waving it through as an
expected baseline.

Run pytest via the project venv: `.venv/bin/python -m pytest src/lambda/tests -q`
(a bare `pytest`/`python` may hit a pyenv shim that lacks `dnspython` and fails
at collection on `test_tools_dns.py`).

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
- **Branches/deploy:** work on `development` (auto-deploys staging); `main` is
  production. PRs go `development` → `main`. Don't push/merge `main` directly.
  Antigravity must ALWAYS push ONLY to the `development` branch (or feature branches targeting `development`).

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
