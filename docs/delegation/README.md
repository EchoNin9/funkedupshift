# Lead / Sidekick Delegation for Coding Agents

A cheaper way to run agentic coding work — and a better one.

> **TL;DR:** Per-token model price is the wrong thing to optimize. Agent cost is
> driven by how many turns the expensive model takes, how much context it drags
> along, and how much work it does *itself* instead of handing off. Make your
> frontier model a **lead** that delegates to a cheaper **sidekick**, and you get
> lower cost *and* higher quality on non-trivial tasks.

---

## Where this comes from

This pattern is adapted from Cognition's write-up **"Making Fable Cheaper Than
Opus"** (Joon Hee Lee, July 2026). Their headline result: a model that costs **2x
more per token** ended up **cheaper per run** than the cheaper model — because it
delegated well.

Numbers from their eval (lead + identical cheap sidekick, ~3,000 sessions):

| Config              | Cost / run | Score |
| ------------------- | ---------- | ----- |
| Cheaper lead + sidekick | $2.04  | 54.6  |
| Pricier lead + sidekick | **$1.86** | **60.7** |
| Pricier lead, solo (no sidekick) | $4.03 | — |

The pricier lead was net cheaper because it took **~11 turns/run instead of ~26**,
wrote a third of the tokens, and in **81% of runs never edited code itself**.

---

## The core idea

Two roles, one session:

- **Lead** (frontier model): talks to the ticket/user, plans, writes briefs,
  reviews, decides, commits. Owns judgment.
- **Sidekick** (cheaper model): does the legwork — repo exploration, first-draft
  implementation, mechanical edits — in its own context, and reports back.

The difference between a good lead and a bad one is **not how much it delegates**
(both delegate ~3x per run). It's:

1. **When** — good leads delegate *exploration first*, often as their very first
   action. Bad leads do 20 turns of solo work, then hand off the mechanical tail.
2. **What** — good leads write **spec-quality briefs** (constraints, edge cases,
   definition of done). Bad leads **dictate file contents** line by line.

> Analogy from the article: a bad lead behaves like *a micromanager with an intern*;
> a good lead behaves like *a manager with a capable engineer*.

---

## Why briefs beat dictation (a concrete example)

Their hashing-task example:

- **Dictation lead** implemented it by hand, forgot the O(1) constraint → scored **25**.
- **Brief lead** put "must be O(1)" explicitly in the handoff → sidekick scored **94**.

Stating the *constraint and the definition of done* travels better than typing out
the *solution*. It also keeps the expensive context window clean.

---

## The protocol (what your leads should do)

> **Source of truth.** This six-rule protocol is the canonical copy. Every other
> place it appears (the `/delegate` CLAUDE.md block, the Level 4 skill, the demo
> script's system prompt) is a restatement of *this* list. If you change the
> approach, change it here first, then propagate.

1. **Exploration first, delegated.** First action on any non-trivial task is a
   sidekick handoff: *"Map how X is implemented. Change nothing. Report file paths
   and snippets."* Don't read repo files yourself unless the report is thin.
2. **Briefs are design docs, not dictation.** Delegate implementation with
   constraints, edge cases, a test matrix, and an explicit definition of done.
   Never inline full file contents. Always end with *"report the diff + test
   results before committing."*
3. **Review cheaply.** Review via `git diff` / `git show`. Don't pull the
   sidekick's files back into your context.
4. **Fix via re-handoff.** Wrong or over-engineered result → second cheap handoff
   with feedback, not a lead-priced rewrite.
5. **Know when NOT to delegate.** Short tasks and serial root-cause debugging —
   where the accumulated context *is* the work — should be done solo. Delegation
   has no leverage there and can hurt quality.
6. **The lead owns the session.** Design decisions, final review, and the commit
   stay with the lead.

### Anti-patterns to catch in review

- Lead re-reads files the sidekick already summarized.
- Late delegation (solo exploration + implementation, then hand off the scraps).
- Dictation briefs (`overwrite config.json with exactly: {...}`).
- Lead makes >2 corrective edits at lead prices instead of re-delegating.
- Forcing delegation on serial-debug tickets.

---

## The reusable brief template

Works for code, and just as well for planning / architecture / docs:

```
TASK:        <one sentence>
CONSTRAINTS: <hard requirements — perf, compliance, naming, budget>
EDGE CASES:  <what must not break>
DONE MEANS:  <observable acceptance criteria>
REPORT BACK: <diff / summary / table> BEFORE finalizing. Do not commit/send/apply.
```

---

## It's not just for code

The same research → produce → review loop shows up everywhere:

- **Business logic / Cowork:** delegate document and source trawling
  ("read these 6 pages, report the constraints relevant to X, draft nothing"),
  keep the decision in the main thread.
- **Sprint / quarter planning:** delegate data gathering (Jira exports, Slack
  summaries) with a "report facts, no recommendations" handoff; lead synthesizes.
- **Cloud architecture:** delegate current-state inventory ("enumerate the ALBs /
  target groups / DNS records touching service X; report names, ARNs, relationships;
  change nothing"), lead does the design and reviews diffs only.

---

## How to measure whether it's working

Instrument each run and track:

| Metric              | Healthy signal                          |
| ------------------- | --------------------------------------- |
| First handoff turn  | within the first ~3 turns (early)       |
| Lead code edits     | zero on most tasks                      |
| Handoffs per task   | ~2–4                                    |
| Lead cost share     | < 70% of total                          |

Then A/B it: run the same 5–10 tasks under `{lead model} × {delegation on/off}`,
compare total cost and human review pass/fail, keep what wins.

> **Cost caveat:** the article's 54% saving used a *much* cheaper sidekick. The
> closer the sidekick's price is to the lead's, the smaller the dollar saving —
> but the quality/context-hygiene benefits still hold. Pick your sidekick tier
> based on how much you value savings vs. delegated-work quality.

---

## Try it in 5 minutes

1. Open Claude Code in any repo.
2. Give it a real task, prefixed with the protocol:
   > *"You are the lead. Before doing anything, spawn a subagent to explore how
   > `<area>` works and report paths + snippets — don't read the files yourself.
   > Then delegate the implementation with a brief (constraints, edge cases,
   > definition of done). Review the diff only."*
3. Watch where the turns and tokens go vs. your usual flow.

See `claude_agent_delegate_example.py` for a scripted, headless version of the same idea.
