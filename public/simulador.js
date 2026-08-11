// Simulador de zona segura.
//
// Mueve un punto sobre un mapa y manda esas coordenadas a POST
// /api/ubicacion, exactamente como lo haria el telefono del adulto mayor.
// El servidor es el que decide si hubo salida; aqui solo se dibuja y se
// muestra el veredicto, para poder afinar las falsas alarmas sin salir a
// caminar con el celular.

const mapaEl = document.getElementById("mapa");
const zonaEl = document.getElementById("zona");
const puntoEl = document.getElementById("punto");
const escalaEl = document.getElementById("escala");
const logEl = document.getElementById("log");

const mDistancia = document.getElementById("mDistancia");
const mEstado = document.getElementById("mEstado");
const mLecturas = document.getElementById("mLecturas");
const mUmbrales = document.getElementById("mUmbrales");

const inPrecision = document.getElementById("inPrecision");
const valPrecision = document.getElementById("valPrecision");
const inRadio = document.getElementById("inRadio");
const valRadio = document.getElementById("valRadio");
const chkAuto = document.getElementById("chkAuto");

const METROS_POR_GRADO_LAT = 111320;

let zona = { lat: 0, lng: 0, radioM: 300 };
let config = { margenM: 25, lecturasParaSalir: 3, lecturasParaVolver: 2 };
// Posicion del punto como desplazamiento en metros desde el centro.
let pos = { este: 0, norte: 0 };
let estaFuera = false;
let escala = 1; // pixeles por metro
let ocupado = false;
let temporizadorAuto = null;

// --- Conversiones --------------------------------------------------------

function aCoordenadas({ este, norte }) {
  const lat = zona.lat + norte / METROS_POR_GRADO_LAT;
  const metrosPorGradoLng =
    METROS_POR_GRADO_LAT * Math.cos((zona.lat * Math.PI) / 180);
  const lng = zona.lng + este / metrosPorGradoLng;
  return { lat, lng };
}

function distanciaActual() {
  return Math.sqrt(pos.este ** 2 + pos.norte ** 2);
}

// --- Dibujo --------------------------------------------------------------

function recalcularEscala() {
  const ancho = mapaEl.clientWidth;
  const alto = mapaEl.clientHeight;
  // Que el circulo ocupe alrededor de un tercio del lado mas corto.
  const vistaMetros = zona.radioM * 3;
  escala = Math.min(ancho, alto) / vistaMetros;
}

function dibujar() {
  const ancho = mapaEl.clientWidth;
  const alto = mapaEl.clientHeight;

  const diametro = 2 * zona.radioM * escala;
  zonaEl.style.width = `${diametro}px`;
  zonaEl.style.height = `${diametro}px`;

  puntoEl.style.left = `${ancho / 2 + pos.este * escala}px`;
  puntoEl.style.top = `${alto / 2 - pos.norte * escala}px`;

  escalaEl.textContent = `radio ${zona.radioM} m`;
  mapaEl.classList.toggle("fuera", estaFuera);

  const d = Math.round(distanciaActual());
  mDistancia.textContent = `${d} m`;

  mEstado.textContent = estaFuera ? "FUERA" : "DENTRO";
  mEstado.className = estaFuera ? "fuera" : "dentro";

  mUmbrales.textContent =
    `Alerta al pasar ${zona.radioM + config.margenM} m ` +
    `(${config.lecturasParaSalir} lecturas seguidas) · ` +
    `regreso al bajar de ${zona.radioM - config.margenM} m ` +
    `(${config.lecturasParaVolver} lecturas)`;
}

// --- Registro ------------------------------------------------------------

function log(texto, clase = "") {
  const vacio = logEl.querySelector(".sim-log-vacio");
  if (vacio) vacio.remove();

  const hora = new Date().toLocaleTimeString("es-CO", { hour12: false });
  const linea = document.createElement("div");
  linea.className = `sim-linea ${clase}`;
  linea.innerHTML = `<span class="hora">${hora}</span><span class="texto"></span>`;
  linea.querySelector(".texto").textContent = texto;
  logEl.prepend(linea);
}

// --- Comunicacion con el servidor ---------------------------------------

async function cargarZona() {
  const res = await fetch("/api/zona-segura");
  const datos = await res.json();
  zona = { lat: datos.lat, lng: datos.lng, radioM: datos.radioM };
  config = datos.config;
  estaFuera = datos.seguimiento.estaFuera;

  inRadio.value = zona.radioM;
  valRadio.textContent = zona.radioM;
  mLecturas.textContent = "0";

  recalcularEscala();
  dibujar();
}

async function enviarUbicacion({ precision, silencioso = false } = {}) {
  const { lat, lng } = aCoordenadas(pos);
  const prec = precision ?? Number(inPrecision.value);

  const res = await fetch("/api/ubicacion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, precision: prec }),
  });
  const r = await res.json();

  if (!res.ok) {
    log(r.error || "Error del servidor", "alerta");
    return r;
  }

  if (!r.aceptada) {
    log(`Lectura descartada — ${r.motivo}`, "descartada");
    return r;
  }

  estaFuera = r.fueraDeZona;
  mLecturas.textContent = r.lecturasFuera
    ? `${r.lecturasFuera} fuera`
    : r.lecturasDentro
    ? `${r.lecturasDentro} dentro`
    : "0";

  if (r.evento === "salida") {
    log(`${r.distanciaM} m — ALERTA: salió de la zona segura`, "alerta");
  } else if (r.evento === "regreso") {
    log(`${r.distanciaM} m — volvió a la zona segura`, "ok");
  } else if (!silencioso) {
    const pendiente = r.lecturasFuera
      ? ` (fuera del umbral ${r.lecturasFuera}/${config.lecturasParaSalir})`
      : "";
    log(
      `${r.distanciaM} m — ${r.fueraDeZona ? "fuera" : "dentro"}${pendiente}`,
      ""
    );
  } else {
    const pendiente = r.lecturasFuera
      ? ` (${r.lecturasFuera}/${config.lecturasParaSalir} fuera del umbral)`
      : "";
    log(`${r.distanciaM} m — precisión ±${Math.round(prec)} m${pendiente}`, "");
  }

  dibujar();
  return r;
}

// --- Arrastre del punto --------------------------------------------------

function moverA(clientX, clientY) {
  const rect = mapaEl.getBoundingClientRect();
  pos.este = (clientX - rect.left - rect.width / 2) / escala;
  pos.norte = (rect.height / 2 - (clientY - rect.top)) / escala;
  dibujar();
}

puntoEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  puntoEl.setPointerCapture(e.pointerId);

  const alMover = (ev) => moverA(ev.clientX, ev.clientY);
  const alSoltar = (ev) => {
    puntoEl.removeEventListener("pointermove", alMover);
    puntoEl.removeEventListener("pointerup", alSoltar);
    puntoEl.removeEventListener("pointercancel", alSoltar);
  };

  puntoEl.addEventListener("pointermove", alMover);
  puntoEl.addEventListener("pointerup", alSoltar);
  puntoEl.addEventListener("pointercancel", alSoltar);
});

// Tocar el mapa tambien reubica el punto.
mapaEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".sim-punto")) return;
  moverA(e.clientX, e.clientY);
});

// --- Escenarios ----------------------------------------------------------

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Ruido gaussiano: se parece mucho mas al GPS real que un valor al azar.
function ruidoGauss(sigma) {
  const u = 1 - Math.random();
  const v = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const ESCENARIOS = {
  // Persona quieta cerca del limite. Es EL caso que arruina el producto si
  // se alerta a la ligera: el GPS baila y parece que entra y sale.
  async ruido() {
    log("— Escenario: persona quieta junto al límite —");
    pos = { este: zona.radioM - 5, norte: 0 };
    dibujar();

    let cruzaronElRadio = 0;
    for (let i = 0; i < 10; i++) {
      // Sentada justo dentro del limite, con el ruido tipico de ciudad.
      pos = {
        este: zona.radioM - 5 + ruidoGauss(18),
        norte: ruidoGauss(18),
      };
      dibujar();
      if (distanciaActual() > zona.radioM) cruzaronElRadio++;
      await enviarUbicacion({ precision: 20 + Math.random() * 15, silencioso: true });
      await esperar(450);
    }

    log(
      `Resumen: ${cruzaronElRadio} de 10 lecturas pasaron el radio. ` +
        `Con la regla ingenua serían ${cruzaronElRadio} alertas falsas; ` +
        `con margen e histéresis: ${estaFuera ? "1 alerta" : "ninguna"}.`,
      estaFuera ? "alerta" : "ok"
    );
  },

  // Se aleja de verdad: aqui SI tiene que alertar.
  async salir() {
    log("— Escenario: sale caminando —");
    const pasos = 8;
    const destino = zona.radioM + 180;
    for (let i = 1; i <= pasos; i++) {
      pos = {
        este: (destino * i) / pasos + ruidoGauss(8),
        norte: ruidoGauss(8),
      };
      dibujar();
      await enviarUbicacion({ precision: 15, silencioso: true });
      await esperar(450);
    }
  },

  async volver() {
    log("— Escenario: vuelve a casa —");
    const desde = { ...pos };
    const pasos = 6;
    for (let i = 1; i <= pasos; i++) {
      const f = 1 - i / pasos;
      pos = { este: desde.este * f + ruidoGauss(6), norte: desde.norte * f + ruidoGauss(6) };
      dibujar();
      await enviarUbicacion({ precision: 15, silencioso: true });
      await esperar(450);
    }
  },

  // Las dos clases de dato malo que el servidor tiene que rechazar.
  async basura() {
    log("— Escenario: lecturas basura —");

    log("Enviando una lectura con precisión de 140 m…");
    await enviarUbicacion({ precision: 140, silencioso: true });
    await esperar(1400);

    log("Enviando un salto de ~55 km respecto a la lectura anterior…");
    const guardado = { ...pos };
    pos = { este: pos.este + 55000, norte: pos.norte };
    await enviarUbicacion({ precision: 10, silencioso: true });
    pos = guardado;
    dibujar();
  },
};

// --- Controles -----------------------------------------------------------

function bloquear(si) {
  ocupado = si;
  document
    .querySelectorAll("[data-escenario], #btnEnviar, #btnReiniciar")
    .forEach((b) => (b.disabled = si));
}

document.querySelectorAll("[data-escenario]").forEach((btn) => {
  btn.onclick = async () => {
    if (ocupado) return;
    bloquear(true);
    try {
      await ESCENARIOS[btn.dataset.escenario]();
    } catch (e) {
      log("Error: " + e.message, "alerta");
    }
    bloquear(false);
  };
});

document.getElementById("btnEnviar").onclick = async () => {
  if (ocupado) return;
  bloquear(true);
  try {
    await enviarUbicacion();
  } catch (e) {
    log("Error: " + e.message, "alerta");
  }
  bloquear(false);
};

document.getElementById("btnReiniciar").onclick = async () => {
  if (ocupado) return;
  bloquear(true);
  await fetch("/api/simulador/reiniciar", { method: "POST" });
  pos = { este: 0, norte: 0 };
  estaFuera = false;
  logEl.innerHTML = '<p class="sim-log-vacio">Simulación reiniciada.</p>';
  mLecturas.textContent = "0";
  dibujar();
  bloquear(false);
};

inPrecision.oninput = () => {
  valPrecision.textContent = inPrecision.value;
};

inRadio.onchange = async () => {
  const radioM = Number(inRadio.value);
  const res = await fetch("/api/zona-segura", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ radioM }),
  });
  const datos = await res.json();
  if (!res.ok) {
    log(datos.error, "alerta");
    return;
  }
  zona.radioM = datos.radioM;
  recalcularEscala();
  dibujar();
  log(`Radio de la zona segura cambiado a ${datos.radioM} m`);
};
inRadio.oninput = () => {
  valRadio.textContent = inRadio.value;
};

chkAuto.onchange = () => {
  clearInterval(temporizadorAuto);
  if (chkAuto.checked) {
    temporizadorAuto = setInterval(() => {
      if (!ocupado) enviarUbicacion();
    }, 3000);
  }
};

window.addEventListener("resize", () => {
  recalcularEscala();
  dibujar();
});

cargarZona();
