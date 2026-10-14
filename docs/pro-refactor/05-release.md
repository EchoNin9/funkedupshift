# 05 — Release

Full Play setup is in `docs/android-play-store-deployment.md`. Capacitor build steps are in
`docs/mobile-build.md`. This doc only covers what's specific to the refactor release.

## Version

The last artifact here is **0.1.6** (April 2026). Ship the refactor as **0.2.0**, with versionCode = previous code + 1.
Check the current code in Play Console; Gradle defaults it to 1 when the env var is unset.

## Steps

1. Phases 1 and 2 merged to `development`. Staging deploy green. Doc 04 run against staging with a **staging** build:
   `API_BASE_URL=<stage api> COGNITO_POOL_ID=... COGNITO_CLIENT_ID=... PUBLIC_SITE_URL=https://stage.funkedupshift.com npm run build:mobile:prod`
   then `npx cap run android`.
2. Release PR `development` → `main` follows the usual funkedupshift process. The web gets these changes too, but they're
   native-only, so web behaviour shouldn't change. Still check `/` and one share link on prod web after deploy.
3. Run the `Build & Release Android` workflow from `main` with `version_name=0.2.0` and the next `version_code`.
   It uses the production vars, so add `PUBLIC_SITE_URL` to that job (phase 2 item 1).
4. Download the AAB artifact and upload it to the **internal testing** track. Smoke-test the four personas on a device, then promote it.
5. Store listing: update the screenshots to the new shell (TabBar, launcher sheet, dashboard). Capture them at 1080×1920 from the emulator.
6. iOS (optional, separate): `npx cap open ios`, set `MARKETING_VERSION` to 0.2.0, check the Info.plist usage strings (phase 2 item 8),
   archive, then TestFlight. There's no iOS CI. Add one only if iOS releases become regular.

## Artifact and secret hygiene in `fus-mobile`

The local `fus-mobile/android/` folder holds `release-keystore.jks`, `jinksninja-keystore.jks` and `release-keystore.jks.txt`. The `.txt` contains
keystore credentials in plain text. Today the folder isn't a git repo.

- **Before running `git init` here**, add a `.gitignore` with `*.jks`, `*.keystore`, `*.jks.txt`, `*.aab` and `*.aab.zip`.
  Losing the upload key means you can never update the app. Leaking it means anyone can sign updates as you.
- Move the passwords into a password manager and delete the `.txt`. The CI copy is already in GitHub secrets
  (`ANDROID_KEYSTORE_*`).
- Old AABs don't need to live here, since Play keeps every release. Keep the latest one at most.
