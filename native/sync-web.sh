#!/usr/bin/env bash
# Copies the Totem web app from the repo root into native/www/ (Capacitor's
# webDir), so the native iOS/Android shells bundle the app locally rather than
# pointing at a remote URL (a remote-URL wrapper is an App Store 4.2 rejection
# risk). Run this before `npx cap sync` whenever the web app changes.
#
#   cd native && ./sync-web.sh && npx cap sync
#
# Deliberately an ALLOWLIST, not a copy-everything: marketing pages, demo,
# videos, the service worker (no SW in the native shell), and all tooling are
# excluded. Keep this list in sync with the files index.html actually needs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WWW="$HERE/www"

# Core app + pages linked from inside the app + icons/logos it references.
FILES=(
  index.html
  app.js
  styles.css
  config.js
  manifest.json
  privacy.html
  consent-response.html
  transport-response.html
  parental-consent-form-template.docx
  apple-touch-icon.png
  favicon-16.png
  favicon-32.png
  icon-192.png
  icon-512.png
  icon-512-maskable.png
  totem-icon-white.png
  totem-logo.png
)

rm -rf "$WWW"
mkdir -p "$WWW"

missing=0
for f in "${FILES[@]}"; do
  if [ -f "$ROOT/$f" ]; then
    cp "$ROOT/$f" "$WWW/$f"
  else
    echo "  ! missing (skipped): $f"
    missing=$((missing+1))
  fi
done

echo "Synced ${#FILES[@]} entries into www/ (${missing} missing). Excluded: service-worker.js, landing.html, demo.html, videos, social/, email-templates/, docs/, supabase/, scripts/."
