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

      <label for="recFecha">Fecha <span>(opcional)</span></label>
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

// ── Citas médicas ─────────────────────────────────────────────────
// Desde el 2026-10-12 tienen su propia lista, como la tabla citas_medicas
// del backend real. Antes eran un recordatorio de tipo "cita" con texto
// libre, y no habia donde poner especialidad, profesional ni institucion.

function renderListaCitas() {
  if (!state.citas.length) {
    return `<p class="empty-hint">No hay citas médicas registradas.</p>`;
  }

  const filas = state.citas
    .map((c) => {
      const estado = ESTADOS_CITA[c.estado] || ESTADOS_CITA.programada;
      const lugar = [c.institucion, c.direccion].filter(Boolean).join(" · ");
      return `
      <div class="cita-card ${c.estado}">
        <div class="icon-badge" style="background:${estado.color}18;color:${estado.color}">${ICONS.cita}</div>
        <div class="cita-body">
          <p class="title">${esc(c.especialidad)}${
            c.estado !== "programada"
              ? ` <span class="cita-estado">${estado.etiqueta}</span>`
              : ""
          }</p>
          <p class="sub cita-cuando">${esc(fmtFechaHoraCita(c.fechaHora))}</p>
          ${c.profesional ? `<p class="sub">${esc(c.profesional)}</p>` : ""}
          ${lugar ? `<p class="sub">${esc(lugar)}</p>` : ""}
          ${c.notas ? `<p class="sub">${esc(c.notas)}</p>` : ""}
        </div>
        <div class="med-acciones">
          <button data-cita-editar="${c.id}" aria-label="Editar cita">${ICONS.lapiz}</button>
          <button data-cita-borrar="${c.id}" aria-label="Eliminar cita">${ICONS.basura}</button>
        </div>
      </div>`;
    })
    .join("");

  return `<div class="med-lista">${filas}</div>`;
}

function conectarEventosCitas() {
  const btn = document.getElementById("btnAgregarCita");
  if (btn) btn.onclick = () => abrirFormCita(null);

  screenEl.querySelectorAll("[data-cita-editar]").forEach((b) => {
    b.onclick = () => {
      const cita = state.citas.find((c) => c.id === Number(b.dataset.citaEditar));
      if (cita) abrirFormCita(cita);
    };
  });
  screenEl.querySelectorAll("[data-cita-borrar]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("¿Eliminar esta cita?")) return;
      await api(`/citas/${b.dataset.citaBorrar}`, { method: "DELETE" });
      refreshAll();
    };
  });
}

// Crea y edita. Al editar se puede marcar como cumplida o cancelada; no
// se borra, para que quede el historial de consultas.
function abrirFormCita(cita) {
  const editando = !!cita;
  const [fecha, hora] = editando ? cita.fechaHora.split("T") : ["", ""];
  let estadoElegido = editando ? cita.estado : "programada";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="citaTitle">
      <h2 id="citaTitle">${editando ? "Editar cita" : "Nueva cita médica"}</h2>

      <label for="citaEsp">Especialidad</label>
      <input id="citaEsp" type="text" maxlength="120" placeholder="Cardiología"
             value="${esc(editando ? cita.especialidad : "")}" />

      <div class="fila-2">
        <div>
          <label for="citaFecha">Fecha</label>
          <input id="citaFecha" type="date" value="${esc(fecha)}" />
        </div>
        <div>
          <label for="citaHora">Hora</label>
          <input id="citaHora" type="time" value="${esc(hora)}" />
        </div>
      </div>

      <label for="citaProf">Profesional <span>(opcional)</span></label>
      <input id="citaProf" type="text" maxlength="120" placeholder="Dra. Paula Ríos"
             value="${esc(editando ? cita.profesional : "")}" />

      <label for="citaInst">Institución <span>(opcional)</span></label>
      <input id="citaInst" type="text" maxlength="150" placeholder="Clínica del Country"
             value="${esc(editando ? cita.institucion : "")}" />

      <label for="citaDir">Dirección <span>(opcional)</span></label>
      <input id="citaDir" type="text" maxlength="200" placeholder="Carrera 16 #82-57, consultorio 304"
             value="${esc(editando ? cita.direccion : "")}" />

      <label for="citaNotas">Notas <span>(opcional)</span></label>
      <input id="citaNotas" type="text" maxlength="400" placeholder="Llevar los exámenes"
             value="${esc(editando ? cita.notas : "")}" />

      ${
        editando
          ? `<label>Estado</label>
      <div class="tipo-picker" id="citaEstados">
        ${Object.entries(ESTADOS_CITA)
          .map(
            ([clave, e]) => `<button type="button" data-estado="${clave}" class="${
              clave === estadoElegido ? "activo" : ""
            }"><span>${e.etiqueta}</span></button>`
          )
          .join("")}
      </div>`
          : ""
      }

      <p class="modal-error" id="citaError" hidden></p>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="citaCancelar">Cancelar</button>
        <button class="btn btn-primary" id="citaGuardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errorEl = overlay.querySelector("#citaError");
  const btnGuardar = overlay.querySelector("#citaGuardar");
  const val = (id) => overlay.querySelector(id).value.trim();
  const mostrarError = (texto) => {
    errorEl.textContent = texto;
    errorEl.hidden = !texto;
  };

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

  overlay.querySelectorAll("#citaEstados button").forEach((b) => {
    b.onclick = () => {
      estadoElegido = b.dataset.estado;
      overlay
        .querySelectorAll("#citaEstados button")
        .forEach((x) => x.classList.toggle("activo", x === b));
    };
  });

  btnGuardar.onclick = async () => {
    const especialidad = val("#citaEsp");
    const f = val("#citaFecha");
    const h = val("#citaHora");
    if (!especialidad) return mostrarError("Escribe la especialidad.");
    if (!f || !h) return mostrarError("La fecha y la hora son obligatorias.");

    const cuerpo = {
      especialidad,
      fechaHora: `${f}T${h}`,
      profesional: val("#citaProf"),
      institucion: val("#citaInst"),
      direccion: val("#citaDir"),
      notas: val("#citaNotas"),
    };
    if (editando) cuerpo.estado = estadoElegido;

    btnGuardar.disabled = true;
    try {
      await api(editando ? `/citas/${cita.id}` : "/citas", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify(cuerpo),
      });
      cerrar();
      refreshAll();
    } catch (err) {
      mostrarError(err.message);
      btnGuardar.disabled = false;
    }
  };
  overlay.querySelector("#citaCancelar").onclick = cerrar;
  overlay.querySelector("#citaEsp").focus();
}

function renderInicio() {
  const s = state.senior;
  if (!s) { screenEl.innerHTML = '<div class="loading">Cargando…</div>'; return; }

  screenEl.innerHTML = `
    ${selectorAdultos()}
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
          ${pildoraZona(s)}
          ${etiquetaSenal(s)}
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
        ${lineaDistancia(s)}
        ${avisoSenal(s)}
        ${infoZona(s)}
        <div class="map-meta">
          <button class="ajustar-zona" id="btnZona">
            Zona segura: ${fmtRadio(s.zonaSegura.radioM)} · <b>Ajustar</b>
          </button>
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

    <div class="section">
      <div class="section-head">
        <p class="section-title">Citas médicas</p>
        <button class="add-btn" id="btnAgregarCita">${ICONS.mas} Agregar</button>
      </div>
      ${renderListaCitas()}
    </div>
  `;

  // El mapa real se coloca DESPUES de escribir el HTML, porque necesita
  // un contenedor ya presente en el documento y con tamaño. Si falla
  // (sin red, CDN caido), se dibuja el estilizado de siempre: la
  // pantalla nunca se queda con un recuadro vacio.
  const hueco = document.getElementById("mapaHueco");
  if (hayMapaReal() && hueco) {
    // Con varios adultos a cargo, los demas tambien salen en el mapa.
    const otros = state.adultos.filter((a) => a.id !== s.id);
    montarMapaReal(hueco, s, otros).then((ok) => {
      if (!ok && hueco.childElementCount === 0) hueco.innerHTML = mapaEstilizado(s);
    });
  }

  document.getElementById("btnZona").onclick = abrirFormZona;
  // Sin permiso de ubicacion, la zona que sigue al familiar necesita un
  // toque para arrancar (iOS no deja pedirlo sin gesto).
  // Mi ubicacion, si todavia no se dio permiso: con un toque (iOS solo
  // muestra el permiso dentro del gesto).
  const btnYo = document.getElementById("btnMiUbicacion");
  if (btnYo) {
    btnYo.onclick = () => {
      iniciarMiUbicacion();
      btnYo.textContent = "Buscando tu ubicación…";
      btnYo.disabled = true;
    };
  }

  const btnSeguir = document.getElementById("btnActivarZonaMovil");
  if (btnSeguir) {
    btnSeguir.onclick = () => {
      iniciarZonaMovil();
      setTimeout(render, 1500);
    };
  }
  document.getElementById("btnVisto").onclick = async () => {
    await api("/senior/marcar-visto", { method: "POST" });
    refreshAll();
  };
  document.getElementById("btnLlamar").onclick = () => {
    const principal = contactoPrincipal();
    window.location.href = telDeContacto(principal);
  };

  conectarEventosRecordatorios();
  conectarEventosCitas();
  conectarSelectorAdultos();
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

// Lo que dice la etiqueta sale de la geocerca, no del estado general.
// Antes solo miraba status, y al marcar la alerta como atendida volvia a
// decir "Dentro de la zona segura" aunque la persona siguiera fuera.
function pildoraZona(s) {
  if (s.seguimiento && s.seguimiento.estaFuera) {
    return `<span class="pill alerta">${ICONS.warn} Fuera de la zona segura</span>`;
  }
  if (s.status === "alerta") {
    return `<span class="pill alerta">${ICONS.warn} Alerta activa</span>`;
  }
  return `<span class="pill presente">${ICONS.check} Dentro de la zona segura</span>`;
}

// ── Distancia a mi ─────────────────────────────────────────────────
// Con mi ubicacion (mi-ubicacion.js) cada persona dice a cuanto esta de
// mi. Los textos llevan data-dist-lat/lng para que se actualicen solos
// cuando me muevo, sin repintar la pantalla.

// corto = solo "250 m" (para el selector, donde "A 250 m de ti" no cabe).
function spanDistancia(a, clase, prefijo = "", corto = false) {
  if (!a || !a.ubicacion || typeof a.ubicacion.lat !== "number") return "";
  const t = corto
    ? fmtDistancia(distanciaDesdeMi(a.ubicacion.lat, a.ubicacion.lng))
    : textoDistancia(a.ubicacion.lat, a.ubicacion.lng);
  return `<span class="${clase}" data-dist-lat="${a.ubicacion.lat}" data-dist-lng="${a.ubicacion.lng}"${corto ? " data-dist-corto" : ""}
            ${t ? "" : "hidden"}>${esc(prefijo ? prefijo + t.charAt(0).toLowerCase() + t.slice(1) : t)}</span>`;
}

// El adulto de una alerta, con su ubicacion de AHORA (no la de la alerta).
function adultoDeAlerta(alerta) {
  return (
    state.adultos.find((x) => x.id === alerta.adultoMayorId) ||
    (state.senior && state.senior.id === alerta.adultoMayorId ? state.senior : null)
  );
}

function lineaDistancia(s) {
  const yo = miPosicion();
  if (yo) return `<p class="distancia-yo">${ICONS.persona}${spanDistancia(s, "")}</p>`;
  if (MiUbicacion.error === "permiso") {
    return `<p class="distancia-yo apagada">${ICONS.persona}<span>Para verte en el mapa y saber a qué distancia está, permite la ubicación a esta app en los ajustes del teléfono.</span></p>`;
  }
  if (MiUbicacion.necesitaToque) {
    return `<button class="btn btn-secondary btn-mi-ubicacion" id="btnMiUbicacion">${ICONS.pin} Verme en el mapa</button>`;
  }
  return "";
}

// ── Señal del teléfono del adulto mayor ───────────────────────────
// En la primera prueba de campo el telefono de Claudia dejo de enviar y
// esta tarjeta siguio diciendo "EN VIVO". Ahora dice la verdad: en vivo,
// sin señal (con cuanto hace), dejó de compartir, o dato de ejemplo.

function etiquetaSenal(s) {
  const senal = s.senal || { estado: "ejemplo" };
  if (senal.estado === "en_vivo") {
    return `<span class="time"><span class="punto-vivo"></span>EN VIVO</span>`;
  }
  if (senal.estado === "perdida") {
    return `<span class="time sin-senal">${ICONS.warn} SIN SEÑAL</span>`;
  }
  if (senal.estado === "apagada") {
    return `<span class="time">${ICONS.clock} no comparte</span>`;
  }
  return `<span class="time">${ICONS.clock} dato de ejemplo</span>`;
}

function avisoSenal(s) {
  const senal = s.senal || {};
  const nombre = esc(primerNombre(s.nombre));
  if (senal.estado === "perdida") {
    return `<p class="aviso-tarjeta alerta">${ICONS.warn}<span>El teléfono de ${nombre} no envía su ubicación desde las ${esc(
      fmtCuando(senal.ultimoReporte)
    )} (${esc(timeAgo(senal.ultimoReporte))}). Lo de abajo es su última posición conocida.</span></p>`;
  }
  if (senal.estado === "apagada") {
    return `<p class="aviso-tarjeta">${ICONS.clock}<span>${nombre} dejó de compartir su ubicación ${esc(
      timeAgo(senal.ultimoReporte)
    )}.</span></p>`;
  }
  return "";
}

// Que dice la zona: centrada en una direccion, o siguiendo al familiar.
function infoZona(s) {
  const z = s.zonaSegura;
  if (z.modo !== "cuidador") {
    return z.direccion
      ? `<p class="info-zona">${ICONS.pin}<span>Zona centrada en <b>${esc(z.direccion)}</b></span></p>`
      : "";
  }
  if (z.cuidadorId !== state.usuario.id) {
    return `<p class="info-zona">${ICONS.persona}<span>La zona sigue a otro familiar.</span></p>`;
  }
  if (ZonaMovil.activo && ZonaMovil.ultimaPos) {
    return `<p class="info-zona">${ICONS.persona}<span>La zona te sigue: avisa si ${esc(
      primerNombre(s.nombre)
    )} se aleja más de ${fmtRadio(z.radioM)} de ti. Mantén la app abierta. <span class="mono">±${Math.round(
      ZonaMovil.ultimaPos.coords.accuracy
    )} m</span></span></p>`;
  }
  return `<div class="info-zona alerta">${ICONS.warn}<span>${
    ZonaMovil.error ||
    `La zona debe seguirte, pero este teléfono no está enviando tu ubicación. Quedó donde estabas ${esc(
      timeAgo(z.centroEn)
    )}.`
  }</span>
    <button class="btn btn-primary" id="btnActivarZonaMovil">Activar mi ubicación</button></div>`;
}

// ── Zona segura ───────────────────────────────────────────────────
// El familiar la define desde su telefono. Los metros se eligen igual
// que antes; el centro tiene dos opciones (pedido del usuario tras la
// prueba de campo del 2026-10-12):
//   · Establecer dirección: se busca la direccion y se CONFIRMA en un
//     mapa, arrastrando el punto si hace falta. Los geocodificadores
//     gratuitos ubican mal muchas direcciones de Bogota ("Calle 181
//     13-54" devolvio la Calle 44), asi que el mapa manda, no la busqueda.
//   · Donde estoy yo: la zona sigue al familiar mientras tenga la app
//     abierta (ver zona-movil.js).
// Se quito "Donde está Claudia": como ella camina, la zona quedaba donde
// estaba en ese instante, que no significaba nada.

// El radio se escribe con su unidad (pedido del usuario el 2026-10-14).
// Los tamaños de siempre quedan como atajos de un toque. Limites: 50 m
// (por debajo, el ruido del GPS daria alertas falsas) y 20 km; los mismos
// que valida el servidor.
const RADIOS_ZONA = [100, 200, 300, 500, 1000];
const RADIO_MIN_M = 50;
const RADIO_MAX_M = 20000;

// El numero que va en el campo, en la unidad elegida y con coma decimal.
function numeroRadio(m, unidad) {
  const n = unidad === "km" ? m / 1000 : m;
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

function fmtRadio(m) {
  if (m >= 1000) return (m / 1000).toLocaleString("es-CO", { maximumFractionDigits: 2 }) + " km";
  return m + " m";
}

function abrirFormZona() {
  const s = state.senior;
  const z = s.zonaSegura;
  const nombre = primerNombre(s.nombre);

  let radioElegido = z.radioM;
  // La unidad con la que se muestra al abrir: km si es un numero redondo
  // de kilometros o mas de 1 km.
  let unidad = z.radioM >= 1000 ? "km" : "m";
  let modo = z.modo === "cuidador" ? "cuidador" : "fija";
  // El punto elegido para la zona fija. Arranca en el centro actual.
  let punto = { lat: z.lat, lng: z.lng };
  let direccionTexto = z.direccion || "";
  let posYo = null;
  let miniMapa = null;
  let pin = null;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="zonaTitle">
      <h2 id="zonaTitle">Zona segura</h2>

      <label for="zonaRadio">Radio</label>
      <div class="radio-libre">
        <!-- type="text" y no "number": un campo numerico descarta "1,5"
             (la coma decimal de Colombia) y lo deja vacio sin avisar. -->
        <input id="zonaRadio" type="text" inputmode="decimal" autocomplete="off"
               value="${numeroRadio(radioElegido, unidad)}" />
        <div class="unidad" id="zonaUnidad" role="group" aria-label="Unidad">
          <button type="button" data-unidad="m" class="${unidad === "m" ? "activo" : ""}">m</button>
          <button type="button" data-unidad="km" class="${unidad === "km" ? "activo" : ""}">km</button>
        </div>
      </div>
      <div class="atajos-radio" id="zonaRadios">
        ${RADIOS_ZONA.map((r) => `<button type="button" data-radio="${r}">${fmtRadio(r)}</button>`).join("")}
      </div>

      <label>Centro</label>
      <div class="tipo-picker" id="zonaModos">
        <button type="button" data-modo="fija">${ICONS.pin}<span>Establecer dirección</span></button>
        <button type="button" data-modo="cuidador">${ICONS.persona}<span>Donde estoy yo</span></button>
      </div>

      <div id="panelFija">
        <div class="buscar-dir">
          <input id="zonaDir" type="text" maxlength="150"
                 placeholder="Calle 181 #13-54, Bogotá" value="${esc(direccionTexto)}" />
          <button type="button" class="btn btn-secondary" id="zonaBuscar">Buscar</button>
        </div>
        <div class="dir-resultados" id="zonaResultados"></div>
        <div class="mini-mapa" id="zonaMapa"></div>
        <p class="zona-nota">Revisa el punto en el mapa. Si no es exacto, <b>arrástralo</b> o <b>toca el lugar correcto</b>.</p>
      </div>

      <div id="panelCuidador" hidden>
        <p class="zona-nota" id="zonaNotaYo">La zona te seguirá mientras tengas la app abierta: si ${esc(
          nombre
        )} se aleja más del radio elegido de ti, te llega la alerta. Útil al salir juntos.</p>
      </div>

      <p class="modal-error" id="zonaError" hidden></p>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="zonaCancelar">Cancelar</button>
        <button class="btn btn-primary" id="zonaGuardar">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const errorEl = $("#zonaError");
  const btnGuardar = $("#zonaGuardar");
  const resultadosEl = $("#zonaResultados");

  const mostrarError = (texto) => {
    errorEl.textContent = texto;
    errorEl.hidden = !texto;
  };

  const cerrar = () => {
    document.removeEventListener("keydown", alPresionarTecla);
    if (miniMapa) miniMapa.remove();
    miniMapa = null;
    overlay.remove();
  };
  function alPresionarTecla(e) {
    if (e.key === "Escape") cerrar();
  }
  document.addEventListener("keydown", alPresionarTecla);
  overlay.onclick = (e) => {
    if (e.target === overlay) cerrar();
  };

  // ── Radio: numero + unidad ──
  const inputRadio = $("#zonaRadio");

  // Lee lo escrito y lo pasa a metros. null si no es un numero valido.
  function leerRadio() {
    const n = parseFloat(String(inputRadio.value).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(unidad === "km" ? n * 1000 : n);
  }

  function alCambiarRadio() {
    const m = leerRadio();
    overlay
      .querySelectorAll("#zonaRadios button")
      .forEach((b) => b.classList.toggle("activo", Number(b.dataset.radio) === m));
    if (m && m >= RADIO_MIN_M && m <= RADIO_MAX_M) {
      radioElegido = m;
      if (miniMapa) {
        miniMapa.circulo.setRadius(m);
        // Que se vea la zona entera: con 1,5 km el circulo se sale del
        // recuadro y no se sabe que abarca.
        miniMapa.fitBounds(miniMapa.circulo.getBounds(), { padding: [12, 12], maxZoom: 17, animate: false });
      }
    }
  }
  inputRadio.oninput = alCambiarRadio;

  overlay.querySelectorAll("#zonaUnidad button").forEach((btn) => {
    btn.onclick = () => {
      // Cambiar la unidad conserva la distancia: 500 m pasa a 0,5 km.
      const m = leerRadio();
      unidad = btn.dataset.unidad;
      overlay
        .querySelectorAll("#zonaUnidad button")
        .forEach((b) => b.classList.toggle("activo", b === btn));
      if (m) inputRadio.value = numeroRadio(m, unidad);
      alCambiarRadio();
    };
  });

  overlay.querySelectorAll("#zonaRadios button").forEach((btn) => {
    btn.onclick = () => {
      const m = Number(btn.dataset.radio);
      unidad = m >= 1000 ? "km" : "m";
      overlay
        .querySelectorAll("#zonaUnidad button")
        .forEach((b) => b.classList.toggle("activo", b.dataset.unidad === unidad));
      inputRadio.value = numeroRadio(m, unidad);
      alCambiarRadio();
    };
  });
  alCambiarRadio();

  // ── Mini mapa con el punto arrastrable (zona fija) ──
  function moverPunto(lat, lng, centrar) {
    punto = { lat, lng };
    if (!miniMapa) return;
    pin.setLatLng([lat, lng]);
    miniMapa.circulo.setLatLng([lat, lng]);
    if (centrar) miniMapa.setView([lat, lng], 17, { animate: false });
  }

  async function prepararMiniMapa() {
    if (miniMapa || proveedorMapa() !== "osm") {
      if (!miniMapa) $("#zonaMapa").hidden = true;
      return;
    }
    try {
      await cargarLibreria();
    } catch (_) {
      $("#zonaMapa").hidden = true;
      return;
    }
    miniMapa = L.map($("#zonaMapa"), { zoomControl: true, attributionControl: true })
      .setView([punto.lat, punto.lng], 16);
    L.tileLayer(TILES, { attribution: ATRIBUCION, maxZoom: 19 }).addTo(miniMapa);
    miniMapa.circulo = L.circle([punto.lat, punto.lng], {
      radius: radioElegido,
      color: COLOR.presente,
      weight: 1.5,
      dashArray: "6 6",
      fill: false,
      interactive: false,
    }).addTo(miniMapa);
    pin = L.marker([punto.lat, punto.lng], { draggable: true }).addTo(miniMapa);
    pin.on("dragend", () => {
      const p = pin.getLatLng();
      moverPunto(p.lat, p.lng, false);
    });
    miniMapa.on("click", (e) => moverPunto(e.latlng.lat, e.latlng.lng, false));
    // Si el formulario se cerro antes de los 50 ms, el mapa ya no existe.
    setTimeout(() => {
      if (miniMapa) miniMapa.invalidateSize();
    }, 50);
  }

  async function buscar() {
    const q = $("#zonaDir").value.trim();
    mostrarError("");
    if (q.length < 3) return mostrarError("Escribe la dirección.");
    resultadosEl.innerHTML = `<p class="zona-nota">Buscando…</p>`;
    try {
      const lista = await api(`/geocodificar?q=${encodeURIComponent(q)}`);
      if (!lista.length) {
        resultadosEl.innerHTML = `<p class="zona-nota">No la encontramos. Toca el lugar en el mapa.</p>`;
        return;
      }
      resultadosEl.innerHTML = lista
        .map(
          (r, i) => `<button type="button" class="dir-opcion" data-i="${i}">${ICONS.pin}<span>${esc(
            r.etiqueta
          )}</span></button>`
        )
        .join("");
      resultadosEl.querySelectorAll(".dir-opcion").forEach((b) => {
        b.onclick = () => {
          const r = lista[Number(b.dataset.i)];
          resultadosEl
            .querySelectorAll(".dir-opcion")
            .forEach((x) => x.classList.toggle("activo", x === b));
          moverPunto(r.lat, r.lng, true);
        };
      });
      // El primero se marca de entrada, pero hay que mirarlo en el mapa.
      resultadosEl.querySelector(".dir-opcion").click();
    } catch (err) {
      resultadosEl.innerHTML = "";
      mostrarError(err.message);
    }
  }
  $("#zonaBuscar").onclick = buscar;
  $("#zonaDir").onkeydown = (e) => {
    if (e.key === "Enter") buscar();
  };

  // ── Elegir el modo ──
  function elegirModo(nuevo) {
    modo = nuevo;
    overlay
      .querySelectorAll("#zonaModos button")
      .forEach((b) => b.classList.toggle("activo", b.dataset.modo === modo));
    $("#panelFija").hidden = modo !== "fija";
    $("#panelCuidador").hidden = modo !== "cuidador";
    mostrarError("");
    if (modo === "fija") prepararMiniMapa();
  }

  overlay.querySelectorAll("#zonaModos button").forEach((btn) => {
    // NO es async a proposito: Safari solo muestra el dialogo de permiso
    // si getCurrentPosition se llama dentro del propio toque.
    btn.onclick = () => {
      elegirModo(btn.dataset.modo);
      if (modo !== "cuidador" || posYo) return;
      if (!navigator.geolocation) {
        mostrarError("Este navegador no permite leer tu ubicación.");
        return;
      }
      const nota = $("#zonaNotaYo");
      const textoBase = nota.textContent;
      // Si ya se conoce mi posicion (mi-ubicacion.js la sigue mientras
      // miro el mapa), se usa esa. Pedir otra lectura mientras hay un
      // watchPosition activo puede no responder nunca: Chrome junta las
      // peticiones en vuelo y la nueva se pierde.
      const conocida = typeof miPosicion === "function" ? miPosicion() : null;
      if (conocida) {
        posYo = { lat: conocida.lat, lng: conocida.lng, precision: conocida.precision };
        nota.textContent = `${textoBase} Tu ubicación ahora: ±${posYo.precision} m.`;
        return;
      }
      nota.textContent = "Buscando tu ubicación…";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          posYo = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            precision: Math.round(pos.coords.accuracy),
          };
          nota.textContent = `${textoBase} Tu ubicación ahora: ±${posYo.precision} m.`;
        },
        (err) => {
          nota.textContent = textoBase;
          mostrarError(
            err.code === err.PERMISSION_DENIED
              ? "No diste permiso de ubicación a esta página. Actívalo en los ajustes del navegador."
              : "No se pudo leer tu ubicación. Revisa que el GPS del teléfono esté encendido."
          );
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
      );
    };
  });

  elegirModo(modo);

  btnGuardar.onclick = async () => {
    const m = leerRadio();
    if (!m || m < RADIO_MIN_M || m > RADIO_MAX_M) {
      return mostrarError("El radio debe estar entre 50 m y 20 km.");
    }
    radioElegido = m;
    let cuerpo;
    if (modo === "cuidador") {
      if (!posYo) {
        // Ya estaba siguiendo a este telefono: basta con cambiar el radio.
        if (z.modo === "cuidador" && z.cuidadorId === state.usuario.id) {
          cuerpo = { radioM: radioElegido };
        } else {
          return mostrarError("Espera a que el teléfono encuentre tu ubicación.");
        }
      } else {
        cuerpo = { modo: "cuidador", lat: posYo.lat, lng: posYo.lng, radioM: radioElegido };
      }
    } else {
      const texto = $("#zonaDir").value.trim();
      const elegido = resultadosEl.querySelector(".dir-opcion.activo span");
      cuerpo = {
        modo: "fija",
        lat: punto.lat,
        lng: punto.lng,
        radioM: radioElegido,
        // Se guarda lo que escribio el familiar (lo reconoce), o si no,
        // la etiqueta del resultado.
        direccion: texto || (elegido ? elegido.textContent : ""),
      };
    }

    btnGuardar.disabled = true;
    try {
      await api("/senior/zona-segura", { method: "POST", body: JSON.stringify(cuerpo) });
      // Con el modo nuevo ya guardado, arrancar el envio desde este mismo
      // toque (sin esperar al refresco, que ya no seria un gesto).
      if (cuerpo.modo === "cuidador") iniciarZonaMovil();
      if (cuerpo.modo === "fija" && ZonaMovil.activo) detenerZonaMovil();
      cerrar();
      refreshAll();
    } catch (err) {
      mostrarError(err.message);
      btnGuardar.disabled = false;
    }
  };
  $("#zonaCancelar").onclick = cerrar;
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

// Con permiso, una alerta nueva sale tambien como notificacion del
// sistema (ver app.js). En iPhone el navegador no las ofrece hasta que la
// app se agrega a la pantalla de inicio, y conviene decirlo: si no, el
// cuidador busca un boton que no existe.
function barraNotificaciones() {
  // En la app Android el permiso se pide al entrar (ver app.js).
  if (esAppNativa) return "";
  if (!notificacionesDisponibles()) {
    return `
    <div class="simulate-bar">
      <p>Para recibir notificaciones en iPhone, agrega la app a la pantalla de inicio (Compartir → Agregar a inicio) y ábrela desde ahí.</p>
    </div>`;
  }
  if (Notification.permission === "default") {
    return `
    <div class="simulate-bar">
      <p>Activa las notificaciones para enterarte de una alerta aunque estés en otra pantalla.</p>
      <button id="btnNotif" class="btn-notif">Activar</button>
    </div>`;
  }
  if (Notification.permission === "denied") {
    return `
    <div class="simulate-bar">
      <p>Las notificaciones están bloqueadas para esta página. Actívalas en los ajustes del navegador.</p>
    </div>`;
  }
  return "";
}

// ── Varios adultos a cargo ────────────────────────────────────────
// Un familiar puede tener a mas de una persona a cargo (adultoResponsable).
// Todos salen en el mapa y sus alertas llegan juntas; el selector decide
// de quien son los recordatorios, citas, perfil y zona que se ven.

const variosAdultos = () => state.adultos.length > 1;

function selectorAdultos() {
  if (!variosAdultos()) return "";
  return `
    <div class="selector-adultos" role="tablist" aria-label="Personas a tu cargo">
      ${state.adultos
        .map((a) => {
          const fuera = a.seguimiento && a.seguimiento.estaFuera;
          const estado = a.status === "alerta" || fuera ? "alerta" : "presente";
          return `<button role="tab" data-adulto="${a.id}" aria-selected="${a.id === state.adultoId}"
                  class="${a.id === state.adultoId ? "activo" : ""}">
            <span class="punto-estado ${estado}"></span>
            ${esc(primerNombre(a.nombre))}
            ${a.alertasPendientes ? `<span class="cuenta-alertas">${a.alertasPendientes}</span>` : ""}
            ${spanDistancia(a, "dist-chip", "", true)}
          </button>`;
        })
        .join("")}
    </div>`;
}

function elegirAdulto(id) {
  if (id === state.adultoId) return;
  state.adultoId = id;
  try { localStorage.setItem(CLAVE_ADULTO, String(id)); } catch (_) {}
  // Que el mapa vaya a la persona recien elegida.
  if (typeof Mapa !== "undefined") Mapa.ultimoCentrado = null;
  refreshAll();
}

function conectarSelectorAdultos() {
  screenEl.querySelectorAll(".selector-adultos [data-adulto]").forEach((b) => {
    b.onclick = () => elegirAdulto(Number(b.dataset.adulto));
  });
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
          ${variosAdultos() ? `<p class="alert-quien">${esc(a.adultoNombre)}</p>` : ""}
          <p class="alert-detail">${esc(a.detalle)}</p>
          <div class="alert-place">${ICONS.pin} ${esc(a.lugar)}</div>
          ${a.estado === "pendiente" ? spanDistancia(adultoDeAlerta(a), "alert-dist", "Ahora ") : ""}
          <span class="alert-status ${a.estado}">${esc(a.estado)}</span>
          ${a.estado === "pendiente" ? `<div class="alert-actions"><button data-id="${a.id}" data-adulto="${a.adultoMayorId}">Marcar como atendida</button></div>` : ""}
        </div>
      </div>`;
    })
    .join("");

  screenEl.innerHTML = `
    <div class="hero">
      <h1 class="hero-title" style="font-size:24px">Alertas</h1>
      <p class="hero-greeting" style="margin-top:4px">Cada alerta se envía también por WhatsApp</p>
    </div>

    ${barraNotificaciones()}

    <div class="simulate-bar">
      <p>Para probar el flujo sin la pulsera física: simula que alguien escaneó el código QR${
        variosAdultos() ? ` de ${esc(primerNombre(state.senior.nombre))}` : ""
      }.</p>
      <button id="btnSimular">Simular escaneo</button>
    </div>

    <div class="section" style="padding-top:0">
      ${items || '<p class="loading">Sin alertas todavía</p>'}
    </div>
  `;

  const btnNotif = document.getElementById("btnNotif");
  if (btnNotif) {
    btnNotif.onclick = async () => {
      await pedirPermisoNotificaciones();
      render();
    };
  }

  document.getElementById("btnSimular").onclick = async () => {
    await api("/alertas/simular-scan", { method: "POST" });
    refreshAll();
  };

  screenEl.querySelectorAll(".alert-actions button").forEach((btn) => {
    btn.onclick = async () => {
      // La alerta puede ser de otro adulto distinto al seleccionado.
      await api(`/alertas/${btn.dataset.id}/marcar-atendida`, {
        method: "POST",
        headers: { "X-Adulto-Id": btn.dataset.adulto },
      });
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
          <div><p class="title">${esc(c.nombre)}</p><p class="sub">${esc(vinculoDeContacto(c))}</p></div>
        </div>
        <a href="${telDeContacto(c)}" style="color:var(--noche);display:flex">${ICONS.phone}</a>
      </div>`
    )
    .join("");

  screenEl.innerHTML = `
    ${selectorAdultos()}
    <div class="profile-head">
      <div class="avatar-lg">${esc(s.nombre.charAt(0))}</div>
      <div>
        <h1>${esc(s.nombre)}</h1>
        <p>${s.edad != null ? s.edad + " años · " : ""}Pulsera de caucho #${esc(s.codigoQr)}</p>
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
  conectarSelectorAdultos();
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

      <label>Horas de toma <span>(opcional)</span></label>
      <div class="horas-toma" id="medHoras"></div>
      <button type="button" class="add-btn horas-agregar" id="medHoraMas">${ICONS.mas} Otra hora</button>

      <div class="fila-2">
        <div>
          <label for="medInicio">Inicio <span>(opcional)</span></label>
          <input id="medInicio" type="date" value="${esc(med && med.fechaInicio ? med.fechaInicio : "")}" />
        </div>
        <div>
          <label for="medFin">Fin <span>(opcional)</span></label>
          <input id="medFin" type="date" value="${esc(med && med.fechaFin ? med.fechaFin : "")}" />
        </div>
      </div>

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

  // Una fila por hora de toma, como medicamento_horas en el backend real.
  // Con horas concretas se pueden programar avisos; con "despues del
  // almuerzo" no.
  const horasEl = overlay.querySelector("#medHoras");
  const agregarHora = (valor) => {
    const fila = document.createElement("div");
    fila.className = "hora-fila";
    fila.innerHTML = `<input type="time" value="${esc(valor || "")}" />
      <button type="button" aria-label="Quitar hora">${ICONS.basura}</button>`;
    fila.querySelector("button").onclick = () => fila.remove();
    horasEl.appendChild(fila);
  };
  const horasIniciales = med && med.horas && med.horas.length ? med.horas : [""];
  horasIniciales.forEach(agregarHora);
  overlay.querySelector("#medHoraMas").onclick = () => agregarHora("");

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
      horas: [...horasEl.querySelectorAll("input")].map((i) => i.value).filter(Boolean),
      fechaInicio: val("#medInicio"),
      fechaFin: val("#medFin"),
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
