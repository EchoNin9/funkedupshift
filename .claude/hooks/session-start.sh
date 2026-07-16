#!/bin/bash
# SessionStart hook for funkedupshift.
#
# Two jobs, on every Claude Code session (web + CLI):
#   1. Inject the lead/sidekick DELEGATION protocol as session context, so the
#      workflow in CLAUDE.md / docs/delegation/ is followed and not skipped.
#   2. (web sessions only) Install the Python test deps + SPA deps so the
#      fast/full test commands documented in CLAUDE.md actually run.
#
# stdout MUST stay a single clean JSON object (the hook's additionalContext
# payload). All dependency-install chatter is redirected to stderr.
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- 1. Dependency setup (remote/web only) -----------------------------------
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  {
    # Python (Lambda) test + build deps: pytest, boto3, Pillow.
    if ! python3 -m pytest --version >/dev/null 2>&1; then
      python3 -m pip install --quiet -r "$PROJECT_DIR/src/lambda/requirements-test.txt" || true
    fi
    # SPA deps — always run: `npm install` is idempotent, reconciles a stale or
    # partial node_modules, and is fast once the container layer is cached.
    (cd "$PROJECT_DIR/src/web/spa" && npm install --no-audit --no-fund) || true
  } >&2
fi

# --- 2. Inject the delegation protocol as session context --------------------
read -r -d '' CONTEXT <<'EOF' || true
DELEGATION WORKFLOW IS ACTIVE for this repo (canonical: CLAUDE.md and docs/delegation/README.md).
You are the LEAD; spawn Sonnet-tier sidekick subagents (web: Task/Agent tool with model: sonnet;
CLI: a claude-sonnet-* id). Behave like a manager with a capable engineer:
1. Exploration first, delegated — your FIRST action on any non-trivial task is a sidekick handoff
   ("map how <area> works, change nothing, report file paths + snippets"). Don't read repo files
   yourself unless the report is insufficient.
2. Briefs, not dictation — hand off with constraints, edge cases, a test matrix, and a definition
   of done; end every brief with "report the diff + test results before committing." Never inline
   full file contents.
3. Review cheaply via `git diff` / `git show` only.
4. Fix via re-handoff, not a lead-priced rewrite.
5. Do short tasks and serial root-cause debugging yourself — say so and proceed solo.
6. The lead owns design decisions, final review, and the commit.
Fast tests (sidekick, while implementing): `pytest src/lambda/tests -q`; `cd src/web/spa && npm run build`.
Full verification (before a PR): `pytest src/lambda/tests -v`; `cd src/web/spa && npm ci && npm run build`.
(Known baselines, don't chase: 2 pre-existing PIL failures in test_api_handler.py; `npm run typecheck` has pre-existing type errors and is not the gate.)
EOF

python3 - "$CONTEXT" <<'PY'
import json, sys
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": sys.argv[1],
    }
}))
PY
