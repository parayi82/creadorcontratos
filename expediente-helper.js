// expediente-helper.js
// Módulo compartido por todos los generadores de documentos. Permite:
//   1) Elegir un trabajador del roster para autocompletar y ligar el doc a su expediente
//   2) Guardar un registro en documentos_expediente
//   3) Imprimir / exportar a PDF
//
// Uso: ExpedienteHelper.init({ inputNombreId: 'trabajador', tipoDocumento: 'acta_administrativa' });
// Para docs empresariales sin trabajador: inputNombreId: null

(function (global) {
  const SUPABASE_URL = 'https://hpzgqaplrywwjuvrzhcp.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1g8US8iFJ8CxnSaF_4MHgA_gqyyAr3W';

  let sb = null;
  let rfcCliente = null;
  let trabajadorSeleccionadoId = null;
  let roster = [];
  let config = {};

  function getClient() {
    if (!sb) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return sb;
  }

  async function cargarRoster() {
    try {
      const { data } = await getClient().auth.getSession();
      const _meta = data?.session?.user?.user_metadata || {};
      if (_meta.tipo === 'despacho') {
        let _g = null;
        try { _g = JSON.parse(sessionStorage.getItem('cl_gestion')||'null'); } catch(_) {}
        const { data: _dcRows } = await getClient().from('despacho_clientes').select('cliente_rfc').eq('activo', true);
        const _aut = (_dcRows||[]).map(c=>String(c.cliente_rfc||'').toUpperCase());
        rfcCliente = (_g && _aut.includes(String(_g.rfc||'').toUpperCase())) ? _g.rfc : null;
      } else {
        rfcCliente = data?.session?.user?.user_metadata?.rfc || null;
      }
      if (!rfcCliente) return [];
      // Para despachos, usar proxy (evita RLS en SELECT si la política filtra por JWT rfc)
      if (_meta.tipo === 'despacho') {
        try {
          const _tok = data?.session?.access_token || '';
          const _resp = await fetch('/api/mutar-datos-cliente', {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+_tok},
            body: JSON.stringify({ tabla:'trabajadores', accion:'select', cliente_rfc: rfcCliente,
              columnas:'id,nombre,puesto', filtros:{ activo:true }, order:{ campo:'nombre', asc:true } }),
          });
          if(_resp.ok){ const _r=await _resp.json(); if(_r.ok){ roster=_r.data||[]; return roster; } }
        } catch(_e){ console.warn('proxy roster falló, usando directo:', _e.message); }
      }
      // Para despachos el SELECT directo también falla por RLS — reintentar proxy
      if (_meta.tipo === 'despacho') {
        console.warn('proxy roster falló, roster vacío para despacho');
        roster = [];
        return roster;
      }
      const { data: trabajadores, error } = await getClient()
        .from('trabajadores').select('id,nombre,puesto')
        .eq('cliente_rfc', rfcCliente).eq('activo', true).order('nombre');
      if (error) throw error;
      roster = trabajadores || [];
      return roster;
    } catch (e) {
      console.error('ExpedienteHelper: no se pudo cargar roster:', e.message || e);
      return [];
    }
  }

  function inyectarSelector(inputNombreId) {
    if (!inputNombreId) return; // doc empresarial — sin selector de trabajador
    const inputNombre = document.getElementById(inputNombreId);
    if (!inputNombre) return;
    const campoWrap = inputNombre.closest('.field') || inputNombre.parentElement;
    if (!campoWrap || document.getElementById('expediente-selector-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.id = 'expediente-selector-wrap';
    wrap.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;">
        📁 Vincular a trabajador del expediente
        <span style="font-weight:400;color:#8a8a84;font-size:11px;">(opcional)</span>
      </label>
      <select id="expediente-select-trabajador" style="width:100%;padding:8px 10px;border:1px solid #ddddd6;border-radius:6px;font-size:13px;font-family:inherit;background:#fff;">
        <option value="">— Sin vincular (guardar sin trabajador específico) —</option>
      </select>
      <div id="expediente-hint" style="font-size:11px;color:#8a8a84;margin-top:3px;">
        ${roster.length ? 'Selecciona un trabajador para guardar en su expediente.' : 'No hay trabajadores en el roster. Agrégalos en Asistencias y vacaciones.'}
      </div>
    `;
    campoWrap.parentElement.insertBefore(wrap, campoWrap);

    const select = wrap.querySelector('#expediente-select-trabajador');
    roster.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.nombre + (t.puesto ? ' — ' + t.puesto : '');
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      trabajadorSeleccionadoId = select.value || null;
      const t = roster.find(r => r.id === select.value);
      if (t) {
        inputNombre.value = t.nombre;
        inputNombre.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  function inyectarBotones() {
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;

    // Botón imprimir/PDF — si no existe ya
    if (!headerActions.querySelector('#btn-imprimir-doc')) {
      const btnPrint = document.createElement('button');
      btnPrint.className = 'btn btn-outline';
      btnPrint.id = 'btn-imprimir-doc';
      btnPrint.textContent = '🖨 Imprimir / PDF';
      btnPrint.onclick = () => window.print();
      headerActions.insertBefore(btnPrint, headerActions.firstChild);
    }

    // Botón guardar en expediente
    if (!headerActions.querySelector('#btn-guardar-expediente')) {
      const btnGuardar = document.createElement('button');
      btnGuardar.className = 'btn btn-outline';
      btnGuardar.id = 'btn-guardar-expediente';
      btnGuardar.textContent = '📁 Guardar en expediente';
      btnGuardar.onclick = guardar;
      // Insertar después del botón imprimir
      const btnPrint = headerActions.querySelector('#btn-imprimir-doc');
      if (btnPrint && btnPrint.nextSibling) {
        headerActions.insertBefore(btnGuardar, btnPrint.nextSibling);
      } else {
        headerActions.appendChild(btnGuardar);
      }
    }
  }

  async function guardar() {
    if (!rfcCliente) {
      try {
        const sb2 = getClient();
        const { data } = await sb2.auth.getSession();
        const _m2 = data?.session?.user?.user_metadata || {};
        if (_m2.tipo === 'despacho') {
          let _g2 = null;
          try { _g2 = JSON.parse(sessionStorage.getItem('cl_gestion')||'null'); } catch(_e){}
          const { data: _dc2 } = await sb2.from('despacho_clientes').select('cliente_rfc').eq('activo', true);
          const _a2 = (_dc2||[]).map(c=>String(c.cliente_rfc||'').toUpperCase());
          rfcCliente = (_g2 && _a2.includes(String(_g2.rfc||'').toUpperCase())) ? _g2.rfc : null;
        } else {
          rfcCliente = _m2.rfc || null;
        }
      } catch(e) {}
    }
    if (!rfcCliente) {
      alert('No se pudo identificar el cliente. Seleccione un cliente desde el panel del despacho.');
      return;
    }
    const nombreDoc = config.nombreDocumentoFn ? config.nombreDocumentoFn() : (config.tipoDocumento || 'Documento');
    const btn = document.getElementById('btn-guardar-expediente');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      // Capturar el HTML actual del documento (incluyendo ediciones libres)
      const _preview = document.getElementById('doc-preview');
      const _htmlDoc = _preview ? _preview.innerHTML : '';

      const registro = {
        cliente_rfc:   rfcCliente,
        tipo:          config.tipoDocumento || 'documento',
        nombre:        nombreDoc,
        generador:     window.location.pathname.split('/').pop(),
        metadata:      config.metadataFn ? config.metadataFn() : null,
        fecha:         new Date().toISOString().split('T')[0],
        generado_en:   new Date().toISOString(),
        contenido_html: _htmlDoc, // HTML completo del documento para poder reabrirlo
      };
      if (trabajadorSeleccionadoId) registro.trabajador_id = trabajadorSeleccionadoId;

      // Usar la función Netlify para el INSERT: evita el bloqueo RLS
      // cuando quien escribe es un usuario despacho (RFC distinto al cliente)
      const { data: sesData } = await getClient().auth.getSession();
      const _token = sesData?.session?.access_token || '';
      let guardadoOk = false;

      if (_token) {
        // Intento 1: función Netlify (funciona para clientes y despachos sin RLS)
        try {
          const resp = await fetch('/api/guardar-documento-expediente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
            body: JSON.stringify(registro),
          });
          const result = await resp.json().catch(()=>({}));
          console.log('[guardar-expediente] HTTP', resp.status, JSON.stringify(result));
          if (resp.status === 404 || resp.status === 502) {
            console.warn('Función guardar-documento no disponible ('+resp.status+'), usando INSERT directo');
          } else if (resp.ok && result.ok) {
            guardadoOk = true;
          } else {
            // Cualquier otro error es definitivo — mostrar el error real
            throw new Error('HTTP '+resp.status+': '+(result.error||JSON.stringify(result)));
          }
        } catch (fnErr) {
          console.error('[guardar-expediente] Error:', fnErr.message);
          throw fnErr;
        }
      }

      if (!guardadoOk) {
        // Intento 2: INSERT directo (funciona para clientes normales con RLS a su favor)
        const { error } = await getClient().from('documentos_expediente').insert(registro);
        if (error) throw error;
      }

      const msg = trabajadorSeleccionadoId
        ? '✅ Documento guardado en el expediente del trabajador.\n\nPuedes verlo en Asistencias y vacaciones → trabajador → Expediente.'
        : '✅ Documento guardado.\n\nPuedes verlo en tu portal bajo "Mis documentos".';
      
      if (btn) { btn.textContent = '✅ Guardado'; setTimeout(()=>{ btn.disabled=false; btn.textContent='📁 Guardar en expediente'; },2000); }
      
      // Mostrar confirmación discreta sin alert bloqueante
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#065f46;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2);';
      banner.textContent = msg.replace(/\n\n.*/,'');
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 3500);
    } catch (e) {
      alert('No se pudo guardar en el expediente: ' + (e.message || e));
      if (btn) { btn.disabled = false; btn.textContent = '📁 Guardar en expediente'; }
    }
  }

  async function init(opts) {
    config = opts || {};
    await cargarRoster();
    if (config.inputNombreId) inyectarSelector(config.inputNombreId);
    inyectarBotones();
  }

  global.ExpedienteHelper = { init, guardar };
})(window);

