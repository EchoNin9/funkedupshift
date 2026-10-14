# Redesign execution state

Live tracker for the plan in `cloud-agent-redesign.md`. The lead session updates
this file on `development` after each launch, merge, or wave transition so any
later session can resume from here.

**Lead session:** `session_01F95VctFJZth9U2iYETcc8c`
**Current wave:** 3 — four agents launched 2026-10-14 03:50 UTC (wave 2 fully merged)
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
| 2 | `redesign/themes-api` | `session_013KbockRqzwxNAd5mu9ttvp` (archived) | [#142](https://github.com/EchoNin9/funkedupshift/pull/142) | merged `4cb905a`; deploy run 432 success (terraform routes applied) |
| 2 | `redesign/shell-desktop` | `session_01CfgfuWvZwByKygyP7yHMbT` (archived) | [#139](https://github.com/EchoNin9/funkedupshift/pull/139) | merged `90057c6` (before themes-api: backend-only, no dependency); deploy run 428 success |
| 2 | `redesign/app-frame` | `session_01Ati2nHZyx6KD4KZuNH9Ezu` (archived) | [#138](https://github.com/EchoNin9/funkedupshift/pull/138) | merged `6d00080`; deploy run 430 success |
| 2 | `redesign/shortener` | `session_01AEXAGgAw83aKKGNJLtj3dk` (archived) | [#140](https://github.com/EchoNin9/funkedupshift/pull/140) | merged `c62a9e7`; deploy run 431 success |
| 3 | `redesign/themes-ui` | `session_014NWXMLfXzFu1RdmmAfEJxG` | — | launched |
| 3 | `redesign/homes` | `session_013cQk2vfzAHwv7DqgUWaMFV` | [#143](https://github.com/EchoNin9/funkedupshift/pull/143) | reviewed; fixed branding hero + per-user recents (`55e58ff`); merges after themes-ui |
| 3 | `redesign/tools-restyle` | `session_018EbfRP2kn4e2m5KJikjXsU` | — | launched |
| 3 | `redesign/mobile` | `session_018Cja9GAUnWfsjmkTDU7uKV` | — | launched |
| 4 | `redesign/cleanup-qa` | — | — | not started |

## Wave 2 brief carry-overs (from #136 follow-ups)

- `shell-desktop`: decide body font size/line-height (15px/1.55) + heading scale;
  port `.btn/.input/.table/.dialog` set where names don't collide.
- Remaining heroicons in `ADMIN_MODULES`/`MODULE_GROUPS` stay until wave 4.

## Wave 3 brief decisions

- **tools-restyle scope correction:** tool pages live in `features/{passwordgen,imagetool,croptool,removebg,dnstool,textshare,converters,myinfo,lipsync}` + `features/tools/ToolsIndexPage.tsx`, not `features/tools/*` as the plan says.
- **Admin > Themes is admin-only** (backend `_requireAdmin`); README said managers too — following the backend. One-line change per route if managers should get it.
- **themes-ui** owns `usePins.ts` (move to profile API, keep #141 same-tab sync), the Appearance section in `AccountMenu`, one `/admin/themes` route + `ADMIN_MODULES` entry. Skips saving prefs while impersonating.
- **homes** owns `HomePage` + new `useRecentRoutes` (`funkedupshift_recent`), one call site in `AppPageLayout`.
- **mobile** owns `TabBar`, mobile sheet wrappers of `LauncherDrawer`/`AccountMenu`, `MobileAppShell`, `AppLayout` mobile chrome outside `<Routes>`; must carry the impersonation banner on mobile.
- Merge order: themes-ui → homes → tools-restyle → mobile.

## Log

- 2026-10-14 — Wave 2 staging deploys all green (runs 427–432). #143 homes re-briefed: keep admin Branding hero fields; recents keyed per user, no admin record ids.

- 2026-10-14 — Wave 2 complete: #140 shortener merged (`c62a9e7`), #142 themes-api merged (`4cb905a`). Wave 3 launched (user go-ahead).

- 2026-10-14 — #141 usePins sync merged (`4b016f6`). Merge order adjusted: shell-desktop → #141 → app-frame → shortener → themes-api (backend fixes landed later).

- 2026-10-14 — #137 memes fix merged (`3da866b`), deploy success. #139 shell-desktop merged (`90057c6`).
  Lead fix PR [#141](https://github.com/EchoNin9/funkedupshift/pull/141): `usePins` same-tab sync
  (launcher + AppPage Pin button each mount the hook). Wave 3 `themes-ui` must keep this behaviour.

- 2026-10-14 — Wave 2 launched (themes-api, shell-desktop, app-frame, shortener). Memes fix PR #137 opened (lead, solo).

- 2026-10-14 — #136 merged (`779e156`); staging deploy success. Staging visual
  spot-check NOT done (host blocked from cloud session).

- 2026-10-14 — #136 opened; lead review OK; asked agent to drop 9 dead heroicons imports in modules.ts (would block wave 4's "remove heroicons if unused"). PR Check green (first run).
- 2026-10-14 — Added PR Check workflow as the pre-merge gate (user has no local machine).
- 2026-10-14 — Wave 1 launched (`redesign/foundation`, brief = PROMPTS 1 + 2 +
  `usePins()`; minimal `shell/theme.ts` edit allowed for `[data-theme]`).
