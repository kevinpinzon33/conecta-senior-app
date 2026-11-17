// Pantalla de inicio de sesion.
//
// Es la unica puerta de entrada: el rol que devuelve el servidor decide
// que interfaz se monta despues (ver app.js). No hay forma de llegar a una
// vista sin pasar por aqui.

function mostrarLogin(mensaje = "") {
  document.body.classList.add("en-login");
  topbarEl.innerHTML = "";
  tabbarEl.innerHTML = "";
  tabbarEl.hidden = true;

  screenEl.innerHTML = `
    <div class="login">
      <div class="login-marca">
        <img src="icons/logo-mark.png" alt="" width="64" height="64" />
        <h1>Conecta Senior</h1>
        <p>Tranquilidad para tu familia</p>
      </div>

      <form class="login-form" id="loginForm" novalidate>
        <label for="inUsuario">Usuario</label>
        <input id="inUsuario" name="usuario" type="text" autocomplete="username"
               autocapitalize="none" autocorrect="off" spellcheck="false"
               placeholder="Tu usuario" />

        <label for="inClave">Contraseña</label>
        <input id="inClave" name="clave" type="password"
               autocomplete="current-password" placeholder="Tu contraseña" />

        <p class="login-error" id="loginError" ${mensaje ? "" : "hidden"}>${esc(
    mensaje
  )}</p>

        <button class="btn btn-primary login-btn" type="submit" id="btnEntrar">
          Entrar
        </button>
      </form>

      <p class="login-privacidad"><a href="privacidad.html" target="_blank" rel="noopener">Aviso de privacidad</a></p>

      <!-- PENDIENTE: quitar este bloque al conectar la base de datos real.
           Esta aqui solo para que el equipo pueda probar los dos roles. -->
      <div class="login-demo">
        <p class="login-demo-titulo">Usuarios de prueba</p>
        <button class="login-demo-fila" data-usuario="kevin" data-clave="123">
          <span class="rol">Cuidador · 5 adultos mayores</span>
          <span class="cred">kevin / 123</span>
        </button>
        <button class="login-demo-fila" data-usuario="laura" data-clave="123">
          <span class="rol">Cuidadora · 1 adulto mayor</span>
          <span class="cred">laura / 123</span>
        </button>
      </div>
    </div>
  `;

  const form = document.getElementById("loginForm");
  const inUsuario = document.getElementById("inUsuario");
  const inClave = document.getElementById("inClave");
  const errorEl = document.getElementById("loginError");
  const btnEntrar = document.getElementById("btnEntrar");

  const mostrarError = (texto) => {
    errorEl.textContent = texto;
    errorEl.hidden = false;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const usuario = inUsuario.value.trim();
    const clave = inClave.value;
    if (!usuario || !clave) {
      mostrarError("Escribe tu usuario y tu contraseña.");
      return;
    }

    btnEntrar.disabled = true;
    btnEntrar.textContent = "Entrando…";
    try {
      // Ojo: este fetch no pasa por api() porque todavia no hay sesion.
      const res = await fetchConLimite("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, clave }),
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error || "No se pudo entrar");

      guardarSesion(datos.token, datos.usuario);
      // Un cuidador elige con que perfil entrar: el mismo o uno de sus
      // adultos mayores. Un adulto mayor entra directo.
      if (Array.isArray(datos.perfiles) && datos.perfiles.length > 1) {
        mostrarSelectorPerfil(datos.perfiles);
        return;
      }
      document.body.classList.remove("en-login");
      await iniciarSesionEnLaApp();
    } catch (err) {
      mostrarError(err.message);
      btnEntrar.disabled = false;
      btnEntrar.textContent = "Entrar";
      inClave.select();
    }
  };

  // Los atajos de prueba solo rellenan el formulario; el login real sigue
  // siendo el mismo, para no tener un camino alterno que despues sobre.
  screenEl.querySelectorAll(".login-demo-fila").forEach((btn) => {
    btn.onclick = () => {
      inUsuario.value = btn.dataset.usuario;
      inClave.value = btn.dataset.clave;
      form.requestSubmit();
    };
  });

  inUsuario.focus();
}

// ── ¿Con quién quieres entrar? ───────────────────────────────────
// Lo ve un cuidador al iniciar sesión: él mismo (ve a todos en el mapa) y
// cada adulto mayor a su cargo (entra a la interfaz de esa persona, por
// ejemplo para compartir su ubicación desde el teléfono de ella).
function mostrarSelectorPerfil(perfiles) {
  const etiqueta = (p) => (p.rol === "adulto_mayor" ? "Adulto mayor" : "Cuidador");
  screenEl.innerHTML = `
    <div class="login selector-perfil">
      <h1 class="login-titulo">¿Con quién quieres entrar?</h1>
      <p class="login-sub">Elige tu perfil de cuidador para ver a todos, o el de un adulto mayor para usar la app como esa persona.</p>
      <div class="perfiles">
        ${perfiles
          .map(
            (p) => `<button class="perfil-opcion ${p.rol === "adulto_mayor" ? "mayor" : "cuidador"}"
                      data-usuario-id="${p.usuarioId}" ${p.propio ? "data-propio" : ""}>
              <span class="perfil-avatar">${esc(p.nombre.charAt(0))}</span>
              <span class="perfil-texto">
                <span class="perfil-nombre">${esc(p.nombre)}${p.propio ? " (tú)" : ""}</span>
                <span class="perfil-rol">${etiqueta(p)}</span>
              </span>
            </button>`
          )
          .join("")}
      </div>
      <p class="login-error" id="perfilError" hidden></p>
      <button class="perfil-otra-cuenta" id="otraCuenta">Usar otra cuenta</button>
    </div>`;

  const errorEl = document.getElementById("perfilError");
  document.getElementById("otraCuenta").onclick = () => {
    olvidarSesion();
    mostrarLogin();
  };
  screenEl.querySelectorAll(".perfil-opcion").forEach((btn) => {
    btn.onclick = async () => {
      screenEl.querySelectorAll(".perfil-opcion").forEach((b) => (b.disabled = true));
      try {
        if (!("propio" in btn.dataset)) {
          const r = await api("/auth/elegir-perfil", {
            method: "POST",
            body: JSON.stringify({ usuarioId: Number(btn.dataset.usuarioId) }),
          });
          guardarSesion(r.token, r.usuario);
          // Cambiar de persona: que no quede el adulto elegido del cuidador.
          state.adultoId = null;
        }
        document.body.classList.remove("en-login");
        await iniciarSesionEnLaApp();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        screenEl.querySelectorAll(".perfil-opcion").forEach((b) => (b.disabled = false));
      }
    };
  });
}
