// netlify/functions/_admin-auth.js
//
// Helpers compartidos de autorización para las funciones serverless.
//
//   verificarAdmin(event, supabase)      → user si es admin, si no null
//   verificarSesion(event, supabase)     → user de cualquier sesión válida, si no null
//   puedeAccederRFC(user, rfc)           → true si el usuario puede operar sobre ese RFC
//   cabecerasCORS(event)                 → headers CORS restringidos al dominio propio
//
// El frontend envía el token en el header: Authorization: Bearer <access_token>
//   const { data } = await sb.auth.getSession();
//   data.session.access_token

// ─────────────────────────────────────────────────────────────────────────────
// CORS restringido
// ─────────────────────────────────────────────────────────────────────────────
// Antes todas las funciones respondían Access-Control-Allow-Origin: '*', lo que
// permitía que cualquier página de internet llamara a la API desde el navegador
// de un cliente logueado. Ahora solo se aceptan los orígenes propios.

const ORIGENES_FIJOS = [
  'https://clicklaboral.mx',
  'https://www.clicklaboral.mx',
];

function origenesPermitidos() {
  const lista = [...ORIGENES_FIJOS];
  // URLs que Netlify inyecta automáticamente (producción y deploy previews)
  if (process.env.URL) lista.push(process.env.URL);
  if (process.env.DEPLOY_PRIME_URL) lista.push(process.env.DEPLOY_PRIME_URL);
  return lista;
}

function cabecerasCORS(event) {
  const origen = (event && event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const permitidos = origenesPermitidos();
  // Si el origen no está en la lista, se responde con el dominio canónico:
  // el navegador bloqueará la respuesta en el sitio del atacante.
  const elegido = permitidos.includes(origen) ? origen : ORIGENES_FIJOS[0];
  return {
    'Access-Control-Allow-Origin': elegido,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación de sesión
// ─────────────────────────────────────────────────────────────────────────────

function extraerToken(event) {
  const auth = (event && event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

// Devuelve el usuario de cualquier sesión válida (cliente, despacho o admin).
async function verificarSesion(event, supabase) {
  try {
    const token = extraerToken(event);
    if (!token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch (_) {
    return null;
  }
}

// Devuelve el usuario solo si tiene rol de administrador.
async function verificarAdmin(event, supabase) {
  const user = await verificarSesion(event, supabase);
  if (!user) return null;
  return (user.user_metadata && user.user_metadata.role === 'admin') ? user : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Autorización por RFC
// ─────────────────────────────────────────────────────────────────────────────
// Mismo criterio que ya usa guardar-documento-expediente.js:
//   · admin      → puede operar sobre cualquier RFC
//   · despacho   → solo sobre los RFC de su lista despacho_clientes
//   · cliente    → solo sobre su propio RFC
function puedeAccederRFC(user, rfc) {
  if (!user || !rfc) return false;
  const meta = user.user_metadata || {};
  const rfcU = String(rfc).toUpperCase().trim();

  if (meta.role === 'admin') return true;

  if (meta.tipo === 'despacho') {
    const autorizados = (meta.despacho_clientes || [])
      .map(function (c) { return String((c && c.rfc) || '').toUpperCase().trim(); });
    return autorizados.indexOf(rfcU) !== -1;
  }

  const rfcPropio = String(meta.rfc || '').toUpperCase().trim();
  return !!rfcPropio && rfcPropio === rfcU;
}

module.exports = {
  verificarAdmin,
  verificarSesion,
  puedeAccederRFC,
  cabecerasCORS,
};
