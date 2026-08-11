// Interfaz del CONTACTO DE EMERGENCIA.
//
// Orientada al seguimiento: donde esta el adulto mayor, que alertas hay
// pendientes y que recordatorios tiene programados. Es quien administra:
// crea y borra recordatorios, resuelve alertas y marca que ya reviso.

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
      <p class="hero-greeting">Hola, ${esc(primerNombre(state.usuario.nombre))}</p>
      <h1 class="hero-title">${esc(primerNombre(s.nombre))} está ${s.status === "alerta" ? "en alerta" : "bien"}</h1>
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
          <div class="presence-avatar">${esc(s.nombre.charAt(0))}</div>
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
            <p>${esc(s.ubicacion.direccion)}</p>
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
    const principal = contactoPrincipal();
    window.location.href = telHref(principal?.telefono);
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
            <p class="title">${esc(a.titulo)}</p>
            <span class="time">${fmtDateTime(a.creadoEn)}</span>
          </div>
          <p class="alert-detail">${esc(a.detalle)}</p>
          <div class="alert-place">${ICONS.pin} ${esc(a.lugar)}</div>
          <span class="alert-status ${a.estado}">${esc(a.estado)}</span>
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
          <div class="contact-avatar">${ICONS.persona}</div>
          <div><p class="title">${esc(c.nombre)}</p><p class="sub">${esc(c.rol)}</p></div>
        </div>
        <a href="${telHref(c.telefono)}" style="color:var(--noche);display:flex">${ICONS.phone}</a>
      </div>`
    )
    .join("");

  screenEl.innerHTML = `
    <div class="profile-head">
      <div class="avatar-lg">${esc(s.nombre.charAt(0))}</div>
      <div>
        <h1>${esc(s.nombre)}</h1>
        <p>${s.edad} años · Pulsera de caucho #${esc(s.pulseraId)}</p>
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
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--senal)">${ICONS.drop}</div><div><p class="title">Tipo de sangre</p><p class="sub">${esc(s.tipoSangre)}</p></div></div>
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--cuidado)">${ICONS.pill}</div><div><p class="title">Condiciones</p><p class="sub">${esc(s.condiciones)}</p></div></div>
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--senal)">${ICONS.warn}</div><div><p class="title">Alergias</p><p class="sub">${esc(s.alergias)}</p></div></div>
      </div>
    </div>

    <div class="section">
      <p class="section-title">Contactos de emergencia</p>
      <div class="contact-list">${contactosHtml}</div>
    </div>
  `;
}
