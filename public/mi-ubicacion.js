// La ubicacion del PROPIO familiar, para verse en el mapa ("Tú") y saber
// a que distancia esta cada persona a su cargo.
//
// Pedido del usuario el 2026-10-18: se veian los puntos de Claudia y de
// Fernando pero no el suyo, y sin esa referencia una alerta no dice lo
// que mas importa en ese momento: que tan lejos estan de mi.
//
// ── NO SE ENVIA AL SERVIDOR ───────────────────────────────────────
// Se usa solo en este telefono, para dibujar y calcular distancias. La
// unica vez que la posicion del familiar llega al servidor es con la zona
// "Donde estoy yo" (zona-movil.js), que la necesita para mover la zona.
//
// Solo funciona con la app abierta, como todo lo del navegador: es para
// mirar el mapa, no para vigilar al familiar.

const MiUbicacion = {
  pos: null, // { lat, lng, precision, en }
  watchId: null,
  error: "", // "permiso" | "gps" | ""
  necesitaToque: false, // sin permiso concedido: hace falta un toque
};

// Una posicion de hace mas de 2 minutos ya no sirve de referencia.
const MI_UBICACION_VIGENTE_MS = 2 * 60 * 1000;

function miPosicion() {
  const p = MiUbicacion.pos;
  return p && Date.now() - p.en < MI_UBICACION_VIGENTE_MS ? p : null;
}

function metrosEntre(lat1, lng1, lat2, lng2) {
  const rad = (g) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** Metros desde mi posicion hasta un punto, o null si no se mi posicion. */
function distanciaDesdeMi(lat, lng) {
  const yo = miPosicion();
  if (!yo || typeof lat !== "number" || typeof lng !== "number") return null;
  return metrosEntre(yo.lat, yo.lng, lat, lng);
}

function fmtDistancia(m) {
  if (m == null) return "";
  if (m < 1000) return Math.round(m / 10) * 10 + " m";
  return (m / 1000).toLocaleString("es-CO", { maximumFractionDigits: m < 10000 ? 1 : 0 }) + " km";
}

/** "A 1,2 km de ti", o "" si no se sabe. */
function textoDistancia(lat, lng) {
  const m = distanciaDesdeMi(lat, lng);
  return m == null ? "" : `A ${fmtDistancia(m)} de ti`;
}

// Al moverse el familiar no se repinta toda la pantalla (seria pesado y
// borraria lo que este mirando): solo su punto y los textos de distancia,
// que llevan data-dist-lat / data-dist-lng.
function alCambiarMiUbicacion() {
  // Si en pantalla seguia el boton "Verme en el mapa", repintar una vez
  // para cambiarlo por la distancia.
  if (document.getElementById("btnMiUbicacion") && typeof render === "function") render();
  if (typeof actualizarMiPuntoEnMapa === "function") actualizarMiPuntoEnMapa();
  document.querySelectorAll("[data-dist-lat]").forEach((el) => {
    const lat = Number(el.dataset.distLat), lng = Number(el.dataset.distLng);
    const t = "distCorto" in el.dataset ? fmtDistancia(distanciaDesdeMi(lat, lng)) : textoDistancia(lat, lng);
    el.textContent = t;
    el.hidden = !t;
  });
}

/**
 * Arranca el seguimiento de mi posicion. Desde un toque, llamarla
 * DIRECTAMENTE en el onclick: iOS solo muestra el permiso dentro del gesto.
 */
function iniciarMiUbicacion() {
  if (MiUbicacion.watchId !== null || !navigator.geolocation) return;
  MiUbicacion.necesitaToque = false;
  MiUbicacion.watchId = navigator.geolocation.watchPosition(
    (p) => {
      MiUbicacion.pos = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        precision: Math.round(p.coords.accuracy),
        en: Date.now(),
      };
      MiUbicacion.error = "";
      alCambiarMiUbicacion();
    },
    (e) => {
      if (e.code === 1) {
        MiUbicacion.error = "permiso";
        detenerMiUbicacion();
      } else if (!MiUbicacion.pos) {
        MiUbicacion.error = "gps";
      }
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
  );
}

function detenerMiUbicacion() {
  if (MiUbicacion.watchId !== null) navigator.geolocation.clearWatch(MiUbicacion.watchId);
  MiUbicacion.watchId = null;
}

/**
 * Tras cada refresco del familiar: si ya dio permiso, arranca solo. Si no,
 * la tarjeta del mapa muestra un boton (no se pide el permiso de sopetón
 * al abrir la app, sin que se sepa para que).
 */
async function sincronizarMiUbicacion() {
  if (!esContacto() || MiUbicacion.watchId !== null || MiUbicacion.error === "permiso") return;
  try {
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: "geolocation" });
      if (p.state !== "granted") {
        MiUbicacion.necesitaToque = true;
        return;
      }
    }
  } catch (_) {}
  iniciarMiUbicacion();
}

// iOS pausa la geolocalizacion en segundo plano: al volver, reiniciar.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && MiUbicacion.watchId !== null) {
    detenerMiUbicacion();
    iniciarMiUbicacion();
  }
});
