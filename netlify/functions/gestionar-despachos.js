// netlify/functions/gestionar-despachos.js
//
// Alta y gestión de despachos (contadores/abogados/RRHH en marca blanca)
// desde el dashboard de administración, usando la service_role key.
//
// Acciones (POST con JSON { accion: ... }):
//   { accion:'listar' }
//       → lista de despachos con su cartera
//   { accion:'crear', email, password, nombre_despacho, color?, clientes? }
//       → crea el usuario tipo despacho
//   { accion:'agregar_cliente', despacho_id, rfc, empresa }
//       → agrega un cliente a la cartera del despacho
//   { accion:'quitar_cliente', despacho_id, rfc }
//       → quita un cliente de la cartera
//
// ⚠️ Igual que solicitudes-admin.js: este endpoint no tiene login propio.
// Hereda la misma brecha del dashboard admin — conviene cerrarla pronto
// con autenticación real del administrador.
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { verificarAdmin } = require('./_admin-auth');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno de Supabase.' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const _admin = await verificarAdmin(event, supabase);
  if (!_admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado. Inicie sesión como administrador.' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const responder = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });

  try {
    const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const usuarios = usersData?.users || [];
    const despachos = usuarios.filter(u => u.user_metadata?.tipo === 'despacho');

    switch (body.accion) {

      case 'listar': {
        return responder(200, {
          despachos: despachos.map(d => ({
            id: d.id,
            email: d.email,
            nombre: d.user_metadata?.nombre_despacho || '(sin nombre)',
            color: d.user_metadata?.color || '#1e3a5f',
            tipo: d.user_metadata?.tipo_despacho || 'contador',
            rango: d.user_metadata?.rango_clientes || '3-9',
            clientes: d.user_metadata?.despacho_clientes || [],
            creado: d.created_at,
          })),
        });
      }

      case 'crear': {
        const { email, password, nombre_despacho, color, clientes } = body;
        if (!email || !password || !nombre_despacho) {
          return responder(400, { error: 'Faltan datos: email, password y nombre del despacho son obligatorios.' });
        }
        if (password.length < 8) return responder(400, { error: 'La contraseña debe tener al menos 8 caracteres.' });

        const { data, error } = await supabase.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          password,
          email_confirm: true,
          user_metadata: {
            tipo: 'despacho',
            nombre_despacho: nombre_despacho.trim(),
            color: color || '#1e3a5f',
            tipo_despacho: body.tipo_despacho || 'contador',
            rango_clientes: body.rango_clientes || '3-9',
            despacho_clientes: Array.isArray(clientes) ? clientes : [],
          },
        });
        if (error) {
          if (/already/i.test(error.message)) return responder(409, { error: 'Ya existe un usuario con ese correo.' });
          throw error;
        }
        return responder(200, { ok: true, id: data.user.id, mensaje: 'Despacho creado. Entrega estas credenciales al despacho: entra en /panel-despacho.html' });
      }

      case 'agregar_cliente': {
        const { despacho_id, rfc, empresa } = body;
        if (!despacho_id || !rfc) return responder(400, { error: 'Faltan despacho_id y rfc.' });
        const d = despachos.find(x => x.id === despacho_id);
        if (!d) return responder(404, { error: 'Despacho no encontrado.' });
        const lista = d.user_metadata?.despacho_clientes || [];
        const rfcU = rfc.trim().toUpperCase();
        if (lista.some(c => String(c.rfc).toUpperCase() === rfcU)) {
          return responder(409, { error: 'Ese RFC ya está en la cartera de este despacho.' });
        }
        const rango = d.user_metadata?.rango_clientes || '3-9';
        const limites = { '3-9':9, '10-24':24, '25-49':49, '50+':Infinity };
        const maximo = limites[rango] ?? 9;
        if (lista.length >= maximo) {
          return responder(403, { error: `Límite de clientes alcanzado para el plan ${rango}. Actualice el plan del despacho para agregar más.` });
        }
        lista.push({ rfc: rfcU, empresa: (empresa || rfcU).trim() });
        await supabase.auth.admin.updateUserById(despacho_id, {
          user_metadata: { ...d.user_metadata, despacho_clientes: lista },
        });
        return responder(200, { ok: true, clientes: lista });
      }

      case 'quitar_cliente': {
        const { despacho_id, rfc } = body;
        if (!despacho_id || !rfc) return responder(400, { error: 'Faltan despacho_id y rfc.' });
        const d = despachos.find(x => x.id === despacho_id);
        if (!d) return responder(404, { error: 'Despacho no encontrado.' });
        const rfcU = rfc.trim().toUpperCase();
        const lista = (d.user_metadata?.despacho_clientes || []).filter(c => String(c.rfc).toUpperCase() !== rfcU);
        await supabase.auth.admin.updateUserById(despacho_id, {
          user_metadata: { ...d.user_metadata, despacho_clientes: lista },
        });
        return responder(200, { ok: true, clientes: lista });
      }

      default:
        return responder(400, { error: 'Acción no reconocida.' });
    }
  } catch (e) {
    console.error('gestionar-despachos:', e.message || e);
    return responder(500, { error: e.message || 'Error interno.' });
  }
};
