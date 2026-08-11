// Subir este numero cuando cambie el frontend. Al cambiar el nombre del
// cache, el "activate" de abajo borra el cache viejo y el usuario deja de
// ver la version anterior.
const CACHE = "conecta-senior-v2";
const ASSETS = ["/", "/styles.css", "/app.js", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Estrategia: red primero, cache solo como respaldo sin conexion.
//
// Antes era al reves (cache primero) y eso congelaba la app: aunque se
// desplegara una version nueva en Render, el telefono seguia mostrando
// para siempre los archivos guardados la primera vez. Yendo primero a la
// red, cada despliegue se ve de inmediato y el cache solo entra cuando
// de verdad no hay internet.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // La API nunca se cachea: siempre queremos datos frescos.
  if (e.request.url.includes("/api/")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Solo guardamos lo nuestro; respuestas de otros dominios
        // (por ejemplo las fuentes de Google) se dejan pasar sin cachear.
        if (res.ok && new URL(e.request.url).origin === self.location.origin) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
