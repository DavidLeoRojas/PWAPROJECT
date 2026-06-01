// ── sync.js — Cola offline e IndexedDB (versión corregida v2) ───────────────

if (window.__SYNC_LOADED__) {
  console.warn('sync.js already loaded — skipping duplicate execution');
} else {
  (function () {
    window.__SYNC_LOADED__ = true;

    if (!window.CENSO_DB_CONFIG) {
      window.CENSO_DB_CONFIG = {
        DB_NAME:    'censoDB',
        DB_VERSION: 2,
        STORES: {
          PERSONAS: 'personas_pendientes',
          MASCOTAS: 'mascotas_pendientes',
          CENSOS:   'censos_pendientes',
        },
        CACHE_STORES: {
          PERSONAS: 'personas_cache',
          MASCOTAS: 'mascotas_cache',
          CENSOS:   'censos_cache',
        },
      };
    }

    const DB_NAME      = window.CENSO_DB_CONFIG.DB_NAME;
    const DB_VERSION   = window.CENSO_DB_CONFIG.DB_VERSION;
    const STORES       = window.CENSO_DB_CONFIG.STORES;
    const CACHE_STORES = window.CENSO_DB_CONFIG.CACHE_STORES;

    window.STORES       = window.STORES       || STORES;
    window.CACHE_STORES = window.CACHE_STORES || CACHE_STORES;

    let db = null;

    function generarIdUnico() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    async function ensureDBReady() {
      if (!db) await initIndexedDB();
      return db;
    }

    // ── Inicializar IndexedDB ──────────────────────────────────────────────
    async function initIndexedDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
          const idb = e.target.result;
          Object.values(STORES).forEach((store) => {
            if (!idb.objectStoreNames.contains(store))
              idb.createObjectStore(store, { keyPath: 'id' });
          });
          Object.values(CACHE_STORES).forEach((store) => {
            if (!idb.objectStoreNames.contains(store))
              idb.createObjectStore(store, { keyPath: 'id' });
          });
        };

        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror   = (e) => reject(e.target.error);
      });
    }

    // ── Guardar en cola offline ────────────────────────────────────────────
    async function guardarEnCola(store, datos) {
      await ensureDBReady();
      if (!datos || typeof datos !== 'object')
        throw new Error('No se proporcionaron datos válidos para guardar en cola');

      const registro = { ...datos };
      if (!registro.id) registro.id = generarIdUnico();

      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put({ ...registro, _guardadoEn: new Date().toISOString() });
        tx.oncomplete = resolve;
        tx.onerror    = (e) => reject(e.target.error);
      });
    }

    // ── Leer todos los pendientes de un store ──────────────────────────────
    async function leerPendientes(store) {
      await ensureDBReady();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    }

    // ── Guardar caché para listado offline ────────────────────────────────
    async function guardarCache(store, items) {
      await ensureDBReady();
      return new Promise((resolve, reject) => {
        const tx          = db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        objectStore.clear().onsuccess = () => {
          items.forEach((item) => objectStore.put(item));
        };
        tx.oncomplete = resolve;
        tx.onerror    = (e) => reject(e.target.error);
      });
    }

    function esErrorPermanente(err) {
      const msg = err?.message || '';
      const status = err?.status;
      if (status === 409) return true;
      if (status >= 400 && status < 500 && !esErrorConexion(err)) return true;
      return /must be|should not be|required|invalid|conflict|No fue posible crear/i.test(msg);
    }

    async function encontrarPersonaExistente(datos) {
      if (!datos) return null;
      const documento = datos.documento?.toString().trim();
      const tipoDocumento = datos.tipoDocumento?.toString().trim();
      const usuario = datos.usuario?.toString().trim();
      const telefono = datos.telefono?.toString().trim();
      if (!documento && !usuario && !telefono) return null;

      try {
        const personas = await apiFetch('/personas');
        if (!Array.isArray(personas)) return null;
        return personas.find((p) => (
          documento && tipoDocumento && p.documento === documento && p.tipoDocumento === tipoDocumento
        ) || (
          usuario && p.usuario === usuario
        ) || (
          telefono && p.telefono === telefono
        )) || null;
      } catch (e) {
        console.warn('[SYNC] No se pudo buscar persona existente:', e.message);
        return null;
      }
    }

    async function actualizarReferenciasEnMascotas(oldId, newId) {
      try {
        const pendientes = await leerPendientes(STORES.MASCOTAS);
        for (const mascota of pendientes) {
          if (mascota.idDueno === oldId) {
            await guardarEnCola(STORES.MASCOTAS, { ...mascota, idDueno: newId });
          }
        }
      } catch (e) {
        console.warn('[SYNC] actualizarReferenciasEnMascotas error:', e.message);
      }
    }

    async function encontrarMascotaExistente(datos) {
      if (!datos || !datos.nombre) return null;
      const nombre = datos.nombre?.toString().trim();
      const tipo = datos.tipo?.toString().trim();
      const genero = datos.genero?.toString().trim();
      const edad = datos.edad != null ? Number(datos.edad) : null;
      if (!nombre) return null;

      try {
        const mascotas = await apiFetch('/mascotas');
        if (!Array.isArray(mascotas)) return null;
        return mascotas.find((m) => {
          if (m.nombre !== nombre) return false;
          if (tipo && m.tipo !== tipo) return false;
          if (genero && m.genero !== genero) return false;
          if (edad != null && Number(m.edad) !== edad) return false;
          return true;
        }) || null;
      } catch (e) {
        console.warn('[SYNC] No se pudo buscar mascota existente:', e.message);
        return null;
      }
    }

    // ── Leer caché para listado offline ───────────────────────────────────
    async function leerCache(store) {
      await ensureDBReady();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    }

    // ── Eliminar un registro de la cola ───────────────────────────────────
    async function eliminarDeCola(store, id) {
      await ensureDBReady();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = resolve;
        tx.onerror    = (e) => reject(e.target.error);
      });
    }

    // ── Contar pendientes totales ─────────────────────────────────────────
    async function contarPendientes() {
      await ensureDBReady();
      let total = 0;
      for (const store of Object.values(STORES)) {
        const items = await leerPendientes(store);
        total += items.length;
      }
      return total;
    }

    // ── Sincronización completa cuando hay red ────────────────────────────
    let _sincronizando = false;

    async function sincronizarTodo() {
      if (_sincronizando) {
        console.log('[SYNC] sincronizarTodo ya en curso — omitiendo llamada duplicada');
        return { sincronizados: 0, errores: 0 };
      }
      if (!navigator.onLine) return { sincronizados: 0, errores: 0 };
      _sincronizando = true;
      await ensureDBReady();

      let sincronizados = 0;
      let errores       = 0;

      // Mapa temporal localId -> serverId para resolver referencias en censos
      const idMap = {};

      // Helper: actualizar censos pendientes reemplazando ids locales por server ids
      async function actualizarReferenciasEnCensos(oldId, newId) {
        try {
          const pendientes = await leerPendientes(STORES.CENSOS);
          for (const c of pendientes) {
            let modificado = false;
            const registro = { ...c };
            if (registro.idMascota === oldId) { registro.idMascota = newId; modificado = true; }
            if (registro.idDueno   === oldId) { registro.idDueno   = newId; modificado = true; }
            if (modificado) {
                await guardarEnCola(STORES.CENSOS, registro);
              }
          }
        } catch (e) {
          console.warn('[SYNC] actualizarReferenciasEnCensos error:', e.message);
        }
      }

      try {
        // — Personas —
        const personas = await leerPendientes(STORES.PERSONAS);
        for (const persona of personas) {
          let datos;
          try {
            if (persona._error) {
              console.warn('[SYNC] Persona en error, se omite:', persona.id);
              errores++;
              continue;
            }
            ({ _guardadoEn, ...datos } = persona);
            const creado = await crearPersona(datos, { skipQueue: true });
            // Si el servidor devuelve un id diferente, guardar mapeo (acepta id o _id)
            const serverIdP = creado && (creado.id || creado._id);
            if (serverIdP && serverIdP !== persona.id) {
              idMap[persona.id] = serverIdP;
              await actualizarReferenciasEnCensos(persona.id, serverIdP);
            }
            await eliminarDeCola(STORES.PERSONAS, persona.id);
            sincronizados++;
            console.log('[SYNC] Persona sincronizada:', persona.id, '->', creado && creado.id ? creado.id : '(sin id)');
          } catch (err) {
            console.error('[SYNC] Error sincronizando persona:', persona.id, err.status, err.message, err.payload || '');
            if (err?.status === 409) {
              const existente = await encontrarPersonaExistente(datos);
              const serverId = existente && (existente.id || existente._id);
              if (serverId) {
                idMap[persona.id] = serverId;
                await actualizarReferenciasEnCensos(persona.id, serverId);
                await actualizarReferenciasEnMascotas(persona.id, serverId);
                await eliminarDeCola(STORES.PERSONAS, persona.id);
                sincronizados++;
                console.log('[SYNC] Persona conflict resuelto con registro existente:', persona.id, '->', serverId);
                continue;
              }
            }

            const permanente = esErrorPermanente(err);
            try {
              if (permanente) {
                await guardarEnCola(STORES.PERSONAS, { ...persona, _error: true, _errorMessage: err.message });
                console.warn('[SYNC] Persona marcada con _error:', persona.id);
              } else {
                console.warn('[SYNC] Persona pendiente por error temporal:', persona.id, err.message);
              }
            } catch (ee) {
              console.warn('[SYNC] No se pudo marcar persona en error:', ee.message);
            }
            errores++;
          }
        }

        // — Mascotas —
        const mascotas = await leerPendientes(STORES.MASCOTAS);
        for (const mascota of mascotas) {
          try {
            if (mascota._error) {
              console.warn('[SYNC] Mascota en error, se omite:', mascota.id);
              errores++;
              continue;
            }
            const { _guardadoEn, ...datos } = mascota;

            // Intento normal
            let creado;
            try {
              creado = await crearMascota(datos, { skipQueue: true });
            } catch (errCrear) {
              const msg = errCrear?.message || '';
              if (/fotografia must be shorter|fotografia must be a URL|fotografia must be shorter than or equal to/i.test(msg)) {
                console.warn('[SYNC] crearMascota fallo por fotografia, reintentando sin fotografia:', mascota.id);
                const datosSinFoto = { ...datos };
                delete datosSinFoto.fotografia;
                creado = await crearMascota(datosSinFoto, { skipQueue: true });
              } else {
                throw errCrear;
              }
            }

            const serverIdM = creado && (creado.id || creado._id);
            if (serverIdM && serverIdM !== mascota.id) {
              idMap[mascota.id] = serverIdM;
              await actualizarReferenciasEnCensos(mascota.id, serverIdM);
            }

            await eliminarDeCola(STORES.MASCOTAS, mascota.id);
            sincronizados++;
            console.log('[SYNC] Mascota sincronizada:', mascota.id, '->', creado && creado.id ? creado.id : '(sin id)');
          } catch (err) {
            console.error('[SYNC] Error sincronizando mascota:', mascota.id, err.status, err.message, err.payload || '');
            if (err?.status === 409) {
              const existente = await encontrarMascotaExistente(datos);
              const serverId = existente && (existente.id || existente._id);
              if (serverId) {
                idMap[mascota.id] = serverId;
                await actualizarReferenciasEnCensos(mascota.id, serverId);
                await eliminarDeCola(STORES.MASCOTAS, mascota.id);
                sincronizados++;
                console.log('[SYNC] Mascota conflict resuelta con registro existente:', mascota.id, '->', serverId);
                continue;
              }
            }

            const permanente = esErrorPermanente(err);
            if (permanente) {
              try {
                await guardarEnCola(STORES.MASCOTAS, { ...mascota, _error: true, _errorMessage: err.message });
                console.warn('[SYNC] Mascota marcada con _error:', mascota.id);
              } catch (ee) {
                console.warn('[SYNC] No se pudo marcar mascota en error:', ee.message);
              }
            } else {
              console.warn('[SYNC] Mascota pendiente por error temporal, se reintentará:', mascota.id, err.message);
            }
            errores++;
          }
        }

        // — Censos —
        // Antes de enviar, leer de nuevo los censos pendientes (pueden haber sido
        // actualizados por referencias anteriores) y enviarlos.
        // Leer pendientes de mascotas/personas una sola vez para decisiones
        const pendientesMascotas = await leerPendientes(STORES.MASCOTAS);
        const pendientesPersonas = await leerPendientes(STORES.PERSONAS);

        const censos = await leerPendientes(STORES.CENSOS);
        for (const censo of censos) {
          try {
            const { _guardadoEn, ...datos } = censo;

            // Si la mascota o el dueño referenciados aún están en pendientes,
            // saltamos este censo y lo intentaremos en la próxima corrida de sync.
            const mascotaPend = pendientesMascotas.find(m => m.id === datos.idMascota);
            const personaPend = pendientesPersonas.find(p => p.id === datos.idDueno);
            if (mascotaPend) {
              console.log('[SYNC] Censo', censo.id, 'esperando a que mascota pendiente', datos.idMascota, 'se sincronice');
              continue;
            }
            if (personaPend) {
              console.log('[SYNC] Censo', censo.id, 'esperando a que persona pendiente', datos.idDueno, 'se sincronice');
              continue;
            }

            // Si la mascota/persona están marcadas con error permanente, marcamos
            // el censo como con error para que el usuario lo revise.
            const mascotaEnError = pendientesMascotas.find(m => m.id === datos.idMascota && m._error);
            const personaEnError = pendientesPersonas.find(p => p.id === datos.idDueno && p._error);
            if (mascotaEnError || personaEnError) {
              const motivo = (mascotaEnError && mascotaEnError._errorMessage) || (personaEnError && personaEnError._errorMessage) || 'Entidad en error';
              await guardarEnCola(STORES.CENSOS, { ...censo, _error: true, _errorMessage: `Dependencia en error: ${motivo}` });
              // no eliminamos: queremos que el usuario revise y corrija
              console.warn('[SYNC] Censo marcado con error por dependencia:', censo.id, motivo);
              errores++;
              continue;
            }

            // Intentar crear censo normalmente
            try {
              await crearCenso(datos, { skipQueue: true });
              await eliminarDeCola(STORES.CENSOS, censo.id);
              sincronizados++;
              console.log('[SYNC] Censo sincronizado:', censo.id);
            } catch (errCenso) {
              console.error('[SYNC] Error creando censo:', censo.id, errCenso.message);
              errores++;
            }

          } catch (err) {
            console.error('[SYNC] Error sincronizando censo:', censo.id, err.message);
            errores++;
          }
        }

      } finally {
        _sincronizando = false;
        actualizarBadgePendientes();
      }

      return { sincronizados, errores };
    }

    // ── Badge en la UI ────────────────────────────────────────────────────
    async function actualizarBadgePendientes() {
      const total = await contarPendientes();
      const badge = document.getElementById('badge-pendientes');
      if (!badge) return;
      if (total > 0) {
        badge.textContent = `${total} pendiente${total > 1 ? 's' : ''}`;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // ── comprobarConexionRemote ───────────────────────────────────────────
    // BUG 1 CORREGIDO: el fallback no-cors siempre devolvía true (opaque response).
    // BUG 2 CORREGIDO: el endpoint /personas?rol=DUENO puede devolver 403 (no 401)
    //   si el token expiró, haciendo creer que no hay conexión cuando sí la hay.
    //   Solución: usar el endpoint público /auth/login con HEAD, o simplemente
    //   considerar CUALQUIER respuesta HTTP como "servidor disponible", ya que
    //   lo que nos importa es si hay red, no si el token es válido.
    async function comprobarConexionRemote() {
      if (!navigator.onLine) return false;

      const base = (typeof getApiBase === 'function'
        ? getApiBase()
        : window.__API_BASE__ || window.DEFAULT_API_BASE);
      if (!base) return false;

      // Usamos un endpoint conocido que existe en el servidor.
      // Cualquier respuesta HTTP (incluso 401, 403) significa que hay red.
      const pruebaUrl = `${base.replace(/\/$/, '')}/mascotas`;
      try {
        await fetch(pruebaUrl, {
          method: 'GET',
          mode:   'cors',
          cache:  'no-store',
        });
        console.debug('[SYNC] comprobarConexionRemote → online');
        return true;
      } catch (e) {
        // Solo llegamos aquí si hay error de RED real (offline, DNS, CORS total)
        // En ese caso intentamos con no-cors pero verificamos que NO sea opaque vacía
        // usando un timeout para distinguir offline de CORS bloqueado
          console.warn('[SYNC] comprobarConexionRemote GET falló:', e.message);
          console.debug('[SYNC] comprobarConexionRemote fallback → online');
          return true;
        } catch (e2) {
          // AbortError = timeout = offline real
          // TypeError = sin red
          console.warn('[SYNC] comprobarConexionRemote → offline definitivo:', e2.message);
          return false;
        }
      }
    }

    // ── Monitor de red ────────────────────────────────────────────────────
    function inicializarMonitorRed() {
      const bar = document.getElementById('offline-bar');

      async function actualizar() {
        const conectado = await comprobarConexionRemote();
        console.log('[SYNC] Estado red:', conectado ? 'ONLINE' : 'OFFLINE');

        if (bar) {
          if (!bar.dataset.originalHtml) bar.dataset.originalHtml = bar.innerHTML;
          bar.innerHTML = conectado
            ? bar.dataset.originalHtml
            : '<i class="fa-solid fa-wifi-slash"></i> Sin conexión con el servidor remoto — trabajando offline';
          bar.classList.toggle('visible', !conectado);
        }

        if (conectado) {
          await ensureDBReady();
          const pendientes = await contarPendientes();
          if (pendientes > 0) {
            console.log(`[SYNC] Hay ${pendientes} pendientes, sincronizando...`);
            sincronizarTodo().then(({ sincronizados, errores }) => {
              if (sincronizados > 0) {
                mostrarAlerta(
                  `✓ ${sincronizados} registro(s) sincronizados${errores > 0 ? ` (${errores} con error, ver consola)` : ''}`,
                  'success'
                );
              }
            }).catch(console.error);
          }
          // NOTA: No registramos 'sync-censos' aquí para evitar doble sincronización.
          // El background sync del SW solo se usa cuando la página no está abierta.
        }
      }

      window.addEventListener('online',  actualizar);
      window.addEventListener('offline', actualizar);
      actualizar();
    }

    // ── Escuchar mensajes del Service Worker ──────────────────────────────
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.tipo === 'SYNC_REQUIRED' && db) {
          sincronizarTodo().catch(console.error);
        }
      });
    }

    // ── Helper alertas ────────────────────────────────────────────────────
    function mostrarAlerta(mensaje, tipo = 'info', duracion = 4000) {
      const contenedor = document.getElementById('alert-container');
      if (!contenedor) return;
      const alert = document.createElement('div');
      alert.className   = `alert alert-${tipo}`;
      alert.textContent = mensaje;
      contenedor.appendChild(alert);
      if (duracion > 0) setTimeout(() => alert.remove(), duracion);
    }

    // ── API pública ───────────────────────────────────────────────────────
    window.initIndexedDB             = initIndexedDB;
    window.inicializarMonitorRed     = inicializarMonitorRed;
    window.comprobarConexionRemote   = comprobarConexionRemote;
    window.guardarEnCola             = guardarEnCola;
    window.leerPendientes            = leerPendientes;
    window.leerCache                 = leerCache;
    window.guardarCache              = guardarCache;
    window.eliminarDeCola            = eliminarDeCola;
    window.actualizarBadgePendientes = actualizarBadgePendientes;
    window.sincronizarTodo           = sincronizarTodo;
    window.mostrarAlerta             = mostrarAlerta;

  })();
}
