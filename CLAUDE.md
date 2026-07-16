# CLAUDE.md — funkedupshift

Project instructions for Claude Code. Read automatically at session start in
**both** Claude Code web and CLI sessions working in this repo.

---

## /delegate — lead/sidekick delegation (default workflow)

This repo adopts the lead/sidekick delegation protocol. The canonical write-up is
`docs/delegation/README.md`; team-setup options are in `docs/delegation/team-setup.md`;
a headless demo is `docs/delegation/claude_agent_delegate_example.py`. The versioned
skill lives at `.claude/skills/agent-delegate/`.

When I say `/delegate` (optionally followed by a ticket key or task description) —
and, by default, on any **non-trivial** task in this repo — apply the DELEGATION
PROTOCOL:

- You are the **lead**; spawn subagents on the **Sonnet tier** as the **sidekick**.
  - Web sessions: use the Agent/Task tool with `model: sonnet`.
  - CLI/headless: `claude-sonnet-*` (e.g. `--sidekick claude-sonnet-4-6`, or your
    installed Sonnet id). The tier matters, not the exact point release.
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
- `test_api_handler.py` has 2 pre-existing PIL-related failures — expected.
- `npm run typecheck` reports several pre-existing type errors and is **not** the
  gate — use `npm run build`. Any *new* failure you introduce is yours to fix.

---

## Repo orientation (pointers, not a substitute for exploration)

- **Frontend:** React SPA in `src/web/spa/` (Vite) → S3 behind CloudFront.
- **API:** HTTP API Gateway → Python Lambda dispatcher `src/lambda/api/handler.py`
  (literal `method + path` chains; feature logic in per-feature modules).
- **Auth:** Cognito (JWT authorizer), groups `admin` / `manager` / `user`.
- **Data:** single-table DynamoDB (`PK`/`SK` + GSIs).
- **Infra:** Terraform in `infra/`.
- **Branches/deploy:** work on `development` (auto-deploys staging); `main` is
  production. PRs go `development` → `main`. Don't push/merge `main` directly.

Planning briefs and design docs live in `docs/`.
