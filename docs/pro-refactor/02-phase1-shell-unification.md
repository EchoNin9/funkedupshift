# 02 — Phase 1: shell unification

**One PR to `development` in funkedupshift.** Expected diff: around −550 lines, +20.

## Change

1. `shell/AppLayout.tsx`: remove the `isNative` branch so `AppLayout` always renders
   `<LauncherProvider><AppLayoutContent/></LauncherProvider>`. Drop the `MobileAppShell` and `usePlatform` imports.
2. Delete:
   - `shell/MobileAppShell.tsx`
   - `shell/MobileBottomTabs.tsx`
   - `shell/MobileMorePage.tsx`
   - `shell/MobileSettingsPage.tsx`
   - `shell/MobileModulesContext.tsx`
   - `hooks/useMobileModules.ts`
3. Route table: add `<Route path="/more" element={<Navigate to="/" replace />} />` and the same for `/mobile-settings`.
   Mark them `// ponytail: drop after 0.2.x is the minimum installed version`.
4. Safe areas:
   - `MobileTopBar` already pads `env(safe-area-inset-top)`, and the TabBar spacer uses `safe-area-inset-bottom`.
   - `index.html` already has `viewport-fit=cover`, which iOS needs for the insets to be non-zero.
   - `TopBar` (desktop, tablets) has no top inset. Add `paddingTop: env(safe-area-inset-top)` only if a tablet shows content under the status bar.
5. Footer on native: the site footer ("All data public…") is fine to keep. Hide it on native only if QA says it looks wrong.
   One `isNative &&` is enough; don't add a new component.

`PlatformContext` stays. The camera buttons in Profile, Vehicles and General expenses still use `isNative`.

## Why this is enough

- Every web route, gate (`SocialGate`, `LipsyncGate`, `AdminLayout`), `AppPageLayout`, the launcher sheet, pins, recents,
  the theme picker, `UpdatesBanner` and `ImpersonationBanner` come over automatically.
- The ≤640px layout (TabBar + launcher bottom sheet + account sheet + soft-keyboard lift via `useKeyboardInset`) was
  built and QA'd at 375 and 320px in wave 3/4, and the handoff README says it's "intended for the native shell too".
- Pins move from on-device Preferences to the profile API, so they sync across web and phone. The old
  `mobile_enabled_modules` key is simply ignored. Skipped migrating it: tab toggles and pins aren't the same thing.

## Edge cases to check in the PR

- The launcher's ⌘K hint and keycap only render at desktop widths. Confirm the phone never shows them.
- `UpdatesBanner` dismissal uses `sessionStorage`. In a WebView a "session" lasts until the app process dies, which is acceptable.
- `AccountMenu` skips saving prefs while impersonating. That behaviour stays unchanged.
- `HomePage` "Explore all apps" now opens the launcher, because `LauncherProvider` is mounted on native.

## Done means

- `npm run build` is green, and the PR Check workflow is green.
- `grep -rn "MobileAppShell\|MobileBottomTabs\|useMobileModules\|mobile_enabled_modules" src` returns nothing.
- Built with `npm run build:mobile` and run on an Android emulator: TabBar, launcher sheet, account sheet and the app frame
  all render and match web at 375px.
- Report the diff and build output before merging, per the funkedupshift delegation protocol.

## Sidekick brief (paste into a funkedupshift session)

```
TASK:        Make the Capacitor native app render the same shell as web: remove the isNative branch in
             shell/AppLayout.tsx and delete MobileAppShell/MobileBottomTabs/MobileMorePage/MobileSettingsPage/
             MobileModulesContext/hooks/useMobileModules.ts. Redirect /more and /mobile-settings to /.
CONSTRAINTS: No new components or gating. Keep PlatformContext (camera buttons use it). Gate = npm run build.
EDGE CASES:  safe-area insets (viewport-fit=cover in index.html), launcher sheet over soft keyboard,
             impersonation banner visible on narrow widths.
DONE MEANS:  build green; no references to deleted files; app runs in Android emulator with TabBar + launcher.
REPORT BACK: diff + build output BEFORE committing.
```
