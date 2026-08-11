const screenEl = document.getElementById("screen");
const tabbar = document.getElementById("tabbar");
const alertBadge = document.getElementById("alertBadge");
const topbar = document.getElementById("topbar");

topbar.innerHTML = `
  <div class="topbar-brand">
    <img src="icons/logo-mark.png" alt="" width="26" height="26" />
    <div class="word"><b>Conecta</b><small>Senior</small></div>
  </div>
`;

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
};

// Cada tipo de recordatorio tiene su icono y su color.
const TIPOS_RECORDATORIO = {
  medicamento: { icono: "pill", color: "var(--cuidado)", etiqueta: "Medicamento" },
  cita: { icono: "cita", color: "var(--noche)", etiqueta: "Cita" },
  otro: { icono: "otro", color: "var(--presente)", etiqueta: "Otro" },
};

let state = {
  senior: null,
  alertas: [],
  contactos: [],
  recordatorios: [],
  tab: "inicio",
};

async function api(path, opts) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
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

// Los recordatorios los escribe el usuario, asi que su texto nunca se
// inserta crudo en el HTML.
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
  return d.toLocaleString("es-MX", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

async function refreshAll() {
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

function render() {
  const pendientes = state.alertas.filter((a) => a.estado === "pendiente").length;
  alertBadge.hidden = pendientes === 0;

  if (state.tab === "inicio") renderInicio();
  else if (state.tab === "alertas") renderAlertas();
  else renderPerfil();
}

function renderListaRecordatorios() {
  if (!state.recordatorios.length) {
    return `<p class="empty-hint">Todavía no hay recordatorios. Toca “Agregar” para crear el primero.</p>`;
  }

  const filas = state.recordatorios
    .map((r) => {
      const tipo = TIPOS_RECORDATORIO[r.tipo] || TIPOS_RECORDATORIO.otro;
      const sub = [r.detalle, fmtHora(r.hora)].filter(Boolean).join(" · ");
      return `
      <div class="reminder-card ${r.hecho ? "hecho" : ""}">
        <button class="rec-main" data-toggle="${r.id}" aria-pressed="${r.hecho}">
          <div class="icon-badge" style="background:${tipo.color}18;color:${tipo.color}">
            ${r.hecho ? ICONS.check : ICONS[tipo.icono]}
          </div>
          <div class="rec-body">
            <p class="title">${esc(r.titulo)}</p>
            ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
          </div>
        </button>
        <button class="rec-del" data-del="${r.id}" aria-label="Eliminar recordatorio">
          ${ICONS.basura}
        </button>
      </div>`;
    })
    .join("");

  return `<div class="reminder-list">${filas}</div>`;
}

function conectarEventosRecordatorios() {
  const btnAgregar = document.getElementById("btnAgregarRec");
  if (btnAgregar) btnAgregar.onclick = abrirFormRecordatorio;

  screenEl.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/recordatorios/${btn.dataset.toggle}/alternar-hecho`, {
        method: "POST",
      });
      refreshAll();
    };
  });

  screenEl.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/recordatorios/${btn.dataset.del}`, { method: "DELETE" });
      refreshAll();
    };
  });
}

// El formulario se monta fuera de #screen: asi el refresco automatico
// cada 15s puede redibujar la pantalla sin borrar lo que el usuario
// esta escribiendo.
function abrirFormRecordatorio() {
  let tipoElegido = "medicamento";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="recTitle">
      <h2 id="recTitle">Nuevo recordatorio</h2>

      <label for="recTitulo">¿Qué hay que recordar?</label>
      <input id="recTitulo" type="text" maxlength="80" placeholder="Medicamento de la tarde" />

      <label for="recDetalle">Detalle <span>(opcional)</span></label>
      <input id="recDetalle" type="text" maxlength="120" placeholder="Losartán 50mg" />

      <label for="recHora">Hora <span>(opcional)</span></label>
      <input id="recHora" type="time" />

      <label>Tipo</label>
      <div class="tipo-picker" id="recTipos">
        ${Object.entries(TIPOS_RECORDATORIO)
          .map(
            ([clave, t]) => `
          <button type="button" data-tipo="${clave}" class="${
              clave === tipoElegido ? "activo" : ""
            }">${ICONS[t.icono]}<span>${t.etiqueta}</span></button>`
          )
          .join("")}
      </div>

      <p class="modal-error" id="recError" hidden></p>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="recCancelar">Cancelar</button>
        <button class="btn btn-primary" id="recGuardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const inputTitulo = overlay.querySelector("#recTitulo");
  const inputDetalle = overlay.querySelector("#recDetalle");
  const inputHora = overlay.querySelector("#recHora");
  const errorEl = overlay.querySelector("#recError");
  const btnGuardar = overlay.querySelector("#recGuardar");

  const cerrar = () => {
    document.removeEventListener("keydown", alPresionarTecla);
    overlay.remove();
  };

  function alPresionarTecla(e) {
    if (e.key === "Escape") cerrar();
  }
  document.addEventListener("keydown", alPresionarTecla);

  // Tocar el fondo oscuro cierra; tocar dentro de la tarjeta no.
  overlay.onclick = (e) => {
    if (e.target === overlay) cerrar();
  };

  overlay.querySelectorAll("#recTipos button").forEach((btn) => {
    btn.onclick = () => {
      tipoElegido = btn.dataset.tipo;
      overlay
        .querySelectorAll("#recTipos button")
        .forEach((b) => b.classList.toggle("activo", b === btn));
    };
  });

  const guardar = async () => {
    const titulo = inputTitulo.value.trim();
    if (!titulo) {
      errorEl.textContent = "Escribe qué hay que recordar.";
      errorEl.hidden = false;
      inputTitulo.focus();
      return;
    }

    btnGuardar.disabled = true;
    try {
      await api("/recordatorios", {
        method: "POST",
        body: JSON.stringify({
          titulo,
          detalle: inputDetalle.value.trim(),
          hora: inputHora.value,
          tipo: tipoElegido,
        }),
      });
      cerrar();
      refreshAll();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btnGuardar.disabled = false;
    }
  };

  btnGuardar.onclick = guardar;
  overlay.querySelector("#recCancelar").onclick = cerrar;
  inputTitulo.onkeydown = (e) => {
    if (e.key === "Enter") guardar();
  };

  inputTitulo.focus();
}

function renderInicio() {
  const s = state.senior;
  if (!s) { screenEl.innerHTML = '<div class="loading">Cargando…</div>'; return; }

  screenEl.innerHTML = `
    <div class="hero">
      <p class="hero-greeting">Hola, Daniela</p>
      <h1 class="hero-title">${s.nombre.split(" ")[0]} está ${s.status === "alerta" ? "en alerta" : "bien"}</h1>
    </div>

    <div class="map-card">
      <div class="map-canvas">
        <svg class="streets" viewBox="0 0 400 260" preserveAspectRatio="none">
          <line x1="0" y1="55" x2="400" y2="40" stroke="#2E3440" stroke-width="10"/>
          <line x1="0" y1="160" x2="400" y2="175" stroke="#2E3440" stroke-width="14"/>
          <line x1="90" y1="0" x2="60" y2="260" stroke="#2E3440" stroke-width="9"/>
          <line x1="290" y1="0" x2="320" y2="260" stroke="#2E3440" stroke-width="9"/>
          <circle cx="120" cy="80" r="24" fill="#242A34"/>
          <circle cx="300" cy="200" r="30" fill="#242A34"/>
        </svg>
        <div class="safe-zone"></div>
        <div class="you-dot"><div class="dot"></div><span>Tú</span></div>
        <div class="presence ${s.status}">
          <div class="ring-pulse"></div>
          <div class="ring-pulse delay"></div>
          <div class="presence-avatar">${s.nombre.charAt(0)}</div>
          <div class="presence-pin">${ICONS.pin}</div>
        </div>
      </div>
      <div class="map-info">
        <div class="map-info-row">
          <span class="pill ${s.status}">${ICONS.check} ${
            s.status === "alerta" ? "Alerta activa" : "Dentro de la zona segura"
          }</span>
          <span class="time">${ICONS.clock} ${timeAgo(s.ubicacion.actualizadoEn)}</span>
        </div>
        <div class="address-block">
          ${ICONS.pin}
          <div>
            <p>${s.ubicacion.direccion}</p>
            <p class="coords">${s.ubicacion.lat.toFixed(4)}° N, ${Math.abs(s.ubicacion.lng).toFixed(4)}° O</p>
          </div>
        </div>
        <div class="map-meta">
          <span>Radio zona segura: ${s.zonaSegura.radioM} m</span>
        </div>
      </div>
    </div>

    <div class="quick-actions">
      <button class="btn btn-primary" id="btnLlamar">${ICONS.phone} Llamar</button>
      <button class="btn btn-secondary" id="btnVisto">${ICONS.check} Marcar visto</button>
    </div>

    <div class="section">
      <div class="section-head">
        <p class="section-title">Recordatorios</p>
        <button class="add-btn" id="btnAgregarRec">${ICONS.mas} Agregar</button>
      </div>
      ${renderListaRecordatorios()}
    </div>
  `;

  document.getElementById("btnVisto").onclick = async () => {
    await api("/senior/marcar-visto", { method: "POST" });
    refreshAll();
  };
  document.getElementById("btnLlamar").onclick = () => {
    const principal = state.contactos.find((c) => c.rol.includes("principal")) || state.contactos[0];
    window.location.href = `tel:${(principal?.telefono || "").replace(/\s/g, "")}`;
  };

  conectarEventosRecordatorios();
}

function renderAlertas() {
  const items = state.alertas
    .map((a) => {
      const color = a.tipo === "wristband" ? "var(--presente)" : "var(--senal)";
      return `
      <div class="alert-card">
        <div class="icon-badge" style="background:${color}18;color:${color}">${ICONS[a.tipo] || ICONS.warn}</div>
        <div class="alert-body">
          <div class="alert-top">
            <p class="title">${a.titulo}</p>
            <span class="time">${fmtDateTime(a.creadoEn)}</span>
          </div>
          <p class="alert-detail">${a.detalle}</p>
          <div class="alert-place">${ICONS.pin} ${a.lugar}</div>
          <span class="alert-status ${a.estado}">${a.estado}</span>
          ${a.estado === "pendiente" ? `<div class="alert-actions"><button data-id="${a.id}">Marcar como atendida</button></div>` : ""}
        </div>
      </div>`;
    })
    .join("");

  screenEl.innerHTML = `
    <div class="hero">
      <h1 class="hero-title" style="font-size:24px">Alertas</h1>
      <p class="hero-greeting" style="margin-top:4px">Cada alerta se envía también por WhatsApp</p>
    </div>

    <div class="simulate-bar">
      <p>Para probar el flujo sin la pulsera física: simula que alguien escaneó el código QR.</p>
      <button id="btnSimular">Simular escaneo</button>
    </div>

    <div class="section" style="padding-top:0">
      ${items || '<p class="loading">Sin alertas todavía</p>'}
    </div>
  `;

  document.getElementById("btnSimular").onclick = async () => {
    await api("/alertas/simular-scan", { method: "POST" });
    refreshAll();
  };

  screenEl.querySelectorAll(".alert-actions button").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/alertas/${btn.dataset.id}/marcar-atendida`, { method: "POST" });
      refreshAll();
    };
  });
}

function renderPerfil() {
  const s = state.senior;
  if (!s) { screenEl.innerHTML = '<div class="loading">Cargando…</div>'; return; }

  const contactosHtml = state.contactos
    .map(
      (c) => `
      <div class="contact-row">
        <div class="left">
          <div class="contact-avatar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--noche)" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg></div>
          <div><p class="title">${c.nombre}</p><p class="sub">${c.rol}</p></div>
        </div>
        <a href="tel:${c.telefono.replace(/\s/g, "")}" style="color:var(--noche);display:flex">${ICONS.phone}</a>
      </div>`
    )
    .join("");

  screenEl.innerHTML = `
    <div class="profile-head">
      <div class="avatar-lg">${s.nombre.charAt(0)}</div>
      <div>
        <h1>${s.nombre}</h1>
        <p>${s.edad} años · Pulsera de caucho #${s.pulseraId}</p>
      </div>
    </div>

    <div class="qr-card">
      <div class="left">
        ${ICONS.qr}
        <div>
          <p class="title">Código QR de emergencia</p>
          <p class="sub">Impreso en su pulsera</p>
        </div>
      </div>
    </div>

    <div class="section">
      <p class="section-title">Información médica</p>
      <div class="medinfo-list">
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--senal)">${ICONS.drop}</div><div><p class="title">Tipo de sangre</p><p class="sub">${s.tipoSangre}</p></div></div>
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--cuidado)">${ICONS.pill}</div><div><p class="title">Condiciones</p><p class="sub">${s.condiciones}</p></div></div>
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--senal)">${ICONS.warn}</div><div><p class="title">Alergias</p><p class="sub">${s.alergias}</p></div></div>
      </div>
    </div>

    <div class="section">
      <p class="section-title">Contactos de emergencia</p>
      <div class="contact-list">${contactosHtml}</div>
    </div>
  `;
}

tabbar.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    tabbar.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.tab = btn.dataset.tab;
    render();
  });
});

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

refreshAll();
setInterval(refreshAll, 15000);
