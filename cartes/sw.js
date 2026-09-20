/* CartePro — service worker : coque applicative hors-ligne + cache du moteur OCR */
const CACHE = "cartepro-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // Moteur et données de langue OCR (CDN) : on sert le cache, sinon on télécharge et on garde
  if(/tesseract|tessdata/i.test(url.href)){
    e.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req);
      if(hit) return hit;
      const res = await fetch(req);
      if(res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Coque de l'application : cache d'abord, réseau en secours
  if(url.origin === location.origin){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if(res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match("./index.html"))));
  }
});
