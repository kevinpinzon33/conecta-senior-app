// Zona segura que SIGUE al familiar ("Donde estoy yo").
//
// Pedido del usuario tras la primera prueba de campo: al salir juntos
// (un centro comercial, una cita) la zona no es la casa, es el propio
// familiar. Su telefono manda su posicion cada 10 s y el servidor mueve
// el centro de la zona; si la persona se aleja mas del radio, salta la
// alerta como siempre.
//
// Mismas reglas que compartir-ubicacion.js, que ya costaron caro en iOS:
// getCurrentPosition sincrono dentro del toque, watch en paralelo, latido
// para no quedarse callado, y reiniciar el watch al volver a la app.
//
// Limite: igual que el adulto mayor, solo funciona con la app abierta y
// la pantalla encendida. Si el familiar la cierra, la zona se queda en
// su ultima posicion conocida (y la pantalla lo dice).

const ZonaMovil = {
  activo: false,
  watchId: null,
  latidoId: null,
  wakeLock: null,
  ultimaPos: null,
  ultimoEnvio: 0,
  necesitaToque: false, // permiso sin conceder: hace falta un toque
  error: "",
};

const MS_ENVIO_ZONA = 10000;
const OPCIONES_ZONA = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };

// ¿La zona de la persona seleccionada me esta siguiendo a MI?
function zonaMeSigue() {
  const z = state.senior && state.senior.zonaSegura;
  return !!z && z.modo === "cuidador" && z.cuidadorId === state.usuario?.id;
}

// Con varios adultos a cargo, puede haber mas de una zona siguiendome
// (salir con los dos a la vez). Se mira en la lista de todos, no solo en
// el seleccionado: cambiar de pestaña no puede dejar una zona quieta.
function adultosQueMeSiguen() {
  const yo = state.usuario?.id;
  const lista = state.adultos && state.adultos.length ? state.adultos : state.senior ? [state.senior] : [];
  return lista
    .filter((a) => a.zonaSegura && a.zonaSegura.modo === "cuidador" && a.zonaSegura.cuidadorId === yo)
    .map((a) => a.id);
}

async function enviarCentroZona(pos) {
  const ahora = Date.now();
  if (ZonaMovil.ultimoEnvio && ahora - ZonaMovil.ultimoEnvio < MS_ENVIO_ZONA - 1000) return;
  ZonaMovil.ultimoEnvio = ahora;
  const cuerpo = JSON.stringify({
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    precision: pos.coords.accuracy,
  });
  for (const id of adultosQueMeSiguen()) {
    try {
      await api("/senior/zona-segura/centro", {
        method: "POST",
        headers: { "X-Adulto-Id": String(id) },
        body: cuerpo,
      });
      ZonaMovil.error = "";
    } catch (err) {
      // 409: alguien cambio esa zona a otro modo; el siguiente refresco
      // la saca de la lista. Cualquier otro fallo, se reintenta.
      if (!/no está siguiendo/.test(err.message)) ZonaMovil.error = "Sin conexión; reintentando…";
    }
  }
}

function alPosicionZona(pos) {
  ZonaMovil.ultimaPos = pos;
  ZonaMovil.error = "";
  ZonaMovil.necesitaToque = false;
  enviarCentroZona(pos);
}

function alFallarZona(err) {
  if (err.code === 3 && ZonaMovil.ultimaPos) return; // timeout suelto
  ZonaMovil.error =
    err.code === 1
      ? "No diste permiso de ubicación a esta página. Actívalo en los ajustes del navegador."
      : "No se pudo leer tu ubicación. Revisa que el GPS esté encendido.";
  if (err.code === 1) ZonaMovil.necesitaToque = true;
}

function latidoZona() {
  if (!ZonaMovil.activo) return;
  const p = ZonaMovil.ultimaPos;
  if (p && Date.now() - p.timestamp < 30000) return enviarCentroZona(p);
  navigator.geolocation.getCurrentPosition(alPosicionZona, alFallarZona, OPCIONES_ZONA);
}

async function pedirWakeLockZona() {
  if (!("wakeLock" in navigator)) return;
  try {
    ZonaMovil.wakeLock = await navigator.wakeLock.request("screen");
    ZonaMovil.wakeLock.addEventListener("release", () => (ZonaMovil.wakeLock = null));
  } catch (_) {}
}

/**
 * OJO: desde un toque, llamarla DIRECTAMENTE en el onclick (sin await
 * antes), o iOS niega el permiso sin preguntar.
 */
function iniciarZonaMovil() {
  if (!navigator.geolocation) {
    ZonaMovil.error = "Este teléfono no permite leer la ubicación.";
    return;
  }
  ZonaMovil.activo = true;
  ZonaMovil.ultimoEnvio = 0;
  navigator.geolocation.getCurrentPosition(alPosicionZona, alFallarZona, OPCIONES_ZONA);
  if (ZonaMovil.watchId !== null) navigator.geolocation.clearWatch(ZonaMovil.watchId);
  ZonaMovil.watchId = navigator.geolocation.watchPosition(alPosicionZona, alFallarZona, OPCIONES_ZONA);
  clearInterval(ZonaMovil.latidoId);
  ZonaMovil.latidoId = setInterval(latidoZona, MS_ENVIO_ZONA);
  pedirWakeLockZona();
}

function detenerZonaMovil() {
  ZonaMovil.activo = false;
  if (ZonaMovil.watchId !== null) navigator.geolocation.clearWatch(ZonaMovil.watchId);
  ZonaMovil.watchId = null;
  clearInterval(ZonaMovil.latidoId);
  ZonaMovil.latidoId = null;
  ZonaMovil.ultimaPos = null;
  if (ZonaMovil.wakeLock) ZonaMovil.wakeLock.release().catch(() => {});
  ZonaMovil.wakeLock = null;
}

/**
 * Se llama tras cada refresco. Arranca o para el envio segun lo que diga
 * el servidor, para que funcione tambien al reabrir la app o si otro
 * familiar cambia la zona. Sin permiso concedido no se puede arrancar
 * solo: la pantalla muestra un boton para hacerlo con un toque.
 */
async function sincronizarZonaMovil() {
  if (!adultosQueMeSiguen().length) {
    if (ZonaMovil.activo) detenerZonaMovil();
    ZonaMovil.necesitaToque = false;
    return;
  }
  if (ZonaMovil.activo) return;
  try {
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: "geolocation" });
      if (p.state !== "granted") {
        ZonaMovil.necesitaToque = true;
        return;
      }
    }
  } catch (_) {}
  iniciarZonaMovil();
}

// iOS pausa la geolocalizacion en segundo plano: al volver, reiniciar.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ZonaMovil.activo) iniciarZonaMovil();
});
