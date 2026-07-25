const firebaseConfig = {
  apiKey: "AIzaSyAjphMyAb7eoV1pHPyAGbDEoUkKZMXkGnU",
  authDomain: "inscripciones-9a302.firebaseapp.com",
  projectId: "inscripciones-9a302",
  storageBucket: "inscripciones-9a302.firebasestorage.app",
  messagingSenderId: "221455024162",
  appId: "1:221455024162:web:4662be1293735f08240a7b"
};

const ADMIN_PASSWORD = "cineclub-admin";

const CONFIGURADO = firebaseConfig.apiKey !== "TU_API_KEY";


const NOMBRES_MES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

function mesInfo(fechaStr) {
  const [anioStr, mesStr] = (fechaStr || "").split("-");
  const anio = Number(anioStr);
  const mes = Number(mesStr);
  const nombreMes = NOMBRES_MES[mes - 1] || "Sin-mes";
  return {
    mesId: `${anioStr}-${mesStr}`,       // ej: "2026-07" → id de la carpeta
    anio,
    mes,
    carpeta: `Funciones ${nombreMes}`,    // ej: "Funciones Julio"
    etiqueta: `Funciones ${nombreMes} ${anio}` // con año, para no confundir julios de distintos años
  };
}

/* =====================================================================
   CAPA DE DATOS
   Expone siempre la misma interfaz (subscribe / add / update / remove)
   sin importar si estamos usando Firestore o el modo local de respaldo.
   Cada función viaja acompañada de su "f" completo (no solo el id)
   para que el backend sepa en qué carpeta de mes vive.
   ===================================================================== */

let backend;

if (CONFIGURADO) {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const {
    getFirestore, collection, collectionGroup, onSnapshot, addDoc, updateDoc,
    deleteDoc, doc, setDoc, arrayUnion, serverTimestamp
  } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const carpetaRef = (mesId) => doc(db, "carpetas", mesId);
  const funcionesDelMes = (mesId) => collection(db, "carpetas", mesId, "funciones");

  // Crea (o actualiza) el documento de la carpeta del mes. setDoc con
  // merge:true no pisa nada si la carpeta ya existía — así se "crea
  // automáticamente" la primera vez y después simplemente se reutiliza.
  async function asegurarCarpeta(info) {
    await setDoc(carpetaRef(info.mesId), {
      nombre: info.carpeta,
      anio: info.anio,
      mes: info.mes
    }, { merge: true });
  }

  backend = {
    subscribe(cb) {
      // collectionGroup escucha la subcolección "funciones" dentro de
      // TODAS las carpetas de mes a la vez, en tiempo real.
      const q = collectionGroup(db, "funciones");
      return onSnapshot(q, (snap) => {
        const items = [];
        snap.forEach((d) => {
          items.push({ id: d.id, mesId: d.ref.parent.parent.id, ...d.data() });
        });
        cb(items);
      });
    },
    async add(data) {
      const info = mesInfo(data.fecha);
      await asegurarCarpeta(info);
      await addDoc(funcionesDelMes(info.mesId), {
        ...data,
        mesId: info.mesId,
        creadoEn: serverTimestamp()
      });
    },
    async update(f, cambios) {
      const infoNueva = mesInfo(cambios.fecha);
      if (infoNueva.mesId === f.mesId) {
        await updateDoc(doc(db, "carpetas", f.mesId, "funciones", f.id), cambios);
      } else {
        // La función cambió de mes (se editó la fecha): se mueve a la
        // carpeta correspondiente, creándola si todavía no existe.
        await asegurarCarpeta(infoNueva);
        const { id, mesId, ...resto } = f;
        await addDoc(funcionesDelMes(infoNueva.mesId), { ...resto, ...cambios, mesId: infoNueva.mesId });
        await deleteDoc(doc(db, "carpetas", f.mesId, "funciones", f.id));
      }
    },
    async addAsistente(f, nombre) {
      await updateDoc(doc(db, "carpetas", f.mesId, "funciones", f.id), { asistentes: arrayUnion(nombre) });
    },
    async remove(f) {
      await deleteDoc(doc(db, "carpetas", f.mesId, "funciones", f.id));
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
      const info = mesInfo(data.fecha);
      const items = leer();
      items.push({ id: idNuevo(), ...data, mesId: info.mesId });
      escribir(items);
    },
    async update(f, cambios) {
      const infoNueva = mesInfo(cambios.fecha);
      const items = leer().map((it) =>
        it.id === f.id ? { ...it, ...cambios, mesId: infoNueva.mesId } : it
      );
      escribir(items);
    },
    async addAsistente(f, nombre) {
      const items = leer().map((it) => {
        if (it.id !== f.id) return it;
        const asistentes = Array.isArray(it.asistentes) ? it.asistentes : [];
        if (asistentes.includes(nombre)) return it;
        return { ...it, asistentes: [...asistentes, nombre] };
      });
      escribir(items);
    },
    async remove(f) {
      escribir(leer().filter((it) => it.id !== f.id));
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

function fechaSoloA_Date(fecha) {
  // fecha: YYYY-MM-DD -> Date a las 00:00 hora local.
  // La hora ahora es texto libre (para poner país/zona horaria), así que
  // el orden y el estado "finalizada" se calculan solo con el día.
  return new Date(`${fecha}T00:00:00`);
}

function hoyA_Date() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return hoy;
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

  const visibles = aplicarFiltros(funciones);

  vacio.classList.toggle("hidden", funciones.length !== 0);
  if (funciones.length !== 0 && visibles.length === 0) {
    cont.innerHTML = `<p class="empty-state">Ninguna función coincide con la búsqueda o el filtro.</p>`;
    return;
  }

  // Agrupar automáticamente por mes ("carpeta"): cada función cae en
  // el grupo que le corresponde según su fecha, sin intervención manual.
  const carpetas = new Map();
  visibles.forEach((f) => {
    const info = mesInfo(f.fecha);
    if (!carpetas.has(info.mesId)) carpetas.set(info.mesId, { info, items: [] });
    carpetas.get(info.mesId).items.push(f);
  });

  const mesesOrdenados = Array.from(carpetas.keys()).sort();

  mesesOrdenados.forEach((mesId) => {
    const { info, items } = carpetas.get(mesId);
    items.sort((a, b) => {
      const porFecha = fechaSoloA_Date(a.fecha) - fechaSoloA_Date(b.fecha);
      if (porFecha !== 0) return porFecha;
      return (a.hora || "").localeCompare(b.hora || "");
    });
    cont.appendChild(crearCarpeta(info, items));
  });
}

function crearCarpeta(info, items) {
  const carpeta = document.createElement("section");
  carpeta.className = "mini-window carpeta-mes";
  carpeta.setAttribute("aria-label", info.etiqueta);

  const barra = document.createElement("div");
  barra.className = "mini-titlebar";
  barra.innerHTML = `<span>🗂️ ${info.etiqueta} <span class="carpeta-contador">(${items.length})</span></span>`;
  carpeta.appendChild(barra);

  const cuerpo = document.createElement("div");
  cuerpo.className = "mini-body";
  const grid = document.createElement("div");
  grid.className = "funciones-grid";
  items.forEach((f) => grid.appendChild(crearTarjeta(f)));
  cuerpo.appendChild(grid);
  carpeta.appendChild(cuerpo);

  return carpeta;
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
  const btnCopiar = $(".btn-copiar", nodo);
  const sinLinkMsg = $(".sin-link", nodo);
  if (f.link) {
    link.href = f.link;
  } else {
    link.classList.add("hidden");
    btnCopiar.classList.add("hidden");
    sinLinkMsg.classList.remove("hidden");
  }

  const fechaFuncion = fechaSoloA_Date(f.fecha);
  const finalizada = fechaFuncion.getTime() < hoyA_Date().getTime();
  const badge = $(".ticket-badge", nodo);
  if (finalizada) {
    nodo.classList.add("finalizada");
    badge.textContent = "Finalizada";
    badge.classList.remove("hidden");
  }

  // Cuenta regresiva (por día — la hora es texto libre y puede incluir país/zona horaria)
  const countdownEl = $(".ticket-countdown", nodo);
  function actualizarCountdown() {
    const diffDias = Math.round((fechaFuncion.getTime() - hoyA_Date().getTime()) / 86400000);
    const horaTexto = f.hora ? ` — ${f.hora}` : "";
    if (diffDias < 0) {
      countdownEl.textContent = "";
    } else if (diffDias === 0) {
      countdownEl.textContent = `🎬 ¡Es hoy!${horaTexto}`;
    } else if (diffDias === 1) {
      countdownEl.textContent = `⏳ Es mañana${horaTexto}`;
    } else {
      countdownEl.textContent = `⏳ Faltan ${diffDias} días${horaTexto}`;
    }
  }
  actualizarCountdown();
  if (!finalizada) {
    timers.push(setInterval(actualizarCountdown, 60000));
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
      await backend.addAsistente(f, nombre);
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
    await backend.remove(f);
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
  const hora = window.prompt("Hora (podés incluir el país o la zona horaria, ej: 20:30 Argentina):", f.hora);
  if (hora === null) return;
  const link = window.prompt("Link de la transmisión (opcional, dejalo vacío si todavía no lo tenés):", f.link || "");
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

  if (!datos.nombre || !datos.anio || !datos.fecha || !datos.hora) {
    window.alert("Datos inválidos. No se guardaron los cambios.");
    return;
  }
  if (datos.link && !esUrlValida(datos.link)) {
    window.alert("El link no parece una URL válida. No se guardaron los cambios.");
    return;
  }

  // Si la fecha cambió de mes, esto mueve la función a la carpeta
  // mensual correspondiente automáticamente (ver backend.update).
  backend.update(f, datos).catch((err) => {
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
  if (!hora) { setError("hora", "Escribí la hora (podés incluir el país o la zona horaria)."); valido = false; }
  if (link && !esUrlValida(link)) { setError("link", "El link no parece una URL válida (debe empezar con http:// o https://)."); valido = false; }

  if (!valido) return;

  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  try {
    // La carpeta del mes (ej. "Funciones Julio") se crea sola acá adentro
    // si todavía no existía — ver backend.add más arriba.
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
    msg.textContent = "¡Función creada! Ya aparece en su carpeta del mes, abajo. 🎉";
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
