# Totem — Native App (Capacitor)

This folder wraps the Totem web app as native **iOS** and **Android** apps using
[Capacitor](https://capacitorjs.com). The web app itself still lives at the repo
root and still deploys to Vercel unchanged — this folder is a separate npm
project and is excluded from the Vercel deploy (`/.vercelignore`).

- **App ID / bundle identifier:** `com.hyperianlabs.totem` (both platforms)
- **App name:** Totem
- **Web assets:** bundled locally (not a remote-URL wrapper), copied from the
  repo root into `www/` by `sync-web.sh`, then into each platform by `cap sync`.

## How it fits together

```
repo root (index.html, app.js, …)  ──sync-web.sh──▶  native/www/  ──cap sync──▶  ios/  android/
        (the live web app)              (allowlist copy)   (Capacitor webDir)     (bundled app)
```

The web app already detects the native shell at runtime via
`window.Capacitor.isNativePlatform()` (see `isNativeApp()` in `app.js`) and, when
true, **hides all Paystack upgrade/checkout UI** (App Store Guideline 3.1.1) and
**skips the service worker** (bundled assets make it pointless and risky in a
WebView). No web behaviour changes — `window.Capacitor` only exists inside the
native shell.

## First-time setup (any machine)

```bash
cd native
npm install            # installs Capacitor
./sync-web.sh          # copy the web app into www/
npx cap sync           # copy www/ into ios/ and android/ + update native deps
```

Then open a platform:

```bash
npx cap open ios       # opens Xcode
npx cap open android   # opens Android Studio
```

## Rebuild after changing the web app

Any edit to the root web files (`app.js`, `index.html`, `styles.css`, …) must be
re-synced before building:

```bash
cd native && ./sync-web.sh && npx cap sync
```

## Prerequisites to actually BUILD (not just scaffold)

Scaffolding is done. Producing installable/uploadable binaries additionally needs:

### iOS (`.ipa`)
- macOS + **Xcode** (installed: Xcode 27)
- **CocoaPods** — NOT yet installed. `sudo gem install cocoapods` (or
  `brew install cocoapods`). Capacitor 8 uses Swift Package Manager for plugins,
  so Xcode may resolve dependencies on open even without Pods; install CocoaPods
  if a build step asks for it.
- An **Apple Developer Program** membership → Team ID, a distribution
  certificate, and an App Store provisioning profile for `com.hyperianlabs.totem`.

### Android (`.aab`)
- **JDK 17** (installed) + the **Android SDK** — NOT yet installed. Install
  Android Studio (bundles the SDK) or the command-line tools, and set
  `ANDROID_HOME`. The Gradle wrapper (`./gradlew`) is already in `android/`.
- An **upload keystore** (`keytool -genkey …`) + Play App Signing enrolment.

## Owner action items (credentials — cannot be done from code)

- [ ] Apple Developer Program enrolment → **Team ID** (D-U-N-S `653626850` already issued)
- [ ] iOS distribution certificate + App Store provisioning profile
- [ ] Install CocoaPods locally (or in CI)
- [ ] Google Play Developer account
- [ ] Android upload keystore + Play App Signing
- [ ] Install the Android SDK (set `ANDROID_HOME`)
- [ ] App icons / splash screens per platform (currently Capacitor defaults)
- [ ] Store listing assets + privacy declarations (see `../docs/APP_STORE_READINESS_AUDIT.md`)

## Still TODO in code (post-scaffold)

- App icons + splash from the Totem brand (replace Capacitor placeholders;
  `@capacitor/assets` can generate them from a source logo).
- Consider bundling the Supabase JS / Paystack / fonts instead of CDN loads
  (offline resilience; see the audit P1 list).
- Universal links / App Links + `apple-app-site-association` / `assetlinks.json`
  if email verification/reset links should open the native app.
- Session persistence for the native build (the web app deliberately uses
  `persistSession:false`).
