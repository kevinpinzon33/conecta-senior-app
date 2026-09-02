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
      const sub = [r.detalle, fmtFecha(r.fecha), fmtHora(r.hora)].filter(Boolean).join(" · ");
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

      <label for="recFecha">Fecha <span>(opcional, para citas médicas)</span></label>
      <input id="recFecha" type="date" />

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
  const inputFecha = overlay.querySelector("#recFecha");
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
          fecha: inputFecha.value,
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
      <div class="map-canvas" id="mapaHueco">${
        hayMapaReal() ? "" : mapaEstilizado(s)
      }</div>
      <div class="map-info">
        <div class="map-info-row">
          <span class="pill ${s.status}">${ICONS.check} ${
            s.status === "alerta" ? "Alerta activa" : "Dentro de la zona segura"
          }</span>
          <span class="time">${
            enVivo(s)
              ? '<span class="punto-vivo"></span>EN VIVO'
              : `${ICONS.clock} dato de ejemplo`
          }</span>
        </div>
        <div class="address-block">
          ${ICONS.pin}
          <div>
            <p class="direccion">${esc(s.ubicacion.direccion)}</p>
            <p class="actualizada">
              Actualizada a las <b>${esc(fmtCuando(s.ubicacion.actualizadoEn))}</b>
              · ${timeAgo(s.ubicacion.actualizadoEn)}
            </p>
            <p class="coords">${s.ubicacion.lat.toFixed(5)}, ${s.ubicacion.lng.toFixed(5)}${
              enVivo(s) && s.ubicacion.precision
                ? ` · ±${s.ubicacion.precision} m`
                : ""
            }</p>
          </div>
        </div>
        <div class="map-meta">
          <span>Radio zona segura: ${s.zonaSegura.radioM} m</span>
          ${
            enVivo(s)
              ? `<a href="${urlMapa(s.ubicacion.lat, s.ubicacion.lng)}"
                    target="_blank" rel="noopener noreferrer"
                    class="ver-mapa">Ver en el mapa</a>`
              : ""
          }
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

  // El mapa real se coloca DESPUES de escribir el HTML, porque necesita
  // un contenedor ya presente en el documento y con tamaño. Si falla
  // (sin red, CDN caido), se dibuja el estilizado de siempre: la
  // pantalla nunca se queda con un recuadro vacio.
  const hueco = document.getElementById("mapaHueco");
  if (hayMapaReal() && hueco) {
    montarMapaReal(hueco, s).then((ok) => {
      if (!ok && hueco.childElementCount === 0) hueco.innerHTML = mapaEstilizado(s);
    });
  }

  document.getElementById("btnVisto").onclick = async () => {
    await api("/senior/marcar-visto", { method: "POST" });
    refreshAll();
  };
  document.getElementById("btnLlamar").onclick = () => {
    const principal = contactoPrincipal();
    window.location.href = telHref(principal?.telefonoPrincipal);
  };

  conectarEventosRecordatorios();
}

// El mapa estilizado de siempre: cuatro calles inventadas y el punto
// colocado por coordenadas. Ya no es lo que se ve normalmente, pero
// sigue siendo el respaldo cuando el mapa real no carga (sin red, CDN
// caido). Sin esto, un fallo de red dejaria la pantalla principal con
// un hueco gris.
function mapaEstilizado(s) {
  return `
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
    <div class="presence ${s.status}" style="${estiloPosicion(s)}">
      <div class="ring-pulse"></div>
      <div class="ring-pulse delay"></div>
      <div class="presence-avatar">${esc(s.nombre.charAt(0))}</div>
      <div class="presence-pin">${ICONS.pin}</div>
    </div>`;
}

// ¿Los datos vienen del teléfono de la persona, ahora mismo? Importa
// distinguirlo del dato de ejemplo con el que arranca la app: un
// cuidador no debe creer que está viendo a su madre en vivo cuando en
// realidad mira una coordenada inventada del seed.
function enVivo(s) {
  return s.ubicacion.fuente === "gps";
}

// Coloca a la persona DENTRO del mapa estilizado, en su posición real
// respecto al centro de la zona segura. Antes estaba clavada en un punto
// fijo, así que el mapa no reflejaba nada: ahora, si se aleja, se ve
// alejarse.
//
// El círculo de la zona mide 180px de lado y representa el radio, así
// que la escala sale de ahí. Se recorta a los bordes para que alguien
// que se fue lejos siga apareciendo, pegado al borde, en vez de
// desaparecer del recuadro.
function estiloPosicion(s) {
  const zona = s.zonaSegura;
  if (!zona || typeof s.ubicacion.lat !== "number") return "";

  const { este, norte } = desplazamientoEnMetros(zona, s.ubicacion);
  const pxPorMetro = 90 / zona.radioM; // el circulo dibujado mide 90px de radio

  // Se desplaza desde el CENTRO del circulo con calc(), en vez de contra
  // un ancho fijo: el contenedor cambia de tamaño con la pantalla y unas
  // coordenadas en px absolutos dejarian el punto descuadrado respecto a
  // la zona segura. El 48% vertical es el mismo que usa .safe-zone.
  const tope = (v, max) => Math.max(-max, Math.min(max, v));
  const x = tope(este * pxPorMetro, 140);
  const y = tope(-norte * pxPorMetro, 100);

  return `left: calc(50% + ${x.toFixed(1)}px); top: calc(48% + ${y.toFixed(1)}px);`;
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
          <div><p class="title">${esc(c.nombre)}</p><p class="sub">${esc(c.relacion)}</p></div>
        </div>
        <a href="${telHref(c.telefonoPrincipal)}" style="color:var(--noche);display:flex">${ICONS.phone}</a>
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
      <div class="section-head">
        <p class="section-title">Medicamentos</p>
        <button class="add-btn" id="btnAgregarMed">${ICONS.mas} Agregar</button>
      </div>
      ${renderListaMedicamentos()}
    </div>

    <div class="section">
      <p class="section-title">Contactos de emergencia</p>
      <div class="contact-list">${contactosHtml}</div>
    </div>
  `;

  conectarEventosMedicamentos();
}

// ── Medicamentos ──────────────────────────────────────────────────
// El tratamiento, separado de los recordatorios a proposito: un
// recordatorio se marca como hecho y desaparece del dia; un
// medicamento sigue ahi mientras el medico lo mantenga.
//
// Suspender NO borra. El historial de lo que tomo alguien es
// informacion clinica y hace falta para saber que ya se probo.

function renderListaMedicamentos() {
  if (!state.medicamentos.length) {
    return `<p class="empty-hint">Todavía no hay medicamentos registrados.</p>`;
  }

  const filas = state.medicamentos
    .map((m) => {
      const detalle = [m.dosis, m.frecuencia, m.horario].filter(Boolean).join(" · ");
      return `
      <div class="med-card ${m.activo ? "" : "suspendido"}">
        <div class="icon-badge med-icono">${ICONS.frasco}</div>
        <div class="med-body">
          <p class="title">${esc(m.nombre)}${
            m.activo ? "" : ' <span class="med-pausa">Suspendido</span>'
          }</p>
          ${detalle ? `<p class="sub">${esc(detalle)}</p>` : ""}
          ${m.viaAdministracion ? `<p class="sub">Vía: ${esc(m.viaAdministracion)}</p>` : ""}
          ${m.notas ? `<p class="sub">${esc(m.notas)}</p>` : ""}
        </div>
        <div class="med-acciones">
          <button data-med-editar="${m.id}" aria-label="Editar medicamento">${ICONS.lapiz}</button>
          <button data-med-activo="${m.id}" aria-label="${
            m.activo ? "Suspender" : "Retomar"
          } medicamento">${m.activo ? ICONS.check : ICONS.otro}</button>
          <button data-med-borrar="${m.id}" aria-label="Eliminar medicamento">${ICONS.basura}</button>
        </div>
      </div>`;
    })
    .join("");

  return `<div class="med-lista">${filas}</div>`;
}

function conectarEventosMedicamentos() {
  const btn = document.getElementById("btnAgregarMed");
  if (btn) btn.onclick = () => abrirFormMedicamento(null);

  screenEl.querySelectorAll("[data-med-editar]").forEach((b) => {
    b.onclick = () => {
      const med = state.medicamentos.find(
        (m) => m.id === Number(b.dataset.medEditar)
      );
      if (med) abrirFormMedicamento(med);
    };
  });

  screenEl.querySelectorAll("[data-med-activo]").forEach((b) => {
    b.onclick = async () => {
      const med = state.medicamentos.find(
        (m) => m.id === Number(b.dataset.medActivo)
      );
      if (!med) return;
      await api(`/medicamentos/${med.id}`, {
        method: "PUT",
        body: JSON.stringify({ activo: !med.activo }),
      });
      refreshAll();
    };
  });

  screenEl.querySelectorAll("[data-med-borrar]").forEach((b) => {
    b.onclick = async () => {
      await api(`/medicamentos/${b.dataset.medBorrar}`, { method: "DELETE" });
      refreshAll();
    };
  });
}

// Sirve para crear y para editar: si llega `med`, el formulario viene
// relleno y guarda con PUT. Dos formularios separados serian el mismo
// codigo duplicado, y con el tiempo se acabarian pareciendo cada vez menos.
function abrirFormMedicamento(med) {
  const editando = !!med;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="medTitle">
      <h2 id="medTitle">${editando ? "Editar medicamento" : "Nuevo medicamento"}</h2>

      <label for="medNombre">Medicamento</label>
      <input id="medNombre" type="text" maxlength="150" placeholder="Losartán"
             value="${esc(med ? med.nombre : "")}" />

      <label for="medDosis">Dosis <span>(opcional)</span></label>
      <input id="medDosis" type="text" maxlength="100" placeholder="50 mg"
             value="${esc(med ? med.dosis : "")}" />

      <label for="medFrecuencia">Frecuencia <span>(opcional)</span></label>
      <input id="medFrecuencia" type="text" maxlength="100" placeholder="Una vez al día"
             value="${esc(med ? med.frecuencia : "")}" />

      <label for="medHorario">Horario <span>(opcional)</span></label>
      <input id="medHorario" type="text" maxlength="100" placeholder="8:00 am"
             value="${esc(med ? med.horario : "")}" />

      <label for="medVia">Vía de administración <span>(opcional)</span></label>
      <input id="medVia" type="text" maxlength="100" placeholder="Oral"
             value="${esc(med ? med.viaAdministracion : "")}" />

      <label for="medNotas">Notas <span>(opcional)</span></label>
      <input id="medNotas" type="text" maxlength="300" placeholder="Tomar con el desayuno"
             value="${esc(med ? med.notas : "")}" />

      <p class="modal-error" id="medError" hidden></p>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="medCancelar">Cancelar</button>
        <button class="btn btn-primary" id="medGuardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errorEl = overlay.querySelector("#medError");
  const btnGuardar = overlay.querySelector("#medGuardar");
  const val = (id) => overlay.querySelector(id).value.trim();

  const cerrar = () => {
    document.removeEventListener("keydown", alPresionarTecla);
    overlay.remove();
  };
  function alPresionarTecla(e) {
    if (e.key === "Escape") cerrar();
  }
  document.addEventListener("keydown", alPresionarTecla);
  overlay.onclick = (e) => {
    if (e.target === overlay) cerrar();
  };

  const guardar = async () => {
    const nombre = val("#medNombre");
    if (!nombre) {
      errorEl.textContent = "Escribe el nombre del medicamento.";
      errorEl.hidden = false;
      overlay.querySelector("#medNombre").focus();
      return;
    }

    btnGuardar.disabled = true;
    const cuerpo = {
      nombre,
      dosis: val("#medDosis"),
      frecuencia: val("#medFrecuencia"),
      horario: val("#medHorario"),
      viaAdministracion: val("#medVia"),
      notas: val("#medNotas"),
    };

    try {
      await api(editando ? `/medicamentos/${med.id}` : "/medicamentos", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify(cuerpo),
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
  overlay.querySelector("#medCancelar").onclick = cerrar;
  overlay.querySelector("#medNombre").onkeydown = (e) => {
    if (e.key === "Enter") guardar();
  };
  overlay.querySelector("#medNombre").focus();
}
