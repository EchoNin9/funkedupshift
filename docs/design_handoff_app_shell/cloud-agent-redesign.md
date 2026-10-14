# Cloud-agent plan: app shell + design system redesign

Runs the phases in `PROMPTS.md` as **parallel cloud agents**, each on its own
branch, merged into `development` by the lead. The spec is `README.md` (screens,
state, tokens), `DESIGN_SYSTEM.md` (rules), `styles.css` (source of truth for
tokens), and `prototype/AppShell.dc.html` (behaviour; its logic class holds the
app list and access rules).

## Ground rules (every agent)

- **Where:** one-time cloud routines (RemoteTrigger / `/schedule` with
  `run_once_at`, `clear_mcp_connections`). Don't use Agent `isolation: "remote"`,
  because it silently runs locally.
- **Branch:** `redesign/<slug>` cut from the latest `origin/development`. The PR
  targets `development` only. Never touch `main`.
- **Scope:** only touch the files your brief owns (see "File ownership" below).
  If you need a change in a file you don't own, write it under "Follow-ups" in
  the PR body instead of making it.
- **Keep behaviour:** Cognito auth, API calls, `canAccess*` / `hasRole`
  gating, impersonation, branding. Restyle and re-home features; don't rewrite
  their internals.
- **Tests:** the cloud sandbox can't run `npm run build`, because its prebuild
  step fetches imgly assets. Run `cd src/web/spa && npx vite build` instead
  (this skips prebuild), plus `.venv/bin/python -m pytest src/lambda/tests -q`
  for backend work. The lead re-runs the full `npm run build` locally before
  merging.
- **Typecheck:** `npm run typecheck` has existing errors and isn't the gate.
  Don't add new ones in the files you touch.
- **PR body:** list what changed, include build and test output, attach
  screenshots for UI work (desktop + 375px, dark + light), and list follow-ups.
- **No new deps** beyond `@phosphor-icons/react` (wave 1). Fonts load from
  Google Fonts.

## Waves

Agents within a wave run in parallel. A wave starts only after the previous
wave's PRs are merged to `development` and staging has deployed.

### Wave 1: foundation (1 agent, serial on purpose)

Every later wave imports these files, so one agent builds them.

| Agent | Phases | Owns |
|---|---|---|
| `redesign/foundation` | PROMPTS 1 + 2 + the `usePins()` hook from 4 | `src/styles.css`, `tailwind.config.cjs`, `index.html` (fonts and favicons), `package.json`/lock, `config/modules.ts`, `hooks/usePins.ts`, `public/` favicons + manifest |

Done means:
- The tokens from `styles.css` are implemented: dark by default, light under
  `[data-theme="light"]`. The old `--color-n1..n4` names stay as aliases.
- Tailwind theme values point at the CSS variables.
- Space Grotesk, Manrope and Syne 800 are loaded, and Phosphor is installed.
- Each `PUBLIC_MODULES` entry has `group`, `icon` and `description`.
  `getLauncherGroups(user)` returns `{locked, lockReason}`.
- `usePins()` is backed by localStorage (`funkedupshift_pins`) and uses the
  README's default pins.
- The UI looks the same apart from the new tokens and fonts.

### Wave 2: shell, frame, reference page, themes API (4 agents)

| Agent | Phases | Owns |
|---|---|---|
| `redesign/shell-desktop` | 3 + launcher/pin wiring from 4 | new `shell/TopBar.tsx`, `LauncherDrawer.tsx`, `AccountMenu.tsx`, `UpdatesBanner.tsx`, `LauncherContext` (exposes `openLauncher({focusSearch})` for homes and tabbar); `AppLayout.tsx`; deletes the use of `LeftSidebar`/`PopBackground`/`PopMarquee` (files stay until wave 4) |
| `redesign/app-frame` | 5 | new `components/AppPage.tsx` (breadcrumb, icon header, Pin button, "More in…" footer), `/apps/:group` section page, wrapping each routed feature/admin page in `AppPage`. **Route-table edits for `/apps/:group` only.** |
| `redesign/shortener` | 7 (ShortenerPage only) | `features/tools/ShortenerPage.tsx` and any small shared form/list pieces it extracts under `components/` |
| `redesign/themes-api` | 7b backend | Lambda routes (themes CRUD, admin only; `siteSettings` get/put; `pins`, `themeId` and `mode` on the profile), seed data (Funk/Ember/Lagoon/Neon), matching `aws_apigatewayv2_route`s in `infra/`, pytest coverage incl. `test_route_coverage.py` |

Contracts between wave 2 agents:
- `app-frame` must not edit `AppLayout.tsx`. `shell-desktop` must not wrap
  feature pages.
- `themes-api` writes numbers to DynamoDB as `Decimal` (theme `tint`); tests
  should assert the type. A missing `themeId` resolves to the site default
  when read, so no migration is needed.
- `shortener` has a deep-link-only fallback if `AppPage` hasn't merged yet.
  Merge order sorts this out (see below).

Merge order: `foundation` is already in → `themes-api` → `shell-desktop` →
`app-frame` → `shortener`. The lead rebases (or asks the agent to rebase) each
one onto the new `development` before merging.

### Wave 3: homes, mobile, themes UI, tool restyle (4 agents)

| Agent | Phases | Owns |
|---|---|---|
| `redesign/homes` | 6 | `HomePage` → guest landing + signed-in dashboard; recent-routes hook (last 6, localStorage); uses `openLauncher`, `usePins`, tools `listLinks` |
| `redesign/mobile` | 8 | `TabBar.tsx`, the mobile CSS/sheet variants of `LauncherDrawer` and `AccountMenu` (positioning and animation only), `MobileAppShell.tsx`; retires `MobileBottomTabs`/`MobileMorePage`/`MobileHeader` usage |
| `redesign/themes-ui` | 7b frontend | `ThemeProvider` (port `themeCSS()`), `theme.ts`/`ThemeToggle.tsx`, the Appearance **content** inside `AccountMenu`, `/admin/themes` page + route, moving `usePins` to the profile API (localStorage kept as a cache) |
| `redesign/tools-restyle` | 7 (other tool pages) | `features/tools/*` except Shortener, plus my-info and lipsync page markup; reuses the shortener patterns; no logic changes |

Contract: `mobile` and `themes-ui` both touch `AccountMenu.tsx`. `mobile` only
handles layout and wrappers, and `themes-ui` only handles the Appearance
section. Merge `themes-ui` first, then rebase `mobile`.

Merge order: `themes-ui` → `homes` → `tools-restyle` → `mobile`.

### Wave 4: clean-up + QA (1 agent)

| Agent | Phases | Owns |
|---|---|---|
| `redesign/cleanup-qa` | 9 | Deletes `pop-*` CSS, the `--color-n*` aliases, Syne outside the brand mark, `PopBackground`, `PopMarquee`, `LeftSidebar`, the SidebarCollapse context, and `@heroicons/react` if it's unused. Writes `docs/design_handoff_app_shell/QA.md` (guest / user / group member / admin × dark / light × desktop / 375px) and fixes what it finds. |

## Lead loop (per wave)

1. Launch the wave's routines with the brief template below.
2. As each PR arrives, review it with `gh pr diff`, not by pulling files into
   context. If something is wrong, comment on the PR or send a re-brief rather
   than rewriting it yourself.
3. Merge **one PR at a time** into `development`:
   - `git fetch && gh pr checkout N`, then rebase onto `origin/development`
     if needed.
   - Locally, run `cd src/web/spa && npm run build`, plus pytest if backend
     files changed.
   - `gh pr merge N --merge`, then wait for the staging deploy. Check
     `gh run view <id> --json conclusion` rather than piping `gh run watch`
     through `tail`.
   - Don't merge back to back: concurrent deploys hit the terraform state lock.
4. Spot-check staging in a browser: dark and light, desktop and 375px.
5. When all of a wave's PRs are on staging, start the next wave.
6. After wave 4 passes QA on staging, open a PR from `development` to `main`.
   That PR is the production release.

## Brief template (fill one per agent)

```
TASK:        Implement <phase(s)> of docs/design_handoff_app_shell (see cloud-agent-redesign.md, agent <slug>).
READ FIRST:  README.md §<n>, DESIGN_SYSTEM.md, styles.css, prototype/AppShell.dc.html (logic class at bottom).
CONSTRAINTS: Branch redesign/<slug> from origin/development; PR → development only. Only touch the files
             listed for <slug>. Keep auth/API/gating/impersonation/branding behaviour. No new deps.
EDGE CASES:  guest vs user vs group member vs admin; locked apps; dark + light; ≤640px; prefers-reduced-motion.
DONE MEANS:  <copy that agent's "done" bullets / owns-column outcome>. `npx vite build` passes
             (+ pytest for backend). No new typecheck errors in touched files.
REPORT BACK: PR body with summary, diff stat, build/test output, screenshots, follow-ups. Do not merge.
```

## Risks

- **AppLayout / route-table conflicts:** handled by ownership and the merge
  order. Rebase before every merge.
- **Wave 1 is the bottleneck:** keep its scope tight. Nothing visual beyond
  tokens and fonts.
- **Cloud build gap:** `npx vite build` skips prebuild, so the lead's local
  `npm run build` is the real gate.
- **Profile schema:** `pins` stays in localStorage until `themes-ui` moves it
  to the API. Once both exist, the API is the source of truth.
- **Release bundling:** `development` currently carries unreleased
  `impeccable` fixes that are ahead of `main`. They go to production with the
  next dev → main merge.
