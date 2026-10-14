# 03 — Phase 2: WebView-only fixes

**One PR after phase 1.** Each item is independent. Do them in this order and stop when QA (doc 04) passes.
Items 1 and 2 are confirmed bugs. The rest depend on what QA finds on a device.

## 1. Share URLs (must fix)

`window.location.origin` is `https://localhost` / `capacitor://localhost` inside the app.

- Add one helper: `export const publicOrigin = () => isNativePlatform() ? (window.PUBLIC_SITE_URL || "https://funkedupshift.com") : window.location.origin;`
  Put it in an existing utils file.
- `scripts/write-mobile-config.js` writes `window.PUBLIC_SITE_URL` from a `PUBLIC_SITE_URL` env var, so staging builds can point at `stage.funkedupshift.com`.
  Add the variable to the `Generate mobile config` step in `mobile-release.yml`.
- Use the helper in `features/memes/ShareMemeBox.tsx`, `features/memes/ShareMemePopover.tsx` and `features/squash/squashShared.ts`.
- Leave `RemoveBgPage` `publicPath` alone. It should resolve to the local bundle.

Check: copy a meme or squash share link in the app, paste it in a desktop browser, and it opens.

## 2. File saving and opening (must fix)

The full spec is in **[03b-file-saving.md](03b-file-saving.md)**. In short:
- Every Download button on Android does nothing today.
- PDF attachment previews render blank.
- The fix is one `utils/saveFile.ts` helper: device-made files go to the OS share sheet via Filesystem + Share,
  and server files open in the system browser via Browser.

## 3. External links

19 `target="_blank"` / `window.open` call sites. Test what they do first; Capacitor 8 usually hands off-origin navigations to the system browser.
Only if a link opens inside the app with no way back, add `@capacitor/browser` and route those calls through one helper.
Don't touch call sites that already behave.

## 4. Android back button

Add `@capacitor/app`, then one listener in `LauncherContext` / `AppLayout`:
`App.addListener("backButton", ...)`. If the launcher or account sheet is open, close it. Otherwise call `history.back()` if
`canGoBack`. Otherwise call `App.exitApp()`.

## 5. Fonts offline (nice to have)

Fonts come from Google Fonts over the network. With no connection the app falls back to system type, and it's online-only anyway
(every page calls the API). **Skip it** unless the store review or QA flags a flash of fallback type.
The upgrade path is to self-host the four families under `public/fonts` and drop the `<link>` tags. That also helps web.

## 6. Bundle size (nice to have)

`dist` is 81 MB, mostly the imgly model + onnx wasm. Play allows 200 MB per AAB module, so **skip** for now. If size
matters, exclude `public/imgly` from the native build and point `publicPath` at the web origin
(`publicOrigin() + "/imgly/"`). Remove Background would then need the network on native, which it already does for the API.

## 7. Token persistence (low)

Cognito session lives in WebView localStorage. The fallout is an occasional re-login if the OS evicts it. Skip it.
If users complain, pass a `Storage` adapter backed by `@capacitor/preferences` to `CognitoUserPool` in `auth.js`.

## 8. Native project hygiene

- `android/app/src/main/AndroidManifest.xml` already has INTERNET + CAMERA.
- iOS `Info.plist`: confirm `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` exist (receipt scanner, avatar).
  App Store review rejects the build without them.
- App icon / splash: regenerate from `docs/design_handoff_app_shell/assets/favicon-512.png` with the new brand mark
  (`npx @capacitor/assets generate`) so the launcher icon matches the redesign.
- Status bar colour: the theme toggles dark/light, but the native status bar doesn't follow. Add `@capacitor/status-bar` and set the style
  on theme change in `shell/theme.ts` (one call). Do this only if it looks wrong on a device.

## Done means

- Items 1 and 2 are fixed and verified on a device (item 2 per the QA list in 03b). Items 3–4 are fixed or confirmed
  unnecessary on a device, and the PR notes which.
- `npm run build` is green, and `npx cap sync` has picked up any new plugins.
