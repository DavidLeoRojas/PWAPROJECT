// ── camera.js — Captura y compresión de fotografías ────────────────────────

const MAX_SIZE_BYTES = 51200;   // 50 KB estricto
const MAX_DIMENSION  = 640;     // px máximo antes de comprimir

// ── Comprimir imagen al tamaño permitido ─────────────────────────────────────
function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calcular dimensiones manteniendo proporción
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height / width) * MAX_DIMENSION);
            width  = MAX_DIMENSION;
          } else {
            width  = Math.round((width / height) * MAX_DIMENSION);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Comprimir iterativamente hasta ≤50 KB
        let quality = 0.8;
        let base64  = canvas.toDataURL('image/jpeg', quality);

        while (calcularBytesBase64(base64) > MAX_SIZE_BYTES && quality > 0.1) {
          quality -= 0.05;
          base64   = canvas.toDataURL('image/jpeg', quality);
        }

        const bytesFinales = calcularBytesBase64(base64);
        if (bytesFinales > MAX_SIZE_BYTES) {
          reject(new Error(`La imagen no puede comprimirse a menos de 50 KB. Usa una foto más pequeña.`));
          return;
        }

        resolve({ base64, bytes: bytesFinales, quality: Math.round(quality * 100) });
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Error leyendo el archivo'));
    reader.readAsDataURL(file);
  });
}

// ── Calcular tamaño real en bytes de un string Base64 ───────────────────────
function calcularBytesBase64(base64String) {
  const data    = base64String.includes(',') ? base64String.split(',')[1] : base64String;
  const padding = (data.match(/=+$/) || [''])[0].length;
  return Math.ceil((data.length * 3) / 4) - padding;
}

// ── Formatear bytes a texto legible ─────────────────────────────────────────
function formatearBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── Inicializar el campo de foto con preview y validación ────────────────────
function inicializarCampoFoto(inputId, previewId, infoId) {
  const input   = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const info    = document.getElementById(infoId);

  if (!input) return;

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Solo imágenes
    if (!file.type.startsWith('image/')) {
      mostrarAlerta('Solo se permiten archivos de imagen', 'danger');
      input.value = '';
      return;
    }

    try {
      mostrarCargando(infoId, 'Comprimiendo imagen...');
      const resultado = await comprimirImagen(file);

      // Guardar en el input como data attribute
      input.dataset.base64 = resultado.base64;

      // Mostrar preview
      if (preview) {
        preview.src = resultado.base64;
        preview.classList.add('visible');
      }

      if (info) {
        info.textContent = `OK ${formatearBytes(resultado.bytes)} — Calidad: ${resultado.quality}%`;
        info.style.color = 'var(--success)';
      }
    } catch (err) {
      if (info) {
        info.textContent = `Error: ${err.message}`;
        info.style.color = 'var(--danger)';
      }
      input.value = '';
      delete input.dataset.base64;
    }
  });
}

function mostrarCargando(infoId, mensaje) {
  const el = document.getElementById(infoId);
  if (el) { el.textContent = mensaje; el.style.color = 'var(--text-muted)'; }
}
