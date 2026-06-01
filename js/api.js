// ── api.js — Cliente para la API REST (versión corregida) ───────────────────

if (!window.DEFAULT_API_BASE) {
  window.DEFAULT_API_BASE = 'https://elprofehugo.online/api/v1';
}
if (!window.CACHE_STORES) {
  window.CACHE_STORES = {
    PERSONAS: 'personas_cache',
    MASCOTAS: 'mascotas_cache',
    CENSOS:   'censos_cache',
  };
}

if (!window.__API_LOADED__) {
  window.__API_LOADED__ = true;
  window.API_BASE = window.__API_BASE__ || window.DEFAULT_API_BASE;
  window.API_BASE = window.API_BASE.replace(/\/$/, '');
}

const CACHE_STORES = window.CACHE_STORES;

function esErrorConexion(err) {
  return err?.message?.includes('Error de conexión') ||
         err?.message?.includes('Failed to fetch')   ||
         err?.message?.includes('NetworkError');
}

async function obtenerCacheOffline(cacheStore, pendingStore) {
  if (typeof window?.leerCache !== 'function') return [];
  const cache      = await window.leerCache(cacheStore).catch(() => []);
  const pendientes = typeof window?.leerPendientes === 'function'
    ? await window.leerPendientes(pendingStore).catch(() => [])
    : [];
  return [...cache, ...pendientes];
}

// ── Función base de fetch con JWT ────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
  const token = obtenerToken();
  const url   = `${window.API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  try {
    console.log('[API] fetch', { url, method: options.method || 'GET' });
    const response = await fetch(url, { ...options, headers });

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new Error(`Error al procesar respuesta del servidor: ${parseErr.message}`);
    }

    if (!response.ok) {
      if (response.status === 401) cerrarSesion();
      let errMsg = data?.error || data?.message || `Error ${response.status}`;
      if (Array.isArray(data?.message)) errMsg = data.message.join('. ');
      console.error(`[API] ${response.status} ${url}:`, errMsg, data);
      throw new Error(errMsg);
    }

    return data;
  } catch (fetchErr) {
    if (fetchErr instanceof TypeError && fetchErr.message.includes('Failed to fetch')) {
      throw new Error(`Error de conexión: verifica que el servidor esté disponible y permita CORS desde ${window.location.origin}`);
    }
    throw fetchErr;
  }
}

// ═══ PERSONAS ════════════════════════════════════════════════════════════════
// FIX: se acepta opción { skipQueue } para evitar re-encolar durante sincronización
async function crearPersona(datos, { skipQueue = false } = {}) {
  const { id, ...payload } = datos || {};
  try {
    return await apiFetch('/personas/registro', {
      method: 'POST',
      body:   JSON.stringify(payload),
    });
  } catch (err) {
    if (!skipQueue && esErrorConexion(err) && typeof window?.guardarEnCola === 'function') {
      await window.guardarEnCola(window.STORES?.PERSONAS || 'personas_pendientes', datos);
      window.actualizarBadgePendientes?.();
      return { ...datos, pendiente: true };
    }
    throw err;
  }
}

async function obtenerPersonas(rol = '') {
  const endpoint = `/personas${rol ? `?rol=${encodeURIComponent(rol)}` : ''}`;
  let personas = [];
  
  try {
    personas = await apiFetch(endpoint);
    if (typeof guardarCache === 'function')
      guardarCache(CACHE_STORES.PERSONAS, Array.isArray(personas) ? personas : []);
  } catch (err) {
    console.warn('[API] obtenerPersonas fallback offline:', err.message);
    personas = await obtenerCacheOffline(CACHE_STORES.PERSONAS, window.STORES?.PERSONAS || 'personas_pendientes');
  }
  
  // ── Agregar pendientes (no duplicados) ──────────────────────────────────
  if (typeof window?.leerPendientes === 'function') {
    try {
      const pendientes = await window.leerPendientes(window.STORES?.PERSONAS || 'personas_pendientes');
      const idsExistentes = new Set(personas.map(p => p.id));
      const pendientesUnicos = pendientes.filter(p => !idsExistentes.has(p.id));
      personas = [...personas, ...pendientesUnicos];
      console.log('[API] obtenerPersonas: +', pendientesUnicos.length, 'pendientes');
    } catch (e) {
      console.warn('[API] Error leyendo pendientes de personas:', e.message);
    }
  }
  
  return Array.isArray(personas) ? personas : [];
}

// ═══ MASCOTAS ════════════════════════════════════════════════════════════════
// FIX: se acepta opción { skipQueue } para evitar re-encolar durante sincronización
async function crearMascota(datos, { skipQueue = false } = {}) {
  const { id, ...payload } = datos || {};
  const payloadLimpio = Object.fromEntries(
    Object.entries(payload).filter(([_, v]) => v !== undefined && v !== null)
  );
  console.log('[API] crearMascota payload:', payloadLimpio);
  try {
    return await apiFetch('/mascotas', {
      method: 'POST',
      body:   JSON.stringify(payloadLimpio),
    });
  } catch (err) {
    if (!skipQueue && esErrorConexion(err) && typeof window?.guardarEnCola === 'function') {
      await window.guardarEnCola(window.STORES?.MASCOTAS || 'mascotas_pendientes', datos);
      window.actualizarBadgePendientes?.();
      return { ...datos, pendiente: true };
    }
    throw err;
  }
}

async function obtenerMascotas() {
  let mascotas = [];
  
  try {
    mascotas = await apiFetch('/mascotas');
    if (typeof guardarCache === 'function')
      guardarCache(CACHE_STORES.MASCOTAS, Array.isArray(mascotas) ? mascotas : []);
  } catch (err) {
    console.warn('[API] obtenerMascotas fallback offline:', err.message);
    mascotas = await obtenerCacheOffline(CACHE_STORES.MASCOTAS, window.STORES?.MASCOTAS || 'mascotas_pendientes');
  }
  
  // ── Agregar pendientes (no duplicados) ──────────────────────────────────
  if (typeof window?.leerPendientes === 'function') {
    try {
      const pendientes = await window.leerPendientes(window.STORES?.MASCOTAS || 'mascotas_pendientes');
      const idsExistentes = new Set(mascotas.map(m => m.id));
      const pendientesUnicos = pendientes.filter(m => !idsExistentes.has(m.id));
      mascotas = [...mascotas, ...pendientesUnicos];
      console.log('[API] obtenerMascotas: +', pendientesUnicos.length, 'pendientes');
    } catch (e) {
      console.warn('[API] Error leyendo pendientes de mascotas:', e.message);
    }
  }
  
  return Array.isArray(mascotas) ? mascotas : [];
}

// ═══ CENSOS ══════════════════════════════════════════════════════════════════
// FIX: se acepta opción { skipQueue } para evitar re-encolar durante sincronización.
//      idProyecto y color ya vienen en `datos` cuando se llama desde sincronizarTodo
//      (se guardaron junto con el censo en censo.html), así no dependemos de
//      getProyectoConfig() en contextos donde puede no estar disponible.
async function crearCenso(datos, { skipQueue = false } = {}) {
  const { id, ...payload } = datos || {};

  // Si idProyecto/color no vienen en datos (llamada directa desde el formulario),
  // los tomamos de getProyectoConfig() como antes.
  let body;
  if (payload.idProyecto) {
    body = JSON.stringify(payload);
  } else {
    const config = (typeof getProyectoConfig === 'function') ? getProyectoConfig() : {};
    body = JSON.stringify({ idProyecto: config.idProyecto, color: config.color, ...payload });
  }

  try {
    return await apiFetch('/censos', { method: 'POST', body });
  } catch (err) {
    if (!skipQueue && esErrorConexion(err) && typeof window?.guardarEnCola === 'function') {
      await window.guardarEnCola(window.STORES?.CENSOS || 'censos_pendientes', datos);
      window.actualizarBadgePendientes?.();
      return { ...datos, pendiente: true };
    }
    throw err;
  }
}

async function obtenerCensos() {
  let censos = [];
  
  try {
    censos = await apiFetch('/censos');
    if (typeof guardarCache === 'function')
      guardarCache(CACHE_STORES.CENSOS, Array.isArray(censos) ? censos : []);
  } catch (err) {
    console.warn('[API] obtenerCensos fallback offline:', err.message);
    censos = await obtenerCacheOffline(CACHE_STORES.CENSOS, window.STORES?.CENSOS || 'censos_pendientes');
  }
  
  // ── Agregar pendientes (no duplicados) ──────────────────────────────────
  if (typeof window?.leerPendientes === 'function') {
    try {
      const pendientes = await window.leerPendientes(window.STORES?.CENSOS || 'censos_pendientes');
      const idsExistentes = new Set(censos.map(c => c.id));
      const pendientesUnicos = pendientes.filter(c => !idsExistentes.has(c.id));
      censos = [...censos, ...pendientesUnicos];
      console.log('[API] obtenerCensos: +', pendientesUnicos.length, 'pendientes');
    } catch (e) {
      console.warn('[API] Error leyendo pendientes de censos:', e.message);
    }
  }
  
  return Array.isArray(censos) ? censos : [];
}

// ═══ PUSH ════════════════════════════════════════════════════════════════════
async function suscribirPush(suscripcion) {
  return apiFetch('/push/subscriptions', {
    method: 'POST',
    body:   JSON.stringify(suscripcion),
  });
}

async function obtenerVapidPublicKey() {
  const data = await apiFetch('/push/key');
  return data.publicKey;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
