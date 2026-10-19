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
  watchNativo: null, // id del watcher nativo dentro de la app Android
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
  // La zona "Donde estoy yo" usa estas mismas posiciones: asi no depende
  // de un segundo seguimiento del GPS (que dentro de la app puede fallar).
  const yo = miPosicion();
  if (yo && typeof ZonaMovil !== "undefined" && ZonaMovil.activo) {
    alPosicionZona({ coords: { latitude: yo.lat, longitude: yo.lng, accuracy: yo.precision }, timestamp: yo.en });
  }
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
// Guarda una posicion nueva y actualiza lo que dependa de ella.
function registrarMiPosicion(lat, lng, precision) {
  const primera = !miPosicion();
  MiUbicacion.pos = { lat, lng, precision: Math.round(precision || 0), en: Date.now() };
  MiUbicacion.error = "";
  // Con la PRIMERA posicion hay que repintar: los textos "A X m de ti"
  // aun no existen en la pantalla y si no, aparecian hasta 10 s despues
  // que el punto "Tú" (visto en el emulador). Despues basta con
  // actualizar esos textos.
  if (primera && typeof render === "function" && state.usuario) render();
  alCambiarMiUbicacion();
}

// ── Dentro de la app Android: ubicacion NATIVA ──
// Visto en el emulador el 2026-10-18: dentro de la app la geolocalizacion
// del navegador no es confiable (una vez dio "gps" sin ninguna lectura
// aunque Android tenia el permiso) y navigator.permissions no existe. Se
// usa el mismo plugin que ya funciona para el adulto mayor, SIN
// backgroundMessage: solo con la app abierta y sin notificacion fija.
function enLaAppNativa() {
  return typeof esAppNativa !== "undefined" && esAppNativa && typeof GeoNativa !== "undefined" && !!GeoNativa;
}

async function iniciarMiUbicacionNativa() {
  MiUbicacion.watchId = "nativo"; // marca de "en marcha" mientras arranca
  try {
    let permiso = await GeoNativa.checkPermissions();
    if (permiso.location !== "granted") permiso = await GeoNativa.requestPermissions();
    if (permiso.location !== "granted") {
      MiUbicacion.error = "permiso";
      MiUbicacion.watchId = null;
      if (typeof render === "function") render();
      return;
    }
    MiUbicacion.watchNativo = await GeoNativa.addWatcher(
      { requestPermissions: false, stale: false, distanceFilter: 10 },
      (loc, err) => {
        if (err) {
          if (!MiUbicacion.pos) MiUbicacion.error = "gps";
          return;
        }
        registrarMiPosicion(loc.latitude, loc.longitude, loc.accuracy);
      }
    );
  } catch (_) {
    MiUbicacion.error = "gps";
    MiUbicacion.watchId = null;
  }
}

/**
 * Arranca el seguimiento de mi posicion. Desde un toque, llamarla
 * DIRECTAMENTE en el onclick: iOS solo muestra el permiso dentro del gesto.
 */
function iniciarMiUbicacion() {
  if (MiUbicacion.watchId !== null) return;
  MiUbicacion.necesitaToque = false;
  if (enLaAppNativa()) {
    iniciarMiUbicacionNativa();
    return;
  }
  if (!navigator.geolocation) return;
  MiUbicacion.watchId = navigator.geolocation.watchPosition(
    (p) => registrarMiPosicion(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
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
  if (MiUbicacion.watchNativo) {
    const id = MiUbicacion.watchNativo;
    MiUbicacion.watchNativo = null;
    Promise.resolve().then(() => GeoNativa.removeWatcher({ id })).catch(() => {});
  } else if (typeof MiUbicacion.watchId === "number") {
    navigator.geolocation.clearWatch(MiUbicacion.watchId);
  }
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
    if (enLaAppNativa()) {
      const p = await GeoNativa.checkPermissions();
      if (p.location !== "granted") {
        MiUbicacion.necesitaToque = true;
        return;
      }
    } else if (navigator.permissions) {
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
  if (document.visibilityState === "visible" && typeof MiUbicacion.watchId === "number") {
    detenerMiUbicacion();
    iniciarMiUbicacion();
  }
});
