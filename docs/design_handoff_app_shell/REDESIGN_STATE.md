# Redesign execution state

Live tracker for the plan in `cloud-agent-redesign.md`. The lead session updates
this file on `development` after each launch, merge, or wave transition so any
later session can resume from here.

**Lead session:** `session_01F95VctFJZth9U2iYETcc8c`
**Current wave:** 1 (foundation) — in progress
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

## Open questions

- Test credentials for user / group member / admin are needed for signed-in
  screenshots and staging spot-checks.
- Existing `shell/UserMenu.tsx`, `DesktopHeaderBar.tsx`, `Header.tsx` aren't
  named in the plan; the wave 2 `shell-desktop` brief must say whether
  `TopBar`/`AccountMenu` replace them.

## Wave tracker

| Wave | Agent / branch | Session | PR | Status |
|---|---|---|---|---|
| 1 | `redesign/foundation` | `session_012RDDaaoPdSCUEfZ2uyANfF` | — | launched 2026-10-14 |
| 2 | `redesign/themes-api` | — | — | not started |
| 2 | `redesign/shell-desktop` | — | — | not started |
| 2 | `redesign/app-frame` | — | — | not started |
| 2 | `redesign/shortener` | — | — | not started |
| 3 | `redesign/themes-ui` | — | — | not started |
| 3 | `redesign/homes` | — | — | not started |
| 3 | `redesign/tools-restyle` | — | — | not started |
| 3 | `redesign/mobile` | — | — | not started |
| 4 | `redesign/cleanup-qa` | — | — | not started |

## Log

- 2026-10-14 — Added PR Check workflow as the pre-merge gate (user has no local machine).
- 2026-10-14 — Wave 1 launched (`redesign/foundation`, brief = PROMPTS 1 + 2 +
  `usePins()`; minimal `shell/theme.ts` edit allowed for `[data-theme]`).
