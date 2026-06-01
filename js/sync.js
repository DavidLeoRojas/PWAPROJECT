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
          try {
            const { _guardadoEn, ...datos } = persona;
            const creado = await crearPersona(datos, { skipQueue: true });
            // Si el servidor devuelve un id diferente, guardar mapeo
            if (creado && creado.id && creado.id !== persona.id) {
              idMap[persona.id] = creado.id;
              await actualizarReferenciasEnCensos(persona.id, creado.id);
            }
            await eliminarDeCola(STORES.PERSONAS, persona.id);
            sincronizados++;
            console.log('[SYNC] Persona sincronizada:', persona.id, '->', creado && creado.id ? creado.id : '(sin id)');
          } catch (err) {
            console.error('[SYNC] Error sincronizando persona:', persona.id, err.message);
            errores++;
          }
        }

        // — Mascotas —
        const mascotas = await leerPendientes(STORES.MASCOTAS);
        for (const mascota of mascotas) {
          try {
            const { _guardadoEn, ...datos } = mascota;

            // Intento normal
            let creado;
            try {
              creado = await crearMascota(datos, { skipQueue: true });
            } catch (errCrear) {
              // Si el error indica que la fotografía es demasiado grande o no es URL,
              // intentamos reenviar sin la propiedad 'fotografia'. Esto evita bloquear
              // toda la cola por una validación del servidor.
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

            if (creado && creado.id && creado.id !== mascota.id) {
              idMap[mascota.id] = creado.id;
              await actualizarReferenciasEnCensos(mascota.id, creado.id);
            }

            await eliminarDeCola(STORES.MASCOTAS, mascota.id);
            sincronizados++;
            console.log('[SYNC] Mascota sincronizada:', mascota.id, '->', creado && creado.id ? creado.id : '(sin id)');
          } catch (err) {
            console.error('[SYNC] Error sincronizando mascota:', mascota.id, err.message);
            errores++;
          }
        }

        // — Censos —
        // Antes de enviar, leer de nuevo los censos pendientes (pueden haber sido
        // actualizados por referencias anteriores) y enviarlos.
        const censos = await leerPendientes(STORES.CENSOS);
        for (const censo of censos) {
          try {
            const { _guardadoEn, ...datos } = censo;

            // Intentar crear censo; si falla por 'No existe mascota/dueno',
            // reintentar creando primero la entidad faltante desde la cola.
            let intento = 0;
            const maxIntentos = 2;
            while (intento < maxIntentos) {
              intento++;
              try {
                await crearCenso(datos, { skipQueue: true });
                // éxito
                await eliminarDeCola(STORES.CENSOS, censo.id);
                sincronizados++;
                console.log('[SYNC] Censo sincronizado:', censo.id);
                break;
              } catch (errCenso) {
                const msg = errCenso?.message || '';
                console.warn('[SYNC] crearCenso fallo (intento', intento, '):', msg);
                // Buscar referencia faltante en el mensaje
                const faltaMascota = /No existe mascota con id\s*([0-9a-fA-F\-]+)/i.exec(msg);
                const faltaDueno   = /No existe persona con id\s*([0-9a-fA-F\-]+)/i.exec(msg);

                if (faltaMascota && intento < maxIntentos) {
                  const missingId = faltaMascota[1];
                  console.log('[SYNC] Mascota faltante detectada:', missingId, 'intentando crearla desde pendientes');
                  // Buscar la mascota en la cola de mascotas
                  const pendientesMasc = await leerPendientes(STORES.MASCOTAS);
                  const mascotaPend = pendientesMasc.find(m => m.id === missingId);
                  if (mascotaPend) {
                    try {
                      const { _guardadoEn, ...mDatos } = mascotaPend;
                      // Reusar la misma lógica de creación con reintento de foto
                      try {
                        await crearMascota(mDatos, { skipQueue: true });
                      } catch (errCrearM) {
                        const msg2 = errCrearM?.message || '';
                        if (/fotografia must be shorter|fotografia must be a URL|fotografia must be shorter than or equal to/i.test(msg2)) {
                          const mSinFoto = { ...mDatos };
                          delete mSinFoto.fotografia;
                          await crearMascota(mSinFoto, { skipQueue: true });
                        } else throw errCrearM;
                      }
                      // si se creó, eliminar mascota de la cola y continuar reintento censo
                      await eliminarDeCola(STORES.MASCOTAS, mascotaPend.id);
                      continue; // reintentar crear el censo
                    } catch (e) {
                      console.error('[SYNC] Error creando mascota faltante:', e.message);
                      break; // salir del while y contabilizar error de censo
                    }
                  } else {
                    console.warn('[SYNC] Mascota faltante no encontrada en pendientes:', missingId);
                    break;
                  }
                } else if (faltaDueno && intento < maxIntentos) {
                  const missingId = faltaDueno[1];
                  console.log('[SYNC] Persona faltante detectada:', missingId, 'intentando crearla desde pendientes');
                  const pendientesPers = await leerPendientes(STORES.PERSONAS);
                  const personaPend = pendientesPers.find(p => p.id === missingId);
                  if (personaPend) {
                    try {
                      const { _guardadoEn, ...pDatos } = personaPend;
                      await crearPersona(pDatos, { skipQueue: true });
                      await eliminarDeCola(STORES.PERSONAS, personaPend.id);
                      continue; // reintentar crear el censo
                    } catch (e) {
                      console.error('[SYNC] Error creando persona faltante:', e.message);
                      break;
                    }
                  } else {
                    console.warn('[SYNC] Persona faltante no encontrada en pendientes:', missingId);
                    break;
                  }
                } else {
                  // Error distinto o máximos intentos alcanzados
                  throw errCenso;
                }
              }
            }
            // Si salimos del while sin romper por éxito, comprobar si el censo fue creado
            // Si no se eliminó de la cola, contamos como error
            const existe = await leerPendientes(STORES.CENSOS);
            if (existe.find(x => x.id === censo.id)) {
              console.error('[SYNC] Error sincronizando censo (persistente):', censo.id);
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

      // Usamos un endpoint que siempre responde sin importar autenticación.
      // Cualquier respuesta HTTP (incluso 401, 403, 404) significa que hay red.
      // Solo un error de red (TypeError: Failed to fetch) significa offline real.
      const pruebaUrl = `${base.replace(/\/$/, '')}/auth/login`;
      try {
        await fetch(pruebaUrl, {
          method: 'HEAD',   // no descarga body, solo verifica conexión
          mode:   'cors',
          cache:  'no-store',
        });
        // Si llegamos aquí (con o sin error HTTP) hay conexión
        console.debug('[SYNC] comprobarConexionRemote → online');
        return true;
      } catch (e) {
        // Solo llegamos aquí si hay error de RED real (offline, DNS, CORS total)
        // En ese caso intentamos con no-cors pero verificamos que NO sea opaque vacía
        // usando un timeout para distinguir offline de CORS bloqueado
        console.warn('[SYNC] comprobarConexionRemote HEAD falló:', e.message);

        // Segundo intento: ping al servidor base
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 3000); // timeout 3s
          await fetch(base.replace(/\/$/, ''), {
            method: 'GET',
            mode:   'no-cors',
            cache:  'no-store',
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          // Con no-cors, si no lanza excepción = hay red (aunque sea opaque)
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
