// Mapa real dentro de la app.
//
// Sustituye al mapa estilizado (un SVG con cuatro calles inventadas) por
// uno de verdad, con calles, edificios y la posición exacta de la
// persona.
//
// ── QUÉ MAPA Y POR QUÉ ────────────────────────────────────────────
//
// Por defecto: **OpenStreetMap con Leaflet**. Da calles y edificios
// reales sin clave de API, sin tarjeta de crédito y sin cuota que
// vigilar. Para lo que hace falta aquí —ver en qué calle está una
// persona— es más que suficiente.
//
// Google queda soportado por si algún día interesa: si el servidor
// entrega una `apiKey`, se usa Google en lugar de OSM. El resto del
// archivo (crear una vez, mover, actualizar marcador) es común a los
// dos, así que el cambio no toca nada más.
//
// ── DOS DECISIONES QUE SOSTIENEN ESTE ARCHIVO ─────────────────────
//
// 1. SI EL MAPA NO CARGA, NO SE ROMPE NADA.
//    Sin red, con el CDN caído o con una clave mal configurada, la
//    vista dibuja el mapa estilizado de siempre. La pantalla nunca se
//    queda con un recuadro gris.
//
// 2. EL MAPA SE CREA UNA SOLA VEZ Y SE MUEVE, NO SE RECREA.
//    La pantalla se repinta entera cada 15 segundos (refreshAll ->
//    innerHTML). Si el mapa viviera dentro de ese HTML, en cada
//    refresco se destruiría y se volvería a crear: parpadeo, pérdida
//    del zoom que el cuidador hubiera puesto y descarga inútil de
//    tiles cada 15 segundos.
//
//    Por eso el nodo del mapa vive fuera del ciclo de render, guardado
//    en `Mapa.nodoMapa`, y después de cada repintado se MUEVE a su
//    hueco con appendChild. Mover un nodo conserva el mapa vivo.

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

// Teselas de OpenStreetMap. Se probaron antes las oscuras de CARTO y se
// descartaron: ahora estampan "API KEY REQUIRED" sobre el mapa, que es
// justo lo que se queria evitar. Estas no piden clave ni registro; su
// licencia solo exige mantener la atribucion, que Leaflet pinta abajo a
// la derecha.
//
// Vienen en claro, asi que se oscurecen por CSS (ver .leaflet-tile-pane
// en styles.css). El filtro se aplica SOLO a la capa de teselas, no al
// marcador ni a los circulos, que ya tienen los colores de la marca.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATRIBUCION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const Mapa = {
  config: null, // { proveedor, apiKey } — lo entrega GET /api/config
  cargando: null, // promesa de carga, para no pedir la librería dos veces
  nodoMapa: null, // el div persistente que contiene el mapa
  mapa: null, // instancia de Leaflet o de google.maps.Map
  marcador: null,
  circuloPrecision: null,
  circuloZona: null,
  ultimoCentrado: null, // para no re-centrar en cada repintado
  otros: {}, // adultoId -> marcador de los demas adultos a cargo (solo OSM)
  encuadrado: false, // si ya se encuadraron todos los adultos una vez
  yo: null, // el punto azul del propio familiar ("Tú")
  encuadradoConmigo: false, // si ya se encuadro una vez incluyendome
  ultimosPuntos: [], // posiciones de los adultos en pantalla, para encuadrar
};

const COLOR = {
  presente: "#2E9E5E",
  cuidado: "#E8A33D",
  alerta: "#E8622C",
};

function proveedorMapa() {
  return Mapa.config ? Mapa.config.proveedor : "ninguno";
}

function hayMapaReal() {
  const p = proveedorMapa();
  return p === "osm" || (p === "google" && !!Mapa.config.apiKey);
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

// ── Carga de la librería ─────────────────────────────────────────

function cargarEtiqueta(tag, atributos) {
  return new Promise((resolver, rechazar) => {
    const el = document.createElement(tag);
    Object.assign(el, atributos);
    el.onload = () => resolver();
    el.onerror = () => rechazar(new Error("No se pudo cargar " + (atributos.src || atributos.href)));
    document.head.appendChild(el);
  });
}

function cargarLibreria() {
  if (Mapa.cargando) return Mapa.cargando;

  Mapa.cargando = (async () => {
    if (proveedorMapa() === "google") {
      if (window.google && window.google.maps) return;
      await cargarEtiqueta("script", {
        src:
          "https://maps.googleapis.com/maps/api/js?key=" +
          encodeURIComponent(Mapa.config.apiKey) +
          "&language=es&region=CO&loading=async",
        async: true,
      });
      return;
    }

    if (window.L) return;
    // El CSS primero: sin él Leaflet dibuja las teselas descolocadas.
    await cargarEtiqueta("link", { rel: "stylesheet", href: LEAFLET_CSS });
    await cargarEtiqueta("script", { src: LEAFLET_JS, async: true });
  })();

  return Mapa.cargando;
}

// ── OpenStreetMap (Leaflet) ──────────────────────────────────────

function crearMapaOSM(s) {
  const centro = [s.ubicacion.lat, s.ubicacion.lng];

  Mapa.mapa = L.map(Mapa.nodoMapa, {
    center: centro,
    zoom: 16,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer(TILES, {
    attribution: ATRIBUCION,
    maxZoom: 19,
  }).addTo(Mapa.mapa);

  // Margen de error del GPS. Dibujarlo es honesto: si el círculo es
  // grande, quien mira sabe que la posición aún no es de fiar.
  Mapa.circuloPrecision = L.circle(centro, {
    radius: 0,
    color: "#C9A535",
    weight: 1,
    opacity: 0.5,
    fillColor: "#C9A535",
    fillOpacity: 0.12,
    interactive: false,
  }).addTo(Mapa.mapa);

  // Zona segura: solo el contorno, sin relleno. Marcarla entera tapaba
  // el mapa justo donde hay que mirar; una línea fina basta para saber
  // dónde está el límite.
  Mapa.circuloZona = L.circle([s.zonaSegura.lat, s.zonaSegura.lng], {
    radius: s.zonaSegura.radioM,
    color: COLOR.presente,
    weight: 1.5,
    opacity: 0.55,
    dashArray: "6 6",
    fill: false,
    interactive: false,
  }).addTo(Mapa.mapa);

  Mapa.marcador = L.circleMarker(centro, iconoOSM(s.status)).addTo(Mapa.mapa);
}

function iconoOSM(status) {
  const color = COLOR[status] || COLOR.presente;
  return {
    radius: 9,
    color: "#181B21",
    weight: 3,
    fillColor: color,
    fillOpacity: 1,
  };
}

function actualizarMapaOSM(s) {
  const pos = [s.ubicacion.lat, s.ubicacion.lng];

  Mapa.marcador.setLatLng(pos);
  Mapa.marcador.setStyle(iconoOSM(s.status));

  Mapa.circuloPrecision.setLatLng(pos);
  Mapa.circuloPrecision.setRadius(radioPrecision(s));

  Mapa.circuloZona.setLatLng([s.zonaSegura.lat, s.zonaSegura.lng]);
  Mapa.circuloZona.setRadius(s.zonaSegura.radioM);
  Mapa.circuloZona.setStyle({
    color: s.status === "alerta" ? COLOR.alerta : COLOR.presente,
  });

  if (seMovio(s)) Mapa.mapa.panTo(pos);
}

// ── Google Maps (solo si hay clave configurada) ──────────────────

function crearMapaGoogle(s) {
  const centro = { lat: s.ubicacion.lat, lng: s.ubicacion.lng };

  Mapa.mapa = new google.maps.Map(Mapa.nodoMapa, {
    center: centro,
    zoom: 16,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
    clickableIcons: false,
    styles: [
      { elementType: "geometry", stylers: [{ color: "#1f2530" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#181b21" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#9a9080" }] },
      { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1d2a24" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#2e3440" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#141a24" }] },
    ],
  });

  Mapa.circuloZona = new google.maps.Circle({
    map: Mapa.mapa,
    center: { lat: s.zonaSegura.lat, lng: s.zonaSegura.lng },
    radius: s.zonaSegura.radioM,
    strokeColor: COLOR.presente,
    strokeOpacity: 0.55,
    strokeWeight: 1.5,
    fillOpacity: 0,
    clickable: false,
  });

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
    icon: iconoGoogle(s.status),
  });
}

function iconoGoogle(status) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 10,
    fillColor: COLOR[status] || COLOR.presente,
    fillOpacity: 1,
    strokeColor: "#181B21",
    strokeWeight: 3,
  };
}

function actualizarMapaGoogle(s) {
  const pos = { lat: s.ubicacion.lat, lng: s.ubicacion.lng };

  Mapa.marcador.setPosition(pos);
  Mapa.marcador.setIcon(iconoGoogle(s.status));

  Mapa.circuloPrecision.setCenter(pos);
  Mapa.circuloPrecision.setRadius(radioPrecision(s));

  Mapa.circuloZona.setCenter({ lat: s.zonaSegura.lat, lng: s.zonaSegura.lng });
  Mapa.circuloZona.setRadius(s.zonaSegura.radioM);
  Mapa.circuloZona.setOptions({
    strokeColor: s.status === "alerta" ? COLOR.alerta : COLOR.presente,
  });

  if (seMovio(s)) Mapa.mapa.panTo(pos);
}

// ── Común a los dos ──────────────────────────────────────────────

// Sin precisión conocida (el dato de ejemplo) no se dibuja el círculo:
// inventar un margen de error sería peor que no mostrarlo.
function radioPrecision(s) {
  return s.ubicacion.fuente === "gps" && s.ubicacion.precision
    ? s.ubicacion.precision
    : 0;
}

// Re-centrar SOLO cuando la persona se ha movido de verdad. Si se
// hiciera en cada repintado, el cuidador no podría arrastrar el mapa
// para mirar alrededor: cada 15 segundos se le volvería al centro.
function seMovio(s) {
  const clave = s.ubicacion.lat.toFixed(5) + "," + s.ubicacion.lng.toFixed(5);
  if (Mapa.ultimoCentrado === clave) return false;
  Mapa.ultimoCentrado = clave;
  return true;
}

/**
 * Coloca el mapa dentro del hueco que dejó el repintado.
 * @param {HTMLElement} hueco  el div vacío que espera al mapa
 * @param {object} s           el adulto mayor
 * @returns {boolean} false si no se pudo y hay que usar el mapa estilizado
 */
// ── Varios adultos a cargo (solo OpenStreetMap) ──────────────────
// La persona seleccionada es el marcador grande con su zona; los demas,
// un punto mas pequeño con su nombre. Tocar uno lo selecciona. Su zona
// segura no se dibuja para no llenar el mapa de circulos: se ve al
// seleccionarlo.

function etiquetaAdulto(nombre) {
  return primerNombre(nombre);
}

function actualizarOtrosOSM(s, otros) {
  const vigentes = new Set(otros.map((a) => a.id));
  for (const id of Object.keys(Mapa.otros)) {
    if (!vigentes.has(Number(id))) {
      Mapa.otros[id].remove();
      delete Mapa.otros[id];
    }
  }
  for (const a of otros) {
    if (typeof a.ubicacion.lat !== "number") continue;
    const fuera = a.seguimiento && a.seguimiento.estaFuera;
    const estilo = {
      radius: 7,
      color: "#181B21",
      weight: 2,
      fillColor: COLOR[fuera ? "alerta" : a.status] || COLOR.presente,
      fillOpacity: 1,
    };
    let m = Mapa.otros[a.id];
    if (!m) {
      m = L.circleMarker([a.ubicacion.lat, a.ubicacion.lng], estilo)
        .bindTooltip(etiquetaAdulto(a.nombre), { permanent: true, direction: "top", className: "etiqueta-mapa otro" })
        .addTo(Mapa.mapa);
      m.on("click", () => {
        if (typeof elegirAdulto === "function") elegirAdulto(a.id);
      });
      Mapa.otros[a.id] = m;
    } else {
      m.setLatLng([a.ubicacion.lat, a.ubicacion.lng]);
      m.setStyle(estilo);
    }
  }

  // El seleccionado tambien lleva su nombre cuando hay mas de uno.
  if (otros.length) {
    if (!Mapa.marcador.getTooltip()) {
      Mapa.marcador.bindTooltip("", { permanent: true, direction: "top", className: "etiqueta-mapa" });
    }
    Mapa.marcador.setTooltipContent(etiquetaAdulto(s.nombre));
  } else if (Mapa.marcador.getTooltip()) {
    Mapa.marcador.unbindTooltip();
  }

  // La primera vez, que se vea a todos.
  if (otros.length && !Mapa.encuadrado) {
    const puntos = [[s.ubicacion.lat, s.ubicacion.lng]].concat(
      otros.filter((a) => typeof a.ubicacion.lat === "number").map((a) => [a.ubicacion.lat, a.ubicacion.lng])
    );
    Mapa.mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 16 });
    Mapa.encuadrado = true;
    return true;
  }
  return false;
}

// ── El propio familiar ("Tú") ─────────────────────────────────────
// Azul, para no confundirlo con los adultos (verde/naranja). Su posicion
// viene de mi-ubicacion.js y NO pasa por el servidor.
const COLOR_YO = "#4A90D9";
const MAX_M_PARA_ENCUADRAR = 30000;

function actualizarMiPuntoEnMapa() {
  if (!Mapa.mapa || proveedorMapa() !== "osm" || typeof miPosicion !== "function") return;
  const yo = miPosicion();
  if (!yo) {
    if (Mapa.yo) { Mapa.yo.remove(); Mapa.yo = null; }
    return;
  }
  if (!Mapa.yo) {
    Mapa.yo = L.circleMarker([yo.lat, yo.lng], {
      radius: 8, color: "#FFFFFF", weight: 3, fillColor: COLOR_YO, fillOpacity: 1,
    })
      // Debajo del punto: las etiquetas de los adultos van encima, y si estoy
      // cerca de alguien no se tapan.
      .bindTooltip("Tú", { permanent: true, direction: "bottom", className: "etiqueta-mapa yo" })
      .addTo(Mapa.mapa);
  } else {
    Mapa.yo.setLatLng([yo.lat, yo.lng]);
  }

  // La primera vez que se sabe donde estoy, encuadrar para verme junto a
  // los demas. Solo si estoy cerca: desde otra ciudad el mapa se alejaria
  // tanto que ya no se verian las calles de nadie.
  if (!Mapa.encuadradoConmigo && Mapa.ultimosPuntos.length) {
    const cerca = Mapa.ultimosPuntos.some(
      (p) => metrosEntre(yo.lat, yo.lng, p[0], p[1]) < MAX_M_PARA_ENCUADRAR
    );
    if (cerca) {
      Mapa.mapa.fitBounds(Mapa.ultimosPuntos.concat([[yo.lat, yo.lng]]), {
        padding: [40, 40], maxZoom: 16, animate: false,
      });
    }
    Mapa.encuadradoConmigo = true;
  }
}

async function montarMapaReal(hueco, s, otros = []) {
  if (!hayMapaReal() || !hueco) return false;

  try {
    await cargarLibreria();
  } catch (_) {
    // Sin red, CDN caído o clave mal configurada: se deja de intentar y
    // la vista cae al mapa estilizado.
    Mapa.config = null;
    return false;
  }

  const esGoogle = proveedorMapa() === "google";

  if (!Mapa.nodoMapa) {
    Mapa.nodoMapa = document.createElement("div");
    Mapa.nodoMapa.className = "mapa-real";
    // Leaflet mide el contenedor al crearse, así que tiene que estar ya
    // dentro del documento y con tamaño. Por eso se inserta ANTES.
    hueco.appendChild(Mapa.nodoMapa);
    if (esGoogle) crearMapaGoogle(s);
    else crearMapaOSM(s);
  } else if (Mapa.nodoMapa.parentElement !== hueco) {
    // Mover, no recrear.
    hueco.appendChild(Mapa.nodoMapa);
  }

  if (esGoogle) {
    actualizarMapaGoogle(s);
    google.maps.event.trigger(Mapa.mapa, "resize");
  } else {
    Mapa.ultimosPuntos = [s].concat(otros)
      .filter((a) => typeof a.ubicacion.lat === "number")
      .map((a) => [a.ubicacion.lat, a.ubicacion.lng]);
    // Si se acaba de encuadrar a todos, no re-centrar en el seleccionado.
    const encuadro = actualizarOtrosOSM(s, otros);
    if (encuadro) Mapa.ultimoCentrado = s.ubicacion.lat.toFixed(5) + "," + s.ubicacion.lng.toFixed(5);
    actualizarMapaOSM(s);
    // Tras moverlo de sitio, Leaflet necesita recalcular su tamaño o
    // dibuja el mapa recortado y con las teselas a medias.
    Mapa.mapa.invalidateSize();
    actualizarMiPuntoEnMapa();
  }

  return true;
}
