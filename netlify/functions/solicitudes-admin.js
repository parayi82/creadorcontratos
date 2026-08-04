// netlify/functions/solicitudes-admin.js
//
// Lee y actualiza las solicitudes de asesoría de TODOS los clientes,
// usando la service_role key del servidor (nunca llega al navegador).
// Esto es necesario porque dashboard-compliance.html no tiene su propio
// login — usa este endpoint en vez de consultar Supabase directo con la
// llave anon, que por RLS solo dejaría ver las solicitudes del cliente
// dueño de la sesión (y el dashboard no tiene ninguna sesión de cliente).
//
// ⚠️ Esto no sustituye un login real para el dashboard del abogado.
// Cualquiera con la URL de este endpoint puede leer/editar todas las
// solicitudes, igual que ya puede entrar a dashboard-compliance.html
// sin contraseña. Es una brecha real que conviene cerrar pronto con un
// login propio — ver nota en la respuesta del chat.
//
// Variables de entorno requeridas:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');
const { verificarAdmin } = require('./_admin-auth');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase no está configurado en el servidor (SUPABASE_URL / SUPABASE_SERVICE_KEY).' }) };
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const _admin = await verificarAdmin(event, supabase);
  if (!_admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado. Inicie sesión como administrador.' }) };

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('solicitudes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ solicitudes: data || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { id, status, respuesta, accion } = body;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta el id de la solicitud' }) };

      // Eliminar solicitud
      if (accion === 'eliminar') {
        const { error } = await supabase.from('solicitudes').delete().eq('id', id);
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      const update = {};
      if (status) update.status = status;
      if (respuesta !== undefined) update.respuesta = respuesta;

      const { error } = await supabase.from('solicitudes').update(update).eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  } catch (err) {
    console.error('Error en solicitudes-admin:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Error al consultar solicitudes' }) };
  }
};
