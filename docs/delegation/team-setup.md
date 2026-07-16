# Team Setup: The `/delegate` Pattern

How to give everyone on the team the lead/sidekick delegation workflow described
in `README.md` — as a one-word trigger in Claude Code, or as a portable snippet
for people who prefer to invoke it by hand.

> **Read `README.md` first** for *why* this works. This doc is *how* to turn it on.

> **This repo already ships Levels 3 + 4.** The repo-root `CLAUDE.md` carries the
> `/delegate` block and the fast/full test commands, and `.claude/skills/agent-delegate/`
> carries the versioned skill. Both are picked up automatically in Claude Code web
> **and** CLI sessions on this repo — no per-person setup needed. The levels below
> are retained as the general reference and for adopting the pattern elsewhere.

---

## Pick your adoption level

| Level | What you get | Effort | Best for |
| ----- | ------------ | ------ | -------- |
| **1. Copy-paste** | Paste the protocol into any prompt | none | trying it once |
| **2. Personal trigger** | `/delegate` in your own sessions | 2 min | individual adoption |
| **3. Repo trigger** | `/delegate` for anyone working in a repo | 5 min | a whole codebase |
| **4. Shared skill** | Versioned, org-wide, auto-updating | 15 min | dept-wide standard |

Start at Level 1 to feel it, standardize at Level 3 or 4.

---

## Level 1 — Copy-paste (no setup)

Prefix any Claude Code task with this. Nothing to install.

```
You are the LEAD. You have a sidekick subagent (Sonnet tier).
1. First, delegate exploration: "Map how <area> works. Change nothing. Report
   file paths + snippets." Don't read repo files yourself unless the report is thin.
2. Delegate implementation with a brief: constraints, edge cases, test matrix,
   definition of done. Never dictate file contents. End with "report the diff +
   test results before committing."
3. Review via `git diff` only. Fix via a second handoff, not a rewrite.
4. Do short tasks and serial debugging yourself — don't delegate for its own sake.
```

---

## Level 2 — Personal trigger (`~/.claude/CLAUDE.md`)

Adds `/delegate` to *your* sessions on *your* machine.

1. Append this block to `~/.claude/CLAUDE.md` (create the file if it doesn't exist):

```markdown
## /delegate — Fusion-style lead/sidekick delegation

When I say `/delegate` (optionally followed by a ticket key or task description),
apply the DELEGATION PROTOCOL to the current task:

- You are the **lead**; spawn subagents on the **Sonnet tier** as the **sidekick**.
- First action on any non-trivial task: delegate exploration ("map it, change nothing,
  report paths + snippets") — don't read repo files yourself unless the report is insufficient.
- Delegate implementation with a spec-quality brief (constraints, edge cases, test matrix,
  definition of done) — never dictate full file contents.
- Review via `git diff`/`git show` only; fix via re-handoff, not lead rewrites.
- Skip delegation for short tasks and serial debugging — say so and proceed solo.
- Also usable for non-coding work (planning, architecture, docs) — delegate recon and
  drafting, keep decisions in the main thread.
```

2. Restart any running Claude Code session (CLAUDE.md is read at session start).
3. Use it: `/delegate add retry-with-backoff to the S3 upload helper`

> **Sidekick choice:** Sonnet is the balanced default (higher-quality delegated
> work, smaller dollar saving). For maximum cost savings on mechanical tasks, use
> a cheaper tier instead. See the cost caveat in `README.md`.

---

## Level 3 — Repo trigger (shared via a repo `CLAUDE.md`)

Gives `/delegate` to **anyone** who runs Claude Code inside a specific repo —
no per-person setup. Best for a codebase your team works in daily.

1. In the repo root, create or edit `CLAUDE.md` (this file is committed and read
   automatically by Claude Code for anyone working in the repo).
2. Add the same `## /delegate` block from Level 2.
3. Also add the two per-repo lines that make delegation actually pay off:

```markdown
## Fast vs full test commands (for delegated work)

- Fast iteration (sidekick uses this while implementing): `<your fast command>`
- Full verification (before opening a PR): `<your full command>`
```

   Without this, a sidekick may run a slow full suite repeatedly. Naming the fast
   command is the single highest-value per-repo line you can add.
4. Commit. Done — teammates get `/delegate` on their next session in that repo.

> Repo `CLAUDE.md` and personal `~/.claude/CLAUDE.md` **stack** (both apply). Keep
> the delegation block in one place to avoid drift — prefer the repo copy for
> shared codebases so everyone's on the same version.

---

## Level 4 — Shared skill (org-wide, versioned)

Turns the pattern into a named, versioned skill that updates for everyone when you
push a change. Best when you want this to be *the* team standard.

1. Create a skill directory (personal: `~/.claude/skills/agent-delegate/`, or ship
   it in a shared plugin/marketplace your team already installs). *In this repo it
   lives at `.claude/skills/agent-delegate/`.*
2. Add `SKILL.md` (this is a full restatement of the README protocol — see the
   "Source of truth" note below):

```markdown
---
name: agent-delegate
description: >
  Lead/sidekick delegation for coding and non-coding agent tasks. Use when the
  user says /delegate, or asks to run a task using a cheaper sidekick model, or
  wants the frontier model to act as a delegating lead rather than doing all the
  work itself. Applies to code, planning, architecture, and document work.
---

# Agent Delegate

You are the LEAD. Spawn subagents on the Sonnet tier as the sidekick.
Behave like a manager with a capable engineer, not a micromanager with an intern.

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

## Reusable brief template

    TASK:        <one sentence>
    CONSTRAINTS: <hard requirements — perf, compliance, naming, budget>
    EDGE CASES:  <what must not break>
    DONE MEANS:  <observable acceptance criteria>
    REPORT BACK: <diff / summary / table> BEFORE finalizing. Do not commit/send/apply.
```

3. Distribute: commit to a shared plugin repo, or have folks symlink/copy it into
   `~/.claude/skills/`. Skills load automatically when their description matches.

> **Source of truth.** The six rules above are a restatement of the canonical
> protocol in `README.md`. If you change the approach, edit `README.md` first,
> then update this skill to match — don't let them drift.

> **Advantage over Levels 2–3:** one source of truth. Fix a rule once, everyone
> gets it. Recommended if more than a handful of people adopt this.

---

## Verify it's working

After setup, run a real task and check the behavior:

- [ ] The agent's **first action** is a delegation (exploration), not reading files.
- [ ] Handoffs contain **briefs** (constraints/DoD), not pasted file contents.
- [ ] The lead **reviews diffs** rather than re-reading full files.
- [ ] On a genuinely short task, the agent **skips delegation** and says why.

Or run the scripted demo with metrics:

```bash
python claude_agent_delegate_example.py --dry-run "test"      # prints protocol + brief, no cost
python claude_agent_delegate_example.py "add a --verbose flag to the CLI"
```

The metrics block at the end shows the lead-vs-sidekick split so you can confirm
the lead isn't doing all the work itself.

---

## Rollout suggestion

1. **Week 1:** share `README.md`, ask 2–3 volunteers to try Level 1 on real tickets.
2. **Week 2:** those volunteers report the cost/quality difference; if positive,
   add Level 3 to your most-used repo.
3. **Week 3+:** if adoption sticks, promote to Level 4 as the team default.

Keep the sidekick tier a conscious choice per team — cost-sensitive teams go
cheaper, quality-sensitive infra work stays on Sonnet.
