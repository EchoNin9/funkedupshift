---
name: agent-delegate
description: >
  Lead/sidekick delegation for coding and non-coding agent tasks. Use when the
  user says /delegate, or asks to run a task using a cheaper sidekick model, or
  wants the frontier model to act as a delegating lead rather than doing all the
  work itself. Applies to code, planning, architecture, and document work.
---

# Agent Delegate

You are the LEAD. Spawn subagents on the **Sonnet tier** as the sidekick (web:
Agent/Task tool with `model: sonnet`; CLI/headless: a `claude-sonnet-*` id — the
tier matters, not the exact point release). Behave like a manager with a capable
engineer, not a micromanager with an intern.

1. EXPLORATION FIRST, DELEGATED. Your first action on any non-trivial task is a
   sidekick handoff: "Map how <area> is implemented. Change nothing. Report file
   paths and relevant snippets." Don't read repo files yourself unless the
   sidekick's report is insufficient.
2. BRIEFS, NOT DICTATION. Delegate implementation with a spec-quality brief:
   constraints (perf, style, compat), edge cases, a test matrix, and an explicit
   definition of done. Never inline full file contents. End every brief with:
   "Report the full diff and test results BEFORE committing."
3. REVIEW CHEAPLY. Review sidekick work via `git diff` / `git show` only. Don't
   pull its files back into your context.
4. FIX VIA RE-HANDOFF. If a result is wrong or over-engineered, issue a second
   handoff with corrective feedback ("try simpler alternatives in this order;
   keep the first that passes"). Don't revert and reimplement yourself except as
   a last resort.
5. KNOW WHEN NOT TO DELEGATE. Short tasks and serial root-cause debugging, where
   the accumulated context IS the work, you do yourself. Don't delegate for its
   own sake — say so and proceed solo.
6. YOU OWN THE SESSION: design decisions, final review, and the commit.

Also usable for non-coding work (planning, architecture, docs): delegate recon
and drafting, keep decisions in the main thread.

## This repo's fast vs full test commands

Hand the fast command to the sidekick so it doesn't run the slow path each loop.

- Fast — backend: `pytest src/lambda/tests -q`; frontend: `cd src/web/spa && npm run typecheck`
- Full (pre-PR) — backend: `pytest src/lambda/tests -v`; frontend: `cd src/web/spa && npm ci && npm run build`
- Known baseline: 2 pre-existing PIL failures in `test_api_handler.py` are expected.

## Reusable brief template

    TASK:        <one sentence>
    CONSTRAINTS: <hard requirements — perf, compliance, naming, budget>
    EDGE CASES:  <what must not break>
    DONE MEANS:  <observable acceptance criteria>
    REPORT BACK: <diff / summary / table> BEFORE finalizing. Do not commit/send/apply.

---

**Source of truth.** These six rules restate the canonical protocol in
`docs/delegation/README.md`. If you change the approach, edit that file first,
then update this skill to match — don't let them drift.
