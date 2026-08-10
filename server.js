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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\nConecta Senior corriendo en:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\nPara verlo en tu iPhone (misma red WiFi que esta compu):`);
  console.log(`  1. Busca la IP local de esta computadora (ver README.md)`);
  console.log(`  2. Abre esa IP con el puerto ${PORT} en Safari, ej: http://192.168.1.23:${PORT}`);
  console.log(`  3. Toca compartir > "Agregar a pantalla de inicio"\n`);
});
