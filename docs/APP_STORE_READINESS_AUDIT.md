# Totem — App Store / Play Store Readiness Audit

**Date:** 2026-09-26
**Auditor:** Independent code + infrastructure review (read-only; no production code modified)
**Repo:** `~/Desktop/BUSINESS/WEB-APPS/REPOS/HyperianLabs/Totem/Totem` @ `main` (commit `6e15f32`, 95 commits total)
**Live web app:** https://totem.hyperianlabs.com (verified loading, no errors)
**Supabase project:** `tiieaubyrjcsgiaegikb` (verified live via direct SQL + REST)

> This audit does **not** trust prior audits or README/doc claims. Every material claim below was verified against actual code, the live Supabase database, the live REST API, or the live site. Where something could not be verified it is marked **UNVERIFIED**.

---

## ★ THE HEADLINE FINDING

**Totem has no native application. It never has.**

There is no `ios/` project, no `android/` project, no `capacitor.config.*`, no `package.json`, no bundler, no Xcode project, no Gradle, no `Info.plist`, no `AndroidManifest.xml` — not in the working tree and not at any point in 95 commits of git history (verified: `git log --all` over all native paths returns nothing).

Totem is a **static vanilla-JavaScript Progressive Web App**:
- `index.html` + `app.js` (~375 KB, the entire SPA) + `styles.css` + `config.js`
- `manifest.json` + `service-worker.js` (PWA installability)
- Hosted on **Vercel** at `totem.hyperianlabs.com`
- Backend: **Supabase** (Postgres + Auth + 15 Edge Functions + 1 Storage bucket)
- Payments: **Paystack** (live)
- Email: **Resend** (via edge functions)

### Direct answer to the core question

> *"If I completed every owner/account task listed in the existing native setup documentation today, would Totem produce valid production iOS and Android store builds and pass a serious store-readiness review?"*

**No — and for a more fundamental reason than missing credentials.**

1. **There is no native setup documentation and no native project to receive those credentials.** Unlike the sibling Vinora project (which has a Capacitor shell, `ios/` scheme, CI workflow for `.aab`/`.ipa`, and store docs), Totem has *none* of this. Signing certs, keystores, Team IDs, and provisioning profiles have nothing to attach to. You cannot sign a build that does not exist.
2. **Even after a native shell is created, there are genuine engineering blockers** that would cause store rejection: Paystack subscription checkout is not gated for iOS (Apple 3.1.1 IAP violation), destructive-action confirmations use `prompt()` (breaks in WKWebView → account deletion could become impossible), and the session is deliberately non-persistent (poor native UX).
3. **Compliance/listing work is unstarted**: the privacy policy is an explicit unreviewed **DRAFT** with ~8 unfilled placeholders, there is **no** App Privacy / Play Data Safety declaration doc, and there is **no age gate** despite the app being built entirely around **minors' personal data**.

**The good news:** the backend is genuinely solid (RLS verified live, edge functions properly authenticated, secrets clean), account deletion and POPIA parental consent are really built, and the code is unusually clean (zero TODOs, zero debug logging, no hardcoded secrets, no backdoors). The *web product* is essentially production-grade. The *native store product* has not been started.

---

## 1. Actual Architecture (verified)

| Layer | Implementation | Evidence |
|---|---|---|
| Framework | None — vanilla JS, no build step | No `package.json`; single `app.js` |
| Frontend | Static HTML/CSS/JS SPA | `index.html`, `app.js`, `styles.css` |
| Backend | Supabase (Postgres 17.6) + 15 Edge Functions (Deno) | `supabase/functions/*`, live query |
| Database | Supabase Postgres, 11 public tables, RLS on all | live `pg_class` query |
| Auth | Supabase Auth (email/password), `persistSession:false` | `app.js:5-9` |
| Hosting | Vercel (`totem.hyperianlabs.com`); GitHub Pages `CNAME` inactive | `vercel.json`, `CNAME`, CLAUDE.md |
| Native wrapper | **NONE** | no native files ever committed |
| Capacitor | **Not present** | — |
| iOS project | **Does not exist** | — |
| Android project | **Does not exist** | — |
| Build tooling | None (static deploy) | — |
| CI/CD | `docs/ci-workflow.yml` authored but **not installed** (no `.github/`) | `ls .github` → absent |
| Env config | `config.js` (publishable keys only); edge secrets via `Deno.env` | `config.js`, function sources |
| Push notifications | **Not implemented** (no FCM/APNs, no `PushNotifications`) | grep clean |
| Deep links | Query-param handling only (`?type/token_hash/mode/ref`); no router, no universal links | `app.js:31,44,55-58` |
| Offline | App-shell SW cache only; **no data persistence** | `service-worker.js` |
| Payments | Paystack web checkout (live public key) | `app.js:1000-1026` |
| Analytics / crash reporting | **None present** | grep clean |

**Native-independence:** As a PWA this is coherent. As a *native app* it would depend on remote web assets and third-party CDNs (Supabase JS, Paystack, Google Fonts loaded from external hosts — `index.html:17-18,603-604`), none of which are bundled.

---

## 2. Repository / Codebase Cleanliness

Verified across `app.js`, HTML, edge functions:

- ✅ **Zero** `TODO` / `FIXME` / `HACK` / `XXX` in `app.js`.
- ✅ **Zero** `console.log/debug/info`; only 15 legitimate `console.warn/error`.
- ✅ **No** hardcoded secret values anywhere (working tree **and** full git history — see §14).
- ✅ **No** dev bypass, no magic query param, no `eval`/`new Function`, no hidden admin backdoor. `isPlatformAdmin` is resolved only by DB lookup, never settable from the URL (`app.js:222-227`).
- ✅ **No** localhost / 127.0.0.1 / staging / dev-endpoint references.
- ⚠️ **Demo mode** is a *separate page* (`demo.html`, `window.TOTEM_DEMO_MODE=true`) using an in-memory sample dataset that never touches Supabase and disables write/admin/delete paths (`app.js:836-841,896-954,1321-1324`). Not reachable from real login → no demo-data-to-prod leakage. **LOW:** `demo.html` still loads `config.js` (harmless — publishable keys only).
- 🟡 65 `alert()`, 18 `confirm()`, 5 `prompt()` in `app.js` — fine on web, problematic in a WebView (see §11/§12).

**Verdict:** Cleanest of the Hyperian codebases reviewed. Nothing dev-only will accidentally reach production on the web.

---

## 3. iOS Readiness

**Status: ❌ NOTHING TO AUDIT — no iOS project exists.**

There is no Xcode project, `Info.plist`, entitlements, privacy manifest, `apple-app-site-association`, or signing configuration. Every iOS sub-item (identity, signing, capabilities, ATS, associated domains, deep links) is **N/A until a native shell is created**.

The repo is **not** structured to accept iOS credentials — there is no target for a Team ID, distribution certificate, or provisioning profile. **Blocker type: ENGINEERING (project creation) + OWNER (credentials), in that order.**

---

## 4. Android Readiness

**Status: ❌ NOTHING TO AUDIT — no Android project exists.**

No `AndroidManifest.xml`, `build.gradle`, `applicationId`, `versionCode`, permissions, intent filters, `assetlinks.json`, keystore, ProGuard/R8, or network-security config. Every Android sub-item is **N/A until a native shell is created**. **Blocker type: ENGINEERING then OWNER.**

The `manifest.json` PWA manifest is well-formed (`display:standalone`, `orientation:portrait-primary`, maskable + any icons) — relevant if a **TWA** (Trusted Web Activity, the lowest-effort Android path) is chosen.

---

## 5. Google Play Requirements

Cannot be met without an app bundle; assessed for the *eventual* build:

- **targetSdk / 64-bit / AAB / Play App Signing** — N/A (no build). Whatever wrapper is chosen must target the current required SDK.
- 🔶 **Data Safety declaration** — does not exist; must be authored (see §9).
- 🔶 **Privacy policy URL** — exists but is a DRAFT (see §9). Blocker.
- ✅ **Account deletion** — implemented in-app and server-side (see §6/§7). Meets Google's deletion requirement.
- 🔶 **Families / child-data policy** — Totem is built around minors' data. Google's Families policy and target-audience/content-rating questionnaires will apply. **No age gate exists** → high scrutiny. Must decide: declare "not primarily for children" (staff-facing tool) with an adult age gate, or enroll in Families (heavier).
- 🔶 **External payments** — Paystack. Google now permits alternative billing in many regions but requires declaration; must be handled deliberately, not by accident.

---

## 6. Apple App Store Requirements

- **Minimum functionality (4.2):** ⚠️ Totem is feature-rich (roster, fixtures, lineups, ratings, consent, transport, payments) — *not* a thin web viewer. But because there is no native code at all, a wrapper must add genuine native value or risk 4.2 "just a website" rejection. A pure WKWebView pointing at the live URL is the highest-risk possible submission.
- **Payments (3.1.1):** ❌ **BLOCKER (native).** Paystack sells digital subscriptions (Starter R49 → Unlimited R349/mo) via web checkout with the live public key (`app.js:975-1026`, `index.html:604`). There is **no** `Capacitor`/`isNative`/`navigator.standalone`/display-mode gate anywhere (grep confirms absence). In a native iOS app this violates 3.1.1 (must use IAP) and exposing the purchase flow risks 3.1.3. On the web PWA this is fine. Must be gated/hidden in the native build (as Vinora did with a payment-hiding flag).
- **Account deletion (5.1.1(v)):** ✅ Implemented. `btnDeleteAccount` (`app.js:441-479`) → `delete-my-account` edge function (JWT-derived identity, service-role delete, sole-owner cascade). **HIGH caveat:** confirmation uses `prompt()` (`app.js:451`) which returns `null` in many WebViews → deletion could silently fail in the native build. Must move to an in-DOM confirm.
- **Sign in with Apple (4.8):** Only email/password is offered → **SIWA not required**. (It becomes required only if a third-party/social login is added.)
- **Privacy (5.1):** ❌ Policy is a DRAFT; no App Privacy label mapping exists (see §9).
- **Kids / minors (5.1.4):** ❌ No age gate; the entire dataset is minors' PII. High scrutiny (see §9).

---

## 7. Authentication + Session (verified against code + live)

- Supabase client: `persistSession:false`, `autoRefreshToken:true` (`app.js:5-9`) — deliberate "log in every time."
- Signup (create org / join via invite code), login (`signInWithPassword`), logout (`signOut`), password reset (`resetPasswordForEmail` → `updateUser`, 8-char min), email verify/recovery via prefetch-safe interstitial (`verifyOtp()` only on explicit click — `app.js:56-58,368-391`). This matches the known mail-scanner-prefetch mitigation.
- Join flow validates invite code through the rate-limited `check-invite-code` function with 429 handling (`app.js:300-309`).
- App UI (`appRoot`) stays hidden until org is resolved post-auth (`app.js:140-162,194-221`) → **no pre-auth data-render race found** (UNVERIFIED at runtime, static read).

**Findings:**
- 🟡 **MEDIUM (native UX):** `persistSession:false` logs users out on every app close/reopen — acceptable in a browser tab, poor and reviewer-visible in an installed app. Reconsider for the packaged build.
- 🔵 **LOW:** a just-signed-up user whose org isn't linked yet is signed out with a "retry" message (`app.js:200-205`).

---

## 8. Role & Authorization Security (verified LIVE against the database)

**Role model (small, deliberate):**
- Org-level `role` on `team_members`: `"owner"` vs non-owner staff. No separate coach/manager/parent/player *login* roles — guardians never log in; they act only via emailed **token** links (consent/transport).
- Platform super-admin: `platform_admins` table lookup (`app.js:222-227`).

**RLS — verified live, not just read:**
- ✅ **All 11 public tables have RLS enabled** (live `pg_class` query).
- ✅ Policies are correctly org-scoped: `org_state`, `organizations`, `consent_records`, `transport_responses` all gate on `team_members` membership of the same `org_id`; owner/admin writes gate on `is_org_owner()` / `is_platform_admin()` (SECURITY DEFINER, `search_path` pinned).
- ✅ **Live anonymous-access test (REST API with the public anon key):** every sensitive table returned **`[]` (zero rows)** — `org_state`, `organizations`, `consent_records`, `transport_responses`, `players`, `team_members`. An unauthenticated attacker sees nothing.
- ✅ The platform-admin and owner "direct writes" that the frontend issues (`organizations.update/delete`, `team_members.delete`) are **RLS-enforced**, not merely UI-gated — the corresponding policies require `is_platform_admin()` / ownership. (This closes a concern raised during the frontend pass.)
- ✅ SECURITY DEFINER helper functions flagged by the linter (`is_org_owner`, `is_platform_admin`) *must* be executable for RLS to work and only return a boolean about the caller's own uid → not a leak.

**UNVERIFIED:** authenticated *cross-org* isolation could not be exercised live (the read-only MCP role cannot assume `authenticated` to run a rollback-transaction JWT test). Isolation is confirmed structurally (policy definitions) and at the anon boundary (live). Recommend one rollback-transaction test with a real member JWT before submission for full assurance.

**No IDOR / privilege-escalation path found** in the reviewed surface.

---

## 9. School / Minor Data Privacy (HIGH PRIORITY)

**Personal data on minors, confirmed:**
- Players (children): **name, date of birth** (`birthDate`, stored in the `org_state` JSON), position, **coach performance ratings**, **VO2-max fitness metric**, fixture/result history.
- **Guardian contact:** `guardianEmail` + `guardianPhone` stored per-player, used to drive WhatsApp/email blasts (`app.js:2371-2454, 4066-4166`).
- Staff/account holders: name, email, phone; club/school name; venue addresses.
- ✅ **No player photos/avatars, no GPS/location of people** (only venue text addresses) — materially reduces exposure. No player-photo storage bucket (only `emblems`, org crests).

**Strong points (genuinely built):**
- ✅ POPIA parental **e-consent flow** (`consent-response.html` + `consent-response` edge function, token-gated) — guardian confirms "I am the parent or legal guardian."
- ✅ Offline consent form `parental-consent-form-template.docx`.
- ✅ In-app data deletion (§6).

**Blockers:**
- ❌ **BLOCKER — Privacy policy is an unreviewed DRAFT.** `privacy.html:37` literally says *"DRAFT … has not been reviewed by a lawyer and should not be published or relied upon."* ~8 unfilled placeholders: date, registered entity name, Supabase region, **retention period (unspecified)**, **contact email (×2)**, Information Officer. Apple 5.1.1 and Google require a complete live policy URL.
- ❌ **BLOCKER — No store data-declaration doc.** No App Privacy (Apple) or Data Safety (Google) mapping exists anywhere in `docs/` (only `docs/ci-workflow.yml` is present). Must be authored.
- ❌ **BLOCKER — No age gate.** No age-verification/adult-confirmation screen (grep confirms). Age-*group* logic (U6–U18) is sports grading, not a gate. For an app built on under-18 data, this is a primary rejection risk (Apple 5.1.4, Google Families).
- 🟠 **HIGH — Consent-collection ≠ COPPA compliance.** The flow lets a coach enter a minor's DOB/metrics/guardian contact with no gate ensuring verifiable parental consent was obtained first; US distribution of under-13 data triggers COPPA. Transport-indemnity wording is itself still flagged draft (`consent-response.html:109`).
- 🔵 **MEDIUM — Support contact is a personal Gmail** (`config.js:16` → `dandanblom@gmail.com`), exposed to users via a `mailto:` link; not a branded role address. Both store consoles want a real support URL/email.

---

## 10. Offline / Network Resilience (verified)

- Service worker is **network-first**, caches only the app shell (`index.html/app.js/styles.css/config.js/manifest.json/icons`), **explicitly never intercepts Supabase requests**, GET-only (`service-worker.js:49-50`). Deliberately avoids the stale-deploy crash trap.
- 🔵 **MEDIUM:** No offline data persistence. Offline **load** → `fetchClubState()` returns null → empty club shown (`app.js:1160-1172`). Offline **save** → surfaced toast "⚠ Couldn't save…" (`app.js:1191-1196`); change kept in memory only, lost on refresh. **No silent data loss** (failures are surfaced) and **no crash**, but a reviewer in airplane mode sees an empty app.
- ✅ Optimistic concurrency implemented well: saves guard on `updated_at` and prompt on conflict rather than clobber (`app.js:1173-1226`).

---

## 11. Native Features

| Feature | Status |
|---|---|
| Camera | Not used (no photo capture/upload) |
| Location (GPS) | Not used (venue text addresses only) |
| Haptics | Not used |
| Share | Web share via WhatsApp/`mailto` links (coach-triggered), not native share sheet |
| Push notifications | **Not implemented** — no FCM/APNs, no token registration. All notification is via **email** (Resend edge functions) |

There are **no unused native plugins or permissions** because there is no native project. Push is entirely unbuilt — it is not "blocked by credentials," it is **not started**.

---

## 12. Performance / UX — Top issues for a mobile build

1. ❌ **Paystack upgrade UI not gated for native (iOS 3.1.1).** (§6)
2. 🟠 **`prompt()`-based destructive confirmations** (delete account/club/sport, rename) break in WKWebView (`app.js:451,739,778,2040`).
3. 🟡 **65 `alert()` / 18 `confirm()`** render inconsistently in WebViews and can show the origin URL — reads as unpolished to reviewers.
4. 🟡 **`persistSession:false`** → logged out every launch (§7).
5. 🟡 **Offline = empty app** (§10).
6. 🟡 **External CDN dependencies** (Supabase JS, Paystack, Google Fonts) not bundled — network-dependent in a native shell (`index.html:17-18,603-604`).
7. 🟡 **No global error safety net** — no `window.onerror` / `unhandledrejection` handler; some `functions.invoke` paths can throw uncaught (`app.js:4139,4550,4619,4662,4701`).
8. 🔵 **84 `innerHTML` sites** — an `escapeHtml()` helper exists and is applied on the reviewed user-data sinks, but a full XSS pass was **not** completed (UNVERIFIED).
9. 🔵 **No universal links / `assetlinks.json`** → email verify/reset links open the web app, not the native app.
10. 🔵 **Upgrade flow shows a "reload to see plan" alert** rather than in-app refresh after Paystack (`app.js:1017-1019`).

**Overall:** the web app feels like a real app, but several web-isms (native dialogs, non-persistent session, external CDNs) would make a naive wrapper feel like "a website in a shell."

---

## 13. Responsive Design

Batch D added safe-area handling (per git history / CLAUDE.md). Manifest locks portrait. Full device-matrix verification (Dynamic Island, iPhone SE, tablets, long names/large datasets, empty/error states) was **not** exercised at runtime in this audit — **UNVERIFIED**; recommend a device pass once a shell exists.

---

## 14. Security Audit — Secrets

- ✅ **Working tree:** only publishable keys present — Supabase anon (`sb_publishable_…`) and Paystack **public** (`pk_live_…`) in `config.js`. Both safe client-side.
- ✅ **Git history (all 95 commits):** no secret value ever committed — `sk_live_`, `sk_test_`, `sb_secret_`, JWT (`eyJhbGciOiJ…`), and `PRIVATE KEY` all return **zero** history hits. The `service_role` history matches are all `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` env-var *references* in edge-function source, not values.
- ✅ Edge-function secrets (`SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, Resend key) are read from `Deno.env` only.
- 🟡 **OWNER TODO (from memory):** rotate the Paystack secret key as a precaution — no evidence it leaked, but it was flagged. **No secret is printed in this report.**
- ✅ `.gitignore` sensibly excludes `.DS_Store`, `.temp`, `email-templates/`, `.impeccable/`, `social/`, large videos.

---

## 15. Database / Backend

- ✅ 11 tables, RLS on all; org-scoped policies (§8). One public storage bucket `emblems` (org crests, 2 objects) — no minor data in storage.
- ✅ 8 DB functions, all `SECURITY DEFINER` where needed, all with pinned `search_path`.
- ✅ **15 Edge Functions**, all verified for correct auth posture:
  - `paystack-webhook` — **HMAC-SHA512 signature verification** against the raw body before parsing; 400 on mismatch (`verify_jwt:false` is correct).
  - `paystack-relay` — forwards raw bytes + signature so downstream verifies; no DB access.
  - `consent-response` / `transport-response` — require an **exact unguessable token match** (`.eq("token", token)`); service-role but token-gated (`verify_jwt:false` correct).
  - `check-invite-code` — **rate-limited 15/IP/10min → 429**, logged in `invite_code_attempts`.
  - `delete-my-account`, `delete-org-users` — JWT-verified.
  - email senders — JWT-verified.
- **Advisors (live):**
  - Security: leaked-password protection **disabled** (WARN — owner fix); SECURITY DEFINER "executable by anon/authenticated" warnings are the RLS helper functions (expected/safe) + two intentionally-public signup helpers; `invite_code_attempts` RLS-enabled-no-policy (intentional, service-role-only). **No critical security advisory.**
  - Performance: `auth_rls_initplan` (14, wrap `auth.uid()` in `(select …)`), unused indexes (5), multiple-permissive-policies (30) — all **negligible at current scale (3–10 orgs)**; P3 polish.

---

## 16. Build / CI/CD

- **Can the repo produce a signed `.aab`?** ❌ No — no Android project.
- **Can the repo produce a signed `.ipa`?** ❌ No — no iOS project.
- **What's preventing builds:** not credentials — **the native projects themselves do not exist.** This is a project-creation (engineering) gap first.
- `docs/ci-workflow.yml` exists (runs `node scripts/check.mjs` blocking + `deno check` non-blocking) but is **not installed** to `.github/workflows/` (no `.github/` dir). Installing it needs a token with `workflow` scope (owner TODO). Note: this CI validates the web/edge code; it does **not** build native artifacts.
- `scripts/check.mjs` is the first quality gate (Batch E).

---

## 17. Environment

| Variable / value | Where | Class |
|---|---|---|
| `SUPABASE_URL`, anon key | `config.js` | web-required (publishable) |
| `PAYSTACK_PUBLIC_KEY` | `config.js` | web-required (publishable) |
| `LAUNCH_DATE`, `SUPPORT_EMAIL` | `config.js` | web config |
| `/verify` → Supabase auth rewrite | `vercel.json` | prod (email links) |
| `SUPABASE_SERVICE_ROLE_KEY` | edge env | server-secret |
| `PAYSTACK_SECRET_KEY` | edge env | server-secret |
| Resend API key | edge env | server-secret |

- ✅ No localhost/staging/dev endpoints; production cannot accidentally target a dev Supabase or test payment endpoint (single hardcoded prod project; Paystack key is `pk_live_`).
- 🟡 Paystack being **live** means test purchases are real money — reviewers cannot be given a throwaway card unless a sandbox/test-mode path or a comped reviewer account is provided.

---

## 18. Store Listing Readiness

Everything below is **unstarted** unless noted.

**Apple:** app name ✅ ("Totem — Team Selection"), icon assets ✅ (PNG set present), subtitle/description/keywords ❌, screenshots ❌, privacy policy URL ⚠️ (draft), support URL ❌ (personal Gmail only), marketing URL ✅ (landing page), age rating ❌, App Privacy ❌, export compliance ❌ (declare standard encryption), review notes + **demo account** ❌ (see §20), pricing/availability ❌.

**Google Play:** title ✅, short/full description ❌, screenshots ❌, feature graphic ❌, icon ✅, privacy policy ⚠️ (draft), Data Safety ❌, content rating ❌, target audience ❌ (child-data sensitive), app access / reviewer credentials ❌, pricing/regions ❌.

---

## 19. Reviewer Experience

- ✅ App loads, shows login/signup, explains itself (verified live).
- ⚠️ A reviewer **cannot** self-serve a meaningful account: signup either creates a new club (empty) or needs an invite code. There is a `demo.html` with sample data, but it is a separate page and would need to be the review target or a pre-seeded demo login provided.
- ⚠️ Testing "upgrade" hits **live Paystack** (real charge) unless a comped/test path is given.
- ⚠️ `persistSession:false` → reviewer is logged out on relaunch (step 9 of the reviewer flow).
- ❌ No demo credentials currently documented for reviewers (§20).

---

## 20. Demo / Reviewer Environment

- `demo.html` = self-contained in-memory demo (Riverstone High rugby), no Supabase, write/admin/delete disabled. Safe, but not a logged-in review of the real app.
- No dedicated reviewer account exists in the DB (UNVERIFIED beyond schema; recommend creating a seeded reviewer org + login with representative data before submission).
- No check-in/bypass mechanism to worry about (Totem has no GPS check-in).

---

## 21. High-Risk Rejection Issues

| # | Issue | Platform | Severity | Fix | Type |
|---|---|---|---|---|---|
| 1 | No native app exists → cannot build/submit | Both | Critical | Create wrapper (Capacitor / TWA) | ENGINEERING |
| 2 | Paystack digital-subscription checkout not gated on native | iOS (3.1.1) | Critical | Hide/gate payments in native, or IAP | ENGINEERING |
| 3 | Privacy policy is unreviewed DRAFT w/ placeholders | Both | Critical | Finalize + lawyer review + publish | OWNER + CODE |
| 4 | No age gate despite minors' data | Both (5.1.4 / Families) | High | Add adult age gate; decide Families posture | ENGINEERING + OWNER |
| 5 | No App Privacy / Data Safety declaration | Both | High | Author declarations | OWNER (doc) |
| 6 | `prompt()` confirmations break in WebView → deletion may fail | Both | High | In-DOM confirm | ENGINEERING |
| 7 | Thin-wrapper 4.2 risk if pure WebView | iOS | Medium | Add native value / offline / push | ENGINEERING |
| 8 | Live Paystack = real charges for reviewers | Both | Medium | Comped reviewer account / test path | OWNER + CODE |
| 9 | Support contact is personal Gmail | Both | Low | Role address (`support@`/`totem@`) | OWNER |
| 10 | COPPA verifiable-consent gap (under-13, US) | iOS/Google (US) | High if US | Gate data entry on consent / restrict regions | ENGINEERING + OWNER |

---

## 22. Final Release Matrix

| Area | iOS | Android | Status | Blocker Type | Evidence |
|---|---|---|---|---|---|
| Native architecture | ❌ | ❌ | No project exists | ENGINEERING | no native files in 95 commits |
| Build | ❌ | ❌ | Cannot produce `.ipa`/`.aab` | ENGINEERING | no Xcode/Gradle |
| Signing | ❌ | ❌ | Nothing to sign yet | OWNER (after project) | — |
| Authentication | ✅ | ✅ | Works (web); session non-persistent | code (UX) | `app.js:5-9,280-418` |
| Authorization | ✅ | ✅ | RLS verified live; anon blocked | READY | live REST `[]` on all tables |
| Payments | ❌ | ⚠️ | Not gated for native | ENGINEERING (iOS) | `app.js:1000-1026` |
| Privacy | ❌ | ❌ | Policy DRAFT; no declarations | OWNER + CODE | `privacy.html:37` |
| Account deletion | ⚠️ | ⚠️ | Built; `prompt()` breaks in WebView | code | `app.js:451`, `delete-my-account` |
| Deep links | ❌ | ❌ | No universal/app links | ENGINEERING | grep clean |
| Camera | n/a | n/a | Not used | — | — |
| Location | n/a | n/a | Not used | — | — |
| Push notifications | ❌ | ❌ | Not implemented (email only) | ENGINEERING | grep clean |
| Offline | ⚠️ | ⚠️ | Shell cached; no data offline | code (UX) | `service-worker.js` |
| Performance | ⚠️ | ⚠️ | Good web; WebView-isms | code (polish) | §12 |
| Security | ✅ | ✅ | No secrets leaked; edge fns hardened | READY | §14/§15 |
| Store metadata | ❌ | ❌ | Unstarted | OWNER | §18 |
| Reviewer access | ❌ | ❌ | No demo login/comped path | OWNER + CODE | §19/§20 |

---

## 23. Final Verdict

### A. CODE READINESS — **NOT READY — ENGINEERING BLOCKERS**
As a **web PWA**, Totem is essentially production-grade and live (verified backend, RLS, payments, deletion). As a **native store app**, it is **not ready**: there is no native project to build or sign, payments aren't gated for iOS, and destructive-action dialogs use `prompt()`. These are engineering blockers, independent of any account/credential.

### B. OWNER / ACCOUNT READINESS — actions only you can do
1. Decide the native strategy (recommended: **Capacitor** for both stores, or **PWABuilder/TWA** for the fastest Android-only path).
2. **Apple Developer Program** enrollment → obtain **Team ID** (D-U-N-S `653626850` already issued per prior record).
3. **Google Play Developer** account.
4. **Android keystore** (generate + securely store) → Play App Signing.
5. **iOS** distribution certificate + provisioning profile (after the Xcode project exists).
6. **GitHub Actions secrets** for CI signing (keystore, iOS cert/profile) — and install `docs/ci-workflow.yml` with a `workflow`-scoped token (extend it to build native artifacts).
7. **Finalize the privacy policy** (fill all placeholders) and get **lawyer review**; publish live.
8. **Enable Supabase leaked-password protection** (dashboard).
9. **Rotate the Paystack secret key** (precaution).
10. Replace `SUPPORT_EMAIL` with a branded role address; ensure a support URL.
11. Create a **seeded reviewer account** + comped/test payment path.
12. Produce **store listing assets** (screenshots, descriptions, feature graphic, age rating, App Privacy + Data Safety answers).

### C. SUBMISSION READINESS — **NOT READY**
No submittable artifact can be produced today. Path: create native shell → fix code blockers (payment gating, `prompt()`, age gate) → finalize privacy + declarations → owner credentials + signing → build/sign `.ipa`/`.aab` → seed reviewer account → submit.

---

## 24. Prioritised Action Plan

### P0 — MUST FIX BEFORE A STORE BUILD (engineering blockers)
1. **Create a native shell** (Capacitor recommended; or TWA for Android-only). Nothing else can proceed without this.
2. **Gate/hide all Paystack upgrade UI on native** (iOS 3.1.1) — add an `isNative` detector; hide upgrade CTAs and checkout in the packaged app.
3. **Replace all `prompt()`/`confirm()` destructive-action dialogs with in-DOM UI** so account deletion works in WebView (`app.js:451,739,778,2040`).
4. **Add a first-launch adult age gate** (and decide Apple Kids-category / Google Families posture).

### P1 — MUST FIX BEFORE SUBMISSION (rejection / production risk)
5. **Finalize + lawyer-review + publish the privacy policy** (fill all placeholders).
6. **Author App Privacy (Apple) + Data Safety (Google) declarations.**
7. **Persist the session** for the native build (or add "stay signed in").
8. **Seed a reviewer account** + comped/test-mode payment path; document credentials in review notes.
9. **Enable leaked-password protection**; **rotate Paystack secret**.
10. **Bundle/self-host CDN deps** (Supabase JS, Paystack, fonts) for the native shell; configure universal links / `assetlinks.json`.
11. **Replace personal support email** with a branded role address.
12. Resolve the **COPPA verifiable-consent gap** (or restrict US/under-13 distribution).

### P2 — SHOULD FIX BEFORE LAUNCH (quality)
13. Add global `window.onerror` + `unhandledrejection` handlers.
14. Improve offline read UX (cache last-known `org_state` read-only, or a clear offline state).
15. Complete a focused **XSS pass** of all 84 `innerHTML` sites.
16. Device-matrix responsive pass (Dynamic Island, SE, tablets, long names, empty/error states).
17. Consider **push notifications** to add native value (currently email-only) — strengthens 4.2.

### P3 — POST-LAUNCH
18. RLS perf polish: wrap `auth.uid()` in `(select auth.uid())` across policies; drop unused indexes; consolidate overlapping permissive policies.
19. Install the CI workflow and extend it to build/sign native artifacts.
20. Run a rollback-transaction authenticated cross-org RLS test for full assurance.

---

## Terminal Summary

**RELEASE STATUS**
- **iOS:** ❌ NOT READY — no iOS project exists; cannot build or sign.
- **Android:** ❌ NOT READY — no Android project exists; cannot build or sign.
- **Code:** ❌ NOT READY — engineering blockers (no native shell, payment gating, `prompt()` dialogs, no age gate). *Web PWA itself is production-grade.*
- **Owner setup:** ⏳ Substantial — Apple/Google accounts, keystore/certs, privacy finalization, listing assets, reviewer account.
- **Submission:** ❌ NOT READY.

**P0 BLOCKERS:** 4
**P1 BLOCKERS:** 8
**OWNER ACTIONS:** 12

**Estimated path to submission (sequence, no invented durations):**
1. Choose native strategy → create Capacitor (or TWA) shell.
2. Fix P0 code blockers (payment gating, in-DOM confirms, age gate).
3. Finalize + lawyer-review + publish privacy policy; author App Privacy + Data Safety.
4. Owner accounts + signing material (Apple Team ID, Play account, keystore, certs/profiles).
5. Bundle CDN deps; configure universal/app links; persist session.
6. Seed reviewer account + comped/test payment path.
7. Build + sign `.ipa` / `.aab`; produce listing assets.
8. Submit.

**Strong points to preserve:** verified RLS + org isolation (anon blocked live), hardened edge functions (HMAC + token-gated + rate-limited), genuine in-app account deletion, real POPIA parental-consent flow, clean codebase, no leaked secrets.
