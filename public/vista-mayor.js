// Interfaz del ADULTO MAYOR.
//
// Misma informacion que ve el contacto de emergencia, pero contada desde
// su punto de vista y con menos cosas que hacer. Diferencias a proposito:
//   - Texto y botones mas grandes (ver .vista-mayor en styles.css).
//   - Lenguaje en primera persona: "tu zona segura", no "la zona segura".
//   - Solo puede marcar recordatorios como hechos. No crea, no borra y no
//     resuelve alertas: eso es trabajo del cuidador.

// Las alertas se guardan redactadas para el cuidador ("Salio de la zona
// segura"). Aqui se traducen a como se lo diriamos a ella.
const TITULOS_PARA_MAYOR = {
  "Pulsera escaneada": "Alguien escaneó tu pulsera",
  "Salió de la zona segura": "Saliste de tu zona segura",
  "Volvió a la zona segura": "Volviste a tu zona segura",
  "Pulsera conectada": "Tu pulsera quedó conectada",
  "Se perdió su ubicación": "Tu teléfono dejó de enviar tu ubicación",
  "Volvió a enviar su ubicación": "Tu teléfono volvió a enviar tu ubicación",
};

function tituloParaMayor(alerta) {
  return TITULOS_PARA_MAYOR[alerta.titulo] || alerta.titulo;
}

function renderMayorRecordatorios() {
  if (!state.recordatorios.length) {
    return `<p class="empty-hint">No tienes recordatorios por ahora.</p>`;
  }

  const filas = state.recordatorios
    .map((r) => {
      const tipo = TIPOS_RECORDATORIO[r.tipo] || TIPOS_RECORDATORIO.otro;
      const sub = [r.detalle, fmtFecha(r.fecha), fmtHora(r.hora)].filter(Boolean).join(" · ");
      return `
      <button class="rec-mayor ${r.hecho ? "hecho" : ""}"
              data-toggle="${r.id}" aria-pressed="${r.hecho}">
        <div class="icon-badge" style="background:${tipo.color}22;color:${tipo.color}">
          ${r.hecho ? ICONS.check : ICONS[tipo.icono]}
        </div>
        <div class="rec-mayor-body">
          <p class="title">${esc(r.titulo)}</p>
          ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
        </div>
        <span class="rec-mayor-marca">${r.hecho ? "Hecho" : ""}</span>
      </button>`;
    })
    .join("");

  return `<div class="rec-mayor-lista">${filas}</div>`;
}

function renderMayorHoy() {
  const s = state.senior;
  if (!s) { screenEl.innerHTML = '<div class="loading">Cargando…</div>'; return; }

  // Igual que en la vista del cuidador, "fuera" sale de la geocerca y no
  // del estado general: atender la alerta no la devuelve a su zona.
  const fuera = !!(s.seguimiento && s.seguimiento.estaFuera);
  const enAlerta = fuera || s.status === "alerta";
  const principal = contactoPrincipal();

  screenEl.innerHTML = `
    <div class="hero">
      <p class="hero-greeting">Hola,</p>
      <h1 class="hero-title">${esc(primerNombre(s.nombre))}</h1>
    </div>

    <div class="estado-mayor ${enAlerta ? "alerta" : "bien"}">
      <div class="estado-mayor-icono">${enAlerta ? ICONS.warn : ICONS.escudo}</div>
      <div>
        <p class="estado-mayor-titulo">${
          fuera
            ? "Estás fuera de tu zona segura"
            : enAlerta
              ? "Tienes una alerta activa"
              : "Estás en tu zona segura"
        }</p>
        <p class="estado-mayor-sub">${
          enAlerta
            ? "Tu familia ya fue avisada"
            : "Tu familia puede ver que estás bien"
        }</p>
      </div>
    </div>

    <div class="ubicacion-mayor">
      <div class="ubicacion-mayor-fila">
        ${ICONS.pin}
        <div>
          <p class="etiqueta">Tu última ubicación</p>
          <p class="valor">${esc(s.ubicacion.direccion)}</p>
        </div>
      </div>
      <p class="ubicacion-mayor-hora">
        ${ICONS.clock} Actualizada a las ${esc(fmtCuando(s.ubicacion.actualizadoEn))}
        · ${timeAgo(s.ubicacion.actualizadoEn)}
      </p>
    </div>

    ${renderCompartirUbicacion()}

    ${
      principal
        ? `<a class="btn-llamar-mayor" href="${telDeContacto(principal)}">
             ${ICONS.phone}
             <span>Llamar a ${esc(primerNombre(principal.nombre))}</span>
           </a>`
        : ""
    }

    <div class="section">
      <p class="section-title">Mis recordatorios</p>
      ${
        state.recordatorios.length
          ? `<p class="ayuda-mayor">Toca un recordatorio cuando ya lo hayas hecho.</p>`
          : ""
      }
      ${renderMayorRecordatorios()}
    </div>

    ${renderMayorCitas()}
  `;

  conectarToggleRecordatoriosMayor();
  conectarCompartirUbicacion();
}

// Sus proximas citas, solo las programadas. Ella no las edita: solo
// necesita saber cuando y donde. Si no hay ninguna, la seccion no sale.
function renderMayorCitas() {
  const proximas = state.citas.filter((c) => c.estado === "programada");
  if (!proximas.length) return "";
  const filas = proximas
    .map(
      (c) => `
      <div class="cita-card">
        <div class="icon-badge" style="background:var(--noche)18;color:var(--noche)">${ICONS.cita}</div>
        <div class="cita-body">
          <p class="title">${esc(c.especialidad)}</p>
          <p class="sub cita-cuando">${esc(fmtFechaHoraCita(c.fechaHora))}</p>
          ${c.institucion ? `<p class="sub">${esc(c.institucion)}</p>` : ""}
          ${c.direccion ? `<p class="sub">${esc(c.direccion)}</p>` : ""}
        </div>
      </div>`
    )
    .join("");
  return `
    <div class="section">
      <p class="section-title">Mis citas médicas</p>
      <div class="med-lista">${filas}</div>
    </div>`;
}

// ── Compartir mi ubicación ────────────────────────────────────────
// Con esto el teléfono de la persona manda su GPS y su familia la ve en
// el mapa. Se explica en primera persona y sin tecnicismos: quien lo usa
// no tiene por qué saber qué es una geocerca.

function renderCompartirUbicacion() {
  const e = Ubicacion.estado;
  const activo = e === "buscando" || e === "compartiendo";

  const titulo = {
    inactivo: "Compartir mi ubicación",
    buscando: "Buscando tu ubicación…",
    compartiendo: "Compartiendo tu ubicación",
    error: "No se pudo compartir",
  }[e];

  const sub = {
    inactivo: "Tu familia podrá ver dónde estás.",
    buscando: "Espera unos segundos con la pantalla encendida.",
    compartiendo: "Tu familia puede verte en el mapa.",
    error: Ubicacion.detalle,
  }[e];

  const lec = Ubicacion.ultimaLectura;
  const pie =
    e === "compartiendo" && lec
      ? `<p class="compartir-pie">${
          lec.aceptada
            ? `Precisión de ${Math.round(lec.precision)} m · enviada ${timeAgo(lec.en)}`
            : esc(lec.motivo)
        }</p>`
      : "";

  return `
    <div class="compartir ${e}">
      <div class="compartir-cab">
        <div class="compartir-icono">${ICONS.senal}</div>
        <div>
          <p class="compartir-titulo">${titulo}</p>
          <p class="compartir-sub">${esc(sub || "")}</p>
        </div>
      </div>
      <button class="compartir-btn ${activo ? "activo" : ""}" id="btnCompartir">
        ${activo ? "Dejar de compartir" : "Compartir mi ubicación"}
      </button>
      ${pie}
      ${
        activo
          ? `<p class="compartir-aviso">Mantén esta pantalla abierta: al bloquear el teléfono se deja de enviar.</p>`
          : ""
      }
    </div>`;
}

function conectarCompartirUbicacion() {
  const btn = document.getElementById("btnCompartir");
  if (!btn) return;

  // Sin async ni await aquí: iOS exige que getCurrentPosition salga del
  // gesto del usuario de forma síncrona, o deniega sin preguntar.
  btn.onclick = () => {
    if (Ubicacion.activo) detenerCompartir();
    else iniciarCompartir();
  };
}

function renderMayorAlertas() {
  const items = state.alertas
    .map((a) => {
      const color = a.tipo === "wristband" ? "var(--presente)" : "var(--senal)";
      return `
      <div class="alerta-mayor">
        <div class="icon-badge" style="background:${color}22;color:${color}">
          ${ICONS[a.tipo] || ICONS.warn}
        </div>
        <div class="alerta-mayor-body">
          <p class="title">${esc(tituloParaMayor(a))}</p>
          <p class="sub">${ICONS.pin} ${esc(a.lugar)}</p>
          <p class="cuando">${esc(fmtDateTime(a.creadoEn))}</p>
        </div>
      </div>`;
    })
    .join("");

  screenEl.innerHTML = `
    <div class="hero">
      <h1 class="hero-title" style="font-size:26px">Mis alertas</h1>
      <p class="hero-greeting" style="margin-top:6px">
        Esto es lo que tu familia recibió por WhatsApp.
      </p>
    </div>

    <div class="section" style="padding-top:4px">
      ${items || '<p class="empty-hint">No tienes alertas. Todo tranquilo.</p>'}
    </div>
  `;
}

function renderMayorInfo() {
  const s = state.senior;
  if (!s) { screenEl.innerHTML = '<div class="loading">Cargando…</div>'; return; }

  const contactosHtml = state.contactos
    .map(
      (c) => `
      <a class="contacto-mayor" href="${telDeContacto(c)}">
        <div class="contact-avatar">${ICONS.persona}</div>
        <div class="contacto-mayor-body">
          <p class="title">${esc(c.nombre)}</p>
          <p class="sub">${esc(vinculoDeContacto(c))}</p>
        </div>
        <span class="contacto-mayor-llamar">${ICONS.phone}</span>
      </a>`
    )
    .join("");

  screenEl.innerHTML = `
    <div class="profile-head">
      <div class="avatar-lg">${esc(s.nombre.charAt(0))}</div>
      <div>
        <h1>${esc(s.nombre)}</h1>
        <p>${s.edad != null ? s.edad + " años · " : ""}Pulsera #${esc(s.codigoQr)}</p>
      </div>
    </div>

    <div class="qr-card">
      <div class="left">
        ${ICONS.qr}
        <div>
          <p class="title">Tu código QR</p>
          <p class="sub">Está impreso en tu pulsera de caucho</p>
        </div>
      </div>
    </div>

    <div class="section">
      <p class="section-title">Mi información médica</p>
      <div class="medinfo-list">
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--senal)">${ICONS.drop}</div><div><p class="title">Tipo de sangre</p><p class="sub">${esc(s.tipoSangre)}</p></div></div>
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--cuidado)">${ICONS.pill}</div><div><p class="title">Condiciones</p><p class="sub">${esc(s.condiciones)}</p></div></div>
        <div class="medinfo-row"><div class="icon-badge" style="color:var(--senal)">${ICONS.warn}</div><div><p class="title">Alergias</p><p class="sub">${esc(s.alergias)}</p></div></div>
      </div>
    </div>

    <div class="section">
      <p class="section-title">Mis medicamentos</p>
      ${renderMedicamentosMayor()}
    </div>

    <div class="section">
      <p class="section-title">Mis contactos</p>
      <p class="ayuda-mayor">Toca un nombre para llamar.</p>
      <div class="contacto-mayor-lista">${contactosHtml}</div>
    </div>
  `;
}

// Solo lectura: quien decide el tratamiento es el medico, y quien lo
// administra en la app es el cuidador. Aqui la persona ve QUE toma y
// CUANDO, que es lo que necesita para no equivocarse.
//
// Los suspendidos no se muestran: enseñarle a alguien una pastilla que
// ya no debe tomar es justo la clase de confusion que hay que evitar.
function renderMedicamentosMayor() {
  const activos = state.medicamentos.filter((m) => m.activo);
  if (!activos.length) {
    return `<p class="empty-hint">No tienes medicamentos registrados.</p>`;
  }

  const filas = activos
    .map((m) => {
      const detalle = [m.dosis, m.frecuencia, m.horario].filter(Boolean).join(" · ");
      return `
      <div class="med-mayor">
        <div class="icon-badge med-icono">${ICONS.frasco}</div>
        <div class="med-mayor-body">
          <p class="title">${esc(m.nombre)}</p>
          ${detalle ? `<p class="sub">${esc(detalle)}</p>` : ""}
          ${m.notas ? `<p class="sub">${esc(m.notas)}</p>` : ""}
        </div>
      </div>`;
    })
    .join("");

  return `<div class="med-mayor-lista">${filas}</div>`;
}

function conectarToggleRecordatoriosMayor() {
  screenEl.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/recordatorios/${btn.dataset.toggle}/alternar-hecho`, {
        method: "POST",
      });
      refreshAll();
    };
  });
}
