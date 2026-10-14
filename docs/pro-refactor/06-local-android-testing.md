# 06 — Testing the app locally with Android Studio

## One-time setup (Android Studio)

- **Settings → Languages & Frameworks → Android SDK**: install an SDK Platform (API 35 or 36) plus the platform-tools.
- **Device Manager**: create a virtual device, for example a Pixel 8 on the API 35 image.
  A real phone with USB debugging turned on also works.

## Each test run

From the funkedupshift repo:

```bash
cd ~/Github/EchoNin9/funkedupshift
git fetch && git checkout <branch>          # e.g. development, or a PR branch
cd src/web/spa
npm ci

# Point the app at staging. The staging config.js is public, so just copy it:
curl -s https://stage.funkedupshift.com/config.js > public/config.js

npm run build:mobile          # builds the SPA and syncs it into android/
npx cap open android          # opens the project in Android Studio
```

In Android Studio, wait for the Gradle sync, pick your emulator or phone, and press **Run ▶**.

When you're done, run `git checkout public/config.js`. That file is tracked, so never commit the staging version.

### Testing two unmerged PRs together

Example: phase 1 (#153) and phase 2 (#154). The two merge without conflicts.

```bash
git fetch && git checkout -b test-mobile origin/feat/native-shell-unify
git merge origin/feat/native-phase2
```

Then follow the steps above from `cd src/web/spa`. Delete the branch afterwards with `git branch -D test-mobile`.

## Useful extras

- **Debugging:** with the app running, open `chrome://inspect/#devices` in desktop Chrome and click **inspect**
  under the app's WebView. You get the console, network and the element inspector, just like on the web.
- **Live reload, so you don't rebuild every time:**
  ```bash
  npm run dev -- --host
  npx cap run android --live-reload --host <your-LAN-IP> --port 5173
  ```
  The app loads from your dev server, so edits show up straight away. Don't test share links this way,
  because the app's address changes.
- **Running from the terminal instead of the Studio button:** `npx cap run android` needs Java 21, and the
  system Java on this machine is 17. Point it at the Java that comes with Android Studio first:
  ```bash
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  ```

## What to check

- Work through [04-parity-qa-matrix.md](04-parity-qa-matrix.md) with a guest, a plain user, a group member and an admin.
  You'll need a staging account for each, because no test credentials exist yet.
- Run the file-saving checklist in [03b-file-saving.md](03b-file-saving.md).
