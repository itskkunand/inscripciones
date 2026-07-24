/* =====================================================================
   CINECLUB — script.js
   ---------------------------------------------------------------------
   Para que la cartelera se comparta entre TODOS los visitantes del
   sitio (y no solo en tu propio navegador), este archivo usa Firebase
   Firestore, que tiene un plan gratuito más que suficiente para un
   cineclub.

   CÓMO CONFIGURARLO (5 minutos, gratis):
   1. Entrá a https://console.firebase.google.com y creá un proyecto.
   2. Dentro del proyecto, and Build > Firestore Database > "Crear
      base de datos". Elegí modo de producción o de prueba (podés
      ajustar las reglas después, ver README.md).
   3. Andá a "Configuración del proyecto" (ícono de tuerca) > tus apps
      > ícono </> "Agregar app web". Copiá el objeto de configuración
      que te da Firebase y pegalo abajo, reemplazando "firebaseConfig".
   4. Subí index.html, style.css y script.js a Neocities. ¡Listo!

   Si no configurás Firebase, el sitio funciona igual pero SOLO en tu
   propio navegador (modo local), y se muestra un aviso arriba de la
   página avisando que falta configurarlo.
   ===================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAjphMyAb7eoV1pHPyAGbDEoUkKZMXkGnU",
  authDomain: "inscripciones-9a302.firebaseapp.com",
  projectId: "inscripciones-9a302",
  storageBucket: "inscripciones-9a302.firebasestorage.app",
  messagingSenderId: "221455024162",
  appId: "1:221455024162:web:4662be1293735f08240a7b"
};

// Contraseña simple para que un "administrador" pueda editar/eliminar
// cualquier función, además de quien la creó. Cambiala por la tuya.
const ADMIN_PASSWORD = "cineclub-admin";

const CONFIGURADO = firebaseConfig.apiKey !== "TU_API_KEY";

/* =====================================================================
   CAPA DE DATOS
   Expone siempre la misma interfaz (subscribe / add / update / remove)
   sin importar si estamos usando Firestore o el modo local de respaldo.
   ===================================================================== */

let backend;

if (CONFIGURADO) {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const {
    getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc,
    doc, arrayUnion, serverTimestamp
  } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const col = collection(db, "funciones");

  backend = {
    subscribe(cb) {
      return onSnapshot(col, (snap) => {
        const items = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
        cb(items);
      });
    },
    async add(data) {
      await addDoc(col, { ...data, creadoEn: serverTimestamp() });
    },
    async update(id, data) {
      await updateDoc(doc(db, "funciones", id), data);
    },
    async addAsistente(id, nombre) {
      await updateDoc(doc(db, "funciones", id), { asistentes: arrayUnion(nombre) });
    },
    async remove(id) {
      await deleteDoc(doc(db, "funciones", id));
    }
  };
} else {
  // ---- Modo local de respaldo (solo este navegador) ----
  const STORAGE_KEY = "cineclub_funciones_local";
  const listeners = new Set();

  function leer() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function escribir(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    listeners.forEach((cb) => cb(items));
  }
  function idNuevo() {
    return "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  backend = {
    subscribe(cb) {
      listeners.add(cb);
      cb(leer());
      return () => listeners.delete(cb);
    },
    async add(data) {
      const items = leer();
      items.push({ id: idNuevo(), ...data });
      escribir(items);
    },
    async update(id, data) {
      const items = leer().map((it) => (it.id === id ? { ...it, ...data } : it));
      escribir(items);
    },
    async addAsistente(id, nombre) {
      const items = leer().map((it) => {
        if (it.id !== id) return it;
        const asistentes = Array.isArray(it.asistentes) ? it.asistentes : [];
        if (asistentes.includes(nombre)) return it;
        return { ...it, asistentes: [...asistentes, nombre] };
      });
      escribir(items);
    },
    async remove(id) {
      escribir(leer().filter((it) => it.id !== id));
    }
  };
}

/* =====================================================================
   IDENTIDAD LOCAL (para permitir editar/eliminar solo lo propio)
   ===================================================================== */
function creatorId() {
  let id = localStorage.getItem("cineclub_creator_id");
  if (!id) {
    id = "u-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("cineclub_creator_id", id);
  }
  return id;
}

/* =====================================================================
   UTILIDADES
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function limpiar(texto) {
  return (texto || "").trim().replace(/\s+/g, " ");
}

function fechaHoraA_Date(fecha, hora) {
  // fecha: YYYY-MM-DD, hora: HH:MM
  return new Date(`${fecha}T${hora || "00:00"}`);
}

function formatearFecha(fecha) {
  if (!fecha) return "";
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

function esUrlValida(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/* =====================================================================
   ESTADO EN MEMORIA + RENDER
   ===================================================================== */
let funciones = [];
let textoBusqueda = "";
let fechaFiltro = "";
const timers = [];

function aplicarFiltros(lista) {
  return lista.filter((f) => {
    const coincideTexto = !textoBusqueda ||
      f.nombre.toLowerCase().includes(textoBusqueda) ||
      (f.organizador || "").toLowerCase().includes(textoBusqueda);
    const coincideFecha = !fechaFiltro || f.fecha === fechaFiltro;
    return coincideTexto && coincideFecha;
  });
}

function render() {
  const cont = $("#funciones-lista");
  const vacio = $("#vacio");
  timers.forEach(clearInterval);
  timers.length = 0;
  cont.innerHTML = "";

  const visibles = aplicarFiltros(funciones)
    .slice()
    .sort((a, b) => fechaHoraA_Date(a.fecha, a.hora) - fechaHoraA_Date(b.fecha, b.hora));

  vacio.classList.toggle("hidden", funciones.length !== 0);
  if (funciones.length !== 0 && visibles.length === 0) {
    cont.innerHTML = `<p class="empty-state">Ninguna función coincide con la búsqueda o el filtro.</p>`;
    return;
  }

  visibles.forEach((f) => cont.appendChild(crearTarjeta(f)));
}

function crearTarjeta(f) {
  const tpl = $("#tpl-funcion");
  const nodo = tpl.content.firstElementChild.cloneNode(true);
  nodo.dataset.id = f.id;

  $(".ticket-titulo", nodo).textContent = f.nombre;
  $(".ticket-anio", nodo).textContent = f.anio;
  $(".dato-fecha span", nodo).textContent = formatearFecha(f.fecha);
  $(".dato-hora span", nodo).textContent = f.hora;

  const orgEl = $(".dato-organizador", nodo);
  if (f.organizador) {
    orgEl.classList.remove("hidden");
    $("span", orgEl).textContent = f.organizador;
  }

  const link = $(".link-transmision", nodo);
  link.href = f.link;

  const inicio = fechaHoraA_Date(f.fecha, f.hora);
  const finalizada = inicio.getTime() < Date.now();
  const badge = $(".ticket-badge", nodo);
  if (finalizada) {
    nodo.classList.add("finalizada");
    badge.textContent = "Finalizada";
    badge.classList.remove("hidden");
  }

  // Cuenta regresiva
  const countdownEl = $(".ticket-countdown", nodo);
  function actualizarCountdown() {
    const ms = inicio.getTime() - Date.now();
    if (ms <= 0) {
      countdownEl.textContent = "";
      return;
    }
    const dias = Math.floor(ms / 86400000);
    const horas = Math.floor((ms % 86400000) / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    const seg = Math.floor((ms % 60000) / 1000);
    countdownEl.textContent = dias > 0
      ? `⏳ Empieza en ${dias}d ${horas}h ${min}m`
      : `⏳ Empieza en ${horas}h ${min}m ${seg}s`;
  }
  actualizarCountdown();
  if (!finalizada) {
    timers.push(setInterval(actualizarCountdown, 1000));
  }

  // Asistentes
  const listaAsist = $(".lista-asistentes", nodo);
  const asistentes = Array.isArray(f.asistentes) ? f.asistentes : [];
  $(".contador-asistentes", nodo).textContent = asistentes.length;
  asistentes.forEach((nombre) => {
    const li = document.createElement("li");
    li.textContent = nombre;
    listaAsist.appendChild(li);
  });

  // Inscripción
  const formInsc = $(".form-inscripcion", nodo);
  const errInsc = $(".error-inscripcion", nodo);
  formInsc.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $(".input-nombre-asistente", nodo);
    const nombre = limpiar(input.value);
    errInsc.textContent = "";
    if (!nombre) {
      errInsc.textContent = "Escribí tu nombre para inscribirte.";
      return;
    }
    const btn = $(".btn-inscribirme", nodo);
    btn.disabled = true;
    try {
      await backend.addAsistente(f.id, nombre);
      input.value = "";
    } catch (err) {
      errInsc.textContent = "No se pudo guardar la inscripción. Intentá de nuevo.";
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });

  // Copiar enlace
  $(".btn-copiar", nodo).addEventListener("click", async () => {
    const btn = $(".btn-copiar", nodo);
    try {
      await navigator.clipboard.writeText(f.link);
      const original = btn.textContent;
      btn.textContent = "¡Copiado!";
      setTimeout(() => (btn.textContent = original), 1500);
    } catch {
      window.prompt("Copiá el enlace manualmente:", f.link);
    }
  });

  // Permisos de edición/eliminación
  const puedeEditar = f.creatorId === creatorId();
  const btnEditar = $(".btn-editar", nodo);
  const btnEliminar = $(".btn-eliminar", nodo);

  btnEditar.addEventListener("click", () => abrirEdicion(f, puedeEditar));
  btnEliminar.addEventListener("click", () => eliminarFuncion(f, puedeEditar));

  return nodo;
}

/* =====================================================================
   VERIFICACIÓN DE PERMISOS (creador o admin)
   ===================================================================== */
function verificarPermiso(yaEsCreador) {
  if (yaEsCreador) return true;
  const pass = window.prompt("Esta función la creó otra persona.\nSi sos administrador, ingresá la contraseña:");
  if (pass === null) return false;
  if (pass === ADMIN_PASSWORD) return true;
  window.alert("Contraseña incorrecta.");
  return false;
}

async function eliminarFuncion(f, puedeEditar) {
  if (!verificarPermiso(puedeEditar)) return;
  const ok = window.confirm(`¿Eliminar la función "${f.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await backend.remove(f.id);
  } catch (err) {
    window.alert("No se pudo eliminar la función.");
    console.error(err);
  }
}

function abrirEdicion(f, puedeEditar) {
  if (!verificarPermiso(puedeEditar)) return;

  const nombre = window.prompt("Nombre de la película:", f.nombre);
  if (nombre === null) return;
  const anio = window.prompt("Año de estreno:", f.anio);
  if (anio === null) return;
  const fecha = window.prompt("Fecha (AAAA-MM-DD):", f.fecha);
  if (fecha === null) return;
  const hora = window.prompt("Hora (HH:MM):", f.hora);
  if (hora === null) return;
  const link = window.prompt("Link de la transmisión:", f.link);
  if (link === null) return;
  const organizador = window.prompt("Organiza (opcional):", f.organizador || "");

  const datos = {
    nombre: limpiar(nombre),
    anio: Number(anio),
    fecha: limpiar(fecha),
    hora: limpiar(hora),
    link: limpiar(link),
    organizador: limpiar(organizador)
  };

  if (!datos.nombre || !datos.anio || !datos.fecha || !datos.hora || !esUrlValida(datos.link)) {
    window.alert("Datos inválidos. No se guardaron los cambios.");
    return;
  }

  backend.update(f.id, datos).catch((err) => {
    window.alert("No se pudieron guardar los cambios.");
    console.error(err);
  });
}

/* =====================================================================
   FORMULARIO DE CREACIÓN
   ===================================================================== */
const form = $("#form-funcion");
const msg = $("#form-msg");

function setError(campo, texto) {
  const el = $(`#err-${campo}`);
  if (el) el.textContent = texto || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  msg.className = "form-msg";

  const nombre = limpiar($("#f-nombre").value);
  const anio = $("#f-anio").value;
  const fecha = $("#f-fecha").value;
  const hora = $("#f-hora").value;
  const link = limpiar($("#f-link").value);
  const organizador = limpiar($("#f-organizador").value);

  let valido = true;
  setError("nombre", ""); setError("anio", ""); setError("fecha", "");
  setError("hora", ""); setError("link", "");

  if (!nombre) { setError("nombre", "Ingresá el nombre de la película."); valido = false; }
  if (!anio) { setError("anio", "Ingresá el año de estreno."); valido = false; }
  if (!fecha) { setError("fecha", "Elegí una fecha."); valido = false; }
  if (!hora) { setError("hora", "Elegí un horario."); valido = false; }
  if (!link) { setError("link", "Pegá el link de la transmisión."); valido = false; }
  else if (!esUrlValida(link)) { setError("link", "El link no parece una URL válida (debe empezar con http:// o https://)."); valido = false; }

  if (!valido) return;

  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  try {
    await backend.add({
      nombre,
      anio: Number(anio),
      fecha,
      hora,
      link,
      organizador,
      asistentes: [],
      creatorId: creatorId()
    });
    form.reset();
    msg.textContent = "¡Función creada! Ya aparece en la cartelera de abajo. 🎉";
    msg.classList.add("ok");
  } catch (err) {
    msg.textContent = "Ocurrió un error al guardar la función. Probá de nuevo.";
    msg.classList.add("err");
    console.error(err);
  } finally {
    btn.disabled = false;
  }
});

/* =====================================================================
   BUSCADOR Y FILTRO DE FECHA
   ===================================================================== */
$("#buscador").addEventListener("input", (e) => {
  textoBusqueda = e.target.value.trim().toLowerCase();
  render();
});
$("#filtro-fecha").addEventListener("input", (e) => {
  fechaFiltro = e.target.value;
  render();
});
$("#limpiar-filtros").addEventListener("click", () => {
  textoBusqueda = "";
  fechaFiltro = "";
  $("#buscador").value = "";
  $("#filtro-fecha").value = "";
  render();
});

/* =====================================================================
   ARRANQUE
   ===================================================================== */
if (!CONFIGURADO) {
  $("#setup-banner").classList.remove("hidden");
}

backend.subscribe((items) => {
  funciones = items;
  render();
});
