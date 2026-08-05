// netlify/functions/buscar-cliente-admin.js
//
// (Reconstruida — la versión original se perdió del repositorio local.)
// Operaciones administrativas sobre cuentas de clientes, con la
// service_role key. PROTEGIDA: requiere sesión de administrador
// (Authorization: Bearer <token> con user_metadata.role === 'admin').
//
// GET  ?rfc=XXX    → { user }  usuario cuyo user_metadata.rfc coincide
// GET  ?rfc=TODOS  → { users } todos los usuarios de auth
// POST { accion:'cambiar-password', userId, pass }
// POST { accion:'reset-email', email }
// POST { accion:'eliminar', userId }   (borra usuario + sus datos por RFC)
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { verificarAdmin } = require('./_admin-auth');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno de Supabase.' }) };
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const responder = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });

  const admin = await verificarAdmin(event, supabase);
  if (!admin) return responder(401, { error: 'No autorizado. Inicie sesión como administrador.' });

  try {
    if (event.httpMethod === 'GET') {
      const rfc = (event.queryStringParameters?.rfc || '').trim();
      if (!rfc) return responder(400, { error: 'Falta el parámetro rfc.' });
      const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const usuarios = data?.users || [];
      if (rfc.toUpperCase() === 'TODOS') return responder(200, { users: usuarios });
      const user = usuarios.find(u => (u.user_metadata?.rfc || '').toUpperCase() === rfc.toUpperCase());
      if (!user) return responder(404, { error: 'No se encontró ningún usuario con ese RFC.', user: null });
      return responder(200, { user });
    }

    if (event.httpMethod !== 'POST') return responder(405, { error: 'Método no permitido' });
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return responder(400, { error: 'JSON inválido' }); }

    switch (body.accion) {

      case 'cambiar-password': {
        const { userId, pass } = body;
        if (!userId || !pass || pass.length < 8) return responder(400, { error: 'userId y contraseña (mín. 8) son obligatorios.' });
        const { error } = await supabase.auth.admin.updateUserById(userId, { password: pass });
        if (error) throw error;
        return responder(200, { ok: true });
      }

      case 'reset-email': {
        const { email } = body;
        if (!email) return responder(400, { error: 'Falta el email.' });
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        return responder(200, { ok: true });
      }

      case 'eliminar': {
        const { userId } = body;
        if (!userId) return responder(400, { error: 'Falta userId.' });
        // Obtener el RFC antes de borrar, para limpiar sus datos
        const { data: uData } = await supabase.auth.admin.getUserById(userId);
        const rfc = uData?.user?.user_metadata?.rfc || null;

        const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
        if (delErr) throw delErr;

        // Limpieza de datos del cliente (tolerante a tablas inexistentes)
        if (rfc) {
          for (const tabla of ['asistencias', 'documentos_identidad', 'documentos_expediente', 'solicitudes', 'trabajadores']) {
            try { await supabase.from(tabla).delete().eq('cliente_rfc', rfc); }
            catch (e) { console.warn(`No se pudo limpiar ${tabla}:`, e.message || e); }
          }
        }
        return responder(200, { ok: true });
      }

      default:
        return responder(400, { error: 'Acción no reconocida.' });
    }
  } catch (e) {
    console.error('buscar-cliente-admin:', e.message || e);
    return responder(500, { error: e.message || 'Error interno.' });
  }
};
