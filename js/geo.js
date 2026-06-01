// ── geo.js — Geolocalización del dispositivo ────────────────────────────────

let ultimaUbicacion = null;

// ── Obtener ubicación actual como promesa ────────────────────────────────────
function obtenerUbicacion(opciones = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalización no disponible en este navegador'));
      return;
    }

    const config = {
      enableHighAccuracy: true,
      timeout:            15000,
      maximumAge:         0,
      ...opciones,
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        ultimaUbicacion = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        resolve(ultimaUbicacion);
      },
      (err) => {
        let mensaje;
        switch (err.code) {
          case err.PERMISSION_DENIED:
            mensaje = 'Permiso de ubicación denegado. Actívalo en la configuración del navegador.';
            break;
          case err.POSITION_UNAVAILABLE:
            mensaje = 'Ubicación no disponible. Verifica tu GPS o conexión.';
            break;
          case err.TIMEOUT:
            mensaje = 'Tiempo de espera agotado obteniendo la ubicación.';
            break;
          default:
            mensaje = 'Error desconocido al obtener la ubicación.';
        }
        reject(new Error(mensaje));
      },
      config
    );
  });
}

// ── Obtener la última ubicación guardada ─────────────────────────────────────
function getUltimaUbicacion() {
  return ultimaUbicacion;
}

// ── Mostrar coordenadas en elementos del DOM ─────────────────────────────────
function mostrarCoordenadas(lat, lon, precisionMetros) {
  const elLat = document.getElementById('coord-lat');
  const elLon = document.getElementById('coord-lon');
  const elAcc = document.getElementById('coord-accuracy');

  if (elLat) elLat.textContent = lat.toFixed(7);
  if (elLon) elLon.textContent = lon.toFixed(7);
  if (elAcc && precisionMetros !== undefined) {
    elAcc.textContent = `± ${Math.round(precisionMetros)} m`;
  }
}
