// mi-perfil.js — devuelve RFC y empresa del cliente autenticado
// Consulta clientes_billing por auth_user_id con service key (sin restricciones RLS)
// para que funcione aunque user_metadata.rfc esté vacío.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token requerido' }) };
  }

  // Usar service key para evitar restricciones RLS
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Verificar el token y obtener el usuario
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión inválida' }) };
  }

  // El tipo 'despacho' tiene su propia lógica en el frontend
  if (user.user_metadata?.tipo === 'despacho') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tipo: 'despacho', rfc: null, empresa: user.user_metadata?.empresa || null }),
    };
  }

  // Buscar en clientes_billing por auth_user_id
  const { data: billing, error: dbErr } = await sb
    .from('clientes_billing')
    .select('cliente_rfc, empresa')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (dbErr) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error de base de datos' }) };
  }

  if (!billing) {
    // Fallback: intentar derivar RFC del email {rfc}@clicklaboral.mx
    const email = user.email || '';
    const rfcFromEmail = email.includes('@clicklaboral.mx')
      ? email.split('@')[0].toUpperCase()
      : null;

    if (rfcFromEmail) {
      return { statusCode: 200, headers, body: JSON.stringify({ rfc: rfcFromEmail, empresa: rfcFromEmail }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Cliente no encontrado' }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ rfc: billing.cliente_rfc, empresa: billing.empresa }),
  };
};
