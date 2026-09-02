const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "db.json");
const SEED_PATH = path.join(__dirname, "db.seed.json");

// --- "Base de datos" ---------------------------------------------------
// Un archivo JSON en disco. Es intencionalmente simple: alcanza para
// probar el flujo completo (leer perfil, listar alertas, crear una
// alerta nueva, marcar como revisado). Cuando tengan su base de datos
// real, este archivo se reemplaza por las llamadas a whatsapp.service.js
// y alerta.controller.js sin tocar el frontend.

// En la maquina de desarrollo el proyecto vive dentro de una carpeta de
// OneDrive, que bloquea el archivo mientras lo sincroniza. Si una lectura
// o una escritura cae justo en ese instante, Windows devuelve EBUSY (o
// EPERM) y la peticion moriria con un 500 aunque no haya nada roto. El
// bloqueo dura milisegundos, asi que basta con reintentar un poco.
//
// El servidor es de un solo hilo: aqui hay que esperar sin ceder el
// control, o el reintento ocurriria antes de que OneDrive suelte nada.
const DORMIDERA = new Int32Array(new SharedArrayBuffer(4));
const REINTENTOS_DISCO = 12;
const MS_ENTRE_REINTENTOS = 25;

function conReintentos(accion) {
  for (let intento = 0; ; intento++) {
    try {
      return accion();
    } catch (err) {
      const bloqueado = err.code === "EBUSY" || err.code === "EPERM";
      if (!bloqueado || intento >= REINTENTOS_DISCO) throw err;
      Atomics.wait(DORMIDERA, 0, 0, MS_ENTRE_REINTENTOS);
    }
  }
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    conReintentos(() => fs.copyFileSync(SEED_PATH, DB_PATH));
  }
  return normalizarDb(
    JSON.parse(conReintentos(() => fs.readFileSync(DB_PATH, "utf-8")))
  );
}

// Un db.json creado por una version anterior puede no tener los campos
// nuevos. En vez de reventar, los rellenamos con valores por defecto.
function normalizarDb(db) {
  if (!db.recordatorios) db.recordatorios = [];
  if (!db.nextRecordatorioId) db.nextRecordatorioId = 1;
  if (!db.usuarios) db.usuarios = [];
  if (!db.medicamentos) db.medicamentos = [];
  if (!db.nextMedicamentoId) db.nextMedicamentoId = 1;
  if (!db.sesiones) db.sesiones = [];
  if (!db.senior.zonaSegura) {
    db.senior.zonaSegura = {
      lat: db.senior.ubicacion.lat,
      lng: db.senior.ubicacion.lng,
      radioM: db.senior.zonaSeguraRadioM || 300,
    };
  }
  if (!db.senior.seguimiento) {
    db.senior.seguimiento = {
      estaFuera: false,
      lecturasFuera: 0,
      lecturasDentro: 0,
      ultimaLectura: null,
    };
  }
  return db;
}

function saveDb(db) {
  const texto = JSON.stringify(db, null, 2);
  conReintentos(() => fs.writeFileSync(DB_PATH, texto));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Autenticacion y roles ----------------------------------------------
//
// Hay dos roles y cada uno ve una interfaz distinta:
//   - adulto_mayor        : ve SUS recordatorios, SUS alertas y su estado.
//   - contacto_emergencia : hace seguimiento del adulto mayor a su cargo.
//
// El vinculo entre ambos es el campo `seniorId` del usuario. Hoy el
// prototipo tiene un solo adulto mayor, pero la forma de los datos ya es
// la correcta para cuando lleguen varios desde la base de datos real.
//
// ┌───────────────────────────────────────────────────────────────────┐
// │ PENDIENTE ANTES DE CONECTAR DATOS REALES                          │
// │                                                                   │
// │ Esto es suficiente para un prototipo con usuarios inventados,     │
// │ pero NO para datos de personas reales. Antes de ese paso hay que: │
// │   1. Guardar las claves hasheadas (bcrypt/scrypt), nunca en       │
// │      texto plano, y borrar el campo `clave` del seed.             │
// │   2. Mover las sesiones a la base de datos real, no a db.json     │
// │      (que ademas se borra en cada despliegue de Render).          │
// │   3. Limitar los intentos de login para frenar fuerza bruta.      │
// │   4. Quitar de la pantalla de login la lista de usuarios de       │
// │      prueba (ver login.js).                                       │
// │   5. Proteger /api/ubicacion y los endpoints del simulador, hoy   │
// │      abiertos a proposito para poder hacer demos.                 │
// └───────────────────────────────────────────────────────────────────┘

const DURACION_SESION_MS = 12 * 60 * 60 * 1000; // 12 horas

// --- Puntos de cambio para la base de datos real ---
// Estas tres funciones son lo unico que hay que reescribir cuando los
// usuarios dejen de venir de db.json y vengan de la base real.

function buscarUsuarioPorNombre(db, usuario) {
  const buscado = String(usuario || "").trim().toLowerCase();
  return db.usuarios.find((u) => u.usuario.toLowerCase() === buscado) || null;
}

function verificarClave(usuarioDb, clave) {
  // Comparacion en texto plano porque son usuarios de prueba. Con la base
  // real esto pasa a ser una verificacion de hash.
  return usuarioDb.clave === String(clave || "");
}

function seniorDeUsuario(db, usuario) {
  // Con la base real aqui se buscaria dentro de una lista de adultos
  // mayores; hoy solo hay uno y basta con comprobar que sea el suyo.
  if (!usuario || db.senior.id !== usuario.seniorId) return null;
  return db.senior;
}

// --- Sesiones ---

function crearSesion(db, usuarioDb) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sesiones.push({
    token,
    usuarioId: usuarioDb.id,
    creadaEn: new Date().toISOString(),
    expiraEn: new Date(Date.now() + DURACION_SESION_MS).toISOString(),
  });
  return token;
}

function purgarSesionesVencidas(db) {
  const ahora = Date.now();
  db.sesiones = db.sesiones.filter(
    (s) => new Date(s.expiraEn).getTime() > ahora
  );
}

function usuarioDeLaPeticion(req, db) {
  const cabecera = req.headers.authorization || "";
  if (!cabecera.startsWith("Bearer ")) return null;
  const token = cabecera.slice(7);

  purgarSesionesVencidas(db);
  const sesion = db.sesiones.find((s) => s.token === token);
  if (!sesion) return null;

  return db.usuarios.find((u) => u.id === sesion.usuarioId) || null;
}

// Nunca devolver la clave al frontend.
function usuarioPublico(u) {
  return {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    seniorId: u.seniorId,
    contactoId: u.contactoId,
  };
}

// --- Middlewares ---

function requiereAuth(req, res, next) {
  const db = loadDb();
  const usuario = usuarioDeLaPeticion(req, db);
  if (!usuario) {
    return res.status(401).json({ error: "Necesitas iniciar sesión" });
  }
  req.usuario = usuario;
  next();
}

function requiereRol(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      return res
        .status(403)
        .json({ error: "Tu rol no tiene permiso para esta acción" });
    }
    next();
  };
}

// --- Endpoints de sesion ---

app.post("/api/auth/login", (req, res) => {
  const { usuario, clave } = req.body || {};
  const db = loadDb();

  const usuarioDb = buscarUsuarioPorNombre(db, usuario);
  // Mismo mensaje si falla el usuario o la clave: no conviene revelar
  // cual de los dos existe.
  if (!usuarioDb || !verificarClave(usuarioDb, clave)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }

  purgarSesionesVencidas(db);
  const token = crearSesion(db, usuarioDb);
  saveDb(db);

  res.json({ token, usuario: usuarioPublico(usuarioDb) });
});

app.post("/api/auth/logout", requiereAuth, (req, res) => {
  const db = loadDb();
  const token = (req.headers.authorization || "").slice(7);
  db.sesiones = db.sesiones.filter((s) => s.token !== token);
  saveDb(db);
  res.json({ ok: true });
});

// Lo llama el frontend al abrir la app para saber si la sesion sigue viva
// y que interfaz mostrar.
app.get("/api/auth/yo", requiereAuth, (req, res) => {
  res.json({ usuario: usuarioPublico(req.usuario) });
});

// --- Configuracion que el frontend necesita saber -------------------------
//
// Hoy solo sirve para elegir el proveedor del mapa.
//
// Por defecto se usa OpenStreetMap: da calles y edificios de verdad sin
// clave de API, sin tarjeta de credito y sin cuota que vigilar. Es lo
// que esta activo.
//
// Google queda soportado por si alguna vez interesa: basta con poner
// GOOGLE_MAPS_API_KEY como variable de entorno (en Render, en
// Environment > Add Environment Variable) y el frontend cambia solo.
// Esa clave NUNCA se guarda en el repositorio.
//
// ── POR QUE SE ENTREGA AL NAVEGADOR ────────────────────────────────
// Una clave de Maps JavaScript es publica por naturaleza: el navegador
// tiene que verla para cargar el mapa, y cualquiera puede leerla en las
// herramientas de desarrollo. Lo que la protege NO es esconderla, sino
// restringirla en Google Cloud a este dominio (restriccion por
// referente HTTP) y a la API de Maps. Sin esas restricciones, la clave
// sirve desde cualquier sitio y el consumo lo paga el titular.
//
// Aun asi se pide sesion: no hace falta repartirla a quien ni siquiera
// ha entrado.
app.get("/api/config", requiereAuth, (req, res) => {
  const clave = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
  res.json({
    mapa: {
      // Por defecto OpenStreetMap: da calles y edificios reales sin
      // clave, sin tarjeta y sin cuota. Si algun dia se configura
      // GOOGLE_MAPS_API_KEY, se usa Google en su lugar sin tocar codigo.
      proveedor: clave ? "google" : "osm",
      apiKey: clave || null,
    },
  });
});

// --- API -----------------------------------------------------------------

// Los dos roles leen los mismos datos del adulto mayor; lo que cambia es
// como se presentan (ver vista-mayor.js y vista-contacto.js) y que puede
// hacer cada uno, definido con requiereRol mas abajo.

app.get("/api/senior", requiereAuth, (req, res) => {
  const db = loadDb();
  const senior = seniorDeUsuario(db, req.usuario);
  if (!senior) {
    return res.status(403).json({ error: "No tienes acceso a esta persona" });
  }
  res.json(senior);
});

app.get("/api/contactos", requiereAuth, (req, res) => {
  const db = loadDb();
  res.json(db.contactos);
});

app.get("/api/alertas", requiereAuth, (req, res) => {
  const db = loadDb();
  const ordenadas = [...db.alertas].sort(
    (a, b) => new Date(b.creadoEn) - new Date(a.creadoEn)
  );
  res.json(ordenadas);
});

// Simula que la pulsera fue escaneada (para probar el flujo de alerta
// de punta a punta sin tener la pulsera fisica todavia).
app.post(
  "/api/alertas/simular-scan",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
    const db = loadDb();
    const nueva = {
      id: db.nextAlertId,
      tipo: "qr",
      titulo: "Pulsera escaneada",
      detalle: "Un desconocido escaneo el codigo QR de " + db.senior.nombre,
      lugar: "Ubicacion aproximada por GPS del telefono que escaneo",
      creadoEn: new Date().toISOString(),
      estado: "pendiente",
      whatsappEnviado: true,
    };
    db.alertas.push(nueva);
    db.nextAlertId += 1;
    db.senior.status = "alerta";
    saveDb(db);
    res.status(201).json(nueva);
  }
);

// Resolver una alerta es tarea del cuidador, no del adulto mayor.
app.post(
  "/api/alertas/:id/marcar-atendida",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
    const db = loadDb();
    const alerta = db.alertas.find((a) => a.id === Number(req.params.id));
    if (!alerta) return res.status(404).json({ error: "Alerta no encontrada" });
    alerta.estado = "atendida";
    const hayPendientes = db.alertas.some((a) => a.estado === "pendiente");
    db.senior.status = hayPendientes ? "alerta" : "presente";
    saveDb(db);
    res.json(alerta);
  }
);

app.post(
  "/api/senior/marcar-visto",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
    const db = loadDb();
    db.senior.ubicacion.actualizadoEn = new Date().toISOString();
    saveDb(db);
    res.json(db.senior);
  }
);

// --- Recordatorios -------------------------------------------------------
// Medicamentos, citas y rutinas del adulto mayor. A diferencia de las
// alertas (que las dispara el sistema), estos los crea el cuidador a mano
// desde la pantalla de Inicio.

const TIPOS_RECORDATORIO = ["medicamento", "cita", "otro"];

// Ordena por hora del dia; los ya marcados como hechos se van al final.
// AAAA-MM-DD y que la fecha exista de verdad: "2026-02-31" cumple el
// patron pero no es un dia real, y JavaScript la corre al 3 de marzo sin
// avisar. Una cita medica en un dia equivocado es peor que no tenerla.
function esFechaValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(texto + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function ordenarRecordatorios(lista) {
  return [...lista].sort((a, b) => {
    if (a.hecho !== b.hecho) return a.hecho ? 1 : -1;
    return (a.hora || "").localeCompare(b.hora || "");
  });
}

app.get("/api/recordatorios", requiereAuth, (req, res) => {
  const db = loadDb();
  res.json(ordenarRecordatorios(db.recordatorios || []));
});

// Crear y borrar recordatorios es del cuidador; marcarlos como hechos es
// del adulto mayor (es quien se toma la pastilla). Por eso el permiso de
// "alternar-hecho" mas abajo es distinto al de estos dos.
app.post(
  "/api/recordatorios",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
  const { titulo, detalle, hora, fecha, tipo } = req.body || {};

  if (!titulo || !String(titulo).trim()) {
    return res.status(400).json({ error: "El titulo es obligatorio" });
  }
  // La hora es opcional, pero si viene tiene que ser HH:MM (24h).
  if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
    return res.status(400).json({ error: "La hora debe tener formato HH:MM" });
  }
  // La fecha tambien es opcional, pero una cita medica sin dia no sirve
  // de nada: si viene, tiene que ser una fecha real en formato AAAA-MM-DD.
  if (fecha && !esFechaValida(fecha)) {
    return res.status(400).json({ error: "La fecha debe tener formato AAAA-MM-DD" });
  }

  const db = loadDb();
  if (!db.recordatorios) db.recordatorios = [];
  if (!db.nextRecordatorioId) db.nextRecordatorioId = 1;

  const nuevo = {
    id: db.nextRecordatorioId,
    tipo: TIPOS_RECORDATORIO.includes(tipo) ? tipo : "otro",
    titulo: String(titulo).trim(),
    detalle: detalle ? String(detalle).trim() : "",
    hora: hora || "",
    fecha: fecha || "",
    hecho: false,
    creadoEn: new Date().toISOString(),
  };

    db.recordatorios.push(nuevo);
    db.nextRecordatorioId += 1;
    saveDb(db);
    res.status(201).json(nuevo);
  }
);

// Este SI lo pueden usar los dos roles: el adulto mayor marca que ya se
// tomo la pastilla, y el cuidador tambien puede hacerlo por el.
// Alterna en vez de solo marcar, para poder deshacer un toque accidental.
app.post("/api/recordatorios/:id/alternar-hecho", requiereAuth, (req, res) => {
  const db = loadDb();
  const rec = (db.recordatorios || []).find(
    (r) => r.id === Number(req.params.id)
  );
  if (!rec) return res.status(404).json({ error: "Recordatorio no encontrado" });
  rec.hecho = !rec.hecho;
  saveDb(db);
  res.json(rec);
});

app.delete(
  "/api/recordatorios/:id",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const antes = (db.recordatorios || []).length;
    db.recordatorios = (db.recordatorios || []).filter((r) => r.id !== id);
    if (db.recordatorios.length === antes) {
      return res.status(404).json({ error: "Recordatorio no encontrado" });
    }
    saveDb(db);
    res.json({ ok: true });
  }
);

// --- Medicamentos --------------------------------------------------------
//
// El tratamiento del adulto mayor: que toma, cuanta dosis y cada cuanto.
// Los campos son los mismos que la tabla `medicamentos` del backend real
// (nombre, dosis, frecuencia, horario, via_administracion, activo), para
// que conectarlo despues sea un mapeo directo y no una traduccion.
//
// ── POR QUE ESTA SEPARADO DE LOS RECORDATORIOS ─────────────────────────
// Son dos cosas distintas y mezclarlas se paga caro:
//   · Un MEDICAMENTO es el tratamiento. Vive mientras el medico lo
//     mantenga y lo administra el cuidador.
//   · Un RECORDATORIO es una tarea de hoy que se marca como hecha.
// Si fueran lo mismo, marcar "ya me la tome" borraria el medicamento de
// la lista de tratamiento, que es justo lo que no debe pasar.
//
// Un medicamento no se borra al suspenderlo: se marca `activo: false`.
// El historial de lo que tomo alguien es informacion clinica.

function limpiarTexto(valor, maximo) {
  return String(valor == null ? "" : valor).trim().slice(0, maximo);
}

app.get("/api/medicamentos", requiereAuth, (req, res) => {
  const db = loadDb();
  const lista = [...(db.medicamentos || [])].sort((a, b) => {
    // Los suspendidos al final; el resto por nombre.
    if (!!a.activo !== !!b.activo) return a.activo ? -1 : 1;
    return String(a.nombre).localeCompare(String(b.nombre), "es");
  });
  res.json(lista);
});

app.post(
  "/api/medicamentos",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
    const { nombre, dosis, frecuencia, horario, viaAdministracion, notas } =
      req.body || {};

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: "El nombre del medicamento es obligatorio" });
    }

    const db = loadDb();
    const nuevo = {
      id: db.nextMedicamentoId,
      nombre: limpiarTexto(nombre, 150),
      dosis: limpiarTexto(dosis, 100),
      frecuencia: limpiarTexto(frecuencia, 100),
      horario: limpiarTexto(horario, 100),
      viaAdministracion: limpiarTexto(viaAdministracion, 100),
      notas: limpiarTexto(notas, 300),
      activo: true,
      creadoEn: new Date().toISOString(),
    };

    db.medicamentos.push(nuevo);
    db.nextMedicamentoId += 1;
    saveDb(db);
    res.status(201).json(nuevo);
  }
);

app.put(
  "/api/medicamentos/:id",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
    const db = loadDb();
    const med = (db.medicamentos || []).find(
      (m) => m.id === Number(req.params.id)
    );
    if (!med) return res.status(404).json({ error: "Medicamento no encontrado" });

    const c = req.body || {};
    if (c.nombre !== undefined) {
      if (!String(c.nombre).trim()) {
        return res.status(400).json({ error: "El nombre del medicamento es obligatorio" });
      }
      med.nombre = limpiarTexto(c.nombre, 150);
    }
    if (c.dosis !== undefined) med.dosis = limpiarTexto(c.dosis, 100);
    if (c.frecuencia !== undefined) med.frecuencia = limpiarTexto(c.frecuencia, 100);
    if (c.horario !== undefined) med.horario = limpiarTexto(c.horario, 100);
    if (c.viaAdministracion !== undefined)
      med.viaAdministracion = limpiarTexto(c.viaAdministracion, 100);
    if (c.notas !== undefined) med.notas = limpiarTexto(c.notas, 300);
    // Suspender o retomar un tratamiento.
    if (c.activo !== undefined) med.activo = !!c.activo;

    saveDb(db);
    res.json(med);
  }
);

app.delete(
  "/api/medicamentos/:id",
  requiereAuth,
  requiereRol("contacto_emergencia"),
  (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const antes = (db.medicamentos || []).length;
    db.medicamentos = (db.medicamentos || []).filter((m) => m.id !== id);
    if (db.medicamentos.length === antes) {
      return res.status(404).json({ error: "Medicamento no encontrado" });
    }
    saveDb(db);
    res.json({ ok: true });
  }
);

// --- Zona segura (geocerca) ----------------------------------------------
//
// El telefono del adulto mayor reporta su posicion aqui y el SERVIDOR
// decide si salio de la zona. Se hace aqui a proposito: asi se pueden
// cambiar las reglas sin actualizar nada instalado en el telefono.
//
// Lo delicado no es medir la distancia, es NO generar falsas alarmas. El
// GPS se desvia entre 10 y 50 m en ciudad, asi que una persona sentada y
// quieta "salta" de un lado a otro. Si alertaramos con cada lectura,
// mandariamos WhatsApps a la familia toda la noche. Por eso hay tres
// defensas: descartar lecturas de mala calidad, exigir varias lecturas
// seguidas antes de decidir, y usar un margen distinto para salir y para
// volver a entrar (histeresis), que evita el parpadeo justo en el borde.

const GEOCERCA = {
  // Margen alrededor del radio: se sale al superar radio+margen y solo se
  // considera "de vuelta" al bajar de radio-margen.
  margenM: 25,
  // Lecturas seguidas fuera/dentro necesarias para confirmar el cambio.
  lecturasParaSalir: 3,
  lecturasParaVolver: 2,
  // Una lectura con precision peor que esto no es confiable: se ignora.
  precisionMaximaM: 100,
  // Un salto mas rapido que esto es dato basura, no una persona caminando.
  velocidadMaximaKmh: 200,
};

function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // radio de la Tierra en metros
  const rad = (grados) => (grados * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function crearAlertaZona(db, { titulo, detalle, lugar, estado }) {
  const alerta = {
    id: db.nextAlertId,
    tipo: "zona",
    titulo,
    detalle,
    lugar,
    creadoEn: new Date().toISOString(),
    estado,
    whatsappEnviado: true,
  };
  db.alertas.push(alerta);
  db.nextAlertId += 1;
  return alerta;
}

// Devuelve que hacer con una lectura, y modifica db si corresponde.
function evaluarUbicacion(db, { lat, lng, precision }) {
  const zona = db.senior.zonaSegura;
  const seg = db.senior.seguimiento;
  const ahora = new Date();

  // Defensa 1: lecturas imprecisas no sirven para decidir nada.
  if (precision != null && precision > GEOCERCA.precisionMaximaM) {
    return {
      aceptada: false,
      motivo: `Precisión de ${Math.round(precision)} m; se descarta (máximo ${
        GEOCERCA.precisionMaximaM
      } m)`,
    };
  }

  // Defensa 2: saltos fisicamente imposibles = dato basura.
  if (seg.ultimaLectura) {
    const segundos = (ahora - new Date(seg.ultimaLectura.en)) / 1000;
    if (segundos >= 1) {
      const salto = distanciaMetros(
        seg.ultimaLectura.lat,
        seg.ultimaLectura.lng,
        lat,
        lng
      );
      const kmh = (salto / segundos) * 3.6;
      if (kmh > GEOCERCA.velocidadMaximaKmh) {
        return {
          aceptada: false,
          motivo: `Salto de ${Math.round(kmh)} km/h; se descarta por imposible`,
        };
      }
    }
  }

  const distancia = distanciaMetros(zona.lat, zona.lng, lat, lng);
  const umbralSalida = zona.radioM + GEOCERCA.margenM;
  const umbralRegreso = zona.radioM - GEOCERCA.margenM;

  let alerta = null;
  let evento = null;

  // Defensa 3: histeresis + lecturas consecutivas.
  if (!seg.estaFuera) {
    if (distancia > umbralSalida) {
      seg.lecturasFuera += 1;
      seg.lecturasDentro = 0;
      if (seg.lecturasFuera >= GEOCERCA.lecturasParaSalir) {
        seg.estaFuera = true;
        seg.lecturasFuera = 0;
        evento = "salida";
        alerta = crearAlertaZona(db, {
          titulo: "Salió de la zona segura",
          detalle: `${db.senior.nombre} está a ${Math.round(
            distancia
          )} m del centro de su zona segura (radio ${zona.radioM} m)`,
          lugar: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          estado: "pendiente",
        });
        db.senior.status = "alerta";
      }
    } else {
      seg.lecturasFuera = 0;
    }
  } else {
    if (distancia < umbralRegreso) {
      seg.lecturasDentro += 1;
      seg.lecturasFuera = 0;
      if (seg.lecturasDentro >= GEOCERCA.lecturasParaVolver) {
        seg.estaFuera = false;
        seg.lecturasDentro = 0;
        evento = "regreso";
        alerta = crearAlertaZona(db, {
          titulo: "Volvió a la zona segura",
          detalle: `${db.senior.nombre} está de nuevo dentro de su zona segura`,
          lugar: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          estado: "atendida",
        });
        const quedanPendientes = db.alertas.some(
          (a) => a.estado === "pendiente"
        );
        db.senior.status = quedanPendientes ? "alerta" : "presente";
      }
    } else {
      seg.lecturasDentro = 0;
    }
  }

  db.senior.ubicacion.lat = lat;
  db.senior.ubicacion.lng = lng;
  db.senior.ubicacion.actualizadoEn = ahora.toISOString();
  seg.ultimaLectura = { lat, lng, en: ahora.toISOString() };

  return {
    aceptada: true,
    distanciaM: Math.round(distancia),
    fueraDeZona: seg.estaFuera,
    lecturasFuera: seg.lecturasFuera,
    lecturasDentro: seg.lecturasDentro,
    evento,
    alerta,
  };
}

// --- Direccion en texto (geocodificacion inversa) -------------------------
//
// Unas coordenadas no le dicen nada a nadie. "Calle 181 #13-54" si. Esto
// convierte lo uno en lo otro con datos de OpenStreetMap: gratuito, sin
// clave y sin tarjeta, igual que las teselas del mapa.
//
// ── POR QUE EN EL SERVIDOR Y NO EN EL NAVEGADOR ────────────────────
//   1. Estos servicios piden un User-Agent que identifique a la
//      aplicacion, y un navegador no puede fijar esa cabecera.
//   2. Una sola consulta sirve para todos los cuidadores que miren.
//   3. El limite de peticiones se controla en un solo sitio.
//
// ── POR QUE HAY DOS PROVEEDORES ───────────────────────────────────
// Nominatim funciona perfecto desde una maquina de casa, pero desde
// Render devuelve 429 (Too Many Requests) SIEMPRE: la IP de salida es
// compartida entre muchos inquilinos y la cuota ya viene agotada por
// otros. No es culpa de nuestro ritmo de peticiones, y por eso subir el
// intervalo no lo arreglaria.
//
// Photon (del proyecto Komoot, tambien sobre datos de OpenStreetMap) si
// atiende a IPs de centro de datos, asi que va primero. Nominatim queda
// de respaldo: en local funciona, y si Photon se cae cubre el hueco.
// Encima, para Bogota Photon da barrios de verdad ("Nicolas de
// Federman", "Britalia") donde Nominatim devolvia "UPZs de Bogota".
//
// ── RESPETAR EL SERVICIO ──────────────────────────────────────────
// Los dos son servicios comunitarios gratuitos. Consultarlos en cada
// lectura (cada 10 s por telefono) seria abusar sin necesidad, asi que
// hay dos frenos:
//   · Solo se vuelve a preguntar si la persona se movio de verdad
//     (mas de 40 m desde la ultima direccion conocida). Quien esta
//     sentado en su casa no genera ni una peticion.
//   · Un intervalo minimo entre peticiones, por si varios titulares
//     reportan a la vez.
//
// Si los dos fallan o tardan, NO pasa nada: se conserva la ultima
// direccion conocida y la ubicacion sigue funcionando igual. Una
// direccion bonita nunca puede costar una alerta.

const GEOCODIFICACION = {
  // Los dos servicios piden identificar a quien llama.
  userAgent:
    "ConectaSenior/1.0 (https://conecta-senior-app.onrender.com; contacto@conectasenior.com.co)",
  metrosParaRepetir: 40,
  msEntrePeticiones: 1500,
  msTimeout: 6000,
};

let ultimaPeticionGeo = 0;

/**
 * Junta las piezas de una direccion como se dicen en Colombia:
 * "via #numero, barrio, ciudad". Se dejan fuera el pais, la region y el
 * codigo postal, que sobran en una pantalla de movil.
 */
function juntarDireccion({ via, numero, barrio, ciudad }) {
  const partes = [];
  if (via) partes.push(numero ? `${via} #${numero}` : via);
  if (barrio && barrio !== via) partes.push(barrio);

  // OSM guarda la capital como "Bogota ciudad", que en pantalla suena
  // raro. Se le quita ese apendice para que se lea como lo diria
  // cualquiera.
  const ciudadLimpia = ciudad ? ciudad.replace(/\s+ciudad$/i, "").trim() : null;
  if (ciudadLimpia && ciudadLimpia !== barrio) partes.push(ciudadLimpia);

  return partes.length ? partes.join(", ") : null;
}

/** Traduce la respuesta de Photon (GeoJSON) a una direccion legible. */
function armarDireccionPhoton(datos) {
  const rasgo = datos && datos.features && datos.features[0];
  if (!rasgo) return null;
  const p = rasgo.properties || {};

  // `name` solo sirve como via cuando el resultado ES una calle. Para
  // una casa, `name` es el nombre del edificio o del monumento
  // ("Maquina Aplanadora a Vapor"), que no es una direccion.
  const via = p.street || (p.type === "street" ? p.name : null);

  return juntarDireccion({
    via,
    numero: p.housenumber || null,
    barrio: p.locality || p.district || null,
    ciudad: p.city || null,
  });
}

/** Traduce la respuesta de Nominatim a una direccion legible. */
function armarDireccionNominatim(datos) {
  if (!datos) return null;
  const a = datos.address || {};

  const texto = juntarDireccion({
    via: a.road || a.pedestrian || a.footway || a.residential || null,
    numero: a.house_number || null,
    // `suburb` antes que `neighbourhood`: en Bogota, neighbourhood suele
    // traer ruido administrativo ("UPZs de Bogota") mientras que suburb
    // da algo que la gente reconoce ("Localidad Suba").
    barrio: a.suburb || a.neighbourhood || a.quarter || null,
    ciudad: a.city || a.town || a.village || a.municipality || null,
  });
  if (texto) return texto;

  // Sin calle reconocida (un descampado, una via sin nombre): mejor la
  // descripcion larga recortada que dejarlo vacio.
  return datos.display_name ? String(datos.display_name).slice(0, 120) : null;
}

async function pedirJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": GEOCODIFICACION.userAgent,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(GEOCODIFICACION.msTimeout),
  });
  if (!res.ok) {
    // El cuerpo del error dice mucho: estos servicios contestan con un
    // texto explicando el motivo cuando bloquean a quien llama.
    const detalle = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${detalle.slice(0, 120)}`);
  }
  return res.json();
}

// `layer=street&layer=house` evita que Photon conteste con el poligono
// de la ciudad entera cuando no hay nada mas cerca; se prefiere quedarse
// sin direccion antes que decir solo "Bogota".
const PROVEEDORES = [
  {
    nombre: "photon",
    url: (lat, lng) =>
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}` +
      `&layer=street&layer=house&limit=1`,
    leer: armarDireccionPhoton,
  },
  {
    nombre: "nominatim",
    url: (lat, lng) =>
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=es`,
    leer: armarDireccionNominatim,
  },
];

/**
 * Devuelve { texto, proveedor }, o lanza con el detalle de por que
 * fallaron los dos.
 */
async function geocodificarInverso(lat, lng) {
  const ahora = Date.now();
  if (ahora - ultimaPeticionGeo < GEOCODIFICACION.msEntrePeticiones) return null;
  ultimaPeticionGeo = ahora;

  const fallos = [];
  for (const p of PROVEEDORES) {
    try {
      const texto = p.leer(await pedirJson(p.url(lat, lng)));
      if (texto) return { texto, proveedor: p.nombre };
      fallos.push(`${p.nombre}: sin direccion utilizable`);
    } catch (err) {
      fallos.push(`${p.nombre}: ${err.message}`);
    }
  }
  throw new Error(fallos.join(" · "));
}

/** ¿Hace falta volver a preguntar la direccion para estas coordenadas? */
function necesitaDireccion(ubicacion, lat, lng) {
  if (!ubicacion.direccionLat || !ubicacion.direccionLng) return true;
  const movido = distanciaMetros(
    ubicacion.direccionLat,
    ubicacion.direccionLng,
    lat,
    lng
  );
  return movido > GEOCODIFICACION.metrosParaRepetir;
}

/**
 * Pide la direccion y la guarda, sin bloquear la respuesta al telefono.
 * Se vuelve a leer la base antes de escribir porque entre la peticion y
 * la respuesta pueden haber entrado lecturas nuevas.
 */
function actualizarDireccionEnSegundoPlano(lat, lng) {
  geocodificarInverso(lat, lng)
    .then((r) => {
      if (!r) return; // frenado por el intervalo minimo; ya se reintentara
      const db = loadDb();
      db.senior.ubicacion.direccion = r.texto;
      db.senior.ubicacion.direccionLat = lat;
      db.senior.ubicacion.direccionLng = lng;
      db.senior.ubicacion.direccionEn = new Date().toISOString();
      db.senior.ubicacion.direccionFallo = null;
      saveDb(db);
      console.log(`[ubicacion] Direccion (${r.proveedor}): ${r.texto}`);
    })
    .catch((err) => {
      // Se conserva la ultima direccion conocida. Que no se sepa la
      // calle no puede impedir que se sepa donde esta la persona.
      console.error("[ubicacion] No se pudo resolver la direccion:", err.message);
      // El motivo se guarda para poder diagnosticarlo sin entrar a los
      // logs del servidor: desde fuera solo se ve "Buscando la
      // direccion..." y eso no dice si fallo la red, el servicio o el
      // formato de la respuesta.
      try {
        const db = loadDb();
        db.senior.ubicacion.direccionFallo = {
          motivo: String(err.message).slice(0, 300),
          cuando: new Date().toISOString(),
        };
        saveDb(db);
      } catch (_) {}
    });
}

// OJO: los cuatro endpoints que siguen son los unicos SIN autenticacion.
// Es a proposito, para que el simulador funcione en demos sin tener que
// iniciar sesion. Antes de conectar datos reales hay que protegerlos: el
// de ubicacion deberia exigir la sesion del propio adulto mayor, y los de
// simulador deberian desaparecer.

// Aqui reportaria el telefono del adulto mayor (hoy lo usa el simulador).
app.post("/api/ubicacion", (req, res) => {
  const { lat, lng, precision, fuente } = req.body || {};

  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat y lng deben ser numeros" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Coordenadas fuera de rango" });
  }

  const db = loadDb();

  // Si la peticion trae sesion, tiene que ser la del PROPIO adulto mayor.
  // Un cuidador no puede mover la ubicacion de la persona a su cargo: seria
  // poder fabricar una salida de zona segura, o taparla.
  //
  // Sin sesion se sigue aceptando porque el simulador de demos no inicia
  // sesion (ver el bloque PENDIENTE del principio del archivo).
  const usuario = usuarioDeLaPeticion(req, db);
  if (usuario && usuario.rol !== "adulto_mayor") {
    return res
      .status(403)
      .json({ error: "Solo el adulto mayor puede reportar su ubicación" });
  }
  if (usuario && db.senior.id !== usuario.seniorId) {
    return res.status(403).json({ error: "No puedes reportar por otra persona" });
  }

  const resultado = evaluarUbicacion(db, { lat, lng, precision });

  // De donde vino la lectura. El panel del cuidador necesita distinguir
  // "esto es el GPS del telefono de mi mama, ahora mismo" de "esto es el
  // dato de ejemplo con el que arranca la app".
  if (resultado.aceptada) {
    const esGps = fuente === "gps" || (usuario && usuario.rol === "adulto_mayor");
    db.senior.ubicacion.fuente = esGps ? "gps" : "simulador";
    db.senior.ubicacion.precision =
      typeof precision === "number" ? Math.round(precision) : null;
    if (esGps) {
      // La direccion del seed es inventada; dejarla puesta junto a unas
      // coordenadas reales haria creer que la persona esta en una calle
      // donde no esta. Se pone un texto neutro hasta que llegue la real.
      if (necesitaDireccion(db.senior.ubicacion, lat, lng)) {
        if (!db.senior.ubicacion.direccionLat) {
          db.senior.ubicacion.direccion = "Buscando la dirección…";
        }
        // Sin await: la respuesta al telefono no espera a Nominatim.
        actualizarDireccionEnSegundoPlano(lat, lng);
      }
    }
  }

  saveDb(db);
  res.json({ ...resultado, config: GEOCERCA, zonaSegura: db.senior.zonaSegura });
});

app.get("/api/zona-segura", (req, res) => {
  const db = loadDb();
  res.json({
    ...db.senior.zonaSegura,
    config: GEOCERCA,
    seguimiento: db.senior.seguimiento,
    ubicacionActual: db.senior.ubicacion,
  });
});

app.post("/api/zona-segura", (req, res) => {
  const { lat, lng, radioM } = req.body || {};
  const db = loadDb();

  if (typeof lat === "number") db.senior.zonaSegura.lat = lat;
  if (typeof lng === "number") db.senior.zonaSegura.lng = lng;
  if (typeof radioM === "number") {
    if (radioM < 50 || radioM > 5000) {
      return res
        .status(400)
        .json({ error: "El radio debe estar entre 50 y 5000 m" });
    }
    db.senior.zonaSegura.radioM = radioM;
  }

  saveDb(db);
  res.json(db.senior.zonaSegura);
});

// Deja todo como al principio para poder repetir una demo.
app.post("/api/simulador/reiniciar", (req, res) => {
  const db = loadDb();
  db.senior.seguimiento = {
    estaFuera: false,
    lecturasFuera: 0,
    lecturasDentro: 0,
    ultimaLectura: null,
  };
  db.senior.ubicacion.lat = db.senior.zonaSegura.lat;
  db.senior.ubicacion.lng = db.senior.zonaSegura.lng;
  db.senior.ubicacion.actualizadoEn = new Date().toISOString();
  // Tambien el origen: si no, tras una prueba con GPS real el panel
  // seguiria diciendo "EN VIVO" sobre una posicion que ya es de mentira.
  db.senior.ubicacion.fuente = "simulador";
  db.senior.ubicacion.precision = null;
  db.senior.ubicacion.direccion = JSON.parse(
    fs.readFileSync(SEED_PATH, "utf-8")
  ).senior.ubicacion.direccion;
  // Y la direccion resuelta, o la siguiente lectura no volveria a
  // preguntarla por creer que ya la tiene.
  db.senior.ubicacion.direccionLat = null;
  db.senior.ubicacion.direccionLng = null;
  db.senior.ubicacion.direccionEn = null;
  db.alertas = db.alertas.filter((a) => a.tipo !== "zona");
  db.senior.status = db.alertas.some((a) => a.estado === "pendiente")
    ? "alerta"
    : "presente";
  saveDb(db);
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\nConecta Senior corriendo en:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\nPara verlo en tu iPhone (misma red WiFi que esta compu):`);
  console.log(`  1. Busca la IP local de esta computadora (ver README.md)`);
  console.log(`  2. Abre esa IP con el puerto ${PORT} en Safari, ej: http://192.168.1.23:${PORT}`);
  console.log(`  3. Toca compartir > "Agregar a pantalla de inicio"\n`);
});
