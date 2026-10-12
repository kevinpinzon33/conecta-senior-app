// Compartir la ubicación desde el teléfono del ADULTO MAYOR.
//
// Es la pieza que faltaba para probar la zona segura de verdad: hasta
// ahora la posición solo se movía con el simulador. Aquí el teléfono de
// la persona manda su GPS al servidor, y el panel del cuidador lo ve.
//
// ── LO QUE ESTO NO ES ──────────────────────────────────────────────
// Solo funciona con la app ABIERTA y en pantalla. Al bloquear el
// teléfono o cambiar de app, iOS congela la página y deja de reportar.
// No hay forma de evitarlo desde el navegador: eso exige una app
// nativa. Sirve para probar la geocerca y afinar las falsas alarmas,
// no para vigilar a alguien un día entero.
//
// ── TRES TRAMPAS DE iOS QUE YA COSTARON CARO ───────────────────────
// (aprendidas en el backend real, ver CONTEXTO-GEOLOCALIZACION.md)
//
//   1. getCurrentPosition TIENE que llamarse de forma SÍNCRONA dentro
//      del gesto del usuario. Metido en un .then() o un setTimeout,
//      Safari lo deniega al instante y sin enseñar el diálogo de
//      permiso, así que el botón parece no hacer nada.
//   2. Hay que lanzar watchPosition EN PARALELO: iOS a veces falla
//      getCurrentPosition con kCLErrorLocationUnknown y sin embargo el
//      watch sí entrega el primer fix.
//   3. Con la página en segundo plano, iOS PAUSA la geolocalización y
//      el watch puede quedar muerto. Al volver hay que reiniciarlo.

const CLAVE_COMPARTIR = "conecta_senior_compartiendo";

// El watch puede disparar cada segundo. Enviar todo eso castigaría al
// servidor gratuito sin aportar nada: para una geocerca, cada 10 s va
// sobrado y deja margen de sobra al guardia de velocidad del servidor.
const MS_ENTRE_ENVIOS = 10000;

// Se pone a true cada vez que se empieza a compartir.
let primeraAceptada = true;

const Ubicacion = {
  activo: false,
  watchId: null,
  latidoId: null,
  ultimaPos: null, // la ultima posicion que dio el GPS, enviada o no
  wakeLock: null,
  ultimoEnvio: 0,
  estado: "inactivo", // inactivo | buscando | compartiendo | error
  detalle: "",
  ultimaLectura: null,
  alCambiar: null, // callback para repintar la pantalla
};

const esIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function avisarCambio() {
  if (typeof Ubicacion.alCambiar === "function") Ubicacion.alCambiar();
}

function fijarEstado(estado, detalle) {
  Ubicacion.estado = estado;
  Ubicacion.detalle = detalle || "";
  avisarCambio();
}

// El mensaje se adapta a la CAUSA. Mandar a encender el GPS cuando el
// problema es el permiso del sitio (o al revés) deja a la persona dando
// vueltas sin resolver nada.
function textoDelError(codigo) {
  if (codigo === 1) {
    return esIOS
      ? "Safari tiene bloqueada la ubicación para esta página. Ve a Ajustes → Safari → Ubicación y elige “Preguntar” o “Permitir”. Luego vuelve y toca el botón otra vez."
      : "El navegador tiene bloqueada la ubicación para esta página. Ábrelo en el candado de la barra de direcciones y permite la ubicación.";
  }
  if (codigo === 2) {
    return esIOS
      ? "La ubicación del teléfono está apagada. Actívala en Ajustes → Privacidad y seguridad → Localización."
      : "La ubicación del teléfono está apagada. Actívala en los ajustes rápidos.";
  }
  return "No se pudo obtener la señal del GPS. Suele pasar bajo techo: acércate a una ventana o sal un momento.";
}

// ── Envío al servidor ────────────────────────────────────────────

async function enviarPosicion(pos) {
  const ahora = Date.now();
  // La primera lectura se manda siempre; las siguientes, espaciadas. El
  // margen de 1 s es para que el latido (cada 10 s justos) no caiga un
  // milisegundo antes y se descarte.
  if (Ubicacion.ultimoEnvio && ahora - Ubicacion.ultimoEnvio < MS_ENTRE_ENVIOS - 1000) {
    return;
  }
  Ubicacion.ultimoEnvio = ahora;

  const lectura = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    precision: pos.coords.accuracy,
    fuente: "gps",
  };

  try {
    const r = await api("/ubicacion", {
      method: "POST",
      body: JSON.stringify(lectura),
    });

    Ubicacion.ultimaLectura = {
      ...lectura,
      en: new Date().toISOString(),
      // El servidor puede descartar una lectura por imprecisa o por
      // salto imposible. Si pasa, hay que decirlo y no fingir que todo
      // va bien.
      aceptada: r.aceptada !== false,
      motivo: r.motivo || "",
      distanciaM: r.distanciaM,
      fueraDeZona: r.fueraDeZona,
    };

    fijarEstado(
      "compartiendo",
      r.aceptada === false ? r.motivo : ""
    );

    // La primera vez se recargan los datos: hasta ese momento la propia
    // pantalla de la persona sigue enseñando la dirección de ejemplo del
    // seed, y resulta confuso ver "compartiendo" junto a una calle que
    // no es la suya. Solo la primera: despues basta el refresco de 15 s.
    // Y tambien cuando el servidor confirma una salida o un regreso: la
    // pantalla de la persona no puede seguir diciendo "Estás en tu zona
    // segura" hasta el siguiente refresco cuando su familia ya fue avisada.
    if ((primeraAceptada && r.aceptada !== false) || r.evento) {
      primeraAceptada = false;
      if (typeof refreshAll === "function") refreshAll().catch(() => {});
    }
  } catch (err) {
    // Un fallo de red no apaga el compartir: el teléfono puede estar en
    // un ascensor. Se sigue intentando con la siguiente lectura.
    fijarEstado("compartiendo", "Sin conexión con el servidor; reintentando…");
  }
}

function alRecibirPosicion(pos) {
  Ubicacion.ultimaPos = pos;
  enviarPosicion(pos);
}

// ── Latido ───────────────────────────────────────────────────────
// En la primera prueba de campo (2026-10-12) el telefono dejo de
// reportar y nadie se entero. Una causa: el watch solo avisa cuando la
// posicion cambia, y las lecturas que llegaban antes de los 10 s se
// descartaban; si despues el GPS se callaba, no salia nada mas.
//
// Ahora, cada 10 s se manda la ultima posicion aunque la persona no se
// mueva. Si esa posicion ya tiene mas de 30 s, se pide una nueva. Asi el
// servidor sabe que el telefono sigue vivo, y si deja de oirlo avisa al
// cuidador (alerta "Se perdió su ubicación").
function latido() {
  if (!Ubicacion.activo) return;
  const p = Ubicacion.ultimaPos;
  if (p && Date.now() - p.timestamp < 30000) {
    enviarPosicion(p);
    return;
  }
  navigator.geolocation.getCurrentPosition(alRecibirPosicion, alFallar, OPCIONES);
}

function arrancarLatido() {
  clearInterval(Ubicacion.latidoId);
  Ubicacion.latidoId = setInterval(latido, MS_ENTRE_ENVIOS);
}

function alFallar(err) {
  // Un timeout suelto no debe apagar nada: el watch sigue vivo y la
  // siguiente lectura suele llegar.
  if (err.code === 3 && Ubicacion.ultimaLectura) return;
  fijarEstado("error", textoDelError(err.code));
}

// ── Mantener la pantalla encendida ───────────────────────────────
// Sin esto, la pantalla se apaga sola a los 30 s y el reporte se corta.

async function pedirWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    Ubicacion.wakeLock = await navigator.wakeLock.request("screen");
    // El sistema lo suelta al ir a segundo plano; se vuelve a pedir al
    // regresar (ver alCambiarVisibilidad).
    Ubicacion.wakeLock.addEventListener("release", () => {
      Ubicacion.wakeLock = null;
    });
  } catch (_) {
    // Navegador sin soporte o permiso denegado: no es motivo para no
    // compartir, solo significa que la pantalla se apagará sola.
  }
}

function soltarWakeLock() {
  if (Ubicacion.wakeLock) {
    Ubicacion.wakeLock.release().catch(() => {});
    Ubicacion.wakeLock = null;
  }
}

// ── Arrancar y parar ─────────────────────────────────────────────

const OPCIONES = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };

function arrancarWatch() {
  if (Ubicacion.watchId !== null) {
    navigator.geolocation.clearWatch(Ubicacion.watchId);
  }
  Ubicacion.watchId = navigator.geolocation.watchPosition(
    alRecibirPosicion,
    alFallar,
    OPCIONES
  );
}

/**
 * OJO: hay que llamar a esto DIRECTAMENTE desde el onclick, sin await ni
 * setTimeout por delante. Si no, iOS deniega el permiso sin preguntar.
 */
function iniciarCompartir() {
  if (!navigator.geolocation) {
    fijarEstado("error", "Este teléfono no permite compartir la ubicación.");
    return;
  }

  Ubicacion.activo = true;
  Ubicacion.ultimoEnvio = 0;
  primeraAceptada = true;
  localStorage.setItem(CLAVE_COMPARTIR, "1");
  fijarEstado("buscando", "");

  // 1) Síncrono dentro del gesto: esto es lo que abre el diálogo.
  navigator.geolocation.getCurrentPosition(alRecibirPosicion, alFallar, OPCIONES);
  // 2) Y en paralelo el watch, que en iOS a veces es el único que responde.
  arrancarWatch();
  arrancarLatido();

  pedirWakeLock();
}

// Devuelve la promesa del aviso al servidor, para que cerrar sesion
// pueda esperarla antes de invalidar el token.
function detenerCompartir() {
  Ubicacion.activo = false;
  localStorage.removeItem(CLAVE_COMPARTIR);
  if (Ubicacion.watchId !== null) {
    navigator.geolocation.clearWatch(Ubicacion.watchId);
    Ubicacion.watchId = null;
  }
  clearInterval(Ubicacion.latidoId);
  Ubicacion.latidoId = null;
  Ubicacion.ultimaPos = null;
  soltarWakeLock();
  fijarEstado("inactivo", "");
  // Que el servidor sepa que el silencio que sigue es voluntario: si no,
  // a los 3 minutos le saltaria al cuidador "Se perdió su ubicación".
  return api("/ubicacion/detener", { method: "POST" }).catch(() => {});
}

// iOS congela la geolocalización en segundo plano y el watch puede
// quedar muerto sin avisar. Al volver se reinicia y se vuelve a pedir la
// pantalla encendida.
function alCambiarVisibilidad() {
  if (document.visibilityState !== "visible" || !Ubicacion.activo) return;
  arrancarWatch();
  pedirWakeLock();
}
document.addEventListener("visibilitychange", alCambiarVisibilidad);

/**
 * Al abrir la app, si ya estaba compartiendo y el permiso sigue
 * concedido, se reanuda solo. No se fuerza cuando el permiso está en
 * "prompt": ahí hace falta el gesto del usuario.
 */
async function reanudarSiProcede() {
  if (localStorage.getItem(CLAVE_COMPARTIR) !== "1") return;
  if (!navigator.geolocation) return;

  try {
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: "geolocation" });
      if (p.state !== "granted") return;
    }
  } catch (_) {
    // Safari viejo no tiene Permissions API: se intenta igual, y si el
    // permiso ya estaba dado no aparece ningún diálogo.
  }

  Ubicacion.activo = true;
  fijarEstado("buscando", "");
  arrancarWatch();
  arrancarLatido();
  pedirWakeLock();
}
