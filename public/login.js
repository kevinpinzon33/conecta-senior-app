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

      <!-- PENDIENTE: quitar este bloque al conectar la base de datos real.
           Esta aqui solo para que el equipo pueda probar los dos roles. -->
      <div class="login-demo">
        <p class="login-demo-titulo">Usuarios de prueba</p>
        <button class="login-demo-fila" data-usuario="rosa" data-clave="rosa123">
          <span class="rol">Adulto mayor</span>
          <span class="cred">rosa / rosa123</span>
        </button>
        <button class="login-demo-fila" data-usuario="daniela" data-clave="daniela123">
          <span class="rol">Contacto de emergencia</span>
          <span class="cred">daniela / daniela123</span>
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, clave }),
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error || "No se pudo entrar");

      guardarSesion(datos.token, datos.usuario);
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
