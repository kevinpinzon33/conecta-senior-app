// Punto de entrada y enrutador por rol.
//
// El flujo es siempre el mismo: se pregunta al servidor quien esta
// conectado y, segun el rol que responda, se monta una interfaz u otra.
// No hay botones para "cambiar de vista": la unica forma de ver la
// interfaz del otro rol es entrar con ese usuario.

// Que pestanas tiene cada rol y que funcion dibuja cada una.
const TABS_POR_ROL = {
  adulto_mayor: [
    { id: "hoy", etiqueta: "Hoy", icono: "casa" },
    { id: "misalertas", etiqueta: "Alertas", icono: "campana", badge: true },
    { id: "miinfo", etiqueta: "Mi info", icono: "persona" },
  ],
};
// Familiar y cuidador (los roles del backend real) ven la misma interfaz.
const TABS_CUIDADOR = [
    { id: "inicio", etiqueta: "Inicio", icono: "pin" },
    { id: "alertas", etiqueta: "Alertas", icono: "campana", badge: true },
    { id: "perfil", etiqueta: "Perfil", icono: "persona" },
  ];
TABS_POR_ROL.familiar = TABS_CUIDADOR;
TABS_POR_ROL.cuidador = TABS_CUIDADOR;

const VISTAS = {
  // Adulto mayor
  hoy: renderMayorHoy,
  misalertas: renderMayorAlertas,
  miinfo: renderMayorInfo,
  // Familiar o cuidador
  inicio: renderInicio,
  alertas: renderAlertas,
  perfil: renderPerfil,
};

let temporizadorRefresco = null;

// --- Montaje de la interfaz ---------------------------------------------

function tabsDelUsuario() {
  return TABS_POR_ROL[state.usuario?.rol] || [];
}

function renderTopbar() {
  const u = state.usuario;
  topbarEl.innerHTML = `
    <div class="topbar-fila">
      <div class="topbar-brand">
        <img src="icons/logo-mark.png" alt="" width="26" height="26" />
        <div class="word"><b>Conecta</b><small>Senior</small></div>
      </div>
      <button class="topbar-salir" id="btnSalir" title="Cerrar sesión">
        <span class="topbar-usuario">${esc(primerNombre(u.nombre))}</span>
        ${ICONS.salir}
      </button>
    </div>
  `;
  document.getElementById("btnSalir").onclick = cerrarSesion;
}

function renderTabbar() {
  const pendientes = state.alertas.filter((a) => a.estado === "pendiente").length;

  tabbarEl.hidden = false;
  tabbarEl.innerHTML = tabsDelUsuario()
    .map(
      (t) => `
      <button class="tab ${t.id === state.tab ? "active" : ""}" data-tab="${t.id}">
        ${TAB_ICONS[t.icono]}
        <span>${t.etiqueta}</span>
        ${t.badge && pendientes ? '<span class="tab-badge"></span>' : ""}
      </button>`
    )
    .join("");

  tabbarEl.querySelectorAll(".tab").forEach((btn) => {
    btn.onclick = () => {
      state.tab = btn.dataset.tab;
      render();
    };
  });
}

function render() {
  if (!state.usuario) return;
  renderTabbar();
  const vista = VISTAS[state.tab];
  if (vista) vista();
}

async function refreshAll() {
  if (!state.usuario) return;

  // El familiar primero averigua a quienes tiene a cargo y cual esta
  // seleccionado; todo lo demas se pide para ese (cabecera X-Adulto-Id).
  // Las alertas, en cambio, se piden de TODOS: una alerta de Jorge no
  // puede pasar desapercibida porque en pantalla se esta mirando a Claudia.
  if (esContacto()) {
    state.adultos = await api("/adultos");
    if (!state.adultos.some((a) => a.id === state.adultoId)) {
      state.adultoId = state.adultos[0] ? state.adultos[0].id : null;
    }
  }

  const [senior, alertas, contactos, recordatorios, medicamentos, citas] =
    await Promise.all([
      api("/senior"),
      api(esContacto() ? "/alertas?todos=1" : "/alertas"),
      api("/contactos"),
      api("/recordatorios"),
      api("/medicamentos"),
      api("/citas"),
    ]);
  state.senior = senior;
  state.alertas = alertas;
  state.contactos = contactos;
  state.recordatorios = recordatorios;
  state.medicamentos = medicamentos;
  state.citas = citas;
  render();
  avisarAlertasNuevas();
  if (esContacto() && typeof sincronizarZonaMovil === "function") {
    sincronizarZonaMovil().catch(() => {});
  }
}

// --- Aviso de alerta nueva (solo el cuidador) ----------------------------
//
// Que la alerta exista en la pestana Alertas no basta: el cuidador tiene
// que enterarse sin estar mirandola. Con la app abierta se muestra un
// aviso a pantalla, vibra y suena; si dio permiso de notificaciones,
// ademas sale una notificacion del sistema.
//
// Limite que hay que tener claro: esto funciona mientras la app este
// abierta (aunque sea en otra pestana, segun el navegador). Avisar con el
// telefono bloqueado exige notificaciones push desde el servidor.

const CLAVE_AVISADAS = "conecta_senior_alertas_avisadas";

// La clave incluye la fecha y no solo el id: Render borra db.json en cada
// despliegue y los ids vuelven a empezar, asi que una alerta nueva podria
// llegar con el id de una ya avisada y quedarse muda.
const claveAviso = (a) => `${a.id}|${a.creadoEn}`;

function leerAvisadas() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE_AVISADAS) || "[]"));
  } catch (_) {
    return new Set();
  }
}

function guardarAvisadas(avisadas) {
  try {
    localStorage.setItem(CLAVE_AVISADAS, JSON.stringify([...avisadas].slice(-50)));
  } catch (_) {}
}

function avisarAlertasNuevas() {
  if (!esContacto()) return;
  const avisadas = leerAvisadas();
  // state.alertas viene ordenado de la mas reciente a la mas vieja.
  const nuevas = state.alertas.filter(
    (a) => a.estado === "pendiente" && !avisadas.has(claveAviso(a))
  );
  if (!nuevas.length) return;

  nuevas.forEach((a) => avisadas.add(claveAviso(a)));
  guardarAvisadas(avisadas);
  mostrarAvisoAlerta(nuevas[0], nuevas.length);
}

function mostrarAvisoAlerta(alerta, cuantas) {
  document.querySelector(".aviso-alerta")?.remove();

  const aviso = document.createElement("div");
  aviso.className = "aviso-alerta";
  aviso.setAttribute("role", "alert");
  aviso.innerHTML = `
    <div class="aviso-icono">${ICONS.warn}</div>
    <div class="aviso-cuerpo">
      ${state.adultos.length > 1 && alerta.adultoNombre
        ? `<p class="aviso-quien">${esc(alerta.adultoNombre)}</p>`
        : ""}
      <p class="aviso-titulo">${esc(alerta.titulo)}</p>
      <p class="aviso-detalle">${esc(alerta.detalle)}</p>
      <p class="aviso-hora">${esc(fmtCuando(alerta.creadoEn))}${
        cuantas > 1 ? ` · y ${cuantas - 1} más` : ""
      }</p>
      <div class="aviso-acciones">
        <button class="btn btn-primary" data-aviso="ver">Ver alertas</button>
        <button class="btn btn-secondary" data-aviso="cerrar">Entendido</button>
      </div>
    </div>
  `;
  document.body.appendChild(aviso);

  aviso.querySelector('[data-aviso="ver"]').onclick = () => {
    aviso.remove();
    state.tab = "alertas";
    render();
  };
  aviso.querySelector('[data-aviso="cerrar"]').onclick = () => aviso.remove();

  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
  sonarAlarma();
  notificarAlSistema(alerta);
}

// El navegador no deja sonar nada hasta que la persona toca la pantalla
// al menos una vez. Se prepara el audio en el primer toque y a partir de
// ahi la alarma puede sonar sola.
let contextoAudio = null;

function prepararSonido() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    contextoAudio = contextoAudio || new Ctx();
    if (contextoAudio.state === "suspended") contextoAudio.resume();
  } catch (_) {}
}
document.addEventListener("pointerdown", prepararSonido, { passive: true });

function sonarAlarma() {
  if (!contextoAudio || contextoAudio.state !== "running") return;
  const t0 = contextoAudio.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = contextoAudio.createOscillator();
    const vol = contextoAudio.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    vol.gain.setValueAtTime(0.0001, t0 + i * 0.45);
    vol.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.45 + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.45 + 0.3);
    osc.connect(vol).connect(contextoAudio.destination);
    osc.start(t0 + i * 0.45);
    osc.stop(t0 + i * 0.45 + 0.32);
  }
}

// --- Notificaciones del sistema ---
// Van por el service worker porque en Android Chrome `new Notification()`
// desde la pagina no esta permitido. En iPhone solo existen si la app se
// instalo en la pantalla de inicio (iOS 16.4 o posterior).

function notificacionesDisponibles() {
  return "Notification" in window && "serviceWorker" in navigator;
}

async function pedirPermisoNotificaciones() {
  if (!notificacionesDisponibles()) return "no-disponible";
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return "denied";
  }
}

async function notificarAlSistema(alerta) {
  // En la app Android no hay service worker: se usa la notificacion
  // nativa (plugin LocalNotifications).
  if (esAppNativa) {
    try {
      await AvisosNativos.schedule({
        notifications: [{
          id: Math.floor(Date.now() % 2147483647),
          title: alerta.titulo,
          body: alerta.detalle,
        }],
      });
    } catch (_) {}
    return;
  }
  if (!notificacionesDisponibles() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(alerta.titulo, {
      body: alerta.detalle,
      tag: "alerta-" + claveAviso(alerta),
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      vibrate: [500, 200, 500, 200, 500],
      requireInteraction: true,
    });
  } catch (_) {}
}

// Se llama justo despues del login y tambien al abrir la app con una
// sesion ya guardada.
async function iniciarSesionEnLaApp() {
  document.body.classList.remove("en-login");
  document.body.classList.toggle("vista-mayor", esAdultoMayor());

  // Cada rol arranca en su primera pestana.
  state.tab = tabsDelUsuario()[0]?.id || null;

  renderTopbar();
  screenEl.innerHTML = '<div class="loading">Cargando…</div>';

  // Una sola vez por sesion: dice si hay clave de Google Maps. Va antes
  // del primer pintado para que la pantalla no muestre primero el mapa
  // estilizado y lo cambie un segundo despues.
  if (typeof cargarConfigMapa === "function") await cargarConfigMapa();

  // El compartir de ubicacion cambia de estado por su cuenta (permiso
  // concedido, primer fix, error del GPS). Sin esto habria que esperar
  // al refresco de 10 s para enterarse.
  if (typeof Ubicacion !== "undefined") {
    Ubicacion.alCambiar = () => {
      if (state.tab === "hoy") render();
    };
    if (esAdultoMayor()) reanudarSiProcede();
  }

  // En la app Android el permiso de notificaciones se pide al entrar: es
  // lo que permite avisar de una alerta (y, al adulto mayor, mostrar la
  // notificacion fija de "compartiendo ubicacion").
  if (esAppNativa) AvisosNativos.requestPermissions().catch(() => {});

  await refreshAll();

  // Cada 10 s, el mismo ritmo al que reporta el telefono del adulto
  // mayor: con 15 s el aviso de una salida podia llegar casi medio minuto
  // tarde sobre lo que ya tarda la geocerca en confirmarla.
  clearInterval(temporizadorRefresco);
  temporizadorRefresco = setInterval(() => {
    refreshAll().catch(() => {});
  }, 10000);
}

async function cerrarSesion() {
  clearInterval(temporizadorRefresco);
  // Dejar de compartir ANTES de cerrar la sesion: el aviso al servidor
  // necesita el token, y la ubicacion es de quien inicio sesion, no del
  // telefono.
  if (typeof Ubicacion !== "undefined" && Ubicacion.activo) await detenerCompartir();
  if (typeof ZonaMovil !== "undefined") detenerZonaMovil();
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (_) {
    // Si el servidor ya no reconoce la sesion da igual: igual salimos.
  }
  olvidarSesion();
  document.body.classList.remove("vista-mayor");
  mostrarLogin();
}

// --- Arranque ------------------------------------------------------------

async function arrancar() {
  // Sin token guardado no hay nada que preguntar.
  if (!state.token) {
    mostrarLogin();
    return;
  }

  try {
    const { usuario } = await api("/auth/yo");
    state.usuario = usuario;
    await iniciarSesionEnLaApp();
  } catch (_) {
    // api() ya manda al login si el token vencio; cualquier otro fallo
    // (por ejemplo el servidor despertando) tambien termina ahi.
    if (state.token) {
      olvidarSesion();
      mostrarLogin();
    }
  }
}

// Registrar service worker para que funcione como PWA instalable.
//
// NO dentro de la app Android: Capacitor inyecta su puente con lo nativo
// en el HTML que carga, y si el service worker sirviera la pagina desde
// su cache, la app se quedaria sin ubicacion en segundo plano sin avisar.
const dentroDeLaApp = !!(
  window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
);
if ("serviceWorker" in navigator && !dentroDeLaApp) {
  // Si ya habia un service worker controlando la pantalla y entra uno
  // nuevo, es que se desplego una version nueva: recargamos una sola vez
  // para mostrarla al instante, en vez de dejar al usuario viendo los
  // archivos viejos hasta que cierre y abra la app dos veces.
  const habiaControlador = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habiaControlador || recargando) return;
    recargando = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

arrancar();
