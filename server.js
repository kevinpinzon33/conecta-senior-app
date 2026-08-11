const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "db.json");
const SEED_PATH = path.join(__dirname, "db.seed.json");

// --- "Base de datos" ---------------------------------------------------
// Un archivo JSON en disco. Es intencionalmente simple: alcanza para
// probar el flujo completo (leer perfil, listar alertas, crear una
// alerta nueva, marcar como revisado). Cuando tengan su base de datos
// real, este archivo se reemplaza por las llamadas a whatsapp.service.js
// y alerta.controller.js sin tocar el frontend.

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.copyFileSync(SEED_PATH, DB_PATH);
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- API -----------------------------------------------------------------

app.get("/api/senior", (req, res) => {
  const db = loadDb();
  res.json(db.senior);
});

app.get("/api/contactos", (req, res) => {
  const db = loadDb();
  res.json(db.contactos);
});

app.get("/api/alertas", (req, res) => {
  const db = loadDb();
  const ordenadas = [...db.alertas].sort(
    (a, b) => new Date(b.creadoEn) - new Date(a.creadoEn)
  );
  res.json(ordenadas);
});

// Simula que la pulsera fue escaneada (para probar el flujo de alerta
// de punta a punta sin tener la pulsera fisica todavia).
app.post("/api/alertas/simular-scan", (req, res) => {
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
});

app.post("/api/alertas/:id/marcar-atendida", (req, res) => {
  const db = loadDb();
  const alerta = db.alertas.find((a) => a.id === Number(req.params.id));
  if (!alerta) return res.status(404).json({ error: "Alerta no encontrada" });
  alerta.estado = "atendida";
  const hayPendientes = db.alertas.some((a) => a.estado === "pendiente");
  db.senior.status = hayPendientes ? "alerta" : "presente";
  saveDb(db);
  res.json(alerta);
});

app.post("/api/senior/marcar-visto", (req, res) => {
  const db = loadDb();
  db.senior.ubicacion.actualizadoEn = new Date().toISOString();
  saveDb(db);
  res.json(db.senior);
});

// --- Recordatorios -------------------------------------------------------
// Medicamentos, citas y rutinas del adulto mayor. A diferencia de las
// alertas (que las dispara el sistema), estos los crea el cuidador a mano
// desde la pantalla de Inicio.

const TIPOS_RECORDATORIO = ["medicamento", "cita", "otro"];

// Ordena por hora del dia; los ya marcados como hechos se van al final.
function ordenarRecordatorios(lista) {
  return [...lista].sort((a, b) => {
    if (a.hecho !== b.hecho) return a.hecho ? 1 : -1;
    return (a.hora || "").localeCompare(b.hora || "");
  });
}

app.get("/api/recordatorios", (req, res) => {
  const db = loadDb();
  res.json(ordenarRecordatorios(db.recordatorios || []));
});

app.post("/api/recordatorios", (req, res) => {
  const { titulo, detalle, hora, tipo } = req.body || {};

  if (!titulo || !String(titulo).trim()) {
    return res.status(400).json({ error: "El titulo es obligatorio" });
  }
  // La hora es opcional, pero si viene tiene que ser HH:MM (24h).
  if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
    return res.status(400).json({ error: "La hora debe tener formato HH:MM" });
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
    hecho: false,
    creadoEn: new Date().toISOString(),
  };

  db.recordatorios.push(nuevo);
  db.nextRecordatorioId += 1;
  saveDb(db);
  res.status(201).json(nuevo);
});

// Alterna entre hecho y pendiente, para que se pueda deshacer un toque
// accidental sin tener que borrar el recordatorio.
app.post("/api/recordatorios/:id/alternar-hecho", (req, res) => {
  const db = loadDb();
  const rec = (db.recordatorios || []).find(
    (r) => r.id === Number(req.params.id)
  );
  if (!rec) return res.status(404).json({ error: "Recordatorio no encontrado" });
  rec.hecho = !rec.hecho;
  saveDb(db);
  res.json(rec);
});

app.delete("/api/recordatorios/:id", (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  const antes = (db.recordatorios || []).length;
  db.recordatorios = (db.recordatorios || []).filter((r) => r.id !== id);
  if (db.recordatorios.length === antes) {
    return res.status(404).json({ error: "Recordatorio no encontrado" });
  }
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
