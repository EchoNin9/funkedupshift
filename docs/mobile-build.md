# Mobile App Build (Capacitor)

The React SPA is wrapped with [Capacitor](https://capacitorjs.com) for iOS and Android app store distribution.

## Prerequisites

- **iOS**: macOS, Xcode, Apple Developer account ($99/year)
- **Android**: Android Studio, JDK, signing keystore
- **Both**: Node.js 20+, npm

## Build for Mobile

### 1. Configure API and Auth

For production mobile builds, set the API URL and Cognito credentials. Either:

**Option A: Environment variables**

```bash
export API_BASE_URL="https://your-api.execute-api.us-east-1.amazonaws.com"
export COGNITO_USER_POOL_ID="us-east-1_xxxxx"
export COGNITO_CLIENT_ID="xxxxxxxxxxxx"
node scripts/write-mobile-config.js
```

Get values from Terraform: `terraform -chdir=infra output -raw apiInvokeUrl` (and cognito outputs).

**Option B: Edit `public/config.js`** before building (same as local web dev).

### 2. Build and Sync

```bash
cd src/web/spa
npm run build:mobile
```

This copies `auth.js`, builds the SPA, and syncs to `ios/` and `android/`.

### 3. Open in Native IDEs

```bash
npx cap open ios     # Opens Xcode
npx cap open android # Opens Android Studio
```

### 4. Run on Device/Simulator

- **iOS**: Select a simulator or device in Xcode, then Run.
- **Android**: Select an emulator or device in Android Studio, then Run.

## Live Reload (Development)

To test changes without rebuilding:

1. Start the dev server: `npm run dev`
2. In `capacitor.config.ts`, set `server: { url: "http://YOUR_LOCAL_IP:5173", cleartext: true }`
3. Run the app: `npx cap run ios` or `npx cap run android`

## App Store Submission

See the App Store Submission Guide (in project plans) for:

- Apple Developer Program and App Store Connect
- Google Play Console setup
- Screenshots, icons, privacy policy, and submission steps

## CORS

The API returns `Access-Control-Allow-Origin: *`, so requests from the Capacitor WebView (`capacitor://localhost`) are allowed.
