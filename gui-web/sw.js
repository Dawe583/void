// App shell cache. Same-origin app files cache-first, all else
// network-first. No push, no background sync.
var CACHE = "void-v1";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./fixtures.js",
  "./js/api.js",
  "./manifest.json"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  var isShell = url.origin === self.location.origin && /(\/|\.html|\.css|\.js|\.json)$/.test(url.pathname);
  e.respondWith(
    isShell
      ? caches.match(e.request).then(function (hit) {
          return hit || fetch(e.request).then(function (res) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
            return res;
          });
        })
      : fetch(e.request).catch(function () { return caches.match("./index.html"); })
  );
});
