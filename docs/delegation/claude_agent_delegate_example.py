#!/usr/bin/env python3
"""
claude_agent_delegate_example.py — Lead / Sidekick delegation for headless Claude Code.

Demonstrates the pattern from Cognition's "Making Fable Cheaper Than Opus":
a frontier LEAD model that delegates exploration and implementation to a
cheaper SIDEKICK model, reviews via diffs, and keeps decisions to itself.

This is a teaching example, not production code. It shows:
  1. How to phrase the delegation protocol as a system prompt.
  2. How to invoke `claude -p` headless with a lead model + allowed subagents.
  3. How to parse stream-json and attribute turns/tokens to lead vs sidekick,
     so you can see the cost split the article talks about.

Requirements:
  - Claude Code CLI installed and authenticated (`claude` on PATH).
  - Run from inside a git repo you're willing to let the agent edit on a branch.

Usage:
  python claude_agent_delegate_example.py "Add retry-with-backoff to the S3 upload helper"
  python claude_agent_delegate_example.py --lead claude-opus-4-8 --sidekick claude-sonnet-4-6 "..."
  python claude_agent_delegate_example.py --dry-run "..."     # print the prompt, don't run
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field

# --- Config ---------------------------------------------------------------

DEFAULT_LEAD = "claude-opus-4-8"
DEFAULT_SIDEKICK = "claude-sonnet-4-6"  # cheaper executor; swap for a cheaper tier to widen savings

# The delegation protocol, injected as an appended system prompt so the lead
# behaves like "a manager with a capable engineer," not "a micromanager with
# an intern."
DELEGATION_PROTOCOL = """\
You are the LEAD on this task. You have a sidekick subagent (a cheaper model,
{sidekick}). Follow this protocol:

1. EXPLORATION FIRST, DELEGATED. Your first action on any non-trivial task is a
   sidekick handoff: "Explore how <area> is implemented. Change nothing. Report
   file paths and relevant snippets." Do NOT read repo files yourself unless the
   sidekick's report is insufficient.
2. BRIEFS, NOT DICTATION. When delegating implementation, write a spec-quality
   brief: constraints (perf, style, compat), edge cases, a test matrix, and an
   explicit definition of done. NEVER inline full file contents. End every brief
   with: "Report the full diff and test results BEFORE committing."
3. REVIEW CHEAPLY. Review sidekick work via `git diff` / `git show` only. Do not
   pull its files back into your context.
4. FIX VIA RE-HANDOFF. If a result is wrong or over-engineered, issue a second
   handoff with corrective feedback ("try simpler alternatives in this order;
   keep the first that passes"). Do not revert and reimplement yourself except as
   a last resort.
5. KNOW WHEN NOT TO DELEGATE. Short tasks and serial root-cause debugging, where
   the accumulated context IS the work, you do yourself. Do not delegate for its
   own sake.
6. YOU OWN THE SESSION: design decisions, final review, and the commit.

Spawn subagents with the Task tool and instruct them to use model: {sidekick}.
"""

# Reusable brief template — hand this to engineers for non-coding work too.
BRIEF_TEMPLATE = """\
TASK:        <one sentence>
CONSTRAINTS: <hard requirements — perf, compliance, naming, budget>
EDGE CASES:  <what must not break>
DONE MEANS:  <observable acceptance criteria>
REPORT BACK: <diff / summary / table> BEFORE finalizing. Do not commit/send/apply.
"""


# --- Metrics --------------------------------------------------------------

@dataclass
class RunMetrics:
    """Attribute usage to lead vs sidekick so you can see the cost split."""
    lead_turns: int = 0
    lead_input_tokens: int = 0
    lead_output_tokens: int = 0
    sidekick_turns: int = 0
    sidekick_input_tokens: int = 0
    sidekick_output_tokens: int = 0
    handoff_count: int = 0
    first_handoff_turn: int | None = None
    lead_code_edits: int = 0
    summary_parts: list[str] = field(default_factory=list)

    def report(self) -> str:
        lines = [
            "--- Run metrics (lead vs sidekick) ---",
            f"  lead turns / in / out : {self.lead_turns} / "
            f"{self.lead_input_tokens} / {self.lead_output_tokens}",
            f"  sidekick turns / in / out : {self.sidekick_turns} / "
            f"{self.sidekick_input_tokens} / {self.sidekick_output_tokens}",
            f"  handoffs : {self.handoff_count} "
            f"(first at turn {self.first_handoff_turn})",
            f"  lead code edits : {self.lead_code_edits}",
            "",
            "Healthy signals: first handoff <= ~3 turns, lead_code_edits == 0 on",
            "most tasks, 2-4 handoffs, lead token share well under total.",
        ]
        return "\n".join(lines)


# --- Stream parsing -------------------------------------------------------

def _accumulate(event: dict, m: RunMetrics) -> None:
    """
    Update metrics from a single stream-json event.

    Note: exact event shapes vary by CLI version. This treats top-level
    assistant events as the LEAD, and tool_use events named "Task" as handoffs.
    Subagent token usage is reported by the CLI under nested usage blocks;
    adjust the key paths below to match your `claude --version`.
    """
    etype = event.get("type")

    if etype == "assistant":
        m.lead_turns += 1
        usage = event.get("message", {}).get("usage", {})
        m.lead_input_tokens += usage.get("input_tokens", 0)
        m.lead_output_tokens += usage.get("output_tokens", 0)
        for block in event.get("message", {}).get("content", []):
            btype = block.get("type")
            if btype == "text":
                m.summary_parts.append(block["text"])
            elif btype == "tool_use":
                name = block.get("name", "")
                if name == "Task":  # a delegation / handoff
                    m.handoff_count += 1
                    if m.first_handoff_turn is None:
                        m.first_handoff_turn = m.lead_turns
                elif name in ("Edit", "Write", "MultiEdit"):  # lead edited code itself
                    m.lead_code_edits += 1

    # Subagent (sidekick) activity is surfaced in nested/child events on some
    # CLI versions. If yours emits them, count them here:
    elif etype == "subagent" or etype == "child":
        m.sidekick_turns += 1
        usage = event.get("usage", {})
        m.sidekick_input_tokens += usage.get("input_tokens", 0)
        m.sidekick_output_tokens += usage.get("output_tokens", 0)


# --- Runner ---------------------------------------------------------------

async def run_delegated_task(
    task: str,
    lead: str,
    sidekick: str,
    allowed_tools: list[str],
) -> RunMetrics:
    protocol = DELEGATION_PROTOCOL.format(sidekick=sidekick)
    cmd = [
        "claude", "-p", task,
        "--model", lead,
        "--append-system-prompt", protocol,
        "--output-format", "stream-json",
        "--permission-mode", "acceptEdits",
        "--allowed-tools", ",".join(allowed_tools),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    m = RunMetrics()
    assert proc.stdout is not None
    async for raw in proc.stdout:
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            continue
        _accumulate(event, m)

    await proc.wait()
    if proc.returncode != 0 and proc.stderr is not None:
        err = (await proc.stderr.read()).decode(errors="replace")
        print(f"[warn] claude exited {proc.returncode}:\n{err}", file=sys.stderr)
    return m


# --- CLI ------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Lead/sidekick delegation demo.")
    ap.add_argument("task", help="What you want done.")
    ap.add_argument("--lead", default=DEFAULT_LEAD)
    ap.add_argument("--sidekick", default=DEFAULT_SIDEKICK)
    ap.add_argument(
        "--allowed-tools",
        default="Task,Read,Grep,Glob,Edit,Write,Bash(git:*),Bash(pytest:*)",
        help="Comma-separated tool allowlist. Task enables delegation.",
    )
    ap.add_argument("--dry-run", action="store_true",
                    help="Print the protocol + brief template and exit.")
    args = ap.parse_args()

    if args.dry_run:
        print("=== Delegation protocol (appended system prompt) ===\n")
        print(DELEGATION_PROTOCOL.format(sidekick=args.sidekick))
        print("\n=== Reusable brief template ===\n")
        print(BRIEF_TEMPLATE)
        return 0

    tools = [t.strip() for t in args.allowed_tools.split(",") if t.strip()]
    metrics = asyncio.run(
        run_delegated_task(args.task, args.lead, args.sidekick, tools)
    )

    print("\n" + "".join(metrics.summary_parts[-3:]).strip())
    print("\n" + metrics.report())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
