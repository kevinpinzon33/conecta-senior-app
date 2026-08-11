# Conecta Senior — prototipo funcional

Esto es una app web (PWA) con un servidor pequeño y una base de datos
en archivo (`db.json`). No necesitas instalar MySQL, Postgres ni nada
parecido — es intencionalmente simple, solo para probar el flujo
completo antes de conectar tu backend real (Twilio, alertas, etc).

## 1. Instalar y correr en tu computadora

Necesitas tener [Node.js](https://nodejs.org) instalado (cualquier
versión reciente sirve).

```bash
cd conecta-senior-app
npm install
npm start
```

Vas a ver algo como:

```
Conecta Senior corriendo en:
  http://localhost:3000
```

Pruébalo primero en la misma computadora abriendo esa dirección en tu
navegador.

## 2. Verlo en tu iPhone

Tu iPhone y tu computadora deben estar **conectados a la misma red WiFi**.

1. Busca la IP local de tu computadora:
   - **Mac**: Preferencias del Sistema → Wi-Fi → Detalles (o `ifconfig | grep "inet "` en Terminal)
   - **Windows**: `ipconfig` en la terminal, busca "Dirección IPv4"
   - Se ve algo así: `192.168.1.23`

2. En tu iPhone, abre **Safari** (tiene que ser Safari, no Chrome, para
   que "Agregar a pantalla de inicio" funcione bien) y entra a:

   ```
   http://TU-IP-LOCAL:3000
   ```

   Ejemplo: `http://192.168.1.23:3000`

3. Toca el botón de compartir (el cuadrito con la flecha hacia arriba)
   y elige **"Agregar a pantalla de inicio"**.

4. Listo — te va a aparecer un ícono de Conecta Senior en tu iPhone que
   abre a pantalla completa, como una app.

> Nota: mientras tu computadora esté apagada o desconectada de esa red,
> la app no va a cargar. Esto es normal en un prototipo local — cuando
> lo suban a un servidor real (o lo conectes a tu backend en producción)
> ya no va a depender de tu compu.

## 3. Qué puedes probar

- **Inicio**: ubicación simulada de Rosa Elena, estado, radio de zona
  segura, botón "Llamar" (marca al contacto principal) y "Marcar visto".
- **Recordatorios** (abajo en Inicio): toca **"+ Agregar"** para crear
  uno (medicamento, cita u otro, con hora opcional). Tócalo para
  marcarlo como hecho — se tacha y se va al final; tócalo otra vez
  para deshacerlo. El ícono de basura lo elimina.
- **Alertas**: botón **"Simular escaneo"** — crea una alerta real,
  nueva, con hora actual, guardada en `db.json`. Puedes marcarla como
  atendida y el estado del adulto mayor vuelve a "presente".
- **Perfil**: info médica y contactos de emergencia (los botones de
  llamada abren el marcador del iPhone).

### Simulador de zona segura

Abre **`/simulador.html`** (por ejemplo `http://localhost:3000/simulador.html`).
Es una herramienta de prueba, aparte de la app: arrastras un punto sobre
el mapa y el servidor decide si el adulto mayor salió de su zona segura,
con las mismas reglas que usaría un teléfono real.

Trae escenarios de un clic para ver que el ruido normal del GPS **no**
genera alertas falsas, que alejarse de verdad **sí** alerta, y que las
lecturas basura se descartan. Para una demo, déjalo abierto en una
pantalla y la app del cuidador en otra.

Todo lo que hagas se guarda en `conecta-senior-app/db.json` — puedes
abrir ese archivo con cualquier editor de texto para ver los datos
crudos, o borrarlo para reiniciar con los datos de ejemplo.

## 4. Subirlo a internet gratis (para que NO dependa de tu PC)

Esto lo deja corriendo 24/7 en un servidor gratuito. Tu iPhone se
conecta directo a internet — ya no necesitas tu PC prendida ni estar
en el mismo WiFi. Son dos pasos: subir el código a GitHub, y conectar
Render a ese código.

### Paso 1: Sube la carpeta a GitHub

1. Entra a [github.com](https://github.com) y crea una cuenta gratis
   si no tienes una.
2. Arriba a la derecha, toca el **+** → **New repository**.
3. Ponle de nombre `conecta-senior-app`, déjalo en **Public**, y
   toca **Create repository**.
4. En la página del repo, busca el link **"uploading an existing file"**.
5. Arrastra ahí TODA la carpeta `conecta-senior-app` (o todos sus
   archivos y subcarpetas) desde tu computadora.
6. Abajo, toca **Commit changes**.

### Paso 2: Conecta Render a ese repositorio

1. Entra a [render.com](https://render.com) y crea una cuenta gratis
   (puedes usar tu cuenta de GitHub para entrar más rápido).
2. Toca **New +** → **Web Service**.
3. Conecta tu cuenta de GitHub y elige el repositorio
   `conecta-senior-app` que acabas de crear.
4. Render va a detectar automáticamente que es Node.js (gracias al
   archivo `render.yaml` que ya está incluido). Deja todo por defecto.
5. Elige el plan **Free**.
6. Toca **Create Web Service** y espera 2–3 minutos mientras se
   construye.

Cuando termine, Render te da una dirección pública como:

```
https://conecta-senior.onrender.com
```

Esa es la dirección que abres en Safari desde tu iPhone (¡desde
cualquier lugar, no solo tu WiFi!) y luego "Agregar a pantalla de
inicio".

> **Nota sobre el plan gratuito de Render**: si nadie usa la app por
> 15 minutos, el servidor "se duerme" para ahorrar recursos. La
> primera vez que la abras después de eso, puede tardar 30-50
> segundos en despertar — es normal, no está roto. Para un prototipo
> de prueba está perfecto; cuando esté lista para uso real todos los
> días, conviene pasar a un plan pago (unos US$7/mes) para que nunca
> se duerma.

## 5. Siguiente paso (cuando conectes tu backend real)

`server.js` tiene comentado dónde reemplazar la base de datos JSON por
tu lógica real de `whatsapp.service.js` y `alerta.controller.js`. El
frontend (`public/app.js`) no necesita cambios: solo habla con
`/api/...`, así que puedes apuntar esas mismas rutas a tu servidor de
producción cuando esté listo.
