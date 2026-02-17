# App Store Submission – Resume Guide

## Current State (as of last session)

### Completed
- [x] **Capacitor added** to React SPA (`src/web/spa`)
- [x] **iOS and Android targets** configured (`ios/` and `android/` folders)
- [x] **Mobile build scripts** in `package.json`:
  - `npm run build:mobile` – build and sync to native projects
  - `npm run build:mobile:prod` – inject config from env vars, then build
- [x] **Config script** `scripts/write-mobile-config.js` for API/Cognito env vars
- [x] **Documentation** in `docs/mobile-build.md`

### Not yet done (manual steps)
- [ ] Sign up for Apple Developer Program ($99/year)
- [ ] Sign up for Google Play Console ($25 one-time)
- [ ] Configure API/Cognito for mobile builds
- [ ] Build production mobile app and test on devices
- [ ] Create app store assets (icons, screenshots, descriptions)
- [ ] Submit to App Store Connect and Google Play Console

---

## How to Restart

### 1. Open the project
```bash
cd /Users/adam/Github/EchoNin9/funkedupshift
```

### 2. Build for mobile (with your API config)
```bash
cd src/web/spa

# Option A: Set env vars and use prod build
export API_BASE_URL="https://your-api.execute-api.us-east-1.amazonaws.com"
export COGNITO_USER_POOL_ID="us-east-1_xxxxx"
export COGNITO_CLIENT_ID="xxxxxxxxxxxx"
npm run build:mobile:prod

# Option B: Edit public/config.js manually, then:
npm run build:mobile
```

### 3. Open native IDEs and run
```bash
npx cap open ios     # Xcode (macOS only)
npx cap open android # Android Studio
```

### 4. App store submission
- **Apple**: [developer.apple.com](https://developer.apple.com) → App Store Connect → create app → upload build from Xcode
- **Google**: [play.google.com/console](https://play.google.com/console) → create app → upload AAB from Android Studio

See `docs/mobile-build.md` for full build instructions and the App Store Submission Guide (in project plans) for store submission steps.
