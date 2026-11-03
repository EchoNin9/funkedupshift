# Pro refactor — START HERE

Goal: make the native app (Android + iOS) match the funkedupshift web app's current UI/UX, feature set and
auth-gated display. That's the app-shell redesign shipped to production on 2026-10-14 (PR #149).

Written 2026-10-14 from reading `docs` and the SPA source.

---

## The one fact that shapes this plan

**There is no separate mobile codebase.** The native app is the funkedupshift React SPA
(`src/web/spa`) wrapped in Capacitor 8 (`appId com.funkedupshift.fus`). The
`android/` and `ios/` native projects, `capacitor.config.ts` and the release workflow
(`.github/workflows/mobile-release.yml`) all live in funkedupshift.

The sibling `fus-mobile` folder (not a git repo) holds only release artifacts: `android/app-release.aab`,
`funkedupshift-0.1.6.aab.zip` (April 2026), keystores and a keystore notes file.

At runtime the SPA forks on `Capacitor.isNativePlatform()` (`shell/AppLayout.tsx:261`):

- **Web** gets `AppLayoutContent`: the redesigned shell with TopBar or MobileTopBar, LauncherDrawer
  (a bottom sheet at ≤640px), TabBar, AccountMenu sheet, AppPageLayout frame, pins, recents,
  UpdatesBanner and ImpersonationBanner.
- **Native** gets `MobileAppShell`: the pre-redesign shell with its own hard-coded route table,
  MobileBottomTabs, the `/more` page, `/mobile-settings` tab toggles and the old Marquee.

The web build already has a complete phone layout. **The refactor deletes the native fork and lets
native render the same shell.** We don't port anything. The redesign team flagged this as the open
follow-up: "native app: MobileAppShell still uses MobileBottomTabs/MobileMorePage"
(`docs/design_handoff_app_shell/REDESIGN_STATE.md`). Their blocker was needing a route table shared
with AppLayout. That blocker goes away once native stops having its own table.

**Decision: all code changes land in this repo (funkedupshift)** on `development`, following its CLAUDE.md
(delegation protocol, PR Check gate, never push to `main`). Don't fork the SPA into `fus-mobile`, or
every web change has to be ported twice forever. `fus-mobile` keeps only the release artifacts.

---

## Docs in this folder (read in order)

| # | Doc | What it covers |
|---|---|---|
| 1 | [01-gap-analysis.md](01-gap-analysis.md) | Native vs web: routes, shell, gating, and the native-only bugs found |
| 2 | [02-phase1-shell-unification.md](02-phase1-shell-unification.md) | Delete MobileAppShell; native renders the web shell. **This is most of the work.** |
| 3 | [03-phase2-native-fixes.md](03-phase2-native-fixes.md) | Things that break only inside a WebView: share URLs, downloads, external links, fonts, back button |
| 3b | [03b-file-saving.md](03b-file-saving.md) | **Must fix**: every save/download/attachment path, with one helper on Filesystem + Share + Browser |
| 4 | [04-parity-qa-matrix.md](04-parity-qa-matrix.md) | Every route × persona, with expected visibility. This is the acceptance checklist. |
| 5 | [05-release.md](05-release.md) | Version bump, Android/iOS build and store rollout, artifact and keystore hygiene |

## Phases at a glance

1. **Shell unification** (one PR, mostly deletions). Native = web shell plus safe-area insets. This alone
   brings over every missing route, the launcher, pins, the app frame, the theme picker, impersonation and gating.
2. **Native fixes** (one PR, small and independent items). Fix what a WebView does differently from a browser.
3. **QA** on real devices with the four personas (guest, user, group member, admin), using matrix doc 04.
4. **Release** as 0.2.0 to Play internal testing, then production. iOS follows if the Apple account is set up.

## Definition of done

- `MobileAppShell.tsx`, `MobileBottomTabs.tsx`, `MobileMorePage.tsx`, `MobileSettingsPage.tsx`,
  `MobileModulesContext.tsx` and `hooks/useMobileModules.ts` are deleted, and `AppLayout` has no `isNative` branch.
- Every row in doc 04 passes on an Android device for all four personas. Spot-check on iOS if built.
- Share links copied in the app open on `funkedupshift.com`, not `localhost`.
- Every Download button and attachment works on Android: device-made files go to the share sheet, server files open in the system browser (03b).
- A signed AAB built from `development` has been uploaded to Play internal testing.

## Rules carried over from funkedupshift

- Gate on `npm run build` in `src/web/spa`, not `typecheck`, which has known pre-existing errors.
- Gating is defined only in `config/modules.ts` and the `canAccess*` helpers in `shell/AuthContext.tsx`.
  Don't add mobile-specific gating.
- The Cognito group `admin` maps to the frontend role **`superadmin`**. No `"admin"` role literal exists.
- The backend enforces auth. Frontend gating only controls what's shown. Nothing in this plan changes the API.
