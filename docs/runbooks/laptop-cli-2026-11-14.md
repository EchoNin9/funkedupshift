# Laptop runbook: local Claude CLI session (2026-11-14) — FUNK-94

Tasks the **cloud** Claude session couldn't do: its GitHub access can't delete
branches or change repo settings, and its network can't reach funkedupshift.com or
AWS. A local `claude` session on your laptop has your `gh` auth, network and AWS
profile, so it can.

Anything that needs a web UI (no CLI/API path) is a manual Jira ticket instead.
See [Manual tasks](#manual-tasks-jira) at the bottom.

## How to start

The cloud session merged everything (PRs #187 to #194) to `main`, so start from `main`:

```bash
cd ~/path/to/funkedupshift
```

```bash
git fetch origin && git checkout main && git pull origin main
```

Then start Claude and paste this prompt:

```text
Read docs/runbooks/laptop-cli-2026-11-14.md and execute it top to bottom.
Run the preflight first and stop if anything fails. Before every step marked
DESTRUCTIVE, show me exactly what will change and wait for my "yes". Don't
skip the verification after each step. At the end, give me a table of every
step: done / skipped (why) / failed (output), and the findings from step 4.
```

---

## 0. Preflight (read-only)

| Check | Command | Expect |
|---|---|---|
| gh logged in, right account, `repo` scope | `gh auth status` | logged in to github.com, scopes include `repo` |
| Admin on the repo (needed for step 3) | `gh api repos/EchoNin9/funkedupshift --jq .permissions.admin` | `true` |
| Network to prod | `curl -sS -o /dev/null -w '%{http_code}\n' https://funkedupshift.com/config.js` | `200` |
| AWS profile (step 5 only) | `AWS_PROFILE=echo9 aws sts get-caller-identity` | your account |
| Python deps for the script | `python3 -c "import sys; print(sys.version)"` | 3.10+ (stdlib only) |

If admin is `false`, skip step 3 and note it. If the AWS profile fails, skip
step 5 and note it.

## 1. Confirm the cloud session's work is on `main` (read-only)

The cloud session merged and released PRs #187 to #194. Verify rather than redo:

1. `gh pr list --state open --author @me` → none of #192, #193, #194 listed.
2. `git fetch origin && git log --oneline origin/development..origin/main` and
   `git log --oneline origin/main..origin/development` → the second is empty
   (everything on `development` is on `main`).
3. `gh run list --workflow main.yml --branch main --limit 1 --json conclusion,headSha`
   → `success`, and `headSha` equals `git rev-parse origin/main`. (Check
   `conclusion` explicitly; don't pipe `gh run watch` into `tail`, see CLAUDE.md
   gotcha #3.)
4. `ls docs/runbooks/laptop-cli-2026-11-14.md scripts/find_duplicate_sites.py
   docs/scaling-sites-media.md` → all present locally.

If any check fails, stop and report. Don't merge anything without the
fresh-context review from CLAUDE.md.

## 2. Delete merged remote branches

Known merged branches from 2026-11-14:

- `fix/site-list-pagination-dedup` ([#187](https://github.com/EchoNin9/funkedupshift/pull/187))
- `docs/claude-md-test-notes` ([#189](https://github.com/EchoNin9/funkedupshift/pull/189))
- `fix/bpf-test-timestamp-flake` ([#190](https://github.com/EchoNin9/funkedupshift/pull/190))
- plus, after step 1: `fix/FUNK-91-fragile-substring-asserts`,
  `feature/FUNK-92-93-pr-review-rule-scaling-notes`, `docs/FUNK-94-laptop-runbook`

Also sweep for older ones:

1. List candidates: for every remote branch except `main` and `development`,
   it's deletable only if **all three** hold:
   - `gh pr list --state merged --head <branch> --json number` is non-empty, and
   - `gh pr list --state open --head <branch> --json number` is empty, and
   - `git merge-base --is-ancestor origin/<branch> origin/development` succeeds
     (no unmerged commits pushed after the merge).
2. Show me the table: branch, merged PR #, last commit date. Branches that
   fail any check go in a separate "kept (why)" list, and are **not** deleted.
3. **DESTRUCTIVE:** `git push origin --delete <branch>` for each approved one.
4. Verify: `git fetch --prune origin && git branch -r` → they're gone.
   Locally: `git branch -d <branch>` for any local copies (`-d`, not `-D`).

## 3. Repo setting: auto-delete branches after merge

So step 2 never has to happen again.

1. Read: `gh api repos/EchoNin9/funkedupshift --jq .delete_branch_on_merge`
2. If `false`, **DESTRUCTIVE (repo setting):**
   `gh repo edit EchoNin9/funkedupshift --delete-branch-on-merge`
3. Verify: re-run step 1 → `true`.

## 4. Audit existing duplicate site URLs (FUNK-90, read-only)

```bash
python3 scripts/find_duplicate_sites.py
```

- Reads prod's public `GET /sites` (API URL auto-discovered from
  `https://funkedupshift.com/config.js`) and groups by the **same**
  normalization as the add-site 409 gate.
- Exit 0 = no duplicates; 1 = duplicates listed; 2 = error.
- Report the output. **Don't delete anything:** deletions happen in the admin
  UI (manual ticket FUNK-90). For each group, recommend which copy to keep:
  the one with a rating, else the one with the better title/description, else
  the oldest.
- Optional: also run against staging with `--api-base <staging API URL>`
  (`terraform -chdir=infra output -raw apiInvokeUrl` in the staging workspace, or
  read staging's `/config.js`).

## 5. Measure real SITE item size (FUNK-93 prerequisite, read-only)

The scaling doc's cost model assumes ~20 KB per site item. Measure it:

1. Find the table: `AWS_PROFILE=echo9 aws dynamodb list-tables` (pick the prod
   main table; confirm with `describe-table` that it has the `byEntity` GSI).
2. Query the `byEntity` GSI for `entityType = SITE` with `--select COUNT
   --return-consumed-capacity TOTAL`, **paging manually** (`--no-paginate`,
   follow `LastEvaluatedKey`) and summing `Count` and
   `ConsumedCapacity.CapacityUnits` across pages.
3. Average item size ≈ `(sum of capacity units × 4 KB × 2) / count`. GSI reads
   are eventually consistent at 0.5 RCU per 4 KB, hence ×2.
4. Repeat for `entityType = MEDIA`.
5. Add the measured numbers to FUNK-93 (comment) and to the cost table in
   `docs/scaling-sites-media.md` on a new branch `docs/FUNK-93-measured-sizes`.
   Open a PR; don't merge without the fresh-context review.

Cost of running this: one full read of the SITE and MEDIA partitions, which is
cents.

## 6. Wrap-up

- Comment on each Jira ticket touched (FUNK-90, 91, 92, 93, 94) with what was
  done and links. Move FUNK-91 and FUNK-94 to Done if their PRs are merged and
  deployed.
- Report the summary table.

---

## Manual tasks (Jira)

These have no CLI/API path from this repo and need you in a browser:

| Ticket | Task | Where |
|---|---|---|
| FUNK-95 | Turn off Codex code review for `funkedupshift` | chatgpt.com → Codex → Settings → Code review |
| FUNK-96 | Re-add the Atlassian connector on the v2 endpoint (v1 removed 2027-03-01) | claude.ai → Settings → Connectors |
| FUNK-90 | Delete the duplicate sites that step 4 lists | funkedupshift.com admin → Websites |
