// Piezas compartidas por las dos interfaces (adulto mayor y contacto de
// emergencia): iconos, helpers de formato, estado en memoria y el cliente
// de la API con el manejo de sesion.

const screenEl = document.getElementById("screen");
const tabbarEl = document.getElementById("tabbar");
const topbarEl = document.getElementById("topbar");

const ICONS = {
  qr: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM21 14v3M14 21h3M18 18h3v3h-3z"/></svg>`,
  zona: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  wristband: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 12 2 2 4-4"/><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/></svg>`,
  phone: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>`,
  pill: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>`,
  drop: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69s-7 7.44-7 11.31a7 7 0 0 0 14 0c0-3.87-7-11.31-7-11.31Z"/></svg>`,
  warn: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  clock: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  pin: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  cita: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  otro: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  mas: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  basura: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  salir: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  escudo: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  persona: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`,
};

// Iconos de la barra inferior, mas grandes que los del contenido.
const TAB_ICONS = {
  pin: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  campana: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  persona: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`,
  casa: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
};

// Cada tipo de recordatorio tiene su icono y su color.
const TIPOS_RECORDATORIO = {
  medicamento: { icono: "pill", color: "var(--cuidado)", etiqueta: "Medicamento" },
  cita: { icono: "cita", color: "var(--noche)", etiqueta: "Cita" },
  otro: { icono: "otro", color: "var(--presente)", etiqueta: "Otro" },
};

const CLAVE_TOKEN = "conecta_senior_token";

let state = {
  usuario: null, // { id, nombre, rol, seniorId, contactoId }
  token: localStorage.getItem(CLAVE_TOKEN) || null,
  senior: null,
  alertas: [],
  contactos: [],
  recordatorios: [],
  tab: null,
};

// --- Cliente de la API ---------------------------------------------------

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch("/api" + path, { ...opts, headers });

  // Sesion vencida o token invalido: de vuelta al login, sin dejar la
  // pantalla a medias.
  if (res.status === 401) {
    olvidarSesion();
    mostrarLogin("Tu sesión expiró. Vuelve a entrar.");
    throw new Error("Sesión expirada");
  }

  if (!res.ok) {
    // El servidor manda { error: "..." } cuando rechaza algo (por ejemplo
    // un recordatorio sin titulo); lo usamos como mensaje si viene.
    let msg = "Error de red: " + path;
    try {
      const cuerpo = await res.json();
      if (cuerpo && cuerpo.error) msg = cuerpo.error;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

function guardarSesion(token, usuario) {
  state.token = token;
  state.usuario = usuario;
  localStorage.setItem(CLAVE_TOKEN, token);
}

function olvidarSesion() {
  state.token = null;
  state.usuario = null;
  state.senior = null;
  state.alertas = [];
  state.contactos = [];
  state.recordatorios = [];
  state.tab = null;
  localStorage.removeItem(CLAVE_TOKEN);
}

const esContacto = () => state.usuario?.rol === "contacto_emergencia";
const esAdultoMayor = () => state.usuario?.rol === "adulto_mayor";

// --- Helpers de formato --------------------------------------------------

// Todo texto que venga de la base de datos o del usuario pasa por aqui
// antes de insertarse en el HTML.
function esc(texto) {
  return String(texto ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// "18:00" -> "6:00 pm"
function fmtHora(hora) {
  if (!hora) return "";
  const [h, m] = hora.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  const sufijo = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "justo ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("es-CO", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function primerNombre(nombre) {
  return String(nombre || "").trim().split(" ")[0];
}

function contactoPrincipal() {
  return (
    state.contactos.find((c) => c.rol.toLowerCase().includes("principal")) ||
    state.contactos[0] ||
    null
  );
}

function telHref(telefono) {
  return `tel:${String(telefono || "").replace(/\s/g, "")}`;
}
