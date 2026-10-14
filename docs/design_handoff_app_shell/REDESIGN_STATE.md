# Redesign execution state

Live tracker for the plan in `cloud-agent-redesign.md`. The lead session updates
this file on `development` after each launch, merge, or wave transition so any
later session can resume from here.

**Lead session:** `session_01F95VctFJZth9U2iYETcc8c`
**Current wave:** 2 — four agents launched 2026-10-14 03:24 UTC
**Last updated:** 2026-10-14

## Decisions

- **Merge gate (cloud-only, no local runs):** the `PR Check` workflow
  (`.github/workflows/pr-check.yml`) must be green on the PR head: full
  `npm ci && npm run build` (incl. imgly prebuild) + pytest on GitHub runners.
  Then merge, and confirm the `Deploy Staging` run's `conclusion` is success
  before the next merge. Cloud sessions can't run the full build:
  `staticimgly.com` is blocked by the session proxy (403); agents use
  `npx vite build` for iteration only.
- **Why pre-merge matters:** `dev.yml` runs `terraform apply` *before* the SPA
  build, so a frontend build break after merge leaves staging half-deployed.
- **Agent runtime:** child cloud sessions (Sonnet tier) via `create_session`,
  each with `outcome_branch: redesign/<slug>`, reporting back by
  `send_message` to the lead session.
- **Release note:** as of 2026-10-14 `development` was 0 commits ahead of
  `main`, so the first dev → main release carries only redesign work.

## Decided

- Shortener module id stays `tools` (not `shortener`); default pins use `tools`.
- **Memes (user, 2026-10-14):** guests can see memes; only Memes-group members
  create/edit. Launcher: Memes open to all, Meme Generator gated by
  `canCreateMemes`. Fix for signed-in non-members being blocked from viewing:
  [#137](https://github.com/EchoNin9/funkedupshift/pull/137). Search stays members-only (backend).
- **Wave 2 ownership tweaks vs the plan:** `app-frame` owns only the `<Routes>`
  block of `AppLayout.tsx` (the route table lives there); `shell-desktop` owns
  the rest. Desktop `TopBar` replaces `DesktopHeaderBar`/`UserMenu`/`LeftSidebar`;
  mobile header path untouched until wave 3. No wave 2 agent edits `styles.css`.
  Body type scale (15px/1.55) deferred to wave 4.
- `--color-n1..n4` remain as aliases remapped onto the new palette until wave 4.

## Open questions

- **Staging not reachable from cloud sessions:** `stage.funkedupshift.com` is denied by
  the environment network policy, so staging spot-checks need it added under
  Allowed domains (or done by the user).

- Test credentials for user / group member / admin are needed for signed-in
  screenshots and staging spot-checks.

## Wave tracker

| Wave | Agent / branch | Session | PR | Status |
|---|---|---|---|---|
| 1 | `redesign/foundation` | `session_012RDDaaoPdSCUEfZ2uyANfF` (archived) | [#136](https://github.com/EchoNin9/funkedupshift/pull/136) | merged `779e156`; Deploy Staging run 426 success |
| 2 | `redesign/themes-api` | `session_013KbockRqzwxNAd5mu9ttvp` | — | launched |
| 2 | `redesign/shell-desktop` | `session_01CfgfuWvZwByKygyP7yHMbT` | — | launched |
| 2 | `redesign/app-frame` | `session_01Ati2nHZyx6KD4KZuNH9Ezu` | — | launched |
| 2 | `redesign/shortener` | `session_01AEXAGgAw83aKKGNJLtj3dk` | — | launched |
| 3 | `redesign/themes-ui` | — | — | not started |
| 3 | `redesign/homes` | — | — | not started |
| 3 | `redesign/tools-restyle` | — | — | not started |
| 3 | `redesign/mobile` | — | — | not started |
| 4 | `redesign/cleanup-qa` | — | — | not started |

## Wave 2 brief carry-overs (from #136 follow-ups)

- `shell-desktop`: decide body font size/line-height (15px/1.55) + heading scale;
  port `.btn/.input/.table/.dialog` set where names don't collide.
- Remaining heroicons in `ADMIN_MODULES`/`MODULE_GROUPS` stay until wave 4.

## Log

- 2026-10-14 — Wave 2 launched (themes-api, shell-desktop, app-frame, shortener). Memes fix PR #137 opened (lead, solo).

- 2026-10-14 — #136 merged (`779e156`); staging deploy success. Staging visual
  spot-check NOT done (host blocked from cloud session).

- 2026-10-14 — #136 opened; lead review OK; asked agent to drop 9 dead heroicons imports in modules.ts (would block wave 4's "remove heroicons if unused"). PR Check green (first run).
- 2026-10-14 — Added PR Check workflow as the pre-merge gate (user has no local machine).
- 2026-10-14 — Wave 1 launched (`redesign/foundation`, brief = PROMPTS 1 + 2 +
  `usePins()`; minimal `shell/theme.ts` edit allowed for `[data-theme]`).
