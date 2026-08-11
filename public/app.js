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
  contacto_emergencia: [
    { id: "inicio", etiqueta: "Inicio", icono: "pin" },
    { id: "alertas", etiqueta: "Alertas", icono: "campana", badge: true },
    { id: "perfil", etiqueta: "Perfil", icono: "persona" },
  ],
};

const VISTAS = {
  // Adulto mayor
  hoy: renderMayorHoy,
  misalertas: renderMayorAlertas,
  miinfo: renderMayorInfo,
  // Contacto de emergencia
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

  const [senior, alertas, contactos, recordatorios] = await Promise.all([
    api("/senior"),
    api("/alertas"),
    api("/contactos"),
    api("/recordatorios"),
  ]);
  state.senior = senior;
  state.alertas = alertas;
  state.contactos = contactos;
  state.recordatorios = recordatorios;
  render();
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

  await refreshAll();

  clearInterval(temporizadorRefresco);
  temporizadorRefresco = setInterval(() => {
    refreshAll().catch(() => {});
  }, 15000);
}

async function cerrarSesion() {
  clearInterval(temporizadorRefresco);
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

// Registrar service worker para que funcione como PWA instalable
if ("serviceWorker" in navigator) {
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
