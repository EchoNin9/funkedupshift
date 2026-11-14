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
| AWS profile (step 5 only) | `aws sts get-caller-identity --profile echo9 --region us-east-1` | your account |
| Python deps for the script | `python3 -c "import sys; print(sys.version)"` | 3.10+ (stdlib only) |

If admin is `false`, skip step 3 and note it. If the AWS profile fails, skip
step 5 and note it.

## 1. Confirm the cloud session's work is on `main` (read-only)

The cloud session merged and released PRs #187 to #194. Verify rather than redo:

1. `for n in 187 188 189 190 191 192 193 194; do gh pr view $n --json number,state,mergedAt --jq '"\(.number) \(.state)"'; done`
   → every one `MERGED`.
2. `git fetch origin && git log --oneline origin/development..origin/main` and
   `git log --oneline origin/main..origin/development` → the second is empty
   (everything on `development` is on `main`).
3. `gh run list --workflow main.yml --branch main --limit 1 --json conclusion,headSha`
   → `success`, and `headSha` equals `git rev-parse origin/main`. If `status`
   isn't `completed` yet (`conclusion` is empty), wait and re-check. Don't treat
   it as passed. (Check
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

1. List candidates: for every remote branch except `main`, `development` and the
   `origin/HEAD -> origin/main` pointer line,
   it's deletable only if **all four** hold:
   - `gh pr list --state merged --head <branch> --json number` is non-empty, and
   - `gh pr list --state open --head <branch> --json number` is empty, and
   - `git merge-base --is-ancestor origin/<branch> origin/development` succeeds
     (no unmerged commits pushed after the merge), and
   - `gh pr list --state open --base <branch> --json number` is empty
     (deleting the **base** of an open PR closes that PR; GitHub doesn't retarget it).
2. Show me the table: branch, merged PR #, last commit date. Branches that
   fail any check go in a separate "kept (why)" list, and are **not** deleted.
3. **DESTRUCTIVE:** `git push origin --delete <branch>` for each approved one.
4. Verify: `git fetch --prune origin && git branch -r` → they're gone.
   Locally: `git branch -d <branch>` for any local copies (`-d`, not `-D`).

## 3. Protect `main`/`development`, then auto-delete merged branches

So step 2 never has to happen again. **Order matters.** Today no branch is
protected (`gh api repos/EchoNin9/funkedupshift/branches --jq '.[]|select(.protected)'`
returns nothing). With auto-delete on, merging a `development` → `main` release
PR would **delete `development`**, because it's that PR's head branch. GitHub would
then retarget every open PR onto `main`, and staging auto-deploy would stop.
GitHub never auto-deletes a branch that a rule protects from deletion, so protect
first.

1. Read the current state:
   - `gh api repos/EchoNin9/funkedupshift --jq .delete_branch_on_merge`
   - `gh api repos/EchoNin9/funkedupshift/rulesets`
2. **DESTRUCTIVE (repo setting):** create a ruleset that only blocks deleting
   `main` and `development`. No other restrictions, so pushes, merges and
   deploys behave exactly as today:

   ```bash
   gh api -X POST repos/EchoNin9/funkedupshift/rulesets --input - <<'JSON'
   {
     "name": "protect-long-lived-branches",
     "target": "branch",
     "enforcement": "active",
     "conditions": {"ref_name": {"include": ["refs/heads/main", "refs/heads/development"], "exclude": []}},
     "rules": [{"type": "deletion"}]
   }
   JSON
   ```

3. Verify **both** before going on, and **stop here** if either check fails:
   - `gh api repos/EchoNin9/funkedupshift/rules/branches/development --jq '[.[].type]'` → contains `"deletion"`
   - `gh api repos/EchoNin9/funkedupshift/rules/branches/main --jq '[.[].type]'` → contains `"deletion"`
4. **DESTRUCTIVE (repo setting):** `gh repo edit EchoNin9/funkedupshift --delete-branch-on-merge`
5. Verify: `gh api repos/EchoNin9/funkedupshift --jq .delete_branch_on_merge` → `true`.

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
- There's no separate staging dataset: `dev.yml` and `main.yml` share one
  Terraform state, so staging and prod use the **same API and DynamoDB table**
  (only the CloudFront distribution differs). One run covers both.

## 5. Measure real SITE item size (FUNK-93 prerequisite, read-only)

The scaling doc's cost model assumes ~20 KB per site item. Measure it:

1. Find the table: it's `var.dynamoTableName` in `infra/` (shared by staging and
   prod, see step 4). Confirm with
   `aws dynamodb describe-table --table-name <name> --profile echo9 --region us-east-1 --query 'Table.GlobalSecondaryIndexes[].IndexName'`
   → includes `byEntity`. Use `--profile echo9 --region us-east-1` on every AWS command.
2. Query the `byEntity` GSI for `entityType = SITE` with `--select COUNT
   --return-consumed-capacity TOTAL`, **paging manually** (`--no-paginate`,
   follow `LastEvaluatedKey`) and summing `Count` and
   `ConsumedCapacity.CapacityUnits` across pages.
3. Average item size ≈ `(sum of capacity units × 4 KB × 2) / count`. GSI reads
   are eventually consistent at 0.5 RCU per 4 KB, hence ×2.
4. Repeat for `entityType = MEDIA`.
5. Add the measured numbers to FUNK-93 (comment) and to the cost table in
   `docs/scaling-sites-media.md` on a new branch `feature/FUNK-93-measured-sizes`.
   Open a PR; don't merge without the fresh-context review.

Cost of running this: one full read of the SITE and MEDIA partitions, which is
cents.

## 6. Wrap-up

- If this session has Jira access (Atlassian MCP connector): comment on each
  ticket touched (FUNK-90, 93, 94) with what was done and links, and move FUNK-94
  to Done. If it doesn't, put the per-ticket notes in the final report so I can
  paste them.
- Report the summary table.

---

## Manual tasks (Jira)

These have no CLI/API path from this repo and need you in a browser:

| Ticket | Task | Where |
|---|---|---|
| FUNK-95 | Turn off Codex code review for `funkedupshift` | chatgpt.com → Codex → Settings → Code review |
| FUNK-96 | Re-add the Atlassian connector on the v2 endpoint (v1 removed 2027-03-01) | claude.ai → Settings → Connectors |
| FUNK-90 | Delete the duplicate sites that step 4 lists | funkedupshift.com admin → Websites |
