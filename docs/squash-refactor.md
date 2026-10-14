# Squash refactor

## Context
Squash data is shared by everyone right now. Players and matches are global rows (`SQUASH#PLAYER#…` and `SQUASH#MATCH#…`). Only managers in the "Squash" custom group can change them, through a separate `/squash-admin` page that also shows up in the admin sidebar.

**Goal:** make Squash a private, per-user module.
- Every member of the Squash group can record and view **only their own** players and matches.
- The admin tools move inside the module.
- Users can publish search results as public share pages that expire.

**Decisions already made:**
- **Access:** keep the "Squash" custom-group gate (Cognito `admin` also passes). Drop the manager-only rule for changing data.
- **Old data:** a one-off script moves all existing global players and matches to **adam@echo9.net** (Cognito sub `44087408-3081-70b2-062c-74dc3b313c63`, pool `fus-user-pool` `us-east-1_60qcom7aZ`).
- **Share type:** chosen per share with a toggle:
  - **"Snapshot"** freezes the results.
  - **"Updates Live"** saves the filters and re-runs them against the owner's data every time the page is viewed.

When the plan is approved, copy this file to `docs/squash-refactor.md`. It is a single file, so it doesn't need a subfolder.

## Data model (main table, single-table)
| Entity | PK | SK | Attributes |
|---|---|---|---|
| Player | `USER#<sub>` | `SQUASH#PLAYER#<uuid>` | `name` (drop `email` and `userId`; the `/admin/users` picker is admin-only) |
| Match | `USER#<sub>` | `SQUASH#MATCH#<uuid>` | `date`, `teamA/BPlayer1/2Id`, `winningTeam`, `teamAGames`/`teamBGames`, `tags` |
| Share | `SQUASH#SHARE#<token>` | `METADATA` | `ownerId`, `title`, `mode` (`snapshot`/`live`), `filters`, `snapshot` (matches with player **names** already filled in), `createdAt`, `expiresAt` (epoch seconds), `entityType=SQUASH_SHARE`, `entitySk=<sub>#<createdAt>` |

- **Listing matches:** Query `PK=USER#sub` with `begins_with(SK,"SQUASH#MATCH#")`, then filter by date and players in Python. This replaces the `bySquashDate` GSI and the per-player link rows. `# ponytail: whole-partition query per search; fine to thousands of matches per user, add a date-sorted SK if it gets slow.`
- **Listing a user's shares:** reuse the existing `byEntity` GSI (`entityType=SQUASH_SHARE`, `begins_with(entitySk, "<sub>#")`).
- **Share token:** `secrets.token_urlsafe(16)`, the same as text share (`tools/handler.py::mintTextPaste`).
- **TTL:** add a `ttl { attribute_name = "expiresAt", enabled = true }` block to `aws_dynamodb_table.main` (`infra/main.tf:588`).
  - **First, grep the main table for any existing `expiresAt` writes.** If any exist, use a different attribute name.
  - DynamoDB can take up to about 48 hours to delete an expired row, so every read must also check `expiresAt > now`. Text share does the same (`getTextPastePublic`).
- **Writes:** use `Decimal` for numbers (see the lipsync DynamoDB float gotcha in CLAUDE.md).

## Backend: `src/lambda/api/`
- Move the squash section out of `handler.py` (lines ~4865-5420) into a new `api/squash.py`, rewritten so every function is scoped to the caller's `sub`. `handler.py` keeps only the dispatch lines.
- **Auth:** every route uses `_requireSquashAccess` (Cognito `admin` or the `Squash` custom group). Delete `_requireSquashModify` and `_canModifySquash`.
- **Ownership:** any operation on an id that isn't in the caller's partition returns **404**, so it never reveals that the id exists.
- **Routes:**
  - **Unchanged:** `GET/POST/PUT/DELETE /squash/players` and `/squash/matches`. Same contracts, except players only take `{name}`. Match validation stays as `_validateSquashMatchBody`, and each player id must belong to the caller.
  - **`GET /squash/shares`:** lists the caller's unexpired shares. Returns `{shares, count, limit: 10}`.
  - **`POST /squash/shares`:** body is `{title, mode, filters, expiresInDays}`.
    - `expiresInDays` must be an integer from 1 to 90, default 30. Anything else returns 400.
    - If the caller already has 10 or more unexpired shares, return **409**.
    - For `snapshot`, the server runs the filters and stores the results. It doesn't trust results sent by the client.
    - Cap a snapshot at 500 matches, because a DynamoDB item can't exceed 400 KB.
  - **`PUT /squash/shares`:** body is `{id, title?, mode?, filters?, expiresInDays?, refresh?}`.
    - `expiresInDays` resets the expiry to now + that many days.
    - `refresh` re-runs the filters into the snapshot.
    - Returns 404 if the share isn't the caller's.
  - **`DELETE /squash/shares?id=`:** deletes one of the caller's shares.
  - **`GET /squash/public/{id}`:** public, with **no authorizer** and no claim reads.
    - Dispatch it with `path.startswith("/squash/public/")`, like the `/tools/text/` routes.
    - Returns `{title, mode, expiresAt, matches}`, with player names already filled in.
    - `live` re-runs `filters` on the owner's partition. Player names come from the owner's player rows.
    - Never return `ownerId` or player ids.
    - Returns 404 if the share is missing or expired.
- `# ponytail: 10-share cap is count-then-put (a tiny race can make 11); a conditional counter item fixes it if that ever matters.`

## Infra: `infra/main.tf`
- Keep the 8 existing squash routes (`main.tf:1650-1714`).
- Add 4 JWT routes for `/squash/shares` (GET/POST/PUT/DELETE).
- Add 1 public route, `GET /squash/public/{id}`, with no `authorization_type`, like `tools.tf:439`.
- Add the TTL block.
- `src/lambda/tests/test_route_coverage.py` must stay green.

## Frontend: `src/web/spa/src/`
- **Remove squash-admin:**
  - Delete `features/squash/SquashAdminPage.tsx`.
  - Delete the `/squash-admin` routes in `shell/AppLayout.tsx:130` and `shell/MobileAppShell.tsx:131`.
  - In `config/modules.ts`, remove the `squash-admin` entries at line 88, line 116 (`ADMIN_MODULES`), and the link in `MODULE_GROUPS` (lines 236-243).
  - Remove the "Squash Admin" link in `SquashPage.tsx:301-307` and the related icons in `MobileMorePage.tsx`.
  - Delete `canModifySquash` from `shell/AuthContext.tsx`.
- **`SquashPage.tsx`:** gated by `canAccessSquash`. It gets three tabs:
  - **Matches:** the current search UI plus the add/edit/delete match form, moved over from SquashAdminPage. A **"Share results"** button opens the share dialog.
  - **Players:** add, rename, and delete players (name only).
  - **Shares:** shows "n/10". Each share is listed with its title, mode badge, expiry date, the public link, and a `CopyButton`. Each row has Edit (title, Snapshot/Updates Live toggle, days, "refresh from current search") and Delete.

  Split the forms into small files under `features/squash/` if `SquashPage` would grow past about 800 lines.
- **Share dialog:**
  - Title.
  - A segmented toggle with **"Snapshot"** and **"Updates Live"**.
  - `<input type="number" min=1 max=90>` for days, default 30.
  - After it's created, show the URL `${origin}/squash/s/<id>` with `components/CopyButton.tsx`.
  - Disable the dialog with a message when the user is at 10/10.
- **New public page `features/squash/SquashSharePage.tsx` at `/squash/s/:id`:**
  - Add the route in both `AppLayout` and `MobileAppShell`, alongside the `/t/:id` route.
  - It is read-only. It uses a plain `fetch` with no `useAuth`, modelled on `features/textshare/TextViewPage.tsx`.
  - Shows the title, the matches, a "Live"/"Snapshot as of …" note, and the expiry date.
  - Shows a "Share expired or not found" state on 404.

## Migration: `scripts/migrate-squash-to-user.py`
- **Arguments:** `--owner-sub 44087408-3081-70b2-062c-74dc3b313c63`, plus `--table <name>`; generic form: `--owner-sub <sub> --table <name> [--dry-run]`. Pass AWS profile and region as inline flags, because of the zsh gotcha in CLAUDE.md.
- **Steps:**
  - Query `byEntity` for `SQUASH_PLAYER` and `SQUASH_MATCH`.
  - Write each row into the new owner-partition shape, keeping the same uuids so match→player references still resolve.
  - Delete the old rows and the `MATCH#…` link rows.
  - It is safe to re-run.
- **Order:**
  1. Deploy to staging.
  2. Run the script on staging with `--dry-run`, then for real.
  3. Verify on staging.
  4. Merge to `main`.
  5. Run the script on prod right after that deploy.
- **Follow-up, not in this change:** drop the `bySquashDate` GSI and its attribute definitions.

## Tests: rewrite `src/lambda/tests/test_squash_handlers.py`
- No group → 403. Squash-group `user` (not manager) can create, update and delete. `admin` passes.
- Isolation: user B gets 404 on GET/PUT/DELETE of user A's match, player or share. A match that uses another user's player id → 400.
- Shares:
  - `expiresInDays`: 0 → 400, 91 → 400, missing → 30 days, 90 → OK.
  - 10 shares exist → 11th returns 409. Expired shares don't count toward the limit.
  - Public GET: expired → 404, missing → 404, response has no `ownerId` or player ids.
  - Snapshot ignores matches added after it was taken. Live includes them.
  - `PUT refresh` re-snapshots. `PUT expiresInDays` resets `expiresAt`.
- Numbers written to DynamoDB are `Decimal`. Assert the type, not just the value.
- A small test for the migration's pure transform function, if it has one.

## Verification
- `.venv/bin/python -m pytest src/lambda/tests -q`: everything green (896+ tests), including route coverage.
- `cd src/web/spa && npm run build`.
- On staging, check the following in a browser:
  - Two accounts that are both in Squash can't see each other's data.
  - `/squash-admin` is gone from the admin sidebar and the nav.
  - Create a Snapshot share and an Updates Live share, open both links in a private window, and confirm the Copy button works.
  - Record a new match and confirm only the live share shows it.
  - The 11th share is blocked.
  - Delete a share and confirm its link returns 404.
- After migration, the old global matches show up under Adam's account.

## Delegation
Following CLAUDE.md, the lead (me) hands out two Sonnet sidekick briefs, then reviews with `git diff` and owns the commits:
1. Backend, infra and tests.
2. Frontend, using the API contract above.

Each brief ends with "report the diff + test results before committing." The migration script goes with brief 1.
