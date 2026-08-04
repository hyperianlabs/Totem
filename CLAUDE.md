# Totem™ — Claude Code project notes

Totem is a multi-sport team selection and management web app for South African
schools and clubs, built under the Hyperian Labs brand. Positioning: "defensible
team selection." Beta testing at Kingsmead College.

Trademark: Totem™ is a trademark of D.S.Blom.

## Stack

- **Frontend**: vanilla HTML/CSS/JavaScript — no framework, no build step.
  Main files: `index.html`, `app.js` (~5,000 lines), `styles.css`, `config.js`.
  Also: `landing.html` (marketing/public page), `demo.html` (self-contained
  interactive demo, no login, no Supabase calls), `privacy.html`,
  `consent-response.html`, `transport-response.html`.
- **Backend**: Supabase (project ID `tiieaubyrjcsgiaegikb`, region eu-central-1).
  Edge functions live in `supabase/functions/`. SQL migrations in
  `supabase/migrations/` (20+ so far — multitenant, POPIA consent, transport,
  Paystack, staff management, save-conflict detection, etc.) plus `schema.sql`.
- **Email**: Resend (transactional).
- **Payments**: Paystack, via `paystack-webhook` edge function.
- **Hosting**: **Vercel** (project "totem" under the Hyperianlabs team), live at
  `totem.hyperianlabs.com`. Deploys automatically on every push to `main`.
  GitHub Pages is still technically enabled on the repo but unused/inactive —
  don't rely on it, don't bother fixing it if it breaks.
- **Domain**: Porkbun (DNS for hyperianlabs.com).
- **Platform admin email**: dsrc02@gmail.com.

## Deploy flow

`git push` to `main` → Vercel auto-deploys. That's it. There is no manual zip
workflow anymore — the old `totem-deploy_N.zip` / numbered-folder process is
retired. Never suggest re-introducing a zip-based deploy step.

If DNS or domain config ever needs touching, that's in the Vercel dashboard
(Domains tab) plus Porkbun — not something this repo controls.

## Hard-won lessons (don't relearn these the hard way)

- **Webhook raw body integrity**: Paystack (and any HMAC signature
  verification) requires hashing the *raw* request bytes. Use
  `req.arrayBuffer()`, never `req.text()` — a decode/re-encode round trip
  corrupts the hash and breaks signature verification.
- **Supabase Edge Function auth**: functions that need to be hit by external
  webhooks (e.g. `paystack-webhook`) must be deployed with `--no-verify-jwt`,
  or the gateway 401s them before your code ever runs.
- **State mutation discipline**: even one-click convenience actions (e.g.
  "mark unavailable") should route through the app's standard state-mutation
  path, not a background direct write — keeps things consistent and avoids
  silent conflicts.
- **Migration hygiene**: login-time migrations must be flagged run-once, or
  they re-trigger on every login. (Source of a past "Athletics ghost data"
  bug — data reappearing after deletion.)
- **Age-group derivation**: age groups are derived dynamically from the
  actual roster, not a fixed canonical list. The mapping is `U(age+1)` —
  e.g. age 8 plays U9, age 9 plays U10, ..., age 18+ is Senior. Don't
  hardcode band lists like `["U12","U15","U18"]`; always derive and sort
  numerically with Senior last.
- **Optimistic concurrency**: saves check `updated_at` before writing and
  warn on conflict rather than silently overwriting — important in
  multi-session/multi-tab scenarios. Preserve this pattern for new
  mutation code.
- **Demo mode**: `demo.html` sets `window.TOTEM_DEMO_MODE = true` in a
  `<script>` tag *before* `app.js` loads. `app.js` checks that flag and
  calls `enterDemoMode()`, which swaps in an in-memory sample dataset
  (Riverstone High, Rugby) and never touches Supabase. If the demo ever
  looks like the real login screen, check that this flag is still being
  set before `app.js` in the script order — don't assume the page is
  broken from static HTML alone (JS-driven state won't show up in a
  non-JS fetch).
- **Consent & indemnity flows**: POPIA consent and transport indemnity both
  use the same secure-token e-signing pattern. Keep new consent-style flows
  consistent with that pattern rather than inventing a new one.

## Conventions

- Iterative, session-based development — features get scoped, built, and
  fixed within the same session where possible.
- Security-sensitive flows (consent, indemnity, transport) reuse the
  established secure token pattern.
- The demo environment (`demo.html`) must stay fully self-contained — no
  backend calls — so it works for sales/marketing independent of live
  infrastructure. Any change to shared code paths (e.g. `app.js`) should be
  checked against `isDemoMode` branches before assuming a code path is safe
  to change globally.
- Landing (`landing.html`) links to the demo via a lightbox overlay (added
  Aug 2026) — the iframe only gets a `src` on click, so the marketing page's
  initial load stays light. Don't inline the full demo app into the landing
  page itself.

## What NOT to do

- Don't reintroduce a zip-based deploy step — it's git push only, now.
- Don't hardcode age-group bands — derive from roster data.
- Don't use `req.text()` for any webhook signature verification.
- Don't skip `--no-verify-jwt` on edge functions that need external
  webhook access.
- Don't assume GitHub Pages is the live site — it isn't, Vercel is.
