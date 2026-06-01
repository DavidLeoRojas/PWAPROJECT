// ── auth.js — Gestión de autenticación y JWT ────────────────────────────────

const AUTH_KEY = 'censo_jwt';
const USER_KEY = 'censo_user';

// Configuración del proyecto (asignados por el docente)
const PROYECTO_CONFIG = {
  idProyecto: 'Prowa_007', 
  color:      '#c2F0FF',        
};

// ── Guardar / leer / borrar token ───────────────────────────────────────────
function guardarToken(token, usuario) {
  // ⚠️ TESTING: Todos los usuarios son ADMIN (cambiar rol de vuelta después de testing)
  const normalized = { ...usuario, rol: 'ADMIN' };
  localStorage.setItem(AUTH_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(normalized));
}

function obtenerToken() {
  return localStorage.getItem(AUTH_KEY);
}

function obtenerUsuario() {
  const u = localStorage.getItem(USER_KEY);
  if (!u) return null;
  const usuario = JSON.parse(u);
  // ⚠️ TESTING: Devolver siempre ADMIN (cambiar de vuelta después de testing)
  return { ...usuario, rol: 'ADMIN' };
}

function getIndexPath() {
  return location.pathname.includes('/pages/') ? '../index.html' : './index.html';
}

function cerrarSesion() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = getIndexPath();
}

// ── Verificar si el token es válido (no expirado) ───────────────────────────
function tokenValido() {
  const token = obtenerToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// ── Proteger páginas: redirigir si no hay sesión ─────────────────────────────
function requiereAuth() {
  if (!tokenValido()) {
    window.location.href = getIndexPath();
  }
}

// ── Mostrar info del usuario en la navbar ────────────────────────────────────
function mostrarUsuarioNavbar() {
  const u = obtenerUsuario();
  const el = document.getElementById('nav-user-name');
  if (el && u) {
    const rolVisible = u.rol ? ` (${u.rol === 'ADMIN' ? 'Admin' : 'Dueño'})` : '';
    el.textContent = `${u.nombres} ${u.apellidos}${rolVisible}`;
  }
  ajustarMenuPorRol(u);
}

function ajustarMenuPorRol(usuario) {
  if (!usuario || usuario.rol !== 'ADMIN') {
    // Ocultar enlaces no permitidos para dueños
    const enlacesNoPermitidos = [
      'personas.html', 'duenos.html', 'mascotas.html', 'censo.html',
      '/pages/personas.html', '/pages/duenos.html', '/pages/mascotas.html', '/pages/censo.html'
    ];
    enlacesNoPermitidos.forEach(href => {
      const link = document.querySelector(`a[href="${href}"]`);
      if (link) {
        const li = link.closest('li');
        if (li) li.remove();
        else link.style.display = 'none';
      }
    });
  }
}

function esAdmin() {
  const u = obtenerUsuario();
  return u && u.rol && u.rol.toString().toUpperCase() === 'ADMIN';
}

if (!window.DEFAULT_API_BASE) {
  window.DEFAULT_API_BASE = 'https://elprofehugo.online/api/v1';
}
function getApiBase() {
  return (window.__API_BASE__ || window.DEFAULT_API_BASE).replace(/\/$/, '');
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login(usuario, contrasena) {
  const res = await fetch(`${getApiBase()}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ usuario, contrasena }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
  guardarToken(data.token, data.usuario);
  return data;
}

// ── Exportar configuración del proyecto ─────────────────────────────────────
function getProyectoConfig() {
  return PROYECTO_CONFIG;
}
