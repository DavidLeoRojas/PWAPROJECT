// ── notificaciones.js — Gestión de suscripción Push ────────────────────────
//
// Endpoints del backend utilizados:
//   GET  /api/v1/push/key           → { publicKey: "..." }   (público)
//   POST /api/v1/push/subscriptions → 204                    (requiere JWT)
//
// El backend envía el push automáticamente cuando se crea un censo.
// Este módulo solo gestiona la suscripción del dispositivo.
//
// API pública:
//   window.initNotificaciones(containerId?)  → monta botón toggle
//   window.getSuscripcionActiva()            → Promise<PushSubscription|null>

(function () {
  if (window.__NOTIF_LOADED__) return;
  window.__NOTIF_LOADED__ = true;

  let swReg = null;

  // ── Recuperar el SW registrado ───────────────────────────────────────────
  async function getSWReg() {
    if (swReg) return swReg;
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker no soportado');
    swReg = await navigator.serviceWorker.ready;
    return swReg;
  }

  // ── Convertir base64url → Uint8Array (requerido para VAPID) ─────────────
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  // ── Consultar suscripción activa en este dispositivo ────────────────────
  async function getSuscripcionActiva() {
    const reg = await getSWReg();
    return reg.pushManager.getSubscription();  // null si no hay suscripción
  }

  // ── Suscribir este dispositivo al push ───────────────────────────────────
  // 1. Pide permiso al usuario
  // 2. Obtiene la VAPID public key del backend  (GET /push/key)
  // 3. Crea la suscripción en el navegador
  // 4. Registra la suscripción en el backend    (POST /push/subscriptions)
  async function suscribir() {
    // Pedir permiso
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('Permiso de notificaciones denegado por el usuario');

    // Obtener clave pública VAPID del backend
    const publicKey = await obtenerVapidPublicKey();   // definida en api.js
    if (!publicKey) throw new Error('No se pudo obtener la clave VAPID del servidor');

    // Crear suscripción en el navegador
    const reg = await getSWReg();
    const suscripcion = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Registrar en el backend (POST /api/v1/push/subscriptions, con JWT)
    await suscribirPush(suscripcion.toJSON());   // definida en api.js → devuelve 204
    return suscripcion;
  }

  // ── Desuscribir este dispositivo ─────────────────────────────────────────
  // Solo desuscribe localmente en el navegador.
  // El backend expirará la suscripción automáticamente cuando intente enviar.
  async function desuscribir() {
    const sub = await getSuscripcionActiva();
    if (sub) await sub.unsubscribe();
  }

  // ── Reflejar estado en el botón ──────────────────────────────────────────
  async function actualizarBoton(btn) {
    if (!btn) return;
    try {
      const sub      = await getSuscripcionActiva();
      const activo   = !!sub;
      btn.dataset.activo = activo ? 'true' : 'false';
      btn.innerHTML  = activo
        ? '<i class="fa-solid fa-bell"></i> Notificaciones activadas'
        : '<i class="fa-solid fa-bell-slash"></i> Activar notificaciones';
      btn.classList.toggle('btn-success',   activo);
      btn.classList.toggle('btn-secondary', !activo);
    } catch (e) {
      console.warn('[NOTIF] actualizarBoton:', e);
    }
  }

  // ── Montar el botón toggle en el DOM ────────────────────────────────────
  async function initNotificaciones(containerId = 'notif-btn-container') {
    if (!('PushManager' in window)) {
      console.warn('[NOTIF] PushManager no disponible en este navegador/contexto');
      return;
    }
    const container = document.getElementById(containerId);
    if (!container) return;

    const btn = document.createElement('button');
    btn.id            = 'btn-notificaciones';
    btn.type          = 'button';
    btn.className     = 'btn btn-secondary';
    btn.style.cssText = 'margin-top:0.5rem;width:100%';
    container.appendChild(btn);

    // Reflejar estado actual antes de mostrar
    await actualizarBoton(btn);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (btn.dataset.activo === 'true') {
          await desuscribir();
          if (typeof mostrarAlerta === 'function')
            mostrarAlerta('Notificaciones desactivadas', 'info');
        } else {
          await suscribir();
          if (typeof mostrarAlerta === 'function')
            mostrarAlerta('¡Notificaciones activadas! Recibirás alertas cuando se registre un nuevo censo.', 'success');
        }
      } catch (err) {
        console.error('[NOTIF]', err);
        if (typeof mostrarAlerta === 'function')
          mostrarAlerta(err.message || 'Error al gestionar notificaciones', 'danger');
      } finally {
        btn.disabled = false;
        await actualizarBoton(btn);
      }
    });
  }

  // ── API pública ──────────────────────────────────────────────────────────
  window.initNotificaciones   = initNotificaciones;
  window.getSuscripcionActiva = getSuscripcionActiva;

})();
