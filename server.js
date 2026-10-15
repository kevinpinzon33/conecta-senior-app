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

// ── FORMA DE LOS DATOS ────────────────────────────────────────────────
// Desde el 2026-10-12, db.json imita las tablas del backend real (el ZIP
// conecta-senior _5-10, archivo _esquema_completo.sql): una coleccion por
// tabla y las columnas en camelCase. adultoMayor = adulto_mayor,
// adultoResponsable = adulto_responsable, medicamentoHoras =
// medicamento_horas, citasMedicas = citas_medicas, etc. Asi, al acoplar
// la base MySQL, cada coleccion se cambia por su tabla sin traducir nada.
//
// Lo que el backend real NO tiene (ubicacion, zona segura, alertas,
// recordatorios del dia) va en colecciones propias, tambien por
// adultoMayorId: son la propuesta de tablas nuevas. Ver la seccion 9 de
// CONTEXTO-CONECTA-SENIOR.md.
//
// Los ids se calculan como max+1, igual que un AUTO_INCREMENT.

const COLECCIONES = [
  "usuarios", "adultoMayor", "adultoResponsable", "informacionMedica",
  "contactosEmergencia", "medicamentos", "medicamentoHoras", "citasMedicas",
  "recordatorios", "alertas", "zonasSeguras", "monitoreo", "sesiones",
];

function normalizarDb(db) {
  // Un db.json del formato anterior (un unico objeto `senior`) no se
  // puede leer con este codigo. Se reemplaza por el seed: son datos de
  // prueba y en Render se regeneran igual en cada despliegue.
  if (db.senior || !db.adultoMayor) {
    console.warn("[db] db.json con formato anterior; se regenera desde el seed");
    conReintentos(() => fs.copyFileSync(SEED_PATH, DB_PATH));
    db = JSON.parse(conReintentos(() => fs.readFileSync(DB_PATH, "utf-8")));
  }
  for (const c of COLECCIONES) if (!Array.isArray(db[c])) db[c] = [];
  return db;
}

function siguienteId(lista) {
  return lista.reduce((max, x) => Math.max(max, Number(x.id) || 0), 0) + 1;
}

const deAdulto = (lista, adultoId) =>
  lista.filter((x) => x.adultoMayorId === adultoId);

/**
 * Lo que hace falta para vigilar a un adulto mayor: su ficha, su zona
 * segura y su estado de seguimiento. Devuelve referencias vivas: lo que
 * se modifique aqui se guarda con saveDb(db). Crea la zona y el
 * monitoreo si faltan (un adulto recien dado de alta no tiene).
 */
function vigilancia(db, adultoId) {
  const adulto = db.adultoMayor.find((a) => a.id === adultoId);
  if (!adulto) return null;

  let zona = db.zonasSeguras.find((z) => z.adultoMayorId === adultoId);
  let mon = db.monitoreo.find((m) => m.adultoMayorId === adultoId);
  if (!mon) {
    mon = {
      adultoMayorId: adultoId,
      status: "presente",
      revisadoEn: null,
      ubicacion: { direccion: "", lat: null, lng: null, actualizadoEn: null },
      seguimiento: { estaFuera: false, lecturasFuera: 0, lecturasDentro: 0, ultimaLectura: null },
    };
    db.monitoreo.push(mon);
  }
  if (!zona) {
    zona = {
      id: siguienteId(db.zonasSeguras),
      adultoMayorId: adultoId,
      lat: mon.ubicacion.lat ?? 4.711,
      lng: mon.ubicacion.lng ?? -74.0721,
      radioM: 300,
    };
    db.zonasSeguras.push(zona);
  }
  return { adulto, zona, mon };
}

// Sin sesion (simulador de demos) se usa el adulto que pidan o el primero.
function adultoSinSesion(db, pedido) {
  const id = Number(pedido);
  if (id && db.adultoMayor.some((a) => a.id === id)) return id;
  return db.adultoMayor[0] ? db.adultoMayor[0].id : null;
}

function edadDesde(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const n = new Date(fechaNacimiento + "T00:00:00");
  const hoy = new Date();
  let edad = hoy.getFullYear() - n.getFullYear();
  const aunNo =
    hoy.getMonth() < n.getMonth() ||
    (hoy.getMonth() === n.getMonth() && hoy.getDate() < n.getDate());
  return aunNo ? edad - 1 : edad;
}

/**
 * Lo que recibe el frontend en /api/senior: la ficha del adulto mayor,
 * su informacion medica y su estado de vigilancia, juntos. En el backend
 * real son tres tablas (adulto_mayor, informacion_medica y las nuevas de
 * ubicacion); el frontend no tiene por que saberlo.
 */
function vistaSenior(db, adultoId) {
  const v = vigilancia(db, adultoId);
  if (!v) return null;
  const info = db.informacionMedica.find((i) => i.adultoMayorId === adultoId) || {};
  return {
    ...v.adulto,
    nombre: v.adulto.nombreCompleto,
    edad: edadDesde(v.adulto.fechaNacimiento),
    tipoSangre: info.tipoSangre || "",
    condiciones: info.condiciones || "",
    alergias: info.alergias || "",
    notasMedicas: info.notas || "",
    status: v.mon.status,
    revisadoEn: v.mon.revisadoEn,
    ubicacion: v.mon.ubicacion,
    seguimiento: v.mon.seguimiento,
    senal: estadoSenal(v.mon),
    zonaSegura: {
      lat: v.zona.lat,
      lng: v.zona.lng,
      radioM: v.zona.radioM,
      modo: v.zona.modo || "fija",
      direccion: v.zona.direccion || "",
      cuidadorId: v.zona.cuidadorId || null,
      centroEn: v.zona.centroEn || null,
    },
  };
}

function hayAlertasPendientes(db, adultoId) {
  return deAdulto(db.alertas, adultoId).some((a) => a.estado === "pendiente");
}

// --- Señal del telefono del adulto mayor ---------------------------------
//
// Lo que fallo en la primera prueba de campo (2026-10-12): el telefono de
// Claudia dejo de mandar su posicion (pantalla bloqueada o el GPS callado)
// y nadie se entero. El servidor no puede detectar una salida de zona sin
// lecturas, y el panel del cuidador seguia diciendo "EN VIVO" sobre una
// posicion vieja. Un silencio asi es tan importante como una salida.
//
// Regla: si el telefono esta compartiendo (no pulso "Dejar de compartir")
// y lleva mas de SENAL_PERDIDA_MS sin reportar nada, hay alerta. El
// telefono manda un latido cada 10 s aunque la persona no se mueva (ver
// compartir-ubicacion.js), asi que 3 minutos de silencio no son normales.

// Se puede bajar con la variable de entorno para las pruebas automaticas.
const SENAL_PERDIDA_MS = Number(process.env.SENAL_PERDIDA_MS) || 3 * 60 * 1000;

function estadoSenal(mon) {
  const u = mon.ubicacion;
  if (u.fuente !== "gps") return { estado: "ejemplo" };
  if (!mon.compartiendo) return { estado: "apagada", ultimoReporte: mon.ultimoReporte || u.actualizadoEn };
  const ultimo = mon.ultimoReporte || u.actualizadoEn;
  const msSin = Date.now() - new Date(ultimo).getTime();
  return {
    estado: msSin > SENAL_PERDIDA_MS ? "perdida" : "en_vivo",
    ultimoReporte: ultimo,
  };
}

/**
 * Crea la alerta de señal perdida, una sola vez por cada silencio. Se
 * llama al consultar /api/senior y /api/alertas, que el cuidador pide
 * cada 10 s: no hace falta un temporizador en el servidor (que en el plan
 * gratuito de Render se duerme igual).
 */
function revisarSenal(db, adultoId) {
  const v = vigilancia(db, adultoId);
  if (!v) return false;
  if (estadoSenal(v.mon).estado !== "perdida" || v.mon.senalPerdidaAlertada) return false;

  const nombre = v.adulto.nombreCompleto;
  db.alertas.push({
    id: siguienteId(db.alertas),
    adultoMayorId: adultoId,
    tipo: "senal",
    titulo: "Se perdió su ubicación",
    detalle: `El teléfono de ${nombre} dejó de enviar su ubicación. Puede que lo haya bloqueado o cerrado la app. Llámala para confirmar que está bien.`,
    lugar: v.mon.ubicacion.direccion || `${v.mon.ubicacion.lat}, ${v.mon.ubicacion.lng}`,
    creadoEn: new Date().toISOString(),
    estado: "pendiente",
    whatsappEnviado: false,
  });
  v.mon.senalPerdidaAlertada = true;
  v.mon.status = "alerta";
  return true;
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
// Los roles son los del backend real (usuarios.rol), y cada uno ve una
// interfaz distinta:
//   - adulto_mayor       : ve SUS recordatorios, SUS alertas y su estado.
//   - familiar / cuidador: hacen seguimiento del adulto mayor a su cargo.
//     (Hasta el 2026-10-12 este rol se llamaba `contacto_emergencia`, que
//     no existe en el backend real.)
//
// El vinculo es el mismo del backend real:
//   - El adulto mayor y su usuario comparten id (los dos cuelgan de
//     `perfiles`), asi que adultoMayor.id === usuarios.id.
//   - Familiares y cuidadores se enlazan por `adultoResponsable`
//     (adulto_mayor_id, usuario_id, es_principal).
// Un contacto de emergencia NO es un usuario: es una fila de
// contactosEmergencia, alguien a quien llamar, sin cuenta en la app.
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

const ROLES_CUIDADOR = ["familiar", "cuidador"];

/**
 * El adulto mayor que ve este usuario. Misma regla que el middleware
 * del backend real (auth.middleware.js): el propio, si es adulto mayor;
 * si no, el que tenga en adulto_responsable, primero el principal.
 * Hoy la interfaz muestra uno solo; con varios habra que elegir.
 */
function adultoIdDeUsuario(db, usuario) {
  return adultosDeUsuario(db, usuario)[0] || null;
}

/** Todos los adultos que ve el usuario: primero aquel del que es responsable principal. */
function adultosDeUsuario(db, usuario) {
  if (!usuario) return [];
  if (usuario.rol === "adulto_mayor") {
    return db.adultoMayor.some((a) => a.id === usuario.id) ? [usuario.id] : [];
  }
  return db.adultoResponsable
    .filter((r) => r.usuarioId === usuario.id && db.adultoMayor.some((a) => a.id === r.adultoMayorId))
    .sort((a, b) => Number(!!b.esPrincipal) - Number(!!a.esPrincipal))
    .map((r) => r.adultoMayorId);
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
function usuarioPublico(db, u) {
  return {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    adultoMayorId: adultoIdDeUsuario(db, u),
  };
}

// --- Middlewares ---

// Ademas de comprobar la sesion, deja en req.adultoId el adulto mayor
// sobre el que trabaja esta peticion. Todas las rutas filtran por el: un
// familiar nunca ve datos de otra persona.
function requiereAuth(req, res, next) {
  const db = loadDb();
  const usuario = usuarioDeLaPeticion(req, db);
  if (!usuario) {
    return res.status(401).json({ error: "Necesitas iniciar sesión" });
  }
  req.usuario = usuario;
  req.adultoId = adultoIdDeUsuario(db, usuario);

  // Un familiar con varios adultos a cargo elige con cual trabaja con la
  // cabecera X-Adulto-Id (el frontend la manda sola, ver comun.js). Solo
  // se acepta si de verdad esta vinculado en adultoResponsable: si no,
  // podria leer los datos de cualquier persona cambiando un numero.
  const pedido = Number(req.headers["x-adulto-id"]);
  if (pedido && ROLES_CUIDADOR.includes(usuario.rol)) {
    if (!adultosDeUsuario(db, usuario).includes(pedido)) {
      return res.status(403).json({ error: "No tienes acceso a esta persona" });
    }
    req.adultoId = pedido;
  }
  next();
}

// Para las rutas de datos: sin adulto mayor vinculado no hay nada que ver.
function requiereAdulto(req, res, next) {
  if (!req.adultoId) {
    return res.status(403).json({ error: "No tienes un adulto mayor vinculado" });
  }
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

  res.json({ token, usuario: usuarioPublico(db, usuarioDb) });
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
  res.json({ usuario: usuarioPublico(loadDb(), req.usuario) });
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
// hacer cada uno, definido con requiereRol mas abajo. Todo se filtra por
// req.adultoId: cada usuario solo ve a SU adulto mayor.

app.get("/api/senior", requiereAuth, requiereAdulto, (req, res) => {
  const db = loadDb();
  revisarSenal(db, req.adultoId);
  const vista = vistaSenior(db, req.adultoId);
  if (!vista) {
    return res.status(403).json({ error: "No tienes acceso a esta persona" });
  }
  saveDb(db); // vigilancia() puede haber creado la zona o el monitoreo
  res.json(vista);
});

// Todos los adultos que el familiar tiene a cargo, con su estado, para el
// selector y para pintarlos juntos en el mapa. El principal va primero.
app.get("/api/adultos", requiereAuth, (req, res) => {
  const db = loadDb();
  const ids = adultosDeUsuario(db, req.usuario);
  ids.forEach((id) => revisarSenal(db, id));
  const lista = ids.map((id) => {
    const v = vistaSenior(db, id);
    const vinculo = db.adultoResponsable.find(
      (r) => r.adultoMayorId === id && r.usuarioId === req.usuario.id
    );
    return {
      ...v,
      esPrincipal: !!(vinculo && vinculo.esPrincipal),
      parentesco: vinculo ? vinculo.parentesco || "" : "",
      alertasPendientes: deAdulto(db.alertas, id).filter((a) => a.estado === "pendiente").length,
    };
  });
  saveDb(db);
  res.json(lista);
});

// Ordenados por prioridad (1 = al primero que se avisa), como en el
// backend real.
app.get("/api/contactos", requiereAuth, requiereAdulto, (req, res) => {
  const db = loadDb();
  const lista = deAdulto(db.contactosEmergencia, req.adultoId).sort(
    (a, b) => (a.prioridad || 99) - (b.prioridad || 99)
  );
  res.json(lista);
});

// Con ?todos=1, las de todos los adultos a cargo, cada una con el nombre
// de su adulto: un familiar con dos personas a cargo no puede enterarse
// de una alerta solo si tiene seleccionada a la persona correcta.
app.get("/api/alertas", requiereAuth, requiereAdulto, (req, res) => {
  const db = loadDb();
  const ids = req.query.todos ? adultosDeUsuario(db, req.usuario) : [req.adultoId];
  if (ids.map((id) => revisarSenal(db, id)).some(Boolean)) saveDb(db);
  const nombres = Object.fromEntries(db.adultoMayor.map((a) => [a.id, a.nombreCompleto]));
  const ordenadas = db.alertas
    .filter((a) => ids.includes(a.adultoMayorId))
    .map((a) => ({ ...a, adultoNombre: nombres[a.adultoMayorId] || "" }))
    .sort(
    (a, b) => new Date(b.creadoEn) - new Date(a.creadoEn)
  );
  res.json(ordenadas);
});

// Simula que la pulsera fue escaneada (para probar el flujo de alerta
// de punta a punta sin tener la pulsera fisica todavia).
app.post(
  "/api/alertas/simular-scan",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    const v = vigilancia(db, req.adultoId);
    const nueva = {
      id: siguienteId(db.alertas),
      adultoMayorId: req.adultoId,
      tipo: "qr",
      titulo: "Pulsera escaneada",
      detalle: "Un desconocido escaneo el codigo QR de " + v.adulto.nombreCompleto,
      lugar: "Ubicacion aproximada por GPS del telefono que escaneo",
      creadoEn: new Date().toISOString(),
      estado: "pendiente",
      whatsappEnviado: true,
    };
    db.alertas.push(nueva);
    v.mon.status = "alerta";
    saveDb(db);
    res.status(201).json(nueva);
  }
);

// Resolver una alerta es tarea del cuidador, no del adulto mayor.
app.post(
  "/api/alertas/:id/marcar-atendida",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    const alerta = deAdulto(db.alertas, req.adultoId).find(
      (a) => a.id === Number(req.params.id)
    );
    if (!alerta) return res.status(404).json({ error: "Alerta no encontrada" });
    alerta.estado = "atendida";
    vigilancia(db, req.adultoId).mon.status = hayAlertasPendientes(db, req.adultoId)
      ? "alerta"
      : "presente";
    saveDb(db);
    res.json(alerta);
  }
);

app.post(
  "/api/senior/marcar-visto",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    // Va en su propio campo. Antes pisaba ubicacion.actualizadoEn, y eso
    // hacia pasar una ubicacion de hace horas por una recien leida: justo
    // lo que un cuidador no debe creer.
    vigilancia(db, req.adultoId).mon.revisadoEn = new Date().toISOString();
    saveDb(db);
    res.json(vistaSenior(db, req.adultoId));
  }
);

// ── Zona segura: la define el familiar desde su telefono ──────────────
//
// Dos modos (pedido del usuario tras la primera prueba de campo):
//
//   · "fija"     : centro en una DIRECCION (la casa, un centro de dia).
//                  El familiar la busca y confirma el punto en un mapa.
//   · "cuidador" : la zona SIGUE al familiar. Sirve para salir juntos
//                  (un centro comercial, una cita): avisa si la persona
//                  se aleja mas de X metros de el. Su telefono manda su
//                  posicion a /api/senior/zona-segura/centro.
//
// Se descarto "donde esta el adulto mayor": como la persona se mueve, la
// zona quedaria donde estaba en ese instante, que no significa nada.
//
// Al cambiar de modo o de centro se reinicia el conteo de la geocerca:
// las lecturas acumuladas se midieron contra la zona vieja. Si la persona
// queda fuera, las siguientes lecturas lo confirman y salta la alerta
// como siempre. En el modo "cuidador", cada nuevo centro NO reinicia
// nada: es la misma zona moviendose.

// El familiar escribe el radio con su unidad (m o km). Por debajo de 50 m
// el ruido del GPS (10-50 m en ciudad) haria saltar alertas falsas; 20 km
// ya cubre una ciudad entera.
const RADIO_MIN_M = 50;
const RADIO_MAX_M = 20000;

function esCoordenada(lat, lng) {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

function reiniciarConteo(db, adultoId, mon) {
  const seg = mon.seguimiento;
  seg.estaFuera = false;
  seg.lecturasFuera = 0;
  seg.lecturasDentro = 0;
  mon.status = hayAlertasPendientes(db, adultoId) ? "alerta" : "presente";
}

app.post(
  "/api/senior/zona-segura",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const { modo, lat, lng, radioM, direccion } = req.body || {};
    const db = loadDb();
    const { zona, mon } = vigilancia(db, req.adultoId);

    if (radioM != null && (typeof radioM !== "number" || radioM < RADIO_MIN_M || radioM > RADIO_MAX_M)) {
      return res.status(400).json({ error: "El radio debe estar entre 50 m y 20 km" });
    }
    if (modo != null && !["fija", "cuidador"].includes(modo)) {
      return res.status(400).json({ error: "Modo de zona no válido" });
    }
    if (!modo && (lat != null || lng != null)) {
      return res.status(400).json({ error: "Indica el modo de la zona (fija o cuidador)" });
    }
    if (modo && !esCoordenada(lat, lng)) {
      return res.status(400).json({ error: "Coordenadas no válidas" });
    }

    if (modo === "fija") {
      Object.assign(zona, {
        modo: "fija",
        lat,
        lng,
        direccion: limpiarTexto(direccion, 200),
        cuidadorId: null,
        centroEn: new Date().toISOString(),
      });
    } else if (modo === "cuidador") {
      Object.assign(zona, {
        modo: "cuidador",
        lat,
        lng,
        direccion: "",
        cuidadorId: req.usuario.id,
        centroEn: new Date().toISOString(),
      });
    }
    if (radioM != null) zona.radioM = Math.round(radioM);

    // ultimaLectura se conserva: el guardia de velocidad mide como se
    // mueve la persona, y eso no cambia porque se mueva la zona.
    reiniciarConteo(db, req.adultoId, mon);
    saveDb(db);
    res.json(vistaSenior(db, req.adultoId).zonaSegura);
  }
);

// El telefono del familiar, en el modo "cuidador", manda aqui su posicion
// cada 10 s. Solo la acepta del familiar que activo el modo: si otro
// familiar pudiera moverla, la zona saltaria entre dos personas.
app.post(
  "/api/senior/zona-segura/centro",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const { lat, lng, precision } = req.body || {};
    if (!esCoordenada(lat, lng)) {
      return res.status(400).json({ error: "Coordenadas no válidas" });
    }
    const db = loadDb();
    const { zona } = vigilancia(db, req.adultoId);
    if (zona.modo !== "cuidador" || zona.cuidadorId !== req.usuario.id) {
      return res.status(409).json({ error: "La zona no está siguiendo a este teléfono" });
    }
    // Igual que con el adulto mayor: una lectura imprecisa moveria la
    // zona decenas de metros sin motivo y podria fabricar una salida.
    if (typeof precision === "number" && precision > GEOCERCA.precisionMaximaM) {
      return res.json({ aceptada: false, motivo: `Precisión de ${Math.round(precision)} m` });
    }
    zona.lat = lat;
    zona.lng = lng;
    zona.centroEn = new Date().toISOString();
    saveDb(db);
    res.json({ aceptada: true });
  }
);

// Buscar una direccion para la zona fija. Usa Photon (el mismo de la
// direccion en texto), limitado a Colombia y sesgado hacia la zona
// actual. OJO: con las direcciones de Bogota acierta poco ("Calle 181
// 13-54" devolvio la Calle 44), por eso la pantalla SIEMPRE muestra el
// punto en un mapa para que el familiar lo confirme o lo arrastre.
const BBOX_COLOMBIA = "-79.1,-4.3,-66.8,12.5";

app.get(
  "/api/geocodificar",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  async (req, res) => {
    const q = limpiarTexto(req.query.q, 150);
    if (q.length < 3) return res.status(400).json({ error: "Escribe una dirección" });
    const db = loadDb();
    const { zona } = vigilancia(db, req.adultoId);
    const url =
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5` +
      `&bbox=${BBOX_COLOMBIA}&lat=${zona.lat}&lon=${zona.lng}`;
    try {
      const datos = await pedirJson(url);
      const resultados = (datos.features || []).map((f) => {
        const p = f.properties || {};
        const via = [p.street || (p.type === "street" ? p.name : ""), p.housenumber]
          .filter(Boolean).join(" #");
        const etiqueta = [
          p.type !== "street" && p.name !== p.street ? p.name : "",
          via,
          p.locality || p.district,
          p.city,
        ].filter(Boolean).join(", ");
        return {
          etiqueta: etiqueta || p.name || q,
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
        };
      });
      res.json(resultados);
    } catch (err) {
      res.status(502).json({ error: "No se pudo buscar la dirección. Marca el punto en el mapa." });
    }
  }
);


// --- Validaciones comunes ------------------------------------------------

const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// AAAA-MM-DD y que la fecha exista de verdad: "2026-02-31" cumple el
// patron pero no es un dia real, y JavaScript la corre al 3 de marzo sin
// avisar. Una cita medica en un dia equivocado es peor que no tenerla.
function esFechaValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(texto + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function limpiarTexto(valor, maximo) {
  return String(valor == null ? "" : valor).trim().slice(0, maximo);
}

// --- Recordatorios -------------------------------------------------------
// Tareas del dia del adulto mayor (tomar algo, una caminata, llamar a
// alguien). Los crea el cuidador y los marca como hechos el adulto mayor.
// NO existen en el backend real: es una tabla propia.
//
// Las citas medicas ya NO son recordatorios: desde el 2026-10-12 tienen
// su propia coleccion, citasMedicas, igual que la tabla citas_medicas del
// backend real (migracion 63).

const TIPOS_RECORDATORIO = ["medicamento", "otro"];

// Ordena por hora del dia; los ya marcados como hechos se van al final.
function ordenarRecordatorios(lista) {
  return [...lista].sort((a, b) => {
    if (a.hecho !== b.hecho) return a.hecho ? 1 : -1;
    return (a.hora || "").localeCompare(b.hora || "");
  });
}

app.get("/api/recordatorios", requiereAuth, requiereAdulto, (req, res) => {
  const db = loadDb();
  res.json(ordenarRecordatorios(deAdulto(db.recordatorios, req.adultoId)));
});

// Crear y borrar recordatorios es del cuidador; marcarlos como hechos es
// del adulto mayor (es quien se toma la pastilla). Por eso el permiso de
// "alternar-hecho" mas abajo es distinto al de estos dos.
app.post(
  "/api/recordatorios",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const { titulo, detalle, hora, fecha, tipo } = req.body || {};

    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: "El titulo es obligatorio" });
    }
    if (tipo === "cita") {
      return res
        .status(400)
        .json({ error: "Las citas médicas se registran en Citas, no como recordatorio" });
    }
    // La hora es opcional, pero si viene tiene que ser HH:MM (24h).
    if (hora && !RE_HORA.test(hora)) {
      return res.status(400).json({ error: "La hora debe tener formato HH:MM" });
    }
    if (fecha && !esFechaValida(fecha)) {
      return res.status(400).json({ error: "La fecha debe tener formato AAAA-MM-DD" });
    }

    const db = loadDb();
    const nuevo = {
      id: siguienteId(db.recordatorios),
      adultoMayorId: req.adultoId,
      tipo: TIPOS_RECORDATORIO.includes(tipo) ? tipo : "otro",
      titulo: limpiarTexto(titulo, 80),
      detalle: limpiarTexto(detalle, 120),
      fecha: fecha || "",
      hora: hora || "",
      hecho: false,
      creadoEn: new Date().toISOString(),
    };

    db.recordatorios.push(nuevo);
    saveDb(db);
    res.status(201).json(nuevo);
  }
);

// Este SI lo pueden usar los dos roles: el adulto mayor marca que ya se
// tomo la pastilla, y el cuidador tambien puede hacerlo por el.
// Alterna en vez de solo marcar, para poder deshacer un toque accidental.
app.post(
  "/api/recordatorios/:id/alternar-hecho",
  requiereAuth,
  requiereAdulto,
  (req, res) => {
    const db = loadDb();
    const rec = deAdulto(db.recordatorios, req.adultoId).find(
      (r) => r.id === Number(req.params.id)
    );
    if (!rec) return res.status(404).json({ error: "Recordatorio no encontrado" });
    rec.hecho = !rec.hecho;
    saveDb(db);
    res.json(rec);
  }
);

app.delete(
  "/api/recordatorios/:id",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const rec = deAdulto(db.recordatorios, req.adultoId).find((r) => r.id === id);
    if (!rec) return res.status(404).json({ error: "Recordatorio no encontrado" });
    db.recordatorios = db.recordatorios.filter((r) => r !== rec);
    saveDb(db);
    res.json({ ok: true });
  }
);

// --- Medicamentos --------------------------------------------------------
//
// El tratamiento del adulto mayor. Mismas columnas que la tabla
// `medicamentos` del backend real (nombre, dosis, frecuencia, horario,
// via_administracion, fecha_inicio, fecha_fin, notas, activo).
//
// ── LAS HORAS VAN APARTE ───────────────────────────────────────────────
// Igual que la migracion 64 del backend real: cada hora de toma es una
// fila de medicamentoHoras (medicamento_horas), no un texto libre. Sobre
// "7:00 AM y 7:00 PM" o "con las comidas" no se puede programar ningun
// aviso; sobre una lista de horas si. `horario` se sigue rellenando, pero
// como texto de presentacion derivado de las horas, que es lo que lee el
// perfil del QR en el backend real.
//
// ── POR QUE ESTA SEPARADO DE LOS RECORDATORIOS ─────────────────────────
//   · Un MEDICAMENTO es el tratamiento. Vive mientras el medico lo
//     mantenga y lo administra el cuidador.
//   · Un RECORDATORIO es una tarea de hoy que se marca como hecha.
// Si fueran lo mismo, marcar "ya me la tome" borraria el medicamento.
//
// Un medicamento no se borra al suspenderlo: se marca `activo: false`.
// El historial de lo que tomo alguien es informacion clinica.

function horaLegible(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const sufijo = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

function horarioDesdeHoras(horas) {
  const partes = horas.map(horaLegible);
  if (partes.length <= 1) return partes.join("");
  return partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
}

/** Valida y ordena la lista de horas. Devuelve { horas } o { error }. */
function leerHoras(valor) {
  if (valor == null) return { horas: null };
  if (!Array.isArray(valor)) return { error: "Las horas deben ser una lista" };
  const horas = [...new Set(valor.map((h) => String(h).trim()).filter(Boolean))];
  if (horas.some((h) => !RE_HORA.test(h))) {
    return { error: "Cada hora debe tener formato HH:MM" };
  }
  if (horas.length > 8) return { error: "Máximo 8 horas de toma" };
  return { horas: horas.sort() };
}

function guardarHoras(db, med, horas) {
  db.medicamentoHoras = db.medicamentoHoras.filter((h) => h.medicamentoId !== med.id);
  for (const hora of horas) {
    db.medicamentoHoras.push({
      id: siguienteId(db.medicamentoHoras),
      medicamentoId: med.id,
      hora,
    });
  }
  med.horario = horarioDesdeHoras(horas);
}

function conHoras(db, med) {
  const horas = db.medicamentoHoras
    .filter((h) => h.medicamentoId === med.id)
    .map((h) => h.hora)
    .sort();
  return { ...med, horas };
}

function leerFechaOpcional(valor, nombre) {
  if (valor == null || valor === "") return { fecha: null };
  if (!esFechaValida(String(valor))) {
    return { error: `${nombre} debe tener formato AAAA-MM-DD` };
  }
  return { fecha: String(valor) };
}

app.get("/api/medicamentos", requiereAuth, requiereAdulto, (req, res) => {
  const db = loadDb();
  const lista = deAdulto(db.medicamentos, req.adultoId)
    .map((m) => conHoras(db, m))
    .sort((a, b) => {
      // Los suspendidos al final; el resto por nombre.
      if (!!a.activo !== !!b.activo) return a.activo ? -1 : 1;
      return String(a.nombre).localeCompare(String(b.nombre), "es");
    });
  res.json(lista);
});

app.post(
  "/api/medicamentos",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const c = req.body || {};
    if (!c.nombre || !String(c.nombre).trim()) {
      return res.status(400).json({ error: "El nombre del medicamento es obligatorio" });
    }
    const h = leerHoras(c.horas);
    const ini = leerFechaOpcional(c.fechaInicio, "La fecha de inicio");
    const fin = leerFechaOpcional(c.fechaFin, "La fecha de fin");
    const fallo = h.error || ini.error || fin.error;
    if (fallo) return res.status(400).json({ error: fallo });
    if (ini.fecha && fin.fecha && fin.fecha < ini.fecha) {
      return res.status(400).json({ error: "La fecha de fin es anterior a la de inicio" });
    }

    const db = loadDb();
    const nuevo = {
      id: siguienteId(db.medicamentos),
      adultoMayorId: req.adultoId,
      nombre: limpiarTexto(c.nombre, 150),
      dosis: limpiarTexto(c.dosis, 100),
      frecuencia: limpiarTexto(c.frecuencia, 100),
      horario: "",
      viaAdministracion: limpiarTexto(c.viaAdministracion, 100),
      fechaInicio: ini.fecha,
      fechaFin: fin.fecha,
      notas: limpiarTexto(c.notas, 300),
      activo: true,
      fechaCreacion: new Date().toISOString(),
    };
    db.medicamentos.push(nuevo);
    guardarHoras(db, nuevo, h.horas || []);
    saveDb(db);
    res.status(201).json(conHoras(db, nuevo));
  }
);

app.put(
  "/api/medicamentos/:id",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    const med = deAdulto(db.medicamentos, req.adultoId).find(
      (m) => m.id === Number(req.params.id)
    );
    if (!med) return res.status(404).json({ error: "Medicamento no encontrado" });

    const c = req.body || {};
    if (c.nombre !== undefined && !String(c.nombre).trim()) {
      return res.status(400).json({ error: "El nombre del medicamento es obligatorio" });
    }
    const h = leerHoras(c.horas);
    const ini = c.fechaInicio !== undefined ? leerFechaOpcional(c.fechaInicio, "La fecha de inicio") : {};
    const fin = c.fechaFin !== undefined ? leerFechaOpcional(c.fechaFin, "La fecha de fin") : {};
    const fallo = h.error || ini.error || fin.error;
    if (fallo) return res.status(400).json({ error: fallo });

    if (c.nombre !== undefined) med.nombre = limpiarTexto(c.nombre, 150);
    if (c.dosis !== undefined) med.dosis = limpiarTexto(c.dosis, 100);
    if (c.frecuencia !== undefined) med.frecuencia = limpiarTexto(c.frecuencia, 100);
    if (c.viaAdministracion !== undefined)
      med.viaAdministracion = limpiarTexto(c.viaAdministracion, 100);
    if (c.notas !== undefined) med.notas = limpiarTexto(c.notas, 300);
    if (c.fechaInicio !== undefined) med.fechaInicio = ini.fecha;
    if (c.fechaFin !== undefined) med.fechaFin = fin.fecha;
    if (med.fechaInicio && med.fechaFin && med.fechaFin < med.fechaInicio) {
      return res.status(400).json({ error: "La fecha de fin es anterior a la de inicio" });
    }
    if (h.horas) guardarHoras(db, med, h.horas);
    // Suspender o retomar un tratamiento.
    if (c.activo !== undefined) med.activo = !!c.activo;

    saveDb(db);
    res.json(conHoras(db, med));
  }
);

app.delete(
  "/api/medicamentos/:id",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const med = deAdulto(db.medicamentos, req.adultoId).find((m) => m.id === id);
    if (!med) return res.status(404).json({ error: "Medicamento no encontrado" });
    db.medicamentos = db.medicamentos.filter((m) => m !== med);
    // ON DELETE CASCADE, como la FK de medicamento_horas.
    db.medicamentoHoras = db.medicamentoHoras.filter((h) => h.medicamentoId !== id);
    saveDb(db);
    res.json({ ok: true });
  }
);

// --- Citas medicas -------------------------------------------------------
//
// Mismas columnas que la tabla citas_medicas del backend real (migracion
// 63): especialidad, profesional, institucion, direccion, notas,
// fecha_hora, estado (programada | cumplida | cancelada), antelaciones.
// `fechaHora` va como "AAAA-MM-DDTHH:MM", hora local de Colombia, igual
// que un DATETIME de MySQL.
//
// En el backend real especialidad, profesional, institucion, direccion y
// notas van CIFRADOS (AES-256-GCM): son datos de salud. Aqui van en claro
// porque son inventados; al acoplar se leen por su repositorio.
//
// La crea y la edita el cuidador; las ven los dos.

const ESTADOS_CITA = ["programada", "cumplida", "cancelada"];
const RE_FECHA_HORA = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d$/;

function leerCita(c, parcial) {
  const datos = {};
  if (!parcial || c.especialidad !== undefined) {
    if (!c.especialidad || !String(c.especialidad).trim()) {
      return { error: "La especialidad es obligatoria" };
    }
    datos.especialidad = limpiarTexto(c.especialidad, 120);
  }
  if (!parcial || c.fechaHora !== undefined) {
    const m = RE_FECHA_HORA.exec(String(c.fechaHora || ""));
    if (!m || !esFechaValida(m[1])) {
      return { error: "La fecha y la hora de la cita son obligatorias" };
    }
    datos.fechaHora = String(c.fechaHora);
  }
  for (const [campo, max] of [
    ["profesional", 120], ["institucion", 150], ["direccion", 200], ["notas", 400],
  ]) {
    if (!parcial || c[campo] !== undefined) datos[campo] = limpiarTexto(c[campo], max);
  }
  if (c.estado !== undefined) {
    if (!ESTADOS_CITA.includes(c.estado)) return { error: "Estado de cita no válido" };
    datos.estado = c.estado;
  }
  return { datos };
}

// Las programadas primero, de la mas proxima a la mas lejana; despues el
// resto, de la mas reciente a la mas vieja.
function ordenarCitas(lista) {
  return [...lista].sort((a, b) => {
    const pa = a.estado === "programada", pb = b.estado === "programada";
    if (pa !== pb) return pa ? -1 : 1;
    return pa ? a.fechaHora.localeCompare(b.fechaHora) : b.fechaHora.localeCompare(a.fechaHora);
  });
}

app.get("/api/citas", requiereAuth, requiereAdulto, (req, res) => {
  const db = loadDb();
  res.json(ordenarCitas(deAdulto(db.citasMedicas, req.adultoId)));
});

app.post(
  "/api/citas",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const { datos, error } = leerCita(req.body || {}, false);
    if (error) return res.status(400).json({ error });
    const db = loadDb();
    const nueva = {
      id: siguienteId(db.citasMedicas),
      adultoMayorId: req.adultoId,
      ...datos,
      estado: datos.estado || "programada",
      antelaciones: null,
      creadoPor: req.usuario.id,
      creadoEn: new Date().toISOString(),
    };
    db.citasMedicas.push(nueva);
    saveDb(db);
    res.status(201).json(nueva);
  }
);

app.put(
  "/api/citas/:id",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    const cita = deAdulto(db.citasMedicas, req.adultoId).find(
      (c) => c.id === Number(req.params.id)
    );
    if (!cita) return res.status(404).json({ error: "Cita no encontrada" });
    const { datos, error } = leerCita(req.body || {}, true);
    if (error) return res.status(400).json({ error });
    Object.assign(cita, datos, { actualizadoEn: new Date().toISOString() });
    saveDb(db);
    res.json(cita);
  }
);

app.delete(
  "/api/citas/:id",
  requiereAuth,
  requiereAdulto,
  requiereRol(...ROLES_CUIDADOR),
  (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const cita = deAdulto(db.citasMedicas, req.adultoId).find((c) => c.id === id);
    if (!cita) return res.status(404).json({ error: "Cita no encontrada" });
    db.citasMedicas = db.citasMedicas.filter((c) => c !== cita);
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

function crearAlertaZona(db, adultoId, { titulo, detalle, lugar, estado }) {
  const alerta = {
    id: siguienteId(db.alertas),
    adultoMayorId: adultoId,
    tipo: "zona",
    titulo,
    detalle,
    lugar,
    creadoEn: new Date().toISOString(),
    estado,
    whatsappEnviado: true,
  };
  db.alertas.push(alerta);
  return alerta;
}

// Devuelve que hacer con una lectura, y modifica db si corresponde.
function evaluarUbicacion(db, adultoId, { lat, lng, precision }) {
  const { adulto, zona, mon } = vigilancia(db, adultoId);
  const seg = mon.seguimiento;
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
        alerta = crearAlertaZona(db, adultoId, {
          titulo: "Salió de la zona segura",
          detalle: `${adulto.nombreCompleto} está a ${Math.round(
            distancia
          )} m del centro de su zona segura (radio ${zona.radioM} m)`,
          lugar: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          estado: "pendiente",
        });
        mon.status = "alerta";
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
        alerta = crearAlertaZona(db, adultoId, {
          titulo: "Volvió a la zona segura",
          detalle: `${adulto.nombreCompleto} está de nuevo dentro de su zona segura`,
          lugar: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          estado: "atendida",
        });
        mon.status = hayAlertasPendientes(db, adultoId) ? "alerta" : "presente";
      }
    } else {
      seg.lecturasDentro = 0;
    }
  }

  mon.ubicacion.lat = lat;
  mon.ubicacion.lng = lng;
  mon.ubicacion.actualizadoEn = ahora.toISOString();
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
function actualizarDireccionEnSegundoPlano(adultoId, lat, lng) {
  geocodificarInverso(lat, lng)
    .then((r) => {
      if (!r) return; // frenado por el intervalo minimo; ya se reintentara
      const db = loadDb();
      const ubic = vigilancia(db, adultoId).mon.ubicacion;
      ubic.direccion = r.texto;
      ubic.direccionLat = lat;
      ubic.direccionLng = lng;
      ubic.direccionEn = new Date().toISOString();
      ubic.direccionFallo = null;
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
        vigilancia(db, adultoId).mon.ubicacion.direccionFallo = {
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
// simulador deberian desaparecer. Sin sesion trabajan sobre el adulto
// mayor que digan (`adultoMayorId` en el cuerpo o en la consulta) o, si
// no dicen nada, sobre el primero.

// Aqui reporta el telefono del adulto mayor (y el simulador, sin sesion).
app.post("/api/ubicacion", (req, res) => {
  const { lat, lng, precision, fuente, adultoMayorId } = req.body || {};

  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat y lng deben ser numeros" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Coordenadas fuera de rango" });
  }

  const db = loadDb();

  // Si la peticion trae sesion, tiene que ser la del PROPIO adulto mayor,
  // y reporta por si mismo. Un cuidador no puede mover la ubicacion de la
  // persona a su cargo: seria poder fabricar una salida de zona segura, o
  // taparla.
  const usuario = usuarioDeLaPeticion(req, db);
  if (usuario && usuario.rol !== "adulto_mayor") {
    return res
      .status(403)
      .json({ error: "Solo el adulto mayor puede reportar su ubicación" });
  }
  const adultoId = usuario
    ? adultoIdDeUsuario(db, usuario)
    : adultoSinSesion(db, adultoMayorId);
  if (!adultoId) {
    return res.status(403).json({ error: "No hay un adulto mayor para esta lectura" });
  }

  const resultado = evaluarUbicacion(db, adultoId, { lat, lng, precision });
  const { adulto, zona, mon } = vigilancia(db, adultoId);

  // Cualquier reporte del telefono (aunque la lectura se descarte por
  // imprecisa) demuestra que sigue vivo. Es lo que vigila revisarSenal().
  if (usuario) {
    mon.compartiendo = true;
    mon.ultimoReporte = new Date().toISOString();
    if (mon.senalPerdidaAlertada) {
      mon.senalPerdidaAlertada = false;
      db.alertas.push({
        id: siguienteId(db.alertas),
        adultoMayorId: adultoId,
        tipo: "senal",
        titulo: "Volvió a enviar su ubicación",
        detalle: `El teléfono de ${adulto.nombreCompleto} vuelve a compartir su ubicación.`,
        lugar: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        creadoEn: new Date().toISOString(),
        estado: "atendida",
        whatsappEnviado: false,
      });
    }
  }

  // De donde vino la lectura. El panel del cuidador necesita distinguir
  // "esto es el GPS del telefono de mi mama, ahora mismo" de "esto es el
  // dato de ejemplo con el que arranca la app".
  if (resultado.aceptada) {
    const esGps = fuente === "gps" || !!usuario;
    mon.ubicacion.fuente = esGps ? "gps" : "simulador";
    mon.ubicacion.precision =
      typeof precision === "number" ? Math.round(precision) : null;
    if (esGps) {
      // La direccion del seed es inventada; dejarla puesta junto a unas
      // coordenadas reales haria creer que la persona esta en una calle
      // donde no esta. Se pone un texto neutro hasta que llegue la real.
      if (necesitaDireccion(mon.ubicacion, lat, lng)) {
        if (!mon.ubicacion.direccionLat) {
          mon.ubicacion.direccion = "Buscando la dirección…";
        }
        // Sin await: la respuesta al telefono no espera a Photon.
        actualizarDireccionEnSegundoPlano(adultoId, lat, lng);
      }
    }
  }

  saveDb(db);
  res.json({
    ...resultado,
    config: GEOCERCA,
    zonaSegura: { lat: zona.lat, lng: zona.lng, radioM: zona.radioM },
  });
});

// El adulto mayor pulso "Dejar de compartir" (o cerro sesion). Asi el
// silencio que sigue es voluntario y no dispara la alerta de señal
// perdida. El cuidador lo ve como "dejó de compartir".
app.post(
  "/api/ubicacion/detener",
  requiereAuth,
  requiereAdulto,
  requiereRol("adulto_mayor"),
  (req, res) => {
    const db = loadDb();
    const { mon } = vigilancia(db, req.adultoId);
    mon.compartiendo = false;
    mon.senalPerdidaAlertada = false;
    saveDb(db);
    res.json({ ok: true });
  }
);

app.get("/api/zona-segura", (req, res) => {
  const db = loadDb();
  const adultoId = adultoSinSesion(db, req.query.adultoMayorId);
  if (!adultoId) return res.status(404).json({ error: "No hay adultos mayores" });
  const { zona, mon } = vigilancia(db, adultoId);
  res.json({
    lat: zona.lat,
    lng: zona.lng,
    radioM: zona.radioM,
    config: GEOCERCA,
    seguimiento: mon.seguimiento,
    ubicacionActual: mon.ubicacion,
  });
});

app.post("/api/zona-segura", (req, res) => {
  const { lat, lng, radioM, adultoMayorId } = req.body || {};
  const db = loadDb();
  const adultoId = adultoSinSesion(db, adultoMayorId);
  if (!adultoId) return res.status(404).json({ error: "No hay adultos mayores" });
  const { zona } = vigilancia(db, adultoId);

  if (typeof lat === "number") zona.lat = lat;
  if (typeof lng === "number") zona.lng = lng;
  if (typeof radioM === "number") {
    if (radioM < RADIO_MIN_M || radioM > RADIO_MAX_M) {
      return res
        .status(400)
        .json({ error: "El radio debe estar entre 50 m y 20 km" });
    }
    zona.radioM = radioM;
  }

  saveDb(db);
  res.json({ lat: zona.lat, lng: zona.lng, radioM: zona.radioM });
});

// Deja todo como al principio para poder repetir una demo.
app.post("/api/simulador/reiniciar", (req, res) => {
  const db = loadDb();
  const adultoId = adultoSinSesion(db, (req.body || {}).adultoMayorId);
  if (!adultoId) return res.status(404).json({ error: "No hay adultos mayores" });
  const { zona, mon } = vigilancia(db, adultoId);

  mon.seguimiento = {
    estaFuera: false,
    lecturasFuera: 0,
    lecturasDentro: 0,
    ultimaLectura: null,
  };
  const monSeed = JSON.parse(fs.readFileSync(SEED_PATH, "utf-8")).monitoreo.find(
    (m) => m.adultoMayorId === adultoId
  );
  mon.ubicacion = {
    // La direccion de ejemplo del seed, si la hay.
    direccion: monSeed ? monSeed.ubicacion.direccion : "",
    lat: zona.lat,
    lng: zona.lng,
    actualizadoEn: new Date().toISOString(),
    // Tambien el origen: si no, tras una prueba con GPS real el panel
    // seguiria diciendo "EN VIVO" sobre una posicion que ya es de mentira.
    fuente: "simulador",
    precision: null,
    // Y la direccion resuelta, o la siguiente lectura no volveria a
    // preguntarla por creer que ya la tiene.
    direccionLat: null,
    direccionLng: null,
    direccionEn: null,
  };
  mon.compartiendo = false;
  mon.ultimoReporte = null;
  mon.senalPerdidaAlertada = false;
  db.alertas = db.alertas.filter(
    (a) => !(a.adultoMayorId === adultoId && (a.tipo === "zona" || a.tipo === "senal"))
  );
  mon.status = hayAlertasPendientes(db, adultoId) ? "alerta" : "presente";
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
