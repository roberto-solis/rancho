// Guarda as telas do app no aparelho para abrir rápido. Os dados (Supabase) nunca ficam guardados aqui.
// Ao publicar uma versão nova, troque o número abaixo.
const VERSAO = "rds-web-4";
const ARQUIVOS = [
  "./", "index.html", "estilo.css", "calculos.js", "app.js", "manifest.webmanifest",
  "icones/icone-192.png", "icones/apple-touch-icon.png", "icones/foto-rancho.jpg",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const doApp = url.origin === self.location.origin;
  const daBiblioteca = url.hostname === "cdn.jsdelivr.net";
  if (!doApp && !daBiblioteca) return;          // Supabase e outros: sempre direto da internet

  if (daBiblioteca) {                           // versão fixa: pode vir do aparelho
    ev.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }
  // Telas do app: tenta a internet primeiro (pega atualizações); sem internet, usa a cópia
  ev.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
  );
});
