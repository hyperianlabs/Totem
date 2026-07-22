// Totem service worker — deliberately simple and conservative.
//
// Strategy: network-first for everything. Always tries the real network
// first (so you always get the latest deployed code and never stale
// Supabase data), and only falls back to a cached copy if the network
// request genuinely fails (e.g. briefly offline). This avoids the classic
// PWA trap of users getting stuck on an old cached version after a new
// deploy — given how often this project's had deploy/cache mix-ups
// already, network-first is the safer default here.
//
// Bump CACHE_NAME (e.g. "totem-v2") if you ever want to force every
// installed copy to fully discard its old cache — not required for normal
// deploys, since network-first already prefers fresh content automatically.

const CACHE_NAME = "totem-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept anything going to Supabase (auth, database, storage,
  // edge functions) — that must always be a live network request, never
  // served from cache, or you'd risk showing stale team/roster data.
  if (url.hostname.includes("supabase.co")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
