// ════════════════════════════════════════════════════════
// membrete.js — ClickLaboral.mx
// ════════════════════════════════════════════════════════

// ── Logo ClickLaboral en texto CSS (bicolor, sin imagen PNG) ──
// Úsalo en el header de cada generador:
//   <div class="cl-logo-text">Click<span>Laboral</span><span class="cl-mx">.mx</span></div>
// Con este CSS en el <style>:
//   .cl-logo-text{font-size:15px;font-weight:800;color:#fff;font-family:'Segoe UI',sans-serif;letter-spacing:-.3px;}
//   .cl-logo-text span{color:#00c9a7;}
//   .cl-logo-text .cl-mx{font-size:11px;opacity:.7;font-weight:600;}

// ────────────────────────────────────────────────────────
// MEMBRETE DEL DOCUMENTO — solo datos del cliente
// ────────────────────────────────────────────────────────
window.generarMembrete = function({
  empresa = '', rfc = '', domicilio = '', tel = '', emailEmp = '',
  web = '', folio = '', logoDataUrl = null, colorAcento = '#1a3a5c'
} = {}) {

  const logoHtml = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="Logo"
           style="max-height:80px;max-width:200px;object-fit:contain;display:block;">`
    : '';   // Sin logo subido → no mostrar placeholder, solo dejar espacio si hay

  const contactoItems = [
    tel      ? `📞 ${tel}`       : '',
    emailEmp ? `✉️ ${emailEmp}` : '',
    web      ? `🌐 ${web}`       : '',
  ].filter(Boolean);

  const contactoHtml = contactoItems.length
    ? `<div style="font-size:8.5pt;color:#666;font-family:'Segoe UI',sans-serif;
                   margin-top:2px;display:flex;flex-wrap:wrap;gap:4px 14px;">
         ${contactoItems.map(i=>`<span>${i}</span>`).join('')}
       </div>`
    : '';

  const tieneContenido = empresa || rfc || domicilio || tel || emailEmp || web || logoDataUrl;
  if(!tieneContenido) return `<div style="border-bottom:3px solid ${colorAcento};margin-bottom:18px;padding-bottom:2px;"></div>`;

  return `
    <div style="
      display:flex;align-items:flex-start;gap:16px;
      padding-bottom:12px;margin-bottom:18px;
      border-bottom:3px solid ${colorAcento};
    ">
      ${logoDataUrl ? `<div style="flex-shrink:0;">${logoHtml}</div>` : ''}
      <div style="flex:1;min-width:0;">
        <div style="
          font-size:15pt;font-weight:800;color:${colorAcento};
          font-family:'Segoe UI',system-ui,sans-serif;
          line-height:1.2;margin-bottom:3px;
        ">${empresa || ''}</div>
        ${rfc
          ? `<div style="font-size:9pt;color:#555;font-family:'Segoe UI',sans-serif;margin-bottom:2px;">
               RFC: <strong>${rfc}</strong>
             </div>` : ''}
        ${domicilio
          ? `<div style="font-size:8.5pt;color:#666;font-family:'Segoe UI',sans-serif;margin-bottom:2px;">
               📍 ${domicilio}
             </div>` : ''}
        ${contactoHtml}
      </div>
      ${folio ? `
      <div style="text-align:right;flex-shrink:0;min-width:100px;">
        <div style="font-size:8pt;color:#aaa;font-family:'Segoe UI',sans-serif;line-height:1.7;">
          Folio<br><strong style="font-size:10pt;color:#555;">${folio}</strong>
        </div>
      </div>` : ''}
    </div>`;
};

// ────────────────────────────────────────────────────────
// PIE DE PÁGINA — solo datos del cliente, sin leyenda ClickLaboral
// ────────────────────────────────────────────────────────
window.generarFooterDoc = function({
  empresa = '', domicilio = '', tel = '', emailEmp = '', web = '', folio = '',
  piePersonalizado = ''
} = {}) {
  // Si el cliente escribió un pie personalizado, usarlo
  if(piePersonalizado && piePersonalizado.trim()){
    return `
      <div style="
        margin-top:36px;padding-top:10px;
        border-top:1px solid #ddd;
        font-size:8.5pt;color:#666;
        font-family:'Segoe UI',system-ui,sans-serif;
        line-height:1.7;white-space:pre-wrap;
      ">${piePersonalizado}</div>`;
  }

  // Pie automático con los datos capturados
  const partes = [
    empresa,
    domicilio ? `📍 ${domicilio}` : '',
    tel       ? `📞 ${tel}`       : '',
    emailEmp  ? `✉️ ${emailEmp}` : '',
    web       ? `🌐 ${web}`       : '',
  ].filter(Boolean);

  if(!partes.length && !folio) return '';

  return `
    <div style="
      margin-top:36px;padding-top:10px;
      border-top:1px solid #ddd;
      font-size:8.5pt;color:#777;
      font-family:'Segoe UI',system-ui,sans-serif;
      display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;
      line-height:1.8;
    ">
      ${partes.map(p=>`<span>${p}</span>`).join('')}
      ${folio ? `<span style="margin-left:auto;color:#bbb;font-size:8pt;">Folio: ${folio}</span>` : ''}
    </div>`;
};

// ────────────────────────────────────────────────────────
// PANEL LATERAL — Logo + Razón social + Pie de página
// Se renderiza en el form-panel de cada generador
// ────────────────────────────────────────────────────────
window._logoClienteDataUrl = null;

window.renderPanelMembrete = function(containerId) {
  const el = document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = `
    <!-- LOGO DEL CLIENTE -->
    <div style="margin-bottom:16px;">
      <div id="mem-logo-dropzone" style="
        border:2px dashed #c0cdd8;border-radius:8px;
        padding:16px 12px;background:#f7fafd;
        cursor:pointer;text-align:center;
        transition:all .15s;
      "
        onclick="document.getElementById('mem-logo-file').click()"
        ondragover="event.preventDefault();this.style.borderColor='#1a3a5c';this.style.background='#eaf2fb';"
        ondragleave="this.style.borderColor='#c0cdd8';this.style.background='#f7fafd';"
        ondrop="event.preventDefault();this.style.borderColor='#c0cdd8';this.style.background='#f7fafd';cargarLogoMembreteDesdeArchivo(event.dataTransfer.files[0])">
        <div id="mem-logo-preview-wrap" style="display:none;margin-bottom:8px;">
          <img id="mem-logo-img"
               style="max-height:72px;max-width:100%;object-fit:contain;display:block;margin:0 auto;border-radius:4px;">
        </div>
        <div id="mem-logo-placeholder">
          <div style="font-size:20px;margin-bottom:4px;">🖼️</div>
          <div style="font-size:12px;font-weight:700;color:#1a3a5c;margin-bottom:2px;">Logo de su empresa</div>
          <div style="font-size:10px;color:#888;line-height:1.4;">Clic aquí o arrastre la imagen<br>PNG · JPG · SVG · máx. 2 MB</div>
        </div>
        <div id="mem-logo-nombre" style="display:none;font-size:11px;color:#16a34a;margin-top:6px;font-weight:600;"></div>
      </div>
      <input type="file" id="mem-logo-file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
             style="display:none;" onchange="cargarLogoMembreteDesdeArchivo(this.files[0])">
      <button id="mem-logo-quitar" onclick="removerLogo()"
              style="display:none;width:100%;margin-top:4px;padding:4px;font-size:11px;
                     color:#dc2626;background:none;border:1px solid #fca5a5;
                     border-radius:4px;cursor:pointer;">
        ✕ Quitar logo
      </button>
    </div>

    <!-- PIE DE PÁGINA PERSONALIZADO -->
    <div class="field" style="margin-bottom:0;">
      <label style="font-size:11px;font-weight:600;color:#444;display:block;margin-bottom:4px;">
        Pie de página del documento
      </label>
      <textarea id="mem-pie" rows="3" oninput="render()"
                style="width:100%;padding:8px 10px;border:1px solid #ddddd6;border-radius:6px;
                       font-size:12px;font-family:'Segoe UI',sans-serif;resize:vertical;
                       color:#333;background:#fff;line-height:1.5;"
                placeholder="Texto libre para el pie del documento&#10;Ej: Lic. Juan Salas · CEDULA 1234567 · www.clicklaboral.mx · Tel. 33 3926 3817"></textarea>
      <div style="font-size:10px;color:#888;margin-top:3px;line-height:1.4;">
        Si lo deja vacío se usarán automáticamente los datos de la empresa capturados arriba.
      </div>
    </div>`;
};

window.cargarLogoMembreteDesdeArchivo = function(file) {
  if(!file) return;
  if(file.size > 2*1024*1024){
    alert('El archivo es mayor a 2 MB. Elige una imagen más pequeña.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    window._logoClienteDataUrl = e.target.result;
    const img      = document.getElementById('mem-logo-img');
    const prevWrap = document.getElementById('mem-logo-preview-wrap');
    const placer   = document.getElementById('mem-logo-placeholder');
    const nombre   = document.getElementById('mem-logo-nombre');
    const quitar   = document.getElementById('mem-logo-quitar');
    if(img)      img.src = e.target.result;
    if(prevWrap) prevWrap.style.display = 'block';
    if(placer)   placer.style.display   = 'none';
    if(nombre)   { nombre.textContent = '✓ ' + file.name; nombre.style.display = 'block'; }
    if(quitar)   quitar.style.display   = 'block';
    if(typeof render === 'function') render();
  };
  reader.readAsDataURL(file);
};

// Alias compatibilidad
window.cargarLogoMembrete = function(input) {
  cargarLogoMembreteDesdeArchivo(input?.files?.[0]);
};

// Alias renderCampoLogo → renderPanelMembrete
window.renderCampoLogo = window.renderPanelMembrete;

window.removerLogo = function() {
  window._logoClienteDataUrl = null;
  const ids = ['mem-logo-file','mem-logo-img','mem-logo-preview-wrap',
                'mem-logo-placeholder','mem-logo-nombre','mem-logo-quitar'];
  const vals = [null, null, 'none', 'block', 'none', 'none'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(id === 'mem-logo-file') el.value = '';
    else if(id === 'mem-logo-img') el.src = '';
    else el.style.display = vals[i];
  });
  if(typeof render === 'function') render();
};

window.getDatosMembrete = function() {
  const get = id => (document.getElementById(id)?.value || '').trim();
  return {
    empresa:         get('empresa')  || get('f-empresa') || get('mem-empresa') || '',
    rfc:             get('rfc_patron') || get('rfc_emp') || get('f-rfc') || get('mem-rfc') || '',
    tel:             get('mem-tel')   || '',
    domicilio:       get('domicilio_empresa') || get('domicilio_emp') || get('f-domicilio') || '',
    emailEmp:        get('mem-email') || '',
    web:             get('mem-web')   || '',
    piePersonalizado:get('mem-pie')   || '',
    logoDataUrl:     window._logoClienteDataUrl || null,
  };
};

window.precargarMembreteDesdePortal = async function(sb) {
  try {
    const {data} = await sb.auth.getUser();
    const meta = data?.user?.user_metadata || {};
    // En modo despacho: cargar los datos del cliente en gestión, no los del despacho
    if (meta.tipo === 'despacho') {
      let _g = null;
      try { _g = JSON.parse(sessionStorage.getItem('cl_gestion')||'null'); } catch(_) {}
      if (_g?.rfc) {
        // Obtener datos del cliente desde Supabase
        try {
          const { data: usrs } = await sb.from('trabajadores').select('cliente_rfc').eq('cliente_rfc', _g.rfc).limit(1);
          // Pre-llenar con los datos del cl_gestion (empresa + RFC)
          ['empresa','f-empresa','mem-empresa'].forEach(id => {
            const el = document.getElementById(id); if(el && !el.value) el.value = _g.empresa || '';
          });
          ['rfc_patron','rfc_emp','f-rfc','mem-rfc'].forEach(id => {
            const el = document.getElementById(id); if(el && !el.value) el.value = _g.rfc || '';
          });
          if(typeof render === 'function') render();
        } catch(_) {}
      }
      return; // no pre-llenar con datos del despacho
    }
    const cfg  = meta.config_despacho || {};
    const set  = (id, val) => {
      const el = document.getElementById(id);
      if(el && val && !el.value) el.value = val;
    };
    const nombre   = cfg.nombre    || meta.empresa || '';
    const rfcVal   = cfg.rfc       || meta.rfc     || '';
    const telVal   = cfg.tel       || '';
    const domVal   = cfg.domicilio || '';
    const emailVal = cfg.email     || '';
    // Pre-llenar todos los campos posibles de empresa
    ['empresa','f-empresa','mem-empresa'].forEach(id => set(id, nombre));
    ['rfc_patron','rfc_emp','f-rfc','mem-rfc'].forEach(id => set(id, rfcVal));
    set('mem-tel',       telVal);
    set('domicilio_empresa', domVal);
    set('domicilio_emp', domVal);
    set('f-domicilio',   domVal);
    set('mem-email',     emailVal);
    if(typeof render === 'function') render();
  } catch(e) { /* silencioso */ }
};

// ── Validación de RFC mexicano (formato SAT) ──
// Personas morales: 3 letras + 6 dígitos fecha + 3 homoclave
// Personas físicas: 4 letras + 6 dígitos fecha + 3 homoclave
function validarRFC(rfc) {
  if (!rfc) return { ok: false, msg: 'El RFC es requerido.' };
  const r = rfc.trim().toUpperCase();
  // Patrón oficial SAT
  const patron = /^([A-ZÑ&]{3,4})(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([A-Z\d]{2})([A\d])$/;
  if (!patron.test(r)) return { ok: false, msg: 'RFC inválido. Formato esperado: XAXX010101000 (moral) o XAXX010101AAA (física).' };
  // Evitar RFCs genéricos del SAT
  const genericos = ['XAXX010101000','XEXX010101000','DXXX010101000'];
  if (genericos.includes(r)) return { ok: false, msg: 'RFC genérico no permitido.' };
  return { ok: true, rfc: r };
}

// Exponer globalmente si está en browser
if (typeof window !== 'undefined') window.validarRFC = validarRFC;
if (typeof module !== 'undefined') module.exports = { validarRFC };

// ── Sanitización XSS — escapa HTML antes de insertar en documentos ──
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
// Alias para uso en generadores
if (typeof window !== 'undefined') window.esc = esc;
