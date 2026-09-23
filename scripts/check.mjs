#!/usr/bin/env node
// Totem's first quality gate. Deliberately zero-dependency and build-free —
// it runs anywhere `node` exists (locally and in CI) with no `npm install`.
//
// It catches the classes of regression that have actually bitten this project:
//   - JS syntax errors in app.js / other browser scripts (a broken deploy)
//   - a secret accidentally committed to a client-side file
//   - malformed manifest.json / config.js
//   - an edge function that hardcodes a secret instead of reading Deno.env
//
// Run:  npm test   (or)   node scripts/check.mjs
// Exits non-zero on any failure so CI fails the build.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---------- 1. Browser JS syntax ----------
// Every top-level *.js in the repo root is shipped to the browser as-is.
console.log("Checking browser JS syntax...");
for (const file of readdirSync(root).filter((f) => f.endsWith(".js"))) {
  try {
    execSync(`node --check ${JSON.stringify(join(root, file))}`, { stdio: "pipe" });
    ok(`${file} parses`);
  } catch (e) {
    fail(`${file} has a syntax error:\n${e.stderr?.toString() || e.message}`);
  }
}

// ---------- 2. JSON validity ----------
console.log("Checking JSON files...");
for (const file of ["manifest.json"]) {
  const p = join(root, file);
  if (!existsSync(p)) { fail(`${file} is missing`); continue; }
  try { JSON.parse(readFileSync(p, "utf8")); ok(`${file} is valid JSON`); }
  catch (e) { fail(`${file} is invalid JSON: ${e.message}`); }
}

// manifest.json must keep the PWA / install-critical fields.
try {
  const m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  for (const key of ["name", "short_name", "start_url", "scope", "display", "icons", "id"]) {
    if (!(key in m)) fail(`manifest.json is missing "${key}"`);
  }
  if (!failures.some((f) => f.includes("manifest.json is missing"))) ok("manifest.json has required PWA fields");
} catch { /* invalid-JSON already reported above */ }

// ---------- 3. No secrets in client-side files ----------
// config.js is served to the browser and may ONLY contain publishable keys.
console.log("Checking for leaked secrets in client files...");
const secretPatterns = [
  [/\bservice_role\b/i, "service_role reference"],
  [/\bsk_(live|test)_[A-Za-z0-9]/, "Stripe/Paystack SECRET key (sk_...)"],
  [/\bwhsec_[A-Za-z0-9]/, "webhook signing secret (whsec_...)"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "a JWT (eyJ... — anon/service key)"],
];
const clientFiles = readdirSync(root).filter((f) => /\.(js|html)$/.test(f));
for (const file of clientFiles) {
  const text = readFileSync(join(root, file), "utf8");
  for (const [re, label] of secretPatterns) {
    if (re.test(text)) fail(`${file} appears to contain ${label} — client files must not carry secrets`);
  }
}
if (!failures.some((f) => f.includes("must not carry secrets"))) ok("no secrets found in client-side files");

// config.js must define the two expected publishable keys and nothing secret.
if (existsSync(join(root, "config.js"))) {
  const cfg = readFileSync(join(root, "config.js"), "utf8");
  if (!/SUPABASE_URL/.test(cfg) || !/SUPABASE_ANON_KEY/.test(cfg)) fail("config.js is missing SUPABASE_URL / SUPABASE_ANON_KEY");
  else ok("config.js has the expected public config");
}

// ---------- 4. Edge functions read secrets from Deno.env (never hardcoded) ----------
console.log("Checking edge functions...");
const fnDir = join(root, "supabase", "functions");
if (existsSync(fnDir)) {
  for (const entry of readdirSync(fnDir)) {
    const idx = join(fnDir, entry, "index.ts");
    if (!statSync(join(fnDir, entry)).isDirectory() || !existsSync(idx)) continue;
    const src = readFileSync(idx, "utf8");
    for (const [re, label] of secretPatterns.slice(1)) { // skip service_role (edge fns legitimately name the env var)
      if (re.test(src)) fail(`supabase/functions/${entry}/index.ts appears to hardcode ${label}`);
    }
  }
  if (!failures.some((f) => f.includes("hardcode"))) ok("no hardcoded secrets in edge functions");
}

// ---------- report ----------
console.log("");
if (failures.length) {
  console.error(`✗ ${failures.length} check(s) failed:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ All checks passed.");
