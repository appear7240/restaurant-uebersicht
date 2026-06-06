/* Restaurant-Übersicht – Service Worker (network-first) */
var CACHE = "rue-v1";
var CORE = [
  "./", "index.html", "assets/styles.css", "assets/app.js",
  "data/restaurants.js", "config.js", "manifest.webmanifest",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(CORE).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;                 // CDN/Maps/Places -> Netzwerk
  if (url.pathname.indexOf("/admin") === 0 || url.pathname.indexOf("/api") === 0) return; // dynamisch, nie cachen
  // Network-first: immer frisch versuchen, Cache als Offline-Fallback
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match("index.html"); });
    })
  );
});
