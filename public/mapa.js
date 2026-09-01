// Mapa real de Google dentro de la app.
//
// Sustituye al mapa estilizado (que era un SVG con cuatro calles
// inventadas) por uno de verdad, con calles, edificios y la posición
// exacta de la persona.
//
// ── DOS DECISIONES QUE SOSTIENEN ESTE ARCHIVO ─────────────────────
//
// 1. SI NO HAY CLAVE, NO SE ROMPE NADA.
//    El mapa de Google exige una clave de API. Si no está configurada,
//    `hayMapaReal()` devuelve false y la vista dibuja el mapa
//    estilizado de siempre. La app funciona igual, solo se ve menos
//    preciso. Así el despliegue no depende de que alguien recuerde
//    poner una variable de entorno.
//
// 2. EL MAPA SE CREA UNA SOLA VEZ Y SE MUEVE, NO SE RECREA.
//    La pantalla se repinta entera cada 15 segundos (refreshAll ->
//    innerHTML). Si el mapa viviera dentro de ese HTML, en cada
//    refresco se destruiría y se volvería a crear: parpadeo, pérdida
//    del zoom que el usuario había puesto, y —lo que de verdad
//    importa— una carga de mapa facturable cada 15 segundos, que son
//    240 por hora y por cuidador.
//
//    Por eso el nodo del mapa vive fuera del ciclo de render, guardado
//    en `nodoMapa`, y después de cada repintado se MUEVE a su hueco con
//    appendChild. Mover un nodo conserva el mapa vivo.

const Mapa = {
  config: null, // { proveedor, apiKey } — lo entrega GET /api/config
  cargando: null, // promesa de carga del script, para no pedirlo dos veces
  nodoMapa: null, // el div persistente que contiene el mapa
  mapa: null, // instancia de google.maps.Map
  marcador: null,
  circuloPrecision: null,
  circuloZona: null,
  ultimoCentrado: null, // para no re-centrar en cada repintado
};

function hayMapaReal() {
  return !!(Mapa.config && Mapa.config.proveedor === "google" && Mapa.config.apiKey);
}

/** Se llama una vez al entrar. Si falla, se sigue con el mapa estilizado. */
async function cargarConfigMapa() {
  try {
    const cfg = await api("/config");
    Mapa.config = cfg.mapa || null;
  } catch (_) {
    Mapa.config = null;
  }
}

// ── Carga del script de Google ───────────────────────────────────

function cargarScriptGoogle() {
  if (Mapa.cargando) return Mapa.cargando;

  Mapa.cargando = new Promise((resolver, rechazar) => {
    if (window.google && window.google.maps) return resolver();

    const s = document.createElement("script");
    s.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(Mapa.config.apiKey) +
      "&language=es&region=CO&loading=async";
    s.async = true;
    s.onload = () => resolver();
    // Clave inválida, sin conexión o dominio no autorizado: se resuelve
    // como fallo y la vista cae al mapa estilizado en vez de quedarse
    // con un recuadro gris para siempre.
    s.onerror = () => rechazar(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });

  return Mapa.cargando;
}

// ── Estilo oscuro, para que no desentone con la app ──────────────
// Es el mapa de Google con los colores de la marca; sin esto aparece un
// rectángulo blanco brillante en medio de una interfaz oscura.
const ESTILO_OSCURO = [
  { elementType: "geometry", stylers: [{ color: "#1f2530" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#181b21" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9a9080" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#8a8272" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1d2a24" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2e3440" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9a9080" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a4152" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#252931" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#141a24" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4e5a6b" }] },
];

const COLOR = {
  presente: "#2E9E5E",
  cuidado: "#E8A33D",
  alerta: "#E8622C",
};

function crearMapa(s) {
  Mapa.nodoMapa = document.createElement("div");
  Mapa.nodoMapa.className = "mapa-google";

  const centro = { lat: s.ubicacion.lat, lng: s.ubicacion.lng };

  Mapa.mapa = new google.maps.Map(Mapa.nodoMapa, {
    center: centro,
    zoom: 16,
    styles: ESTILO_OSCURO,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy", // dentro de la app, un dedo basta para mover
    clickableIcons: false,
  });

  // Zona segura
  Mapa.circuloZona = new google.maps.Circle({
    map: Mapa.mapa,
    center: { lat: s.zonaSegura.lat, lng: s.zonaSegura.lng },
    radius: s.zonaSegura.radioM,
    strokeColor: COLOR.presente,
    strokeOpacity: 0.85,
    strokeWeight: 2,
    fillColor: COLOR.presente,
    fillOpacity: 0.08,
    clickable: false,
  });

  // Margen de error del GPS. Dibujarlo es honesto: si el círculo es
  // enorme, quien mira sabe que la posición no es de fiar todavía.
  Mapa.circuloPrecision = new google.maps.Circle({
    map: Mapa.mapa,
    center: centro,
    radius: 0,
    strokeColor: "#C9A535",
    strokeOpacity: 0.5,
    strokeWeight: 1,
    fillColor: "#C9A535",
    fillOpacity: 0.12,
    clickable: false,
  });

  Mapa.marcador = new google.maps.Marker({
    map: Mapa.mapa,
    position: centro,
    title: s.nombre,
    icon: iconoPersona(s.status),
  });
}

// Marcador dibujado a mano para que combine con la marca, en vez del
// pin rojo por defecto de Google.
function iconoPersona(status) {
  const color = COLOR[status] || COLOR.presente;
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 10,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#181B21",
    strokeWeight: 3,
  };
}

function actualizarMapa(s) {
  const pos = { lat: s.ubicacion.lat, lng: s.ubicacion.lng };

  Mapa.marcador.setPosition(pos);
  Mapa.marcador.setIcon(iconoPersona(s.status));

  Mapa.circuloPrecision.setCenter(pos);
  // Sin precisión conocida (dato de ejemplo) no se dibuja el círculo:
  // inventar un margen de error sería peor que no mostrarlo.
  Mapa.circuloPrecision.setRadius(
    s.ubicacion.fuente === "gps" && s.ubicacion.precision
      ? s.ubicacion.precision
      : 0
  );

  Mapa.circuloZona.setCenter({ lat: s.zonaSegura.lat, lng: s.zonaSegura.lng });
  Mapa.circuloZona.setRadius(s.zonaSegura.radioM);
  const colorZona = s.status === "alerta" ? COLOR.alerta : COLOR.presente;
  Mapa.circuloZona.setOptions({ strokeColor: colorZona, fillColor: colorZona });

  // Re-centrar SOLO cuando la persona se ha movido de verdad. Si se
  // hiciera en cada repintado, el cuidador no podría arrastrar el mapa
  // para mirar alrededor: cada 15 segundos se le volvería al centro.
  const clave = pos.lat.toFixed(5) + "," + pos.lng.toFixed(5);
  if (Mapa.ultimoCentrado !== clave) {
    Mapa.ultimoCentrado = clave;
    Mapa.mapa.panTo(pos);
  }
}

/**
 * Coloca el mapa dentro del hueco que dejó el repintado.
 * @param {HTMLElement} hueco  el div vacío que espera al mapa
 * @param {object} s           el adulto mayor
 * @returns {boolean} false si no se pudo y hay que usar el mapa estilizado
 */
async function montarMapaGoogle(hueco, s) {
  if (!hayMapaReal() || !hueco) return false;

  try {
    await cargarScriptGoogle();
  } catch (_) {
    // Clave mal configurada o sin red: se avisa una vez y se sigue con
    // el mapa estilizado.
    Mapa.config = null;
    return false;
  }

  if (!Mapa.nodoMapa) crearMapa(s);

  // Mover, no recrear.
  if (Mapa.nodoMapa.parentElement !== hueco) hueco.appendChild(Mapa.nodoMapa);

  actualizarMapa(s);

  // Tras moverlo, Google necesita saber que cambió de sitio o dibuja el
  // mapa recortado.
  google.maps.event.trigger(Mapa.mapa, "resize");
  return true;
}
