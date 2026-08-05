// netlify/functions/registrar-referidor.js
//
// Crea la cuenta de referidor del lado del servidor (service_role), evitando
// el problema de que sb.auth.signUp() del navegador no entrega una sesión
// activa si "Confirmar email" está activado en Supabase — sin sesión, el
// INSERT a la tabla "referidores" se ejecuta como anónimo y la política de
// RLS lo rechaza ("new row violates row-level security policy").
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'El servidor no está configurado (faltan variables de Supabase en Netlify).' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { nombre, despacho, email, telefono, password, codigo } = body;
  if (!nombre || !email || !password || !codigo) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan datos obligatorios (nombre, email, contraseña o código)' }) };
  }
  if (password.length < 8) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La contraseña debe tener al menos 8 caracteres' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 0. Evitar duplicados de código (poco probable, pero por seguridad)
    const { data: existente } = await supabase.from('referidores').select('id').eq('codigo', codigo).maybeSingle();
    if (existente) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Ese código ya está en uso, intente de nuevo.' }) };
    }

    // 1. Crear el usuario en Supabase Auth, confirmado de inmediato (sin esperar email)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email, password,
      email_confirm: true,
      user_metadata: { role: 'referidor', codigo_referidor: codigo },
    });
    if (authError) throw authError;

    // 2. Insertar el registro en la tabla referidores (service_role, sin RLS de por medio)
    const { error: dbError } = await supabase.from('referidores').insert({
      codigo, nombre, email,
      telefono: telefono || null,
      despacho: despacho || null,
      porcentaje_comision: 25,
      activo: true,
    });
    if (dbError) {
      // Si falla el insert, no dejar una cuenta de Auth huérfana sin registro
      try { await supabase.auth.admin.deleteUser(authData.user.id); } catch (cleanupErr) { /* no bloquea */ }
      throw dbError;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, codigo }) };

  } catch (err) {
    console.error('Error registrando referidor:', err);
    let mensaje = err.message || 'Error al crear la cuenta';
    if (/already.*registered|already exists/i.test(mensaje)) mensaje = 'Ya existe una cuenta con ese correo.';
    return { statusCode: 500, headers, body: JSON.stringify({ error: mensaje }) };
  }
};
