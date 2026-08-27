// ════════════════════════════════════════════
// AUTH — Conectado a Supabase Auth real
// ════════════════════════════════════════════
const SUPABASE_URL = 'https://hpzgqaplrywwjuvrzhcp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1g8US8iFJ8CxnSaF_4MHgA_gqyyAr3W';
const sbAuth = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let clienteActual = null;
// Variables globales de datos — accesibles por renderReportes y otras funciones
let _gTrabajadores = [], _gTrabajadoresBaja = [], _gDocumentos = [], _gSolicitudes = [];
let _sbAuth  = null;   // cliente Supabase autenticado (global para reportes)

// esc() — escapa HTML antes de insertar datos de usuario vía innerHTML
function esc(s){
  if(s==null)return'';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
let _rfcReal = null;   // RFC del cliente autenticado (global para reportes)
let _modoDespacho = null; // {rfc, empresa, despacho, color} cuando viene desde panel-despacho


async function cargarDatosCliente(rfc){
  // Fuente de verdad: auth.users (user_metadata) + tablas reales de Supabase
  const { data: sessionData } = await sbAuth.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) throw new Error('Sesión no válida. Inicie sesión nuevamente.');

  const meta = user.user_metadata || {};
  const rfcReal = meta.rfc || rfc;
  const plan = (meta.plan || 'basico').toLowerCase();

  // Cargar datos reales en paralelo
  const hoy = new Date();
  // hace30, hace7, inicioMes: ya no necesarios

  const [trabRes, solRes, docsRes, asistRes, identRes, alertasRes] = await Promise.all([
    sbAuth.from('trabajadores')
      .select('id,nombre,puesto,activo,fecha_ingreso,nss')
      .eq('cliente_rfc', rfcReal).order('nombre'),
    sbAuth.from('solicitudes')
      .select('*').eq('cliente_rfc', rfcReal)
      .order('created_at', { ascending: false }).limit(20),
    sbAuth.from('documentos_expediente')
      .select('id,nombre,tipo,fecha,generado_en,trabajador_id')
      .eq('cliente_rfc', rfcReal)
      .order('fecha', { ascending: false }).limit(100),
    Promise.resolve({ data: [] }), // asistencias retiradas del compliance
    sbAuth.from('documentos_identidad')
      .select('trabajador_id,tipo,nombre_archivo')
      .eq('cliente_rfc', rfcReal).limit(200),
    sbAuth.from('alertas_laborales')
      .select('tipo,trabajador_nombre,mensaje,urgencia,fecha_alerta')
      .eq('cliente_rfc', rfcReal)
      .eq('leida', false)
      .order('fecha_alerta', {ascending:false})
      .limit(10),
  ]);

  const trabajadores    = (trabRes.data || []);
  const trabActivos     = trabajadores.filter(t => t.activo !== false && !t.fecha_baja);
  const solicitudes     = solRes.data  || [];
  const documentos      = docsRes.data || [];
  // Guardar en globales para que renderReportes pueda acceder
  _gTrabajadores     = trabajadores;
  _gTrabajadoresBaja = trabajadores.filter(t => t.activo === false || t.fecha_baja);
  _gDocumentos       = documentos;
  _gSolicitudes      = solicitudes;
  const asistencias     = asistRes.data || [];
  const docsIdentidad   = identRes.data || [];
  const alertasLaborales = alertasRes?.data || [];

  // ─── Compliance por área ────────────────────────────────────────────────
  // 1. Contratos: % de trabajadores activos con contrato
  const trabConContrato = new Set(documentos.filter(d=>d.tipo&&/contrato/i.test(d.tipo)).map(d=>d.trabajador_id));
  const pctContratos = trabActivos.length ? Math.round(trabConContrato.size/trabActivos.length*100) : 0;
  const statusContratos = pctContratos===100?'ok': pctContratos>=50?'warn':'bad';

  // 2. Expediente: % de trabajadores con al menos un documento de identidad
  const trabConDocs = new Set(docsIdentidad.map(d=>d.trabajador_id));
  const pctExpediente = trabActivos.length ? Math.round(trabConDocs.size/trabActivos.length*100) : 0;
  const statusExpediente = pctExpediente===100?'ok': pctExpediente>=50?'warn':'bad';

  // Control de asistencias: retirado del compliance

  // 4. Reglamento interior
  const tieneReglamento = documentos.some(d=>d.tipo&&/reglamento/i.test(d.tipo));
  const statusReglamento = tieneReglamento?'ok':'warn';

  // 5. NOM-035 (comisiones mixtas)
  const tieneNom035 = documentos.some(d=>d.tipo&&/nom.?035|comision|psicosocial/i.test(d.tipo));
  const statusNom035 = tieneNom035?'ok':'warn';

  // 6. Actas administrativas al corriente
  const pendientesSolicitudes = solicitudes.filter(s=>s.status==='pendiente').length;
  const statusActas = pendientesSolicitudes===0?'ok': pendientesSolicitudes<=2?'warn':'bad';

  // 7. Trabajadores con NSS
  const trabConNSS = trabActivos.filter(t=>t.nss&&t.nss.trim()).length;
  const pctNSS = trabActivos.length ? Math.round(trabConNSS/trabActivos.length*100) : 0;
  const statusNSS = pctNSS===100?'ok': pctNSS>=70?'warn':'bad';

  // 8. Constancias firmadas (jornada)
  const tieneConstancias = docsIdentidad.some(d=>d.tipo&&/constancia|firma/i.test(d.tipo));
  const statusConstancias = trabActivos.length===0?'ok': tieneConstancias?'ok':'warn';

  const compliance = {
    'Contratos de trabajo':       { status:statusContratos,   label: trabActivos.length ? `${trabConContrato.size}/${trabActivos.length} trabajadores` : 'Sin trabajadores', icon:'📋', pct:pctContratos },
    'Expedientes completos':      { status:statusExpediente,  label: trabActivos.length ? `${trabConDocs.size}/${trabActivos.length} con documentos` : 'Sin trabajadores', icon:'🗂️', pct:pctExpediente },
    'Reglamento interior':        { status:statusReglamento,  label: tieneReglamento?'Generado':'Pendiente de generar', icon:'📖', pct:tieneReglamento?100:0 },
    'NOM-035 STPS':               { status:statusNom035,      label: tieneNom035?'Al día':'Pendiente', icon:'⚕️', pct:tieneNom035?100:0 },
    'Número de seguridad social': { status:statusNSS,         label: trabActivos.length ? `${trabConNSS}/${trabActivos.length} registrados` : 'Sin trabajadores', icon:'🏥', pct:pctNSS },
    'Solicitudes pendientes':     { status:statusActas,       label: pendientesSolicitudes ? `${pendientesSolicitudes} por atender` : 'Al día', icon:'📨', pct:pendientesSolicitudes===0?100:0 },
    'Constancias de jornada':     { status:statusConstancias, label: tieneConstancias?'Con constancias firmadas':'Sin constancias aún', icon:'✍️', pct:tieneConstancias?100:0 },
  };

  // Score ponderado real
  const pesos = [3,2,2,2,1,2,1]; // 7 áreas sin asistencias
  const areas = Object.values(compliance);
  const scoreReal = Math.round(
    areas.reduce((sum,a,i)=>sum + (a.status==='ok'?pesos[i]: a.status==='warn'?pesos[i]*0.5:0), 0) /
    pesos.reduce((s,p)=>s+p, 0) * 100
  );

  // Obligaciones próximas calculadas
  const obligaciones = [];
  const mesNombre = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth()+1, 0);
  const diasAlFin = Math.ceil((ultimoDia - hoy) / 86400000);
  if(trabActivos.length > 0){
    obligaciones.push({ label:'Pago bimestral IMSS', fecha:`${ultimoDia.getDate()} ${mesNombre[ultimoDia.getMonth()]}`, dias:diasAlFin });
    if(!tieneNom035) obligaciones.push({ label:'Evaluación NOM-035 STPS', fecha:'Próximo mes', dias:30 });
    if(!tieneReglamento) obligaciones.push({ label:'Registrar Reglamento ante STPS', fecha:'Pendiente', dias:45 });
  }
  obligaciones.sort((a,b)=>a.dias-b.dias);

  // Historial de actividad reciente
  const historial = documentos.slice(0,8).map(d=>({
    icon:'📄', cl:'tl-ok',
    titulo: d.nombre || d.tipo || 'Documento generado',
    fecha: d.fecha ? new Date(d.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '',
  }));

  const CUOTAS = { micro:899, pyme:1999, mediana:4499, empresa:9999, basico:499, estandar:799, pro:2399, trial:0, personalizado:0 };
  const cuota  = meta.cuota != null ? Number(meta.cuota) : (CUOTAS[plan] || 1999);

  // Guardar para reportes y para módulos en otras pestañas (asistencias-vacaciones.html)
  _sbAuth  = sbAuth;
  _rfcReal = rfcReal;
  try { localStorage.setItem('cl_rfc_auth', rfcReal); } catch(_) {}

  clienteActual = {
    rfc:             rfcReal,
    empresa:         _modoDespacho?.empresa || meta.empresa || rfcReal,
    contacto:        _modoDespacho?.empresa || meta.contacto_rrhh || meta.empresa || rfcReal,
    email:           meta.email_contacto || user.email || '',
    tel:             meta.tel         || '',
    plan:            capitalize((meta.plan || 'Básico').replace(/^plan\s+/i,'')),
    cuota,
    score:           scoreReal,
    semaforo:        scoreReal>=70?'verde': scoreReal>=40?'amarillo':'rojo',
    trabajadores:    trabActivos.length,
    _trabajadoresRaw: trabajadores, // todos incluyendo bajas para reportes
    trabajadoresTotal: trabajadores.length,
    stripeCustomerId: meta.stripe_customer_id || null,
    giro:            meta.giro        || '',
    ciudad:          meta.domicilio   || '',
    inicioServicio:  user.created_at  ? user.created_at.split('T')[0] : '',
    proximoPago:     '—',
    compliance,
    alertas: [
      ...(!tieneReglamento && trabActivos.length>0 ? [{ tipo:'warn', titulo:'Reglamento interior pendiente', desc:'Genere su reglamento interior de trabajo', dias:45, url:'reglamento-interior.html' }] : []),
      ...(!tieneNom035 && trabActivos.length>0 ? [{ tipo:'warn', titulo:'NOM-035 STPS pendiente', desc:'Realice la evaluación de factores de riesgo psicosocial', dias:30, url:'nom035-evaluacion.html' }] : []),
      ...(statusContratos!=='ok' && trabActivos.length>0 ? [{ tipo:'warn', titulo:`Contratos pendientes`, desc:`${trabActivos.length - trabConContrato.size} trabajador(es) sin contrato generado`, dias:7 }] : []),
      // asistencias: sin alerta en portal
      ...solicitudes.filter(s=>s.status==='pendiente').slice(0,3).map(s=>({ tipo:'warn', titulo:s.tipo||'Solicitud pendiente', desc:s.descripcion||'', dias:0 })),
      ...alertasLaborales.map(a=>({ tipo:a.urgencia==='alta'?'bad':'warn', titulo: a.tipo==='periodo_prueba'?'⏰ Período de prueba próximo a vencer':'📅 Prima vacacional próxima', desc:a.mensaje||'', dias:0 })),
    ].slice(0,6),
    docs: documentos.slice(0,20).map(d => ({
      icon:'📄', nombre: d.nombre || d.tipo, tipo: d.tipo,
      fecha: d.fecha || '', status: 'ok',
    })),
    historial,
    pagos: [],
    obligaciones,
  };

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('portal-app').style.display = 'block';
  initPortal();
}


// Rate limiting: bloqueo tras 5 intentos fallidos por 15 minutos
const _rlState = {
  intentos: parseInt(sessionStorage.getItem('_rl_int')||'0'),
  bloqueadoHasta: parseInt(sessionStorage.getItem('_rl_hasta')||'0'),
};
function _rlBloqueado(){
  if(_rlState.bloqueadoHasta > Date.now()) return true;
  if(_rlState.bloqueadoHasta && _rlState.bloqueadoHasta <= Date.now()){
    _rlState.intentos = 0; _rlState.bloqueadoHasta = 0;
    sessionStorage.removeItem('_rl_int'); sessionStorage.removeItem('_rl_hasta');
  }
  return false;
}
function _rlFallo(){
  _rlState.intentos++;
  sessionStorage.setItem('_rl_int', _rlState.intentos);
  if(_rlState.intentos >= 5){
    _rlState.bloqueadoHasta = Date.now() + 15*60*1000;
    sessionStorage.setItem('_rl_hasta', _rlState.bloqueadoHasta);
  }
}
function _rlExito(){ _rlState.intentos=0; _rlState.bloqueadoHasta=0; sessionStorage.removeItem('_rl_int'); sessionStorage.removeItem('_rl_hasta'); }
async function loginSubmit(){
  const rfc = document.getElementById('login-rfc').value.trim().toUpperCase();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');
  const btn = document.querySelector('.login-btn');
  err.style.display = 'none';

  if(!rfc || !pass){
    err.textContent = 'Ingrese su RFC y contraseña.';
    err.style.display = 'block';
    return;
  }

  const btnOriginal = btn.textContent;
  btn.textContent = 'Verificando...';
  btn.disabled = true;

  try {
    // El RFC se convierte internamente al formato de email que usa Supabase Auth
    const emailInterno = `${rfc.toLowerCase()}@clicklaboral.mx`;

    const { data: authData, error: authError } = await sbAuth.auth.signInWithPassword({
      email: emailInterno,
      password: pass,
    });

    if (authError) {
      err.textContent = 'RFC o contraseña incorrectos. Intente de nuevo.';
      err.style.display = 'block';
      document.getElementById('login-pass').value = '';
      btn.textContent = btnOriginal;
      btn.disabled = false;
      return;
    }

    await cargarDatosCliente(rfc);

  } catch (e) {
    console.error('Error de login:', e);
    err.textContent = 'Error de conexión. Intente de nuevo en unos segundos.';
    err.style.display = 'block';
    btn.textContent = btnOriginal;
    btn.disabled = false;
  }
}

function capitalize(s){
  if(!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function abrirConsultasLegales(){
  const plan = clienteActual?.plan || 'Estándar';
  const rfc = clienteActual?.rfc || '';
  window.open(`consultas-legales.html?plan=${encodeURIComponent(plan)}&rfc=${encodeURIComponent(rfc)}`);
}


// ── Reportes gerenciales ────────────────────────────────────────────────────
function kpiCard(label, val, sub, color) {
  return '<div style="background:var(--white);border-radius:10px;padding:14px;border:1px solid var(--border);">'
    + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:4px;">' + label + '</div>'
    + '<div style="font-size:22px;font-weight:800;color:' + color + ';">' + val + '</div>'
    + '<div style="font-size:11px;color:var(--ink3);">' + sub + '</div>'
    + '</div>';
}

async function renderReportes() {
  const el = document.getElementById('rep-contenido');
  if (!el) { console.error('rep-contenido no encontrado'); return; }

  const rfcUsar = _rfcReal || clienteActual?.rfc;
  console.log('[Rep] rfcUsar:', rfcUsar, '| _sbAuth:', !!_sbAuth, '| clienteActual:', !!clienteActual);

  if (!rfcUsar || !_sbAuth) {
    // Intentar con sbAuth global del portal
    const sbUsar = typeof sbAuth !== 'undefined' ? sbAuth : null;
    const rfcFallback = clienteActual?.rfc || null;
    console.log('[Rep] Fallback sbUsar:', !!sbUsar, 'rfcFallback:', rfcFallback);
    if (!sbUsar || !rfcFallback) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">
        Sin datos: rfcUsar=${rfcUsar}, _sbAuth=${!!_sbAuth}, clienteActual=${!!clienteActual}<br>
        <button onclick="renderReportes()" style="margin-top:12px;padding:8px 16px;background:var(--navy2);color:#fff;border:none;border-radius:6px;cursor:pointer;">🔄 Reintentar</button>
      </div>`;
      return;
    }
    // Usar fallback
    _sbAuth = sbUsar;
    _rfcReal = rfcFallback;
  }

  el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--ink3);">⏳ Cargando reportes…</div>';

  try {
    // Obtener token fresco y hacer fetch directo a REST API
    const { data: sesData } = await _sbAuth.auth.getSession();
    const tok = sesData?.session?.access_token;
    console.log('[Rep] token:', tok ? tok.substring(0,15)+'...' : 'VACÍO');

    if (!tok) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">Sin token de sesión. <button onclick="location.reload()" style="padding:8px 16px;background:var(--navy2);color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:8px;">Recargar</button></div>';
      return;
    }

    const hdrs = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + tok,
      Accept: 'application/json',
    };
    const base = SUPABASE_URL + '/rest/v1/';
    const rfc = encodeURIComponent(rfcUsar);

    const [j1, j2, j3] = await Promise.all([
      fetch(base + 'trabajadores?select=id,nombre,puesto,activo,fecha_ingreso,fecha_baja,motivo_baja,nss,salario_diario&cliente_rfc=eq.' + rfc + '&order=nombre.asc', {headers: hdrs}).then(r=>{ console.log('[Rep] trabajadores status:', r.status); return r.ok?r.json():[]; }),
      fetch(base + 'documentos_expediente?select=id,tipo,nombre,fecha,trabajador_id&cliente_rfc=eq.' + rfc + '&order=fecha.desc&limit=200', {headers: hdrs}).then(r=>{ console.log('[Rep] docs status:', r.status); return r.ok?r.json():[]; }),
      fetch(base + 'asistencias?select=trabajador_id,fecha,status,hora_entrada,hora_salida&cliente_rfc=eq.' + rfc + '&order=fecha.desc&limit=2000', {headers: hdrs}).then(r=>{ console.log('[Rep] asistencias status:', r.status); return r.ok?r.json():[]; }),
    ]);

    const trabs = Array.isArray(j1) ? j1 : [];
    const docs  = Array.isArray(j2) ? j2 : [];
    const asisAll = Array.isArray(j3) ? j3 : [];
    const docsPorTrab = {};
    const docsPorTrabSet = {};
    docs.forEach(function(d){
      if(!d.trabajador_id) return;
      docsPorTrab[d.trabajador_id] = (docsPorTrab[d.trabajador_id]||0)+1;
      if(!docsPorTrabSet[d.trabajador_id]) docsPorTrabSet[d.trabajador_id] = new Set();
      var dk = (d.tipo||'') + ' ' + (d.nombre||'');
      DOCS_REQUERIDOS.forEach(function(req){ if(req.kw.test(dk)) docsPorTrabSet[d.trabajador_id].add(req.id); });
    });
    window._repRFC  = rfcUsar;
    window._repEmpresa = clienteActual?.empresa || rfcUsar;
    console.log('[Rep] Resultado — trabajadores:', trabs.length, '| docs:', docs.length);
    const activos = trabs.filter(t => t.activo !== false && !t.fecha_baja);
    window._repActivos = activos;
    const bajas   = trabs.filter(t => t.activo === false || t.fecha_baja);

    const periodo = document.getElementById('rep-periodo')?.value || 'todo';
    const hoy = new Date();
    let desdeStr = '2020-01-01';
    if (periodo === 'mes') desdeStr = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    else if (periodo === 'trimestre') desdeStr = new Date(hoy.getFullYear(), Math.floor(hoy.getMonth()/3)*3, 1).toISOString().split('T')[0];
    else if (periodo === 'anio') desdeStr = new Date(hoy.getFullYear(), 0, 1).toISOString().split('T')[0];

    const docsFiltrados = docs.filter(d => !d.fecha || d.fecha >= desdeStr);
    const altasPeriodo  = trabs.filter(t => (t.fecha_ingreso||'') >= desdeStr).length;
    const bajasPeriodo  = bajas.filter(t => (t.fecha_baja||'') >= desdeStr).length;
    const rotacion = activos.length > 0 ? Math.round(bajasPeriodo/activos.length*100) : 0;

    const puestos = {};
    activos.forEach(t => { const p=t.puesto||'Sin puesto'; puestos[p]=(puestos[p]||0)+1; });
    const puestosOrden = Object.entries(puestos).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const maxP = puestosOrden[0]?.[1] || 1;

    const tiposDocs = {};
    docsFiltrados.forEach(d => { const t=d.tipo||'otro'; tiposDocs[t]=(tiposDocs[t]||0)+1; });
    const tiposOrden = Object.entries(tiposDocs).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const maxT = tiposOrden[0]?.[1] || 1;

    // ── Costo de plantilla ──
    const mxn = n => '$' + Math.round(n).toLocaleString('es-MX');
    const conSalario = activos.filter(function(t){ return t.salario_diario != null && t.salario_diario > 0; });
    const costoMensualTotal = conSalario.reduce(function(s,t){ return s + t.salario_diario * 30.4; }, 0);
    const salPromedio = conSalario.length ? costoMensualTotal / conSalario.length : 0;
    const pctConSalario = activos.length ? Math.round(conSalario.length / activos.length * 100) : 0;
    const costoPuesto = {};
    conSalario.forEach(function(t){ var p=t.puesto||'Sin puesto'; costoPuesto[p]=(costoPuesto[p]||0)+t.salario_diario*30.4; });
    const costoPuestoOrden = Object.entries(costoPuesto).sort(function(a,b){ return b[1]-a[1]; }).slice(0,6);
    const maxCP = costoPuestoOrden[0]?.[1] || 1;
    const topSalarios = conSalario.slice().sort(function(a,b){ return b.salario_diario-a.salario_diario; }).slice(0,5);

    const fmt = d => d ? new Date(d+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const antig = fi => { if(!fi) return '—'; const d=Math.floor((new Date()-new Date(fi+'T12:00:00'))/86400000); if(d<30) return d+'d'; if(d<365) return Math.floor(d/30)+'m'; return (d/365).toFixed(1)+' años'; };
    const bar = (v,max,col='var(--navy2)') => `<div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;flex:1;"><div style="height:100%;width:${Math.round(v/max*100)}%;background:${col};border-radius:4px;"></div></div>`;

    // ── Alertas de aniversario ──
    const diasVacLFT = function(a){ if(a<=4) return 10+a*2; if(a<=5) return 20; if(a<=10) return 22; if(a<=15) return 24; if(a<=20) return 26; if(a<=25) return 28; if(a<=30) return 30; return 32; };
    const proximosAniv = activos.filter(function(t){return !!t.fecha_ingreso;}).map(function(t){
      var ing = new Date(t.fecha_ingreso+'T12:00:00');
      var aniosCump = Math.floor((hoy-ing)/(365.25*86400000));
      var nxt = new Date(ing); nxt.setFullYear(hoy.getFullYear());
      if(nxt <= hoy) nxt.setFullYear(hoy.getFullYear()+1);
      var df = Math.ceil((nxt-hoy)/86400000);
      var aniosSig = aniosCump+1;
      return {t:t, nextAniv:nxt, diasFalta:df, aniosSig:aniosSig, vacDias:diasVacLFT(aniosSig)};
    }).filter(function(x){return x.diasFalta<=30 && x.aniosSig>=1;}).sort(function(a,b){return a.diasFalta-b.diasFalta;});

    console.log('[Rep] Renderizando HTML con', activos.length, 'activos,', bajas.length, 'bajas');

    // Construcción del HTML por partes — sin template literals anidados
    let html = '';

    // KPIs
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px;">';
    html += kpiCard('Trabajadores activos', activos.length, bajas.length + ' de baja', '#0f2640');
    html += kpiCard('Rotación', rotacion + '%', bajasPeriodo + ' baja(s)', rotacion > 15 ? '#dc2626' : rotacion > 5 ? '#d97706' : '#16a34a');
    html += kpiCard('Documentos', docsFiltrados.length, docsFiltrados.filter(function(d){return d.tipo&&/contrato/i.test(d.tipo);}).length + ' contratos', '#0f766e');
    html += kpiCard('Altas en período', altasPeriodo, 'nuevos ingresos', '#16a34a');
    if (conSalario.length > 0) html += kpiCard('Costo mensual est.', mxn(costoMensualTotal), pctConSalario + '% de plantilla capturado', '#7c3aed');
    if (proximosAniv.length > 0) html += kpiCard('Aniversarios próximos', proximosAniv.length, 'en los próximos 30 días', '#d97706');
    html += '</div>';

    // Alertas de aniversario
    if (proximosAniv.length > 0) {
      html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1.5px solid #fbbf24;margin-bottom:14px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">';
      html += '<span style="font-size:16px;">🎂</span>';
      html += '<span style="font-size:13px;font-weight:700;color:var(--navy);">Aniversarios próximos</span>';
      html += '<span style="font-size:11px;padding:2px 8px;background:#fef3c7;color:#92400e;border-radius:10px;font-weight:600;">' + proximosAniv.length + ' en 30 días</span>';
      html += '</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<thead><tr style="border-bottom:1px solid var(--border);">';
      html += '<th style="padding:4px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Trabajador</th>';
      html += '<th style="padding:4px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Puesto</th>';
      html += '<th style="padding:4px 8px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Fecha</th>';
      html += '<th style="padding:4px 8px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Año que cumple</th>';
      html += '<th style="padding:4px 8px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Vacaciones nuevas</th>';
      html += '<th style="padding:4px 8px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Faltan</th>';
      html += '</tr></thead><tbody>';
      proximosAniv.forEach(function(x) {
        var urgColor = x.diasFalta <= 3 ? '#dc2626' : x.diasFalta <= 7 ? '#b45309' : '#15803d';
        var urgBg    = x.diasFalta <= 3 ? '#fee2e2' : x.diasFalta <= 7 ? '#fef3c7' : '#dcfce7';
        var urgText  = x.diasFalta === 0 ? '¡Hoy!' : x.diasFalta + 'd';
        var fechaStr = x.nextAniv.toISOString().split('T')[0];
        html += '<tr style="border-bottom:1px solid var(--border);">';
        html += '<td style="padding:7px 8px;font-weight:600;">' + esc(x.t.nombre) + '</td>';
        html += '<td style="padding:7px 8px;color:var(--ink3);">' + esc(x.t.puesto||'—') + '</td>';
        html += '<td style="padding:7px 8px;text-align:center;">' + fmt(fechaStr) + '</td>';
        html += '<td style="padding:7px 8px;text-align:center;font-weight:700;">' + x.aniosSig + '</td>';
        html += '<td style="padding:7px 8px;text-align:center;color:#0f766e;font-weight:700;">' + x.vacDias + ' días (Art. 76 LFT)</td>';
        html += '<td style="padding:7px 8px;text-align:right;"><span style="display:inline-block;padding:2px 8px;background:' + urgBg + ';color:' + urgColor + ';border-radius:10px;font-weight:700;font-size:11px;">' + urgText + '</span></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    }

    // ── Completitud de expedientes ──
    if (activos.length > 0) {
      var completitudOrden = activos.map(function(t){
        var s = docsPorTrabSet[t.id] || new Set();
        var faltantes = DOCS_REQUERIDOS.filter(function(r){ return !s.has(r.id); });
        return { t:t, completados:s.size, pct:Math.round(s.size/DOCS_REQUERIDOS.length*100), faltantes:faltantes };
      }).sort(function(a,b){ return a.pct - b.pct; });
      var completosTotal = completitudOrden.filter(function(x){ return x.pct>=100; }).length;
      var pctPromedio = Math.round(completitudOrden.reduce(function(s,x){ return s+x.pct; }, 0) / completitudOrden.length);
      var pctCol = pctPromedio>=80 ? '#16a34a' : pctPromedio>=50 ? '#d97706' : '#dc2626';

      // Guardar para exportación
      window._completitudDatos = completitudOrden.map(function(x){
        return { nombre:x.t.nombre, puesto:x.t.puesto, completados:x.completados, pct:x.pct, faltantes:x.faltantes.map(function(r){ return r.label; }) };
      });

      html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1px solid var(--border);margin-bottom:14px;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span style="font-size:16px;">📋</span>';
      html += '<div><div style="font-size:13px;font-weight:700;color:var(--navy);">Completitud de expedientes</div>';
      html += '<div style="font-size:11px;color:var(--ink3);">' + DOCS_REQUERIDOS.length + ' docs requeridos · ' + completosTotal + ' de ' + activos.length + ' trabajadores al 100%</div></div>';
      html += '</div>';
      html += '<button onclick="exportarCompletitudExcel()" style="padding:6px 12px;background:var(--navy);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">⬇ Exportar pendientes</button>';
      html += '</div>';

      // Medidor general
      html += '<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:10px 14px;background:var(--surface);border-radius:8px;">';
      html += '<div style="font-size:30px;font-weight:800;color:' + pctCol + ';min-width:56px;line-height:1;">' + pctPromedio + '%</div>';
      html += '<div style="flex:1;">';
      html += '<div style="height:10px;background:#e2e8f0;border-radius:5px;overflow:hidden;">';
      html += '<div style="height:100%;width:' + pctPromedio + '%;background:' + pctCol + ';border-radius:5px;transition:width .4s;"></div></div>';
      html += '<div style="font-size:11px;color:var(--ink3);margin-top:4px;">Promedio de completitud de la plantilla · ' + (activos.length - completosTotal) + ' trabajador(es) con documentos faltantes</div>';
      html += '</div></div>';

      // Tabla
      html += '<div style="overflow-x:auto;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<thead><tr>';
      html += '<th style="text-align:left;padding:5px 8px;border-bottom:1.5px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Trabajador</th>';
      html += '<th style="text-align:left;padding:5px 8px;border-bottom:1.5px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Puesto</th>';
      html += '<th style="padding:5px 8px;border-bottom:1.5px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Progreso · documentos faltantes</th>';
      html += '<th style="text-align:right;padding:5px 8px;border-bottom:1.5px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Estado</th>';
      html += '</tr></thead><tbody>';

      completitudOrden.forEach(function(x){
        var col = x.pct>=80 ? '#16a34a' : x.pct>=50 ? '#d97706' : '#dc2626';
        var bg  = x.pct>=80 ? '#dcfce7'  : x.pct>=50 ? '#fef3c7'  : '#fee2e2';
        html += '<tr>';
        html += '<td style="padding:8px 8px 6px;font-weight:600;vertical-align:top;">' + esc(x.t.nombre) + '</td>';
        html += '<td style="padding:8px 8px 6px;color:var(--ink2);white-space:nowrap;vertical-align:top;">' + esc(x.t.puesto||'—') + '</td>';
        html += '<td style="padding:8px 8px 6px;vertical-align:top;">';
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (x.faltantes.length ? '6' : '0') + 'px;">';
        html += '<div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;min-width:80px;">';
        html += '<div style="height:100%;width:' + x.pct + '%;background:' + col + ';border-radius:4px;"></div></div>';
        html += '<span style="font-size:11px;font-weight:700;color:var(--ink2);white-space:nowrap;">' + x.completados + '/' + DOCS_REQUERIDOS.length + '</span>';
        html += '</div>';
        if(x.faltantes.length){
          html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
          x.faltantes.forEach(function(r){
            html += '<span style="display:inline-block;padding:1px 7px;font-size:10px;font-weight:600;background:#fee2e2;color:#b91c1c;border-radius:8px;">Falta: '+r.label+'</span>';
          });
          html += '</div>';
        }
        html += '</td>';
        html += '<td style="padding:8px 8px 6px;text-align:right;vertical-align:top;white-space:nowrap;">';
        html += '<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-weight:700;font-size:11px;background:'+bg+';color:'+col+';">';
        html += x.pct===100 ? '✅ Completo' : x.pct+'%';
        html += '</span></td>';
        html += '</tr>';
      });

      html += '</tbody></table></div></div>';
    }

    // Distribución por puesto
    if (puestosOrden.length > 0) {
      html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1px solid var(--border);margin-bottom:14px;">';
      html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:12px;">Distribución por puesto</div>';
      puestosOrden.forEach(function(entry) {
        var k = entry[0], v = entry[1];
        html += '<div style="display:grid;grid-template-columns:130px 1fr 30px;align-items:center;gap:8px;margin-bottom:6px;">';
        html += '<div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + k + '</div>';
        html += '<div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;flex:1;"><div style="height:100%;width:' + Math.round(v/maxP*100) + '%;background:var(--navy2);border-radius:4px;"></div></div>';
        html += '<div style="font-size:12px;font-weight:700;text-align:right;">' + v + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Costo de plantilla
    if (conSalario.length > 0) {
      html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1px solid var(--border);margin-bottom:14px;">';
      html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:12px;">💰 Costo de plantilla</div>';

      // Mini KPIs
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;">';
      html += '<div style="background:var(--surface);border-radius:8px;padding:10px 12px;">';
      html += '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-bottom:3px;">Total mensual</div>';
      html += '<div style="font-size:20px;font-weight:800;color:#7c3aed;">' + mxn(costoMensualTotal) + '</div>';
      html += '<div style="font-size:10px;color:var(--ink3);">salario × 30.4 días</div></div>';

      html += '<div style="background:var(--surface);border-radius:8px;padding:10px 12px;">';
      html += '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-bottom:3px;">Promedio por trabajador</div>';
      html += '<div style="font-size:20px;font-weight:800;color:var(--navy);">' + mxn(salPromedio) + '</div>';
      html += '<div style="font-size:10px;color:var(--ink3);">' + conSalario.length + ' de ' + activos.length + ' activos</div></div>';

      html += '<div style="background:var(--surface);border-radius:8px;padding:10px 12px;">';
      html += '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-bottom:3px;">Cobertura</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + (pctConSalario < 70 ? '#d97706' : '#16a34a') + ';">' + pctConSalario + '%</div>';
      html += '<div style="font-size:10px;color:var(--ink3);">' + (activos.length - conSalario.length) + ' sin salario registrado</div></div>';
      html += '</div>';

      // Barras por puesto
      if (costoPuestoOrden.length > 0) {
        html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:8px;">Costo mensual por puesto</div>';
        costoPuestoOrden.forEach(function(entry) {
          var k = entry[0], v = entry[1];
          html += '<div style="display:grid;grid-template-columns:140px 1fr 90px;align-items:center;gap:8px;margin-bottom:6px;">';
          html += '<div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + k.replace(/"/g,'') + '">' + k + '</div>';
          html += '<div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;"><div style="height:100%;width:' + Math.round(v/maxCP*100) + '%;background:#7c3aed;border-radius:4px;"></div></div>';
          html += '<div style="font-size:12px;font-weight:700;text-align:right;color:#7c3aed;">' + mxn(v) + '</div>';
          html += '</div>';
        });
      }

      // Top 5 por salario
      if (topSalarios.length > 0) {
        html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-top:16px;margin-bottom:8px;">Mayores salarios individuales</div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        topSalarios.forEach(function(t, i) {
          var bg = i % 2 === 0 ? '' : 'background:var(--surface);';
          html += '<tr style="' + bg + '">';
          html += '<td style="padding:5px 8px;font-weight:600;">' + esc(t.nombre) + '</td>';
          html += '<td style="padding:5px 8px;color:var(--ink3);">' + esc(t.puesto||'—') + '</td>';
          html += '<td style="padding:5px 8px;text-align:right;font-weight:700;color:#7c3aed;font-variant-numeric:tabular-nums;">' + mxn(t.salario_diario * 30.4) + '/mes</td>';
          html += '<td style="padding:5px 8px;text-align:right;color:var(--ink3);font-variant-numeric:tabular-nums;">' + mxn(t.salario_diario) + '/día</td>';
          html += '</tr>';
        });
        html += '</table>';
      }

      html += '</div>';
    }

    // Documentos por tipo
    if (tiposOrden.length > 0) {
      html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1px solid var(--border);margin-bottom:14px;">';
      html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:12px;">Documentos por tipo</div>';
      tiposOrden.forEach(function(entry) {
        var k = entry[0], v = entry[1];
        html += '<div style="display:grid;grid-template-columns:150px 1fr 30px;align-items:center;gap:8px;margin-bottom:6px;">';
        html += '<div style="font-size:12px;">' + k.replace(/_/g,' ') + '</div>';
        html += '<div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;flex:1;"><div style="height:100%;width:' + Math.round(v/maxT*100) + '%;background:var(--teal,#0f766e);border-radius:4px;"></div></div>';
        html += '<div style="font-size:12px;font-weight:700;text-align:right;">' + v + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Tabla trabajadores
    var thSt = 'text-align:left;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);';
    var trigSt = 'padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--navy2);border-radius:6px;background:var(--white);color:var(--navy2);white-space:nowrap;';
    html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1px solid var(--border);overflow-x:auto;">';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--navy);flex-shrink:0;">Trabajadores activos (' + activos.length + ')</div>';
    html += '<input id="trab-search" type="search" placeholder="🔍 Buscar por nombre o puesto…" oninput="filtrarTrabajadores(this.value)" style="flex:1;min-width:0;">';
    html += '<button onclick="exportarExcelTrabajadores()" title="Exportar a Excel" style="padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--teal,#0d9488);border-radius:6px;background:var(--white);color:var(--teal,#0d9488);white-space:nowrap;flex-shrink:0;">⬇ Excel</button>';
    html += '</div>';
    var thSrt = thSt + 'cursor:pointer;user-select:none;';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr>';
    html += '<th data-col="nombre" onclick="ordenarTrabajadores(this)" style="' + thSrt + '">Nombre <span class="sort-ind"></span></th>';
    html += '<th data-col="puesto" onclick="ordenarTrabajadores(this)" style="' + thSrt + '">Puesto <span class="sort-ind"></span></th>';
    html += '<th data-col="ingreso" onclick="ordenarTrabajadores(this)" style="' + thSrt + '">Ingreso <span class="sort-ind"></span></th>';
    html += '<th data-col="antig" onclick="ordenarTrabajadores(this)" style="' + thSrt + '">Antigüedad <span class="sort-ind"></span></th>';
    html += '<th data-col="nss" onclick="ordenarTrabajadores(this)" style="' + thSrt + '">NSS <span class="sort-ind"></span></th>';
    html += '<th style="' + thSt + '">Documentos</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    if (activos.length === 0) {
      html += '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--ink3);">Sin trabajadores</td></tr>';
    } else {
      activos.forEach(function(t, idx) {
        var searchVal = ((t.nombre||'') + ' ' + (t.puesto||'')).replace(/"/g,'');
        var diasAntigSort = t.fecha_ingreso ? Math.floor((new Date()-new Date(t.fecha_ingreso+'T12:00:00'))/86400000) : -1;
        html += '<tr class="trab-row"'
          + ' data-search="' + searchVal.toLowerCase() + '"'
          + ' data-nombre="' + ((t.nombre||'').toLowerCase().replace(/"/g,'')) + '"'
          + ' data-puesto="' + ((t.puesto||'').toLowerCase().replace(/"/g,'')) + '"'
          + ' data-ingreso="' + (t.fecha_ingreso||'') + '"'
          + ' data-antig="' + diasAntigSort + '"'
          + ' data-nss="' + (t.nss||'') + '">';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);font-weight:600;">' + esc(t.nombre) + '</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">' + esc(t.puesto||'—') + '</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">' + fmt(t.fecha_ingreso) + '</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">' + antig(t.fecha_ingreso) + '</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">' + esc(t.nss||'—') + '</td>';
        var docCnt = docsPorTrab[t.id] || 0;
        var tSet = docsPorTrabSet[t.id] || new Set();
        var tPct = Math.round(tSet.size / DOCS_REQUERIDOS.length * 100);
        var tCol = tPct >= 80 ? '#0f766e' : tPct >= 50 ? '#92400e' : '#991b1b';
        var tBg  = tPct >= 80 ? '#ccfbf1' : tPct >= 50 ? '#fef3c7' : '#fee2e2';
        html += '<td style="padding:6px 10px;border-bottom:1px solid var(--border);">';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += '<span title="Expediente: ' + tSet.size + '/' + DOCS_REQUERIDOS.length + ' documentos requeridos" style="display:inline-block;padding:2px 8px;background:' + tBg + ';color:' + tCol + ';border-radius:10px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;cursor:default;">' + tSet.size + '/' + DOCS_REQUERIDOS.length + ' 📄</span>';
        html += '<button style="' + trigSt + '" onclick="toggleGenMenu(event,' + idx + ')">⚡ Generar ▾</button>';
        html += '</div>';
        html += '</td>';
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';

    // Tabla bajas
    if (bajas.length > 0) {
      html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1px solid var(--border);margin-top:14px;overflow-x:auto;">';
      html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:12px;">Bajas (' + bajas.length + ')</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<thead><tr><th style="text-align:left;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">Nombre</th><th style="text-align:left;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">Puesto</th><th style="text-align:left;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">Fecha baja</th><th style="text-align:left;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">Motivo</th></tr></thead>';
      html += '<tbody>';
      bajas.forEach(function(t) {
        html += '<tr>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);font-weight:600;">' + esc(t.nombre) + '</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">' + esc(t.puesto||'—') + '</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">' + fmt(t.fecha_baja) + '</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">' + esc(t.motivo_baja||'—') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }

    // ── Sección Asistencias ────────────────────────────────────────────────────
    // Calcula días laborales (lun-vie) en el período para cada trabajador.
    // Los registros de asistencia pueden tener gaps (pre-cierre-automático);
    // el porcentaje se calcula sobre días laborales desde el ingreso del trabajador.
    var hoyStr = new Date().toISOString().split('T')[0];
    var hastaStr = hoyStr; // hasta hoy

    function contarDiasLaborales(desde, hasta) {
      var count = 0;
      var cur = new Date(desde + 'T12:00:00Z');
      var fin = new Date(hasta + 'T12:00:00Z');
      while (cur <= fin) {
        var dow = cur.getUTCDay();
        if (dow >= 1 && dow <= 5) count++;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return count;
    }

    var asisFiltrados = asisAll.filter(function(a){ return !desdeStr || (a.fecha||'') >= desdeStr; });
    var resumenAsis = {};
    activos.forEach(function(t){
      var inicioEfectivo = (t.fecha_ingreso && t.fecha_ingreso > desdeStr) ? t.fecha_ingreso : desdeStr;
      resumenAsis[t.id] = {
        nombre: t.nombre, puesto: t.puesto,
        presentes: 0, retrasos: 0, faltasInj: 0, faltasJus: 0,
        vacaciones: 0, permisos: 0, incapacidades: 0, sinRegistro: 0,
        diasLaborales: contarDiasLaborales(inicioEfectivo, hastaStr),
        registrados: 0,
      };
    });
    asisFiltrados.forEach(function(a){
      if (!resumenAsis[a.trabajador_id]) return;
      var r = resumenAsis[a.trabajador_id];
      r.registrados++;
      var s = a.status || '';
      if (s === 'presente') r.presentes++;
      else if (s === 'retraso') r.retrasos++;
      else if (s === 'falta_injustificada') r.faltasInj++;
      else if (s === 'falta_justificada') r.faltasJus++;
      else if (s === 'vacaciones') r.vacaciones++;
      else if (s === 'permiso') r.permisos++;
      else if (s === 'incapacidad') r.incapacidades++;
      else if (s === 'sin_registro') r.sinRegistro++;
    });

    var filasAsis = Object.values(resumenAsis).sort(function(a,b){ return a.nombre.localeCompare(b.nombre); });
    var totalPresentes = filasAsis.reduce(function(s,r){ return s+r.presentes+r.retrasos; }, 0);
    var totalLaborales = filasAsis.reduce(function(s,r){ return s+r.diasLaborales; }, 0);
    var pctGlobal = totalLaborales > 0 ? Math.round(totalPresentes/totalLaborales*100) : 0;
    var pctGlobalCol = pctGlobal>=90?'#16a34a':pctGlobal>=70?'#d97706':'#dc2626';

    html += '<div style="background:var(--white);border-radius:10px;padding:16px;border:1px solid var(--border);margin-top:14px;overflow-x:auto;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">';
    html += '<div>';
    html += '<div style="font-size:13px;font-weight:700;color:var(--navy);">📅 Asistencias por trabajador</div>';
    html += '<div style="font-size:11px;color:var(--ink3);margin-top:2px;">% calculado sobre días laborales (lun-vie) desde ingreso del trabajador</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<div style="text-align:center;padding:6px 14px;border-radius:8px;background:var(--surface);"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--ink3);">Asistencia global</div><div style="font-size:20px;font-weight:800;color:'+pctGlobalCol+';">'+pctGlobal+'%</div></div>';
    html += '<a href="asistencias-vacaciones.html" style="padding:6px 14px;background:var(--navy2);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;">📋 Control de asistencias</a>';
    html += '</div></div>';

    if (filasAsis.length === 0) {
      html += '<div style="text-align:center;padding:20px;color:var(--ink3);font-size:12px;">Sin trabajadores activos en el período.</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<thead><tr style="background:var(--surface);">';
      html += '<th style="text-align:left;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">Nombre</th>';
      html += '<th style="text-align:left;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">Puesto</th>';
      html += '<th style="text-align:right;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">Días lab.</th>';
      html += '<th style="text-align:right;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:#16a34a;">Pres.</th>';
      html += '<th style="text-align:right;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:#d97706;">Ret.</th>';
      html += '<th style="text-align:right;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:#dc2626;">Faltas</th>';
      html += '<th style="text-align:right;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:#7c3aed;">Vac/Perm</th>';
      html += '<th style="text-align:right;padding:7px 10px;border-bottom:1.5px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--ink3);">% Asist.</th>';
      html += '</tr></thead><tbody>';
      filasAsis.forEach(function(r) {
        var asistio = r.presentes + r.retrasos;
        var faltas  = r.faltasInj + r.faltasJus;
        var vacPerm = r.vacaciones + r.permisos + r.incapacidades;
        var pct = r.diasLaborales > 0 ? Math.round(asistio / r.diasLaborales * 100) : null;
        var col = pct === null ? 'var(--ink3)' : pct>=90?'#16a34a':pct>=70?'#d97706':'#dc2626';
        var bg  = pct === null ? '' : pct>=90?'#f0fdf4':pct>=70?'#fffbeb':'#fef2f2';
        html += '<tr style="background:'+bg+';">';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);font-weight:600;">'+esc(r.nombre)+'</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--ink2);">'+esc(r.puesto||'—')+'</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;color:var(--ink3);">'+r.diasLaborales+'</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;color:#16a34a;font-weight:600;">'+r.presentes+'</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;color:#d97706;">'+r.retrasos+'</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;color:#dc2626;">'+(faltas>0?'<strong>'+faltas+'</strong>':'0')+'</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;color:#7c3aed;">'+vacPerm+'</td>';
        html += '<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:'+col+';">'+(pct!==null?pct+'%':'—')+'</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '<div style="font-size:10px;color:var(--ink3);margin-top:8px;padding:6px 0;border-top:1px solid var(--border);">';
      html += 'Pres.=Presentes · Ret.=Retrasos · Faltas=injust.+just. · Vac/Perm=vacaciones+permisos+incapacidades · ';
      html += '% = (Pres.+Ret.) ÷ Días laborales · Art. 804 LFT.';
      html += '</div>';
    }
    html += '</div>';
    // ── fin Asistencias ───────────────────────────────────────────────────────

    el.innerHTML = html;
    console.log('[Rep] HTML renderizado OK (' + html.length + ' chars)');
  } catch(e) {
    console.error('renderReportes error:', e.message, e.stack);
    el.innerHTML = '<div style="padding:40px;color:#dc2626;font-size:13px;"><strong>Error:</strong> '+e.message+'<br><pre style="font-size:11px;margin-top:8px;white-space:pre-wrap;">'+e.stack+'</pre></div>';
  }
}


// ════════════════════════════════════════════
// CALCULADORA COMPLETA (flujo unificado)
// ════════════════════════════════════════════
function calcCompleto(){
  const sal  = parseFloat(document.getElementById('cu-salario').value);
  const ing  = document.getElementById('cu-ingreso').value;
  const baj  = document.getElementById('cu-baja').value;
  const mot  = document.getElementById('cu-motivo').value;
  const salPendDias = parseFloat(document.getElementById('cu-sal-pend').value)||0;
  const agDias = parseFloat(document.getElementById('cu-agui-dias').value)||15;
  const salMin = parseFloat(document.getElementById('cu-salmin').value)||315.04;
  const res  = document.getElementById('cu-resultado');

  if(!sal||sal<=0||!ing||!baj||new Date(baj)<=new Date(ing)){
    res.innerHTML='<div style="text-align:center;padding:30px;opacity:.4;font-size:13px;">Complete los datos para calcular</div>';
    document.getElementById('cu-botones').style.display='none';
    return;
  }

  const anios = diffAnios(ing, baj);
  const diasTotal = diffDias(ing, baj);
  const fracAnio = (diasTotal - anios*365)/365;
  const aniosTot = anios + fracAnio;

  // Año calendario para aguinaldo
  const inicioAnio = new Date(new Date(baj).getFullYear(),0,1).toISOString().slice(0,10);
  const diasAnio   = diffDias(inicioAnio, baj);

  // Vacaciones proporcionales (periodo en curso)
  const ultimoAnivD = new Date(ing);
  ultimoAnivD.setFullYear(new Date(ing).getFullYear() + anios);
  const ultimoAniv = ultimoAnivD.toISOString().slice(0,10);
  const diasPeriodoActual = diffDias(ultimoAniv, baj);
  const diasVacSig = diasVacacionesPorAnios(anios+1);
  const diasVacProp = Math.round(diasPeriodoActual/365*diasVacSig*100)/100;

  // SDI auto-calculado (salario integrado para indemnización)
  // SDI = SD × (1 + agDias/365 + vacSig/365 + vacSig*0.25/365)
  const sdi = sal * (1 + agDias/365 + diasVacSig/365 + diasVacSig*0.25/365);

  const conIndemnizacion = (mot === 'despido');
  const primaAntiguedadAplica = conIndemnizacion || (anios >= 15);

  // ── Conceptos de finiquito (siempre aplican) ──
  const salPendImporte   = salPendDias * sal;
  const vacPropImporte   = diasVacProp * sal;
  const primVacPropImp   = vacPropImporte * 0.25;
  const aguinaldoProp    = (diasAnio/365) * agDias * sal;

  const subtotalFiniquito = salPendImporte + vacPropImporte + primVacPropImp + aguinaldoProp;

  // ── Conceptos de indemnización (solo despido injustificado) ──
  const tresMeses   = conIndemnizacion ? sdi * 90 : 0;
  const veinteDias  = conIndemnizacion ? sdi * 20 * Math.max(aniosTot, 1/12) : 0;

  // ── Prima de antigüedad (Art. 162) ──
  const salAnt = Math.min(sal, salMin*2);
  const primaAnt = primaAntiguedadAplica ? salAnt * 12 * Math.max(1, anios) : 0;

  const totalGeneral = subtotalFiniquito + tresMeses + veinteDias + primaAnt;

  const n = (v) => v.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});

  const motLabels = {
    renuncia:'Renuncia voluntaria',
    despido:'Despido injustificado',
    rescision47:'Rescisión justificada (Art. 47)',
    acuerdo:'Mutuo acuerdo',
  };
  const motClass = {renuncia:'cu-motivo-renuncia',despido:'cu-motivo-despido',rescision47:'cu-motivo-rescision',acuerdo:'cu-motivo-acuerdo'};

  let html = `<div class="cu-motivo-badge ${motClass[mot]}">${motLabels[mot]}</div>`;

  // Finiquito section
  html += '<div style="font-size:10px;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Finiquito (siempre aplica)</div>';
  if(salPendDias>0) html += cuFila('Salarios pendientes',''+salPendDias+' días × $'+n(sal), salPendImporte);
  html += cuFila('Vacaciones proporcionales ('+diasVacProp+' días — Art. 79)',''+diasPeriodoActual+' días trans. / 365 × '+diasVacSig+' días', vacPropImporte);
  html += cuFila('Prima vacacional (25%)',''+diasVacProp+' días × $'+n(sal)+' × 25%', primVacPropImp);
  html += cuFila('Aguinaldo proporcional',''+Math.round(diasAnio)+' días del año / 365 × '+agDias+' días × $'+n(sal), aguinaldoProp);
  html += `<div class="cu-sep"></div>`;
  html += `<div class="cu-concepto"><span class="cu-concepto-label" style="font-weight:600;">Subtotal finiquito</span><span class="cu-concepto-val">$${n(subtotalFiniquito)}</span></div>`;

  // Indemnización (despido)
  if(conIndemnizacion){
    html += '<div style="font-size:10px;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">Indemnización (Art. 48 LFT)</div>';
    html += `<div style="font-size:10px;opacity:.4;margin-bottom:8px;">SDI auto-calculado: $${n(sdi)}/día (SD + partes prop. mínimas)</div>`;
    html += cuFila('3 meses de salario','$'+n(sdi)+' × 90 días', tresMeses);
    html += cuFila('20 días × año ('+aniosTot.toFixed(1)+' años)','$'+n(sdi)+' × 20 × '+aniosTot.toFixed(1), veinteDias);
    html += `<div class="cu-sep"></div>`;
  }

  // Prima antigüedad
  if(primaAntiguedadAplica){
    const razPrimaAnt = conIndemnizacion ? 'por despido' : anios+'+ años';
    html += '<div style="font-size:10px;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">Prima de antigüedad (Art. 162 LFT)</div>';
    html += cuFila('Prima de antigüedad ('+razPrimaAnt+')','12 días × '+Math.max(1,anios)+' años × $'+n(salAnt)+' (tope 2×SM)',primaAnt);
    html += `<div class="cu-sep"></div>`;
  }

  // Total
  html += `<div class="cu-total"><span>TOTAL A PAGAR</span><span>$${n(totalGeneral)}</span></div>`;
  if(anios>0){
    html += `<div style="font-size:11px;opacity:.45;margin-top:6px;">Antigüedad: ${anios} año${anios!==1?'s':''} ${Math.round(fracAnio*12)} mes${Math.round(fracAnio*12)!==1?'es':''}</div>`;
  }

  window._cuCalcData = { nombre: document.getElementById('cu-nombre').value, motivo: motLabels[mot], total: totalGeneral, resHtml: html };
  res.innerHTML = html;
  document.getElementById('cu-botones').style.display = 'flex';
}

function cuFila(label, formula, val){
  return `<div class="cu-concepto">
    <div><div class="cu-concepto-label">${label}</div><div class="cu-concepto-formula">${formula}</div></div>
    <div class="cu-concepto-val">$${val.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
  </div>`;
}

function imprimirCalcCompleto(){
  const d = window._cuCalcData;
  if(!d) return;
  const empresa = clienteActual?.empresa||'';
  const w = window.open('','_blank','width=720,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cálculo de terminación laboral</title>
  <style>
    body{font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:40px auto;color:#1a1a1a;}
    h1{font-size:20px;border-bottom:2px solid #0f2640;padding-bottom:8px;margin-bottom:4px;}
    .sub{font-size:13px;color:#888;margin-bottom:24px;}
    .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eee;font-size:14px;}
    .row.total{font-weight:700;font-size:16px;border-top:2px solid #0f2640;border-bottom:none;padding-top:10px;}
    .section-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;padding:14px 0 4px;}
    .badge{display:inline-block;font-size:11px;padding:2px 10px;border-radius:10px;background:#dbeafe;color:#1e40af;margin-bottom:16px;}
    @media print{body{margin:20px;}}
  </style></head><body>
  <h1>Cálculo de terminación laboral</h1>
  <div class="sub">${empresa ? empresa+' · ' : ''}${d.nombre||''} · ${new Date().toLocaleDateString('es-MX')}</div>
  <div class="badge">${d.motivo}</div>
  ${d.resHtml.replace(/class="cu-concepto"/g,'class="row"').replace(/class="cu-total"/g,'class="row total"').replace(/<div class="cu-concepto-formula">[^<]*<\/div>/g,'').replace(/class="cu-concepto-label[^"]*"/g,'').replace(/class="cu-concepto-val"/g,'').replace(/class="cu-motivo-badge[^"]*">.*?<\/div>/,'').replace(/class="cu-sep"/g,'style="display:none"').replace(/<div style="font-size:10[^>]*>[^<]*<\/div>/g,s=>s.replace('font-size:10','class="section-hdr" style="display:block;font-size:10'))}
  <p style="margin-top:24px;font-size:11px;color:#888;">Cálculo orientativo basado en LFT vigente. Confirme los importes con su asesor legal antes de hacer el pago.</p>
  </body></html>`);
  w.document.close();
  setTimeout(()=>w.print(),400);
}

// ════════════════════════════════════════════
// NOM-035 — DASHBOARD DE CUMPLIMIENTO
// ════════════════════════════════════════════
const NOM035_ELEMENTOS = [
  { id:'e1', num:'1', titulo:'Política de prevención de riesgos psicosociales', art:'Arts. 7, 8 y 9 NOM-035', items:[
    { id:'e1i1', texto:'Elaborar la política escrita de prevención de riesgos psicosociales', art:'Art. 8.1' },
    { id:'e1i2', texto:'Difundir la política entre todos los trabajadores (mínimo una vez al año)', art:'Art. 8.2' },
    { id:'e1i3', texto:'La política establece mecanismos de participación de los trabajadores', art:'Art. 8.3' },
    { id:'e1i4', texto:'Revisar y actualizar la política al menos una vez al año', art:'Art. 8.4' },
  ]},
  { id:'e2', num:'2', titulo:'Identificación y análisis de factores de riesgo psicosocial', art:'Arts. 7.2, 8.1 y Guías de referencia I y II', items:[
    { id:'e2i1', texto:'Aplicar la Guía de Referencia I (≤50 trabajadores) o evaluación con instrumento validado (>50)', art:'Art. 7.2' },
    { id:'e2i2', texto:'Evaluar las condiciones del entorno organizacional (Guía de Referencia II)', art:'Art. 7.3' },
    { id:'e2i3', texto:'Identificar trabajadores expuestos a violencia laboral', art:'Art. 7.4' },
    { id:'e2i4', texto:'Documentar y conservar los resultados de la evaluación (mínimo 2 años)', art:'Art. 7.5' },
  ]},
  { id:'e3', num:'3', titulo:'Medidas y acciones de control', art:'Art. 8.5 NOM-035', items:[
    { id:'e3i1', texto:'Establecer medidas de prevención y control para los factores de riesgo identificados', art:'Art. 8.5.1' },
    { id:'e3i2', texto:'Difundir las medidas entre los trabajadores afectados', art:'Art. 8.5.2' },
    { id:'e3i3', texto:'Implementar acciones de mejora en el entorno organizacional', art:'Art. 8.5.3' },
    { id:'e3i4', texto:'Elaborar un plan de acción con responsables y fechas de seguimiento', art:'Art. 8.5.4' },
  ]},
  { id:'e4', num:'4', titulo:'Práctica de exámenes médicos y psicológicos', art:'Art. 8.6 NOM-035 (aplica si hay trabajadores con riesgo identificado)', items:[
    { id:'e4i1', texto:'Ofrecer exámenes médicos a trabajadores identificados con exposición a factores de riesgo', art:'Art. 8.6.1' },
    { id:'e4i2', texto:'Garantizar la confidencialidad de los resultados médicos', art:'Art. 8.6.2' },
    { id:'e4i3', texto:'Documentar la oferta de exámenes aunque el trabajador decline realizarlos', art:'Art. 8.6.3' },
  ]},
  { id:'e5', num:'5', titulo:'Información y capacitación a trabajadores', art:'Art. 8.7 NOM-035', items:[
    { id:'e5i1', texto:'Proporcionar información a los trabajadores sobre los factores de riesgo psicosocial', art:'Art. 8.7.1' },
    { id:'e5i2', texto:'Capacitar a quienes participan en la identificación y análisis de factores de riesgo', art:'Art. 8.7.2' },
    { id:'e5i3', texto:'Capacitar a los jefes directos en prevención de violencia laboral y hostigamiento', art:'Art. 8.7.3' },
  ]},
];

function nom035Key(){
  return 'nom035_'+(_rfcReal||clienteActual?.rfc||'demo');
}

function nom035Toggle(itemId){
  const saved = JSON.parse(localStorage.getItem(nom035Key())||'{}');
  saved[itemId] = !saved[itemId];
  localStorage.setItem(nom035Key(), JSON.stringify(saved));
  renderNom035();
}

function renderNom035(){
  const el = document.getElementById('nom035-contenido');
  if(!el) return;
  const saved = JSON.parse(localStorage.getItem(nom035Key())||'{}');

  const totalItems = NOM035_ELEMENTOS.reduce((s,e)=>s+e.items.length,0);
  const doneItems  = NOM035_ELEMENTOS.reduce((s,e)=>s+e.items.filter(i=>saved[i.id]).length,0);
  const pct = totalItems>0 ? Math.round(doneItems/totalItems*100) : 0;

  const ringColor = pct>=75?'#0d9488':pct>=40?'#d97706':'#dc2626';
  const ringText  = pct>=75?'✅ Cumplimiento alto':pct>=40?'⚠️ Cumplimiento parcial':'🔴 Cumplimiento bajo';
  const circum = 2*Math.PI*30;
  const dash   = (pct/100)*circum;

  let html = `<div style="margin-bottom:16px;">
    <div style="font-size:13px;color:var(--ink2);line-height:1.5;padding:10px 14px;background:var(--sky);border:1px solid var(--border2);border-radius:var(--r-sm);">
      <strong>NOM-035-STPS-2018</strong> · Factores de riesgo psicosocial en el trabajo. Marque los elementos que su empresa ya tiene implementados para visualizar su nivel de cumplimiento.
    </div>
  </div>
  <div class="nom-prog-wrap">
    <div class="nom-ring">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="30" fill="none" stroke="var(--border2)" stroke-width="8"/>
        <circle cx="40" cy="40" r="30" fill="none" stroke="${ringColor}" stroke-width="8"
          stroke-dasharray="${dash.toFixed(1)} ${circum.toFixed(1)}" stroke-linecap="round"/>
      </svg>
      <div class="nom-ring-label">${pct}%<span class="nom-ring-sub">${doneItems}/${totalItems}</span></div>
    </div>
    <div style="flex:1;">
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:4px;">${ringText}</div>
      <div style="font-size:12px;color:var(--ink3);line-height:1.5;">${doneItems} de ${totalItems} requisitos cumplidos · El progreso se guarda en este navegador automáticamente.</div>
      <div style="margin-top:8px;">
        <div style="height:6px;border-radius:3px;background:var(--border2);overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${ringColor};border-radius:3px;transition:width .4s;"></div>
        </div>
      </div>
    </div>
  </div>`;

  NOM035_ELEMENTOS.forEach(elem=>{
    const elemDone = elem.items.filter(i=>saved[i.id]).length;
    const elemPct  = Math.round(elemDone/elem.items.length*100);
    const badgeBg  = elemDone===elem.items.length?'#ccfbf1':elemDone>0?'#fef3c7':'#fee2e2';
    const badgeCol = elemDone===elem.items.length?'#0f766e':elemDone>0?'#92400e':'#991b1b';
    html += `<div class="nom-seccion">
      <div class="nom-seccion-hdr">
        <div style="width:24px;height:24px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${elem.num}</div>
        <div class="nom-seccion-title">${elem.titulo}<br><span style="font-size:10px;color:var(--ink3);font-weight:400;">${elem.art}</span></div>
        <div class="nom-seccion-badge" style="background:${badgeBg};color:${badgeCol};">${elemDone}/${elem.items.length}</div>
      </div>`;
    elem.items.forEach(item=>{
      const checked = !!saved[item.id];
      html += `<div class="nom-item" onclick="nom035Toggle('${item.id}')">
        <input type="checkbox" ${checked?'checked':''} onclick="event.stopPropagation();nom035Toggle('${item.id}')">
        <div>
          <div class="nom-item-text" style="${checked?'text-decoration:line-through;opacity:.55;':''}">${item.texto}</div>
          <div class="nom-item-art">${item.art}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  });

  html += `<div style="margin-top:14px;padding:12px 14px;background:var(--sky);border:1px solid var(--border2);border-radius:var(--r-sm);font-size:12px;color:var(--ink2);line-height:1.6;">
    ⚠️ <strong>Nota legal:</strong> Esta herramienta es de autoevaluación orientativa. La NOM-035 obliga a empresas de todos los tamaños; las obligaciones difieren según número de trabajadores (1-15, 16-50, más de 50). Para auditorías formales de la STPS, consulte a su asesor.
    <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="goPanel('solicitudes')">Consultar a mi asesor →</button></div>
  </div>`;

  el.innerHTML = html;
}

// ════════════════════════════════════════════
// HISTORIAL DE MOVIMIENTOS DE PLANTILLA
// ════════════════════════════════════════════
async function renderHistorial(){
  const el = document.getElementById('hist-contenido');
  if(!el) return;
  el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--ink3);">⏳ Cargando movimientos…</div>';

  const rfcUsar = _rfcReal || clienteActual?.rfc;
  if(!rfcUsar || !_sbAuth){
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink3);">Inicia sesión para ver el historial de plantilla.</div>';
    return;
  }

  try{
    const { data: sesData } = await _sbAuth.auth.getSession();
    const tok = sesData?.session?.access_token;
    if(!tok){ el.innerHTML='<div style="padding:40px;text-align:center;color:#dc2626;">Sin sesión activa. <button onclick="location.reload()" style="padding:6px 14px;background:var(--navy2);color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:6px;">Recargar</button></div>'; return; }

    const hdrs = { apikey:SUPABASE_ANON_KEY, Authorization:'Bearer '+tok, Accept:'application/json' };
    const base = SUPABASE_URL+'/rest/v1/';
    const rfc  = encodeURIComponent(rfcUsar);

    const hace90 = new Date();
    hace90.setDate(hace90.getDate()-90);
    const hace90str = hace90.toISOString().slice(0,10);

    const [altasJ, bajasJ] = await Promise.all([
      fetch(base+'trabajadores?select=id,nombre,puesto,fecha_ingreso&cliente_rfc=eq.'+rfc+'&fecha_ingreso=gte.'+hace90str+'&order=fecha_ingreso.desc&limit=100',{headers:hdrs}).then(r=>r.ok?r.json():[]),
      fetch(base+'trabajadores?select=id,nombre,puesto,fecha_baja,motivo_baja&cliente_rfc=eq.'+rfc+'&activo=eq.false&fecha_baja=gte.'+hace90str+'&order=fecha_baja.desc&limit=100',{headers:hdrs}).then(r=>r.ok?r.json():[]),
    ]);

    const altas = (Array.isArray(altasJ)?altasJ:[]).map(t=>({tipo:'alta',fecha:t.fecha_ingreso,nombre:t.nombre,puesto:t.puesto||'',extra:''}));
    const bajas = (Array.isArray(bajasJ)?bajasJ:[]).map(t=>({tipo:'baja',fecha:t.fecha_baja,nombre:t.nombre,puesto:t.puesto||'',extra:t.motivo_baja||''}));
    const eventos = [...altas,...bajas].sort((a,b)=>b.fecha.localeCompare(a.fecha));

    const nAltas = altas.length, nBajas = bajas.length;
    const rotacion = (nAltas+nBajas);

    let html = `<div style="display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;padding:12px 16px;background:var(--sky);border:1px solid var(--border2);border-radius:var(--r-sm);text-align:center;">
        <div style="font-size:24px;font-weight:800;color:#0d9488;">${nAltas}</div>
        <div style="font-size:12px;color:var(--ink3);">Altas últimos 90 días</div>
      </div>
      <div style="flex:1;min-width:120px;padding:12px 16px;background:var(--sky);border:1px solid var(--border2);border-radius:var(--r-sm);text-align:center;">
        <div style="font-size:24px;font-weight:800;color:#dc2626;">${nBajas}</div>
        <div style="font-size:12px;color:var(--ink3);">Bajas últimos 90 días</div>
      </div>
      <div style="flex:1;min-width:120px;padding:12px 16px;background:var(--sky);border:1px solid var(--border2);border-radius:var(--r-sm);text-align:center;">
        <div style="font-size:24px;font-weight:800;color:var(--navy2);">${rotacion}</div>
        <div style="font-size:12px;color:var(--ink3);">Total movimientos</div>
      </div>
    </div>`;

    if(!eventos.length){
      html += '<div class="hist-empty">📋 Sin movimientos de plantilla en los últimos 90 días.</div>';
    } else {
      let prevMes = '';
      html += '<div class="hist-timeline">';
      eventos.forEach(ev=>{
        const d = new Date(ev.fecha+'T12:00:00');
        const mesLabel = d.toLocaleDateString('es-MX',{month:'long',year:'numeric'});
        if(mesLabel!==prevMes){
          html += `<div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;padding:4px 0 8px;">${mesLabel}</div>`;
          prevMes=mesLabel;
        }
        const dia = d.toLocaleDateString('es-MX',{weekday:'short',day:'numeric'});
        html += `<div class="hist-event ${ev.tipo}">
          <div class="hist-card">
            <span class="hist-badge hist-badge-${ev.tipo}">${ev.tipo==='alta'?'▲ Alta':'▼ Baja'}</span>
            <div class="hist-nombre">${ev.nombre}</div>
            <div class="hist-meta">${ev.puesto||'Sin puesto'}${ev.extra?' · '+ev.extra:''} · ${dia}</div>
          </div>
        </div>`;
      });
      html += '</div>';
    }

    html += `<div style="margin-top:16px;font-size:11px;color:var(--ink3);text-align:center;">Mostrando movimientos de los últimos 90 días · ${new Date().toLocaleDateString('es-MX')}</div>`;
    el.innerHTML = html;

  } catch(e){
    el.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">Error al cargar el historial: ${e.message||e}</div>`;
  }
}

function exportarCompletitudExcel() {
  var datos = window._completitudDatos;
  if (!datos || !datos.length) { alert('Abra Reportes gerenciales para generar la tabla primero.'); return; }
  var esc = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  var xml = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  xml += '<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#0F2640" ss:Pattern="Solid"/><Font ss:Color="#FFFFFF" ss:Bold="1"/></Style>';
  xml += '<Style ss:ID="ok"><Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/></Style>';
  xml += '<Style ss:ID="am"><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/></Style>';
  xml += '<Style ss:ID="ro"><Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/></Style></Styles>';
  xml += '<Worksheet ss:Name="Expedientes"><Table>';
  xml += '<Row>';
  ['Trabajador','Puesto','Docs completos','Total requeridos','% Completitud','Documentos faltantes'].forEach(function(h){
    xml += '<Cell ss:StyleID="h"><Data ss:Type="String">'+esc(h)+'</Data></Cell>';
  });
  xml += '</Row>';
  datos.forEach(function(x){
    var sid = x.pct>=80 ? 'ok' : x.pct>=50 ? 'am' : 'ro';
    xml += '<Row>';
    xml += '<Cell ss:StyleID="'+sid+'"><Data ss:Type="String">'+esc(x.nombre)+'</Data></Cell>';
    xml += '<Cell ss:StyleID="'+sid+'"><Data ss:Type="String">'+esc(x.puesto)+'</Data></Cell>';
    xml += '<Cell ss:StyleID="'+sid+'"><Data ss:Type="Number">'+x.completados+'</Data></Cell>';
    xml += '<Cell ss:StyleID="'+sid+'"><Data ss:Type="Number">'+DOCS_REQUERIDOS.length+'</Data></Cell>';
    xml += '<Cell ss:StyleID="'+sid+'"><Data ss:Type="Number">'+x.pct+'</Data></Cell>';
    xml += '<Cell ss:StyleID="'+sid+'"><Data ss:Type="String">'+esc(x.faltantes.join(', ') || '—')+'</Data></Cell>';
    xml += '</Row>';
  });
  xml += '</Table></Worksheet></Workbook>';
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], {type:'application/vnd.ms-excel'}));
  a.download = 'completitud-expedientes.xls';
  a.click();
}


async function logout(){
  if (_modoDespacho) {
    _modoDespacho = null;
    clienteActual = null;
    window.location.href = 'panel-despacho.html';
    return;
  }
  await sbAuth.auth.signOut();
  try { localStorage.removeItem('cl_rfc_auth'); } catch(_) {}
  clienteActual = null;
  document.getElementById('portal-app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-rfc').value = '';
  document.getElementById('login-pass').value = '';
}

// ════════════════════════════════════════════
// PORTAL INIT
// ════════════════════════════════════════════
function initPortal(){
  const c = clienteActual;

  // Sidebar
  document.getElementById('sb-empresa-name').textContent = c.empresa;
  document.getElementById('sb-rfc-display').textContent = c.rfc;
  document.getElementById('sb-contacto-name').textContent = c.contacto;
  const planBadge = document.getElementById('sb-plan-badge');
  planBadge.textContent = 'Plan '+c.plan;
  const planSlug = {'Básico':'basico','Estándar':'estandar','Pro':'pro'}[c.plan] || 'estandar';
  planBadge.className = 'sb-logo-plan plan-'+planSlug;
  document.getElementById('sb-alert-badge').textContent = c.alertas.length;

  // Cargar saldo de créditos de firma en el sidebar
  cargarCreditosFirma();

  // Despacho mode
  if (_modoDespacho) {
    const banner = document.getElementById('sb-despacho-banner');
    document.getElementById('sb-despacho-nombre').textContent = _modoDespacho.despacho || '';
    banner.style.display = 'block';
    document.getElementById('sb-mi-cuenta-sec').style.display = 'none';
    document.getElementById('sb-logout-btn').textContent = '← Volver a mi cartera';
  }

  // Topbar fecha
  document.getElementById('topbar-fecha').textContent = new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  // Config
  document.getElementById('cfg-contacto').value = c.contacto;
  document.getElementById('cfg-email').value = c.email;
  document.getElementById('cfg-tel').value = c.tel;

  renderInicio();
  renderCompliance();
  renderAlertas();
  renderDocs();
  renderGeneradores();
  renderSuscripcion();
  renderNotifPrefs();
  initScrollHintSidebar();
  window.dispatchEvent(new Event('portalListo'));
}

// ════════════════════════════════════════════
// HINT VISUAL DE SCROLL EN EL MENÚ LATERAL
// Evita que el cliente no se entere de que hay más opciones abajo
// (Suscripción, Configuración) cuando el menú no cabe completo.
// ════════════════════════════════════════════
function initScrollHintSidebar(){
  const nav = document.querySelector('.sb-nav');
  const hint = document.getElementById('sb-scroll-hint');
  if (!nav || !hint) return;

  function actualizarHint(){
    const haySobrante = nav.scrollHeight - nav.clientHeight > 4;
    const yaLlegoAlFondo = nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 4;
    hint.classList.toggle('hidden', !haySobrante || yaLlegoAlFondo);
  }

  nav.addEventListener('scroll', actualizarHint);
  window.addEventListener('resize', actualizarHint);
  // Pequeño delay para que el layout ya esté pintado antes de medir
  setTimeout(actualizarHint, 50);
}

// ════════════════════════════════════════════
// RENDERS
// ════════════════════════════════════════════
const scoreColor = s => s>=80?'var(--green)':s>=50?'var(--amber)':'var(--red)';

function renderInicio(){
  const c = clienteActual;

  // Stats
  document.getElementById('inicio-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Trabajadores</div><div class="stat-value">${c.trabajadores}</div><div class="stat-sub">${c.giro}</div></div>
    <div class="stat-card"><div class="stat-label">Compliance</div><div class="stat-value" style="color:${scoreColor(c.score)}">${c.score}%</div><div class="stat-sub">Score actual</div></div>
    <div class="stat-card"><div class="stat-label">Alertas activas</div><div class="stat-value" style="color:var(--amber)">${c.alertas.length}</div><div class="stat-sub">requieren atención</div></div>
    <div class="stat-card"><div class="stat-label">Documentos</div><div class="stat-value">${c.docs.length}</div><div class="stat-sub">en su expediente</div></div>`;

  // Score
  document.getElementById('inicio-score').innerHTML = `<span style="color:${scoreColor(c.score)}">${c.score}</span>`;

  // Semáforo compacto
  const compItems = Object.entries(c.compliance).slice(0,4);
  document.getElementById('inicio-sem-grid').innerHTML = compItems.map(([k,v])=>`
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border-radius:6px;">
      <span style="font-size:16px;">${v.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${k}</div>
        <span class="${v.status==='ok'?'badge-green':v.status==='warn'?'badge-amber':'badge-red'} badge" style="margin-top:2px;">${v.label}</span>
      </div>
    </div>`).join('');

  // Alertas
  document.getElementById('inicio-alertas').innerHTML = c.alertas.length
    ? c.alertas.slice(0,3).map(alertHTML).join('')
    : '<div style="font-size:12px;color:var(--ink3);text-align:center;padding:16px;">✅ Sin alertas activas</div>';

  // Obligaciones
  document.getElementById('inicio-obligaciones').innerHTML = c.obligaciones.map(o=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:11px;font-weight:600;color:${o.dias<=7?'var(--red)':o.dias<=30?'var(--amber)':'var(--ink3)'};min-width:70px;">${o.dias}d</div>
      <div style="font-size:12px;flex:1;">${o.label}</div>
      <div style="font-size:11px;color:var(--ink3);">${o.fecha}</div>
    </div>`).join('') || '<div style="font-size:12px;color:var(--ink3);padding:10px 0;">Sin obligaciones próximas</div>';
}

function renderCompliance(){
  const c = clienteActual;
  document.getElementById('comp-score-num').innerHTML = `<span style="color:${scoreColor(c.score)}">${c.score}</span>`;
  document.getElementById('comp-sem-grid').innerHTML = Object.entries(c.compliance).map(([k,v])=>`
    <div class="sem-item">
      <div class="sem-item-icon">${v.icon}</div>
      <div class="sem-item-label">${k}</div>
      <div class="sem-item-status ${v.status==='ok'?'status-ok':v.status==='warn'?'status-warn':'status-bad'}">${v.label}</div>
    </div>`).join('');

  // Historial
  document.getElementById('comp-detalle').innerHTML = `
    <div class="card" style="margin-top:16px;">
      <div class="card-title" style="margin-bottom:14px;">Historial de actividad</div>
      <div>${c.historial.map(h=>`
        <div class="tl-item">
          <div class="tl-dot ${h.cl}">${h.icon}</div>
          <div class="tl-body"><div class="tl-title">${h.titulo}</div><div class="tl-date">${h.fecha}</div></div>
        </div>`).join('')}</div>
    </div>`;

  // Gráficas
  renderGraficasCompliance(c);
}

// ════════════════════════════════════════════════════════
// GRÁFICAS DE COMPLIANCE — Canvas nativo, sin dependencias
// ════════════════════════════════════════════════════════
function renderGraficasCompliance(c){
  const areas = Object.entries(c.compliance);
  const ok   = areas.filter(([,v])=>v.status==='ok').length;
  const warn = areas.filter(([,v])=>v.status==='warn').length;
  const bad  = areas.filter(([,v])=>v.status==='bad').length;
  const total = areas.length;

  const GREEN  = '#16a34a';
  const AMBER  = '#d97706';
  const RED    = '#dc2626';
  const NAVY   = '#0f2640';
  const NAVY2  = '#1a3a5c';
  const SKY    = '#e8f2fc';
  const GRAY   = '#d1d5db';
  const INK3   = '#888880';
  const WHITE  = '#ffffff';

  document.getElementById('comp-graficas').innerHTML = `
    <div class="three-col" style="margin-bottom:16px;">
      <div class="card" style="display:flex;flex-direction:column;align-items:center;padding:20px 12px;">
        <div style="font-size:12px;color:var(--ink3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Score general</div>
        <canvas id="gc-gauge" width="180" height="100"></canvas>
        <div style="margin-top:6px;font-size:12px;color:var(--ink3);text-align:center;">Índice de cumplimiento laboral</div>
      </div>
      <div class="card" style="display:flex;flex-direction:column;align-items:center;padding:20px 12px;">
        <div style="font-size:12px;color:var(--ink3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Distribución por estado</div>
        <canvas id="gc-donut" width="160" height="160"></canvas>
        <div id="gc-donut-legend" style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;justify-content:center;font-size:12px;"></div>
      </div>
      <div class="card" style="display:flex;flex-direction:column;padding:20px 16px;">
        <div style="font-size:12px;color:var(--ink3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px;">Resumen de áreas</div>
        <div style="display:flex;flex-direction:column;gap:8px;flex:1;justify-content:center;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:12px;height:12px;border-radius:50%;background:${GREEN};flex-shrink:0;"></div>
            <div style="flex:1;font-size:13px;">Al día</div>
            <div style="font-size:20px;font-weight:800;color:${GREEN};">${ok}</div>
            <div style="font-size:11px;color:var(--ink3);width:36px;text-align:right;">${total?Math.round(ok/total*100):0}%</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:12px;height:12px;border-radius:50%;background:${AMBER};flex-shrink:0;"></div>
            <div style="flex:1;font-size:13px;">Por atender</div>
            <div style="font-size:20px;font-weight:800;color:${AMBER};">${warn}</div>
            <div style="font-size:11px;color:var(--ink3);width:36px;text-align:right;">${total?Math.round(warn/total*100):0}%</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:12px;height:12px;border-radius:50%;background:${RED};flex-shrink:0;"></div>
            <div style="flex:1;font-size:13px;">Crítico</div>
            <div style="font-size:20px;font-weight:800;color:${RED};">${bad}</div>
            <div style="font-size:11px;color:var(--ink3);width:36px;text-align:right;">${total?Math.round(bad/total*100):0}%</div>
          </div>
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;">
            <div style="flex:1;font-size:13px;font-weight:600;">Total áreas</div>
            <div style="font-size:20px;font-weight:800;color:var(--navy2);">${total}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:12px;color:var(--ink3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;">Estado por área de compliance</div>
      <canvas id="gc-barras" width="900" height="${Math.max(220, areas.length*36)}" style="width:100%;height:auto;display:block;"></canvas>
    </div>

    <div class="two-col">
      <div class="card">
        <div style="font-size:12px;color:var(--ink3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Radar de cumplimiento por área</div>
        <canvas id="gc-radar" width="300" height="300" style="width:100%;max-width:300px;display:block;margin:0 auto;"></canvas>
      </div>
      <div class="card">
        <div style="font-size:12px;color:var(--ink3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Próximas obligaciones</div>
        <canvas id="gc-timeline" width="400" height="180" style="width:100%;height:auto;display:block;"></canvas>
        <div id="gc-obl-lista" style="margin-top:10px;"></div>
      </div>
    </div>`;

  // Esperar al siguiente frame para que el DOM esté pintado
  requestAnimationFrame(()=>{
    dibujarGauge(c.score, GREEN, AMBER, RED, NAVY2, INK3);
    dibujarDonut([ok,warn,bad], [GREEN,AMBER,RED], ['Al día','Por atender','Crítico'], total);
    dibujarBarras(areas, GREEN, AMBER, RED, GRAY, NAVY, INK3, WHITE);
    dibujarRadar(areas, GREEN, AMBER, RED, NAVY2, SKY);
    dibujarTimeline(c.obligaciones||[], AMBER, RED, GREEN, INK3, NAVY);
  });
}

function dibujarGauge(score, GREEN, AMBER, RED, NAVY2, INK3){
  const cv = document.getElementById('gc-gauge'); if(!cv) return;
  const ctx = cv.getContext('2d');
  const W=cv.width, H=cv.height, cx=W/2, cy=H-10, r=H-18;
  ctx.clearRect(0,0,W,H);
  // Arco de fondo
  const segmentos=[{color:RED,from:Math.PI,to:Math.PI+Math.PI*0.33},{color:AMBER,from:Math.PI+Math.PI*0.33,to:Math.PI+Math.PI*0.66},{color:GREEN,from:Math.PI+Math.PI*0.66,to:2*Math.PI}];
  segmentos.forEach(s=>{
    ctx.beginPath(); ctx.arc(cx,cy,r,s.from,s.to); ctx.lineWidth=18; ctx.strokeStyle=s.color; ctx.stroke();
  });
  // Aguja
  const ang = Math.PI + (score/100)*Math.PI;
  const ax = cx + (r-9)*Math.cos(ang), ay = cy + (r-9)*Math.sin(ang);
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(ax,ay);
  ctx.lineWidth=3; ctx.strokeStyle=NAVY2; ctx.lineCap='round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,6,0,2*Math.PI); ctx.fillStyle=NAVY2; ctx.fill();
  // Score text
  ctx.fillStyle=score>=70?GREEN:score>=40?AMBER:RED;
  ctx.font=`bold 26px system-ui`; ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText(score, cx, cy-16);
  ctx.fillStyle=INK3; ctx.font=`11px system-ui`;
  ctx.fillText('/ 100', cx, cy-2);
}

function dibujarDonut([ok,warn,bad],[G,A,R],[lOk,lWarn,lBad],total){
  const cv = document.getElementById('gc-donut'); if(!cv) return;
  const ctx = cv.getContext('2d');
  const W=cv.width, H=cv.height, cx=W/2, cy=H/2, r=64, ri=36;
  ctx.clearRect(0,0,W,H);
  const vals=[{v:ok,c:G},{v:warn,c:A},{v:bad,c:R}].filter(x=>x.v>0);
  if(!total){ ctx.fillStyle='#e5e7eb'; ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI); ctx.fill(); return; }
  let ang=-Math.PI/2;
  vals.forEach(({v,c})=>{
    const sweep=(v/total)*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,ang,ang+sweep);
    ctx.closePath(); ctx.fillStyle=c; ctx.fill();
    ang+=sweep;
  });
  // Hueco interior
  ctx.beginPath(); ctx.arc(cx,cy,ri,0,2*Math.PI); ctx.fillStyle=document.body.style.background||'#f5f4f0';
  ctx.fill();
  // Centro
  ctx.fillStyle='#888'; ctx.font='bold 18px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(total, cx, cy-6);
  ctx.font='10px system-ui'; ctx.fillText('áreas', cx, cy+10);
  // Leyenda
  const leg=document.getElementById('gc-donut-legend'); if(leg){
    leg.innerHTML=[{c:G,l:lOk,v:ok},{c:A,l:lWarn,v:warn},{c:R,l:lBad,v:bad}].filter(x=>x.v>0)
      .map(x=>`<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:${x.c};display:inline-block;"></span>${x.l}: ${x.v}</span>`).join('');
  }
}

function dibujarBarras(areas, GREEN, AMBER, RED, GRAY, NAVY, INK3, WHITE){
  const cv = document.getElementById('gc-barras'); if(!cv) return;
  const ctx = cv.getContext('2d');
  const W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);
  const padL=200, padR=80, padT=14, padB=10;
  const barH=22, gap=14;
  const availW=W-padL-padR;

  areas.forEach(([label,v],i)=>{
    const y = padT + i*(barH+gap);
    const pct = v.status==='ok'?100:v.status==='warn'?50:15;
    const color = v.status==='ok'?GREEN:v.status==='warn'?AMBER:RED;
    const barW = Math.round((pct/100)*availW);

    // Fondo barra
    ctx.fillStyle=GRAY; ctx.beginPath();
    ctx.roundRect(padL, y, availW, barH, 4); ctx.fill();

    // Barra de valor
    ctx.fillStyle=color; ctx.beginPath();
    ctx.roundRect(padL, y, barW, barH, 4); ctx.fill();

    // Label izquierda
    ctx.fillStyle='#18233A'; ctx.font=`${window.devicePixelRatio>1?'12':'13'}px system-ui`;
    ctx.textAlign='right'; ctx.textBaseline='middle';
    const labelCorto = label.length>26 ? label.slice(0,24)+'…' : label;
    ctx.fillText(labelCorto, padL-10, y+barH/2);

    // Estado derecha
    ctx.fillStyle=color; ctx.font='bold 12px system-ui';
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(v.label, padL+availW+10, y+barH/2);

    // Icono en barra
    ctx.fillStyle=WHITE; ctx.font='12px system-ui';
    ctx.textAlign='left'; ctx.textBaseline='middle';
    if(barW>24) ctx.fillText(v.icon, padL+6, y+barH/2);
  });
}

function dibujarRadar(areas, GREEN, AMBER, RED, NAVY2, SKY){
  const cv = document.getElementById('gc-radar'); if(!cv) return;
  const ctx = cv.getContext('2d');
  const W=cv.width, H=cv.height, cx=W/2, cy=H/2, r=100;
  ctx.clearRect(0,0,W,H);
  const n=areas.length; if(n<3) return;
  const ang=i=>(-Math.PI/2)+(2*Math.PI/n)*i;

  // Rejilla de fondo (3 niveles)
  [1,0.66,0.33].forEach((frac,ri)=>{
    ctx.beginPath();
    areas.forEach((_,i)=>{ const a=ang(i); const px=cx+r*frac*Math.cos(a), py=cy+r*frac*Math.sin(a); i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
    ctx.closePath(); ctx.strokeStyle=ri===0?'#c7ccd2':'#dde1e5'; ctx.lineWidth=1; ctx.stroke();
    if(ri===0){ ctx.fillStyle='rgba(232,242,252,.3)'; ctx.fill(); }
  });

  // Ejes
  areas.forEach((_,i)=>{ const a=ang(i); ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a)); ctx.strokeStyle='#dde1e5'; ctx.lineWidth=1; ctx.stroke(); });

  // Polígono de compliance
  const vals=areas.map(([,v])=>v.status==='ok'?1:v.status==='warn'?0.5:0.15);
  ctx.beginPath();
  vals.forEach((val,i)=>{ const a=ang(i), px=cx+r*val*Math.cos(a), py=cy+r*val*Math.sin(a); i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
  ctx.closePath();
  ctx.fillStyle='rgba(26,58,92,.18)'; ctx.fill();
  ctx.strokeStyle=NAVY2; ctx.lineWidth=2; ctx.stroke();

  // Puntos
  vals.forEach((val,i)=>{
    const a=ang(i), px=cx+r*val*Math.cos(a), py=cy+r*val*Math.sin(a);
    const col=areas[i][1].status==='ok'?GREEN:areas[i][1].status==='warn'?AMBER:RED;
    ctx.beginPath(); ctx.arc(px,py,4,0,2*Math.PI); ctx.fillStyle=col; ctx.fill();
  });

  // Labels
  ctx.font='10px system-ui'; ctx.fillStyle='#444440'; ctx.textAlign='center'; ctx.textBaseline='middle';
  areas.forEach(([label],i)=>{
    const a=ang(i), dist=r+18;
    const px=cx+dist*Math.cos(a), py=cy+dist*Math.sin(a);
    const corto=label.length>14?label.slice(0,12)+'…':label;
    ctx.fillText(corto, px, py);
  });
}

function dibujarTimeline(obligaciones, AMBER, RED, GREEN, INK3, NAVY){
  const cv = document.getElementById('gc-timeline'); if(!cv) return;
  const lista = document.getElementById('gc-obl-lista'); if(!lista) return;

  if(!obligaciones || !obligaciones.length){
    cv.style.display='none';
    lista.innerHTML='<div style="text-align:center;padding:24px;color:var(--ink3);font-size:13px;">✅ Sin obligaciones pendientes próximas</div>';
    return;
  }

  const ctx=cv.getContext('2d');
  const W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);

  const padL=16, padR=16, padT=28, padB=28;
  const maxDias=Math.max(...obligaciones.map(o=>o.dias||0), 60);
  const availW=W-padL-padR;

  // Línea base
  const baseY=H-padB;
  ctx.beginPath(); ctx.moveTo(padL,baseY); ctx.lineTo(W-padR,baseY);
  ctx.strokeStyle='#d1d5db'; ctx.lineWidth=2; ctx.stroke();

  // Punto "hoy"
  ctx.fillStyle=NAVY; ctx.font='bold 11px system-ui'; ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText('HOY', padL, baseY-4);
  ctx.beginPath(); ctx.arc(padL,baseY,5,0,2*Math.PI); ctx.fillStyle=NAVY; ctx.fill();

  obligaciones.slice(0,5).forEach((o,i)=>{
    const x = padL + ((o.dias||0)/maxDias)*availW;
    const col = (o.dias||0)<=14?RED:(o.dias||0)<=30?AMBER:GREEN;
    // Línea vertical
    ctx.beginPath(); ctx.moveTo(x,baseY); ctx.lineTo(x,padT);
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
    // Punto
    ctx.beginPath(); ctx.arc(x,baseY,5,0,2*Math.PI); ctx.fillStyle=col; ctx.fill();
    // Etiqueta de días
    ctx.fillStyle=col; ctx.font='bold 11px system-ui'; ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillText((o.dias||0)+'d', x, baseY-8);
    // Label arriba alternado
    ctx.fillStyle='#18233A'; ctx.font='10px system-ui';
    ctx.textBaseline='bottom';
    ctx.fillText((i%2===0?'':' '), x, padT+(i%2)*12);
  });

  // Lista debajo del canvas
  lista.innerHTML = obligaciones.slice(0,5).map(o=>{
    const col=(o.dias||0)<=14?'color:#dc2626':(o.dias||0)<=30?'color:#d97706':'color:#16a34a';
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <div style="font-weight:700;min-width:36px;${col}">${o.dias||0}d</div>
      <div style="flex:1;">${o.label}</div>
      <div style="font-size:11px;color:var(--ink3);">${o.fecha}</div>
    </div>`;
  }).join('');
}

function renderAlertas(){
  const c = clienteActual;
  document.getElementById('alertas-lista').innerHTML = c.alertas.length
    ? `<div class="card"><div class="card-title" style="margin-bottom:14px;">Alertas activas (${c.alertas.length})</div>${c.alertas.map(alertHTML).join('')}</div>`
    : `<div class="card" style="text-align:center;padding:48px;">
        <div style="font-size:40px;margin-bottom:12px;">✅</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px;">Sin alertas activas</div>
        <div style="font-size:13px;color:var(--ink3);">Su empresa está al día en todas las obligaciones</div>
      </div>`;
}

function alertHTML(a){
  const cls = a.tipo==='urgent'?'alert-urgent':a.tipo==='warn'?'alert-warn':'alert-info';
  const icon = a.tipo==='urgent'?'🚨':a.tipo==='warn'?'⚠️':'ℹ️';
  const dias = a.dias>0?`${a.dias} días`:a.tipo==='urgent'?'Vencido':'—';
  let clickable='';
  if(a.url){
    const c=clienteActual||{};
    const params=`?empresa=${encodeURIComponent(c.empresa||'')}&rfc=${encodeURIComponent(c.rfc||'')}`;
    clickable=` style="cursor:pointer;" title="Abrir generador" onclick="window.open('${a.url}${params}')"`;
  }
  return `<div class="alert-item ${cls}"${clickable}>
    <div class="alert-icon">${icon}</div>
    <div class="alert-body">
      <div class="alert-title">${a.titulo}</div>
      <div class="alert-desc">${a.desc}</div>
    </div>
    <div class="alert-days">${a.url?'Resolver →':dias}</div>
  </div>`;
}

// ── Mis documentos — carga en tiempo real desde documentos_expediente ──
let _todosLosDocs = [];
let _filtroDocsActual = 'todos';

async function cargarMisDocumentos() {
  const lista = document.getElementById('docs-lista');
  if (!lista) return;
  lista.innerHTML = '<div style="text-align:center;padding:24px;color:var(--ink3);">⏳ Cargando documentos...</div>';

  try {
    const rfc = clienteActual?.rfc;
    if (!rfc) { lista.innerHTML = '<div style="text-align:center;padding:24px;color:var(--ink3);">Inicie sesión para ver sus documentos.</div>'; return; }

    const { data, error } = await sbAuth
      .from('documentos_expediente')
      .select('id, nombre, tipo, fecha, generado_en, generador, trabajador_id, metadata')
      .eq('cliente_rfc', rfc)
      .order('generado_en', { ascending: false })
      .limit(200);

    if (error) throw error;
    _todosLosDocs = data || [];
    renderMisDocumentos();
  } catch(e) {
    lista.innerHTML = `<div style="text-align:center;padding:24px;color:var(--ink3);">Error al cargar: ${e.message||e}</div>`;
  }
}

function filtrarDocs(tipo, btn) {
  _filtroDocsActual = tipo;
  document.querySelectorAll('#docs-filtros .btn').forEach(b => b.classList.remove('active-filter'));
  if (btn) btn.classList.add('active-filter');
  renderMisDocumentos();
}

function renderMisDocumentos() {
  const lista = document.getElementById('docs-lista');
  if (!lista) return;

  // Aplicar filtro
  let docs = _todosLosDocs;
  if (_filtroDocsActual !== 'todos') {
    docs = docs.filter(d => (d.tipo||'').toLowerCase().includes(_filtroDocsActual) ||
                             (d.nombre||'').toLowerCase().includes(_filtroDocsActual));
  }

  if (!docs.length) {
    lista.innerHTML = `<div style="text-align:center;padding:32px;color:var(--ink3);">
      ${_filtroDocsActual !== 'todos' ? 'Sin documentos de ese tipo.' : 'Sin documentos guardados todavía.'}
      <div style="margin-top:12px;"><button class="btn btn-primary btn-sm" onclick="goPanel(\'generadores\')">Generar primer documento →</button></div>
    </div>`;
    return;
  }

  // Iconos por tipo
  const ICONOS = {
    contrato:'📋', acta:'📝', carta:'✉️', finiquito:'💸', liquidacion:'💸',
    reglamento:'📖', formato:'🗂', comision:'🏛', convenio:'🤝', permiso:'🏖',
    recibo:'💵', nomina:'💵', solicitud:'👤', confidencialidad:'🔒',
    evaluacion:'📊', oferta:'📨', default:'📄',
  };
  const getIcono = tipo => {
    const t = (tipo||'').toLowerCase();
    return Object.entries(ICONOS).find(([k]) => t.includes(k))?.[1] || ICONOS.default;
  };

  // Mapa de generador → URL del generador para reabrir
  const GENERADORES_URL = {
    'acta-administrativa.html':          'acta-administrativa.html',
    'cartas-laborales.html':             'cartas-laborales.html',
    'contrato-indeterminado.html':       'contrato-indeterminado.html',
    'contrato-tiempo-determinado.html':  'contrato-tiempo-determinado.html',
    'contrato-prueba.html':              'contrato-prueba.html',
    'contrato-capacitacion.html':        'contrato-capacitacion.html',
    'contratos-nuevos.html':             'contratos-nuevos.html',
    'contratos-especiales.html':         'contratos-especiales.html',
    'reglamento-interior.html':          'reglamento-interior.html',
    'comisiones-mixtas.html':            'comisiones-mixtas.html',
    'recibos-pagos.html':                'recibos-pagos.html',
    'formatos-rh.html':                  'formatos-rh.html',
    'permisos-ausencias.html':           'permisos-ausencias.html',
    'horario-anexos.html':               'horario-anexos.html',
    'convenios-economicos.html':         'convenios-economicos.html',
    'confidencialidad-civiles.html':     'confidencialidad-civiles.html',
    'asignacion-recursos.html':          'asignacion-recursos.html',
    'proceso-contratacion.html':         'proceso-contratacion.html',
    'cobranza-pagares.html':             'cobranza-pagares.html',
    'aviso-rescision.html':              'aviso-rescision.html',
    'cartas-poder-varios.html':          'cartas-poder-varios.html',
  };

  lista.innerHTML = docs.map(d => {
    const icono    = getIcono(d.tipo);
    const fecha    = d.fecha || d.generado_en?.slice(0,10) || '—';
    const fechaFmt = fecha !== '—' ? new Date(fecha+'T12:00:00').toLocaleDateString('es-MX', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const genUrl   = d.generador ? GENERADORES_URL[d.generador] : null;
    const params   = new URLSearchParams({ empresa: clienteActual.empresa||'', rfc: clienteActual.rfc||'' });
    const abrirUrl = genUrl ? `${genUrl}?${params}` : null;

    return `<div class="doc-row" style="cursor:${abrirUrl?'pointer':'default'};"
        title="${abrirUrl?'Doble clic para abrir en el generador':''}"
        ondblclick="${abrirUrl?`abrirDocumentoEnGenerador('${abrirUrl}')`:''}"
        style="cursor:${abrirUrl?'pointer':'default'};transition:background .15s;">
        <div class="doc-icon">${icono}</div>
        <div class="doc-info" style="flex:1;">
          <div class="doc-name">${d.nombre || d.tipo || 'Documento'}</div>
          <div class="doc-meta">${d.tipo||'Documento'} · ${fechaFmt}${abrirUrl?` · <span style="color:var(--navy2);font-size:10px;">Doble clic para abrir en el generador</span>`:''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${abrirUrl ? `<button class="btn btn-ghost btn-sm" onclick="abrirDocumentoEnGenerador('${abrirUrl}')" title="Abrir en el generador" style="font-size:11px;">✏️ Abrir</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="eliminarDocumento('${d.id}','${(d.nombre||'este documento').replace(/'/g,"\\'")}',this)" title="Eliminar documento" style="font-size:11px;">✕</button>
        </div>
      </div>`;
  }).join('');
}

function abrirDocumentoEnGenerador(url) {
  window.open(url, '_blank');
}

async function eliminarDocumento(id, nombre, btn) {
  if (!confirm(`¿Eliminar el registro de "${nombre}" del expediente?\n\nNota: esto elimina el registro guardado, no el documento impreso.`)) return;
  btn.disabled = true; btn.textContent = '...';
  try {
    const { error } = await sbAuth.from('documentos_expediente').delete().eq('id', id);
    if (error) throw error;
    _todosLosDocs = _todosLosDocs.filter(d => d.id !== id);
    renderMisDocumentos();
  } catch(e) {
    alert('Error al eliminar: ' + (e.message||e));
    btn.disabled = false; btn.textContent = '✕';
  }
}

function renderDocs(){
  // Compatibilidad: si se llama desde initPortal, usar la carga real
  cargarMisDocumentos();
}

function renderGeneradores(){
  const c = clienteActual;
  const params = `?empresa=${encodeURIComponent(c.empresa)}&rfc=${encodeURIComponent(c.rfc)}`;
  const gens = [
    // ── Nómina y recibos ──
    {icon:'💵', name:'Lista de Nómina y Recibos',     art:'Nómina · Aguinaldo · PTU · Vacaciones',  url:'recibos-pagos.html'},
    // ── RH y selección ──
    {icon:'🧑‍💼', name:'Formatos de RH',               art:'Solicitud empleo · Carta oferta · Privacidad · Evaluación · Encuesta salida', url:'formatos-rh.html'},
    // ── Contratación ──
    {icon:'🗂', name:'Entrevista + Expediente',       art:'Art. 804 LFT',                          url:'proceso-contratacion.html'},
    {icon:'📋', name:'Contrato Indeterminado',         art:'Art. 35 LFT',                           url:'contrato-indeterminado.html'},
    {icon:'⏱',  name:'Contrato Determinado',           art:'Arts. 35-36 LFT',                       url:'contrato-tiempo-determinado.html'},
    {icon:'🔬', name:'Período a Prueba',               art:'Art. 39-A LFT',                         url:'contrato-prueba.html'},
    {icon:'🎓', name:'Capacitación Inicial',           art:'Art. 39-B LFT',                         url:'contrato-capacitacion.html'},
    {icon:'💼', name:'Comisionista / Viajante',        art:'Arts. 285-289 LFT',                     url:'contratos-especiales.html'},
    {icon:'📊', name:'Asimilados a Salarios',          art:'Art. 94 LISR',                          url:'contratos-especiales.html'},
    {icon:'📜', name:'Contratos Especiales',           art:'Colectivo · Obra · Teletrabajo · Domicilio', url:'contratos-nuevos.html'},
    // ── Terminación ──
    {icon:'📤', name:'Cartas Laborales',               art:'Renuncia · Recomendación · Constancia', url:'cartas-laborales.html'},
    {icon:'💸', name:'Finiquito / Liquidación',        art:'Arts. 47, 48, 53, 162 LFT',             url:'cartas-laborales.html', tipo:'liquidacion'},
    {icon:'🤝', name:'Convenio de Terminación',        art:'Art. 33 LFT · Ratificación JFCA',       url:'cartas-laborales.html', tipo:'finiquito'},
    {icon:'🚪', name:'Aviso de Rescisión',             art:'Art. 47 LFT · Despido justificado + escrito al Tribunal', url:'aviso-rescision.html'},
    // ── Disciplina y control ──
    {icon:'⚠️', name:'Acta Administrativa',            art:'Arts. 47 y 110 LFT',                    url:'acta-administrativa.html'},
    {icon:'📖', name:'Reglamento Interior de Trabajo', art:'Arts. 422-425 LFT',                     url:'reglamento-interior.html'},
    {icon:'🏛',  name:'Comisiones Mixtas',              art:'Integración · Sesión · Recorrido · Asistencia', url:'comisiones-mixtas.html'},
    {icon:'🧠', name:'Evaluación NOM-035',             art:'Riesgo psicosocial · Guías II y III · calificación automática', url:'nom035-evaluacion.html'},
    // ── Operativos ──
    {icon:'🗓', name:'Permisos y Ausencias',           art:'Permiso · Falta · Incapacidad',         url:'permisos-ausencias.html'},
    {icon:'🧰', name:'Resguardo de Activos',           art:'Herramientas · Uniformes · Vehículo',   url:'asignacion-recursos.html'},
    {icon:'⏰', name:'Horario y Anexos',               art:'Cambio de horario · Modificatorio',     url:'horario-anexos.html'},
    {icon:'💰', name:'Préstamos y Bonos',              art:'Préstamo sobre nómina · Bono',           url:'convenios-economicos.html'},
    {icon:'🔒', name:'Confidencialidad / Servicios',  art:'NDA · Prestación de servicios',          url:'confidencialidad-civiles.html'},
    // ── REPSE ──
    {icon:'🏭', name:'Contrato REPSE',                 art:'Art. 13 LFT · Servicios especializados · Reforma 2021',      url:'contrato-repse.html'},
    {icon:'📋', name:'Gestor de Proveedores REPSE',    art:'Documentación mensual · Vigencias · Alertas',                url:'gestor-repse.html'},
    {icon:'🔍', name:'¿Necesito REPSE?',               art:'Diagnóstico 5 preguntas · Obligación de registro',           url:'diagnostico-repse.html'},
    // ── Cobranza ──
    {icon:'🧾', name:'Cobranza y Pagarés',             art:'Pagaré LGTOC · Requerimiento · Convenio de adeudo · Recibo', url:'cobranza-pagares.html'},
    {icon:'💰', name:'Contrato de Mutuo / Poderes',    art:'Mutuo con interés · Carta poder · Beneficiarios 501 · Carta patronal', url:'cartas-poder-varios.html'},
    // ── Herramienta ──
    {icon:'🧮', name:'Calculadora Laboral',            art:'Finiquito · Liquidación · Vacaciones · Antigüedad', url:null, accion:'calculadora'},
  ];
  document.getElementById('gen-grid').innerHTML = gens.map(g=>{
    const onclick = g.accion
      ? `onclick="goPanel('${g.accion}')"`
      : `onclick="window.open('${g.url + params + (g.tipo ? '&tipo=' + g.tipo : '')}')"`;
    return `<div class="gen-tile" ${onclick}>
      <div class="gen-tile-icon">${g.icon}</div>
      <div class="gen-tile-name">${g.name}</div>
      <div class="gen-tile-art">${g.art}</div>
    </div>`;
  }).join('');
}

const CATALOGO_PLANES = [
  { nombre:'Micro',    orden:1, cuota:899,   rango:'1 a 15 trabajadores' },
  { nombre:'PyME',     orden:2, cuota:1999,  rango:'16 a 50 trabajadores' },
  { nombre:'Mediana',  orden:3, cuota:4499,  rango:'51 a 150 trabajadores' },
  { nombre:'Empresa',  orden:4, cuota:9999,  rango:'151 a 500 trabajadores' },
  { nombre:'Básico',   orden:0, cuota:499,   rango:'plan anterior', legacy:true },
  { nombre:'Estándar', orden:0, cuota:799,   rango:'plan anterior', legacy:true },
  { nombre:'Pro',      orden:0, cuota:2399,  rango:'plan anterior', legacy:true },
];
// Compara nombres de plan ignorando acentos y mayúsculas ("Estandar" === "Estándar")
function _normPlan(t){ return String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

function renderSuscripcion(){
  const c = clienteActual;
  const featuresComunes = ['Contratos sin límite (8+ modalidades) y por sector','Actas, finiquitos y formatos de RH sin límite','NOM-035, Reglamento Interior y comisiones mixtas','Expedientes digitales y control de asistencias','Pruebas psicométricas para selección de personal','Reportes gerenciales exportables a PDF','Asistente Legal IA + biblioteca de 46+ consultas','Checklist de contratación y políticas internas','Alertas multicanal + WhatsApp directo','Auditoría anual y asesoría reactiva'];
  document.getElementById('plan-card').innerHTML = `
    <div class="plan-name">Plan ${c.plan}</div>
    <div class="plan-precio">$${c.cuota.toLocaleString('es-MX')}<span>/mes, IVA incluido</span></div>
    <div class="plan-status" id="plan-status-linea">● Activo · Próximo pago: ${c.proximoPago}</div>
    <div class="plan-features">
      ${featuresComunes.map(f=>`<div class="plan-feature">${f}</div>`).join('')}
    </div>`;

  // Upgrade — solo se muestran planes de orden superior al actual
  const planActualInfo = CATALOGO_PLANES.find(p => _normPlan(p.nombre) === _normPlan(c.plan));
  const ordenActual = planActualInfo ? planActualInfo.orden : 1;
  const superiores = CATALOGO_PLANES.filter(p => p.orden > ordenActual && !p.legacy);

  const upgradeCont = document.getElementById('upgrade-opciones');
  if (!superiores.length) {
    // Ya está en el plan más alto: ofrecer plan a medida para +500 trabajadores
    document.getElementById('upgrade-card').style.display = 'block';
    upgradeCont.innerHTML = `
      <div style="padding:14px;border:1px solid var(--border);border-radius:var(--r-sm);font-size:12px;color:var(--ink2);line-height:1.6;">
        Usted ya cuenta con el plan más alto. ¿Su empresa superó los <strong>500 trabajadores</strong>?
        Contáctenos por WhatsApp o desde <strong>Solicitar asesoría</strong> para diseñar un plan a su medida.
      </div>`;
  } else {
    document.getElementById('upgrade-card').style.display = 'block';
    upgradeCont.innerHTML = superiores.map(p=>`
      <div style="padding:14px;border:1px solid var(--border);border-radius:var(--r-sm);display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-size:13px;font-weight:600;">Plan ${p.nombre}</div>
          <div style="font-size:18px;font-weight:800;color:var(--navy2);margin:2px 0;">$${p.cuota.toLocaleString('es-MX')}<span style="font-size:12px;font-weight:400;color:var(--ink3);">/mes</span></div>
          <div style="font-size:11px;color:var(--ink3);">${p.rango}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="solicitarUpgrade('${p.nombre}')">Subir a ${p.nombre} →</button>
      </div>`).join('');
  }

  // Historial de pagos: cargar desde Stripe en segundo plano
  const histEl = document.getElementById('historial-pagos');
  histEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--ink3);font-size:12px;">Cargando historial de pagos…</div>';
  cargarHistorialPagos(c);

  // El botón de facturas solo tiene sentido si el cliente pagó por Stripe
  document.getElementById('btn-ver-facturas').style.display = c.stripeCustomerId ? 'block' : 'none';
}

async function cargarHistorialPagos(c){
  const histEl = document.getElementById('historial-pagos');
  try {
    const { data: _ses } = await sbAuth.auth.getSession();
    const _tok = _ses?.session?.access_token;
    if (!_tok) throw new Error('Sesión no válida. Inicie sesión nuevamente.');
    const resp = await fetch('/.netlify/functions/historial-pagos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _tok },
      body: JSON.stringify({ rfc: c.rfc }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al consultar pagos');

    // Actualizar la línea de estado del plan con datos reales de Stripe
    const s = data.suscripcion;
    const statusLinea = document.getElementById('plan-status-linea');
    if (s && statusLinea) {
      const punto = s.status === 'active' || s.status === 'trialing' ? '●' : '⚠';
      statusLinea.textContent = `${punto} ${s.statusLabel}` +
        (s.proximoPago ? ` · Próximo pago: ${s.proximoPago}` : '') +
        (s.cancelaAlFinal ? ' · Se cancelará al final del periodo' : '');
    } else if (data.manual && statusLinea) {
      statusLinea.textContent = '● Activo · Suscripción administrada por su asesor';
    }

    const pagos = data.pagos || [];
    if (data.manual) {
      histEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--ink3);font-size:12px;">Su suscripción fue dada de alta directamente con su asesor, por lo que no hay cargos de Stripe que mostrar aquí.<br>Para dudas sobre sus pagos, contáctenos por WhatsApp.</div>';
      const sl = document.getElementById('plan-status-linea');
      if (sl) sl.textContent = '● Activo · Suscripción administrada por su asesor';
      return;
    }
    // Si la función auto-vinculó la cuenta con Stripe, habilitar el botón de facturas
    document.getElementById('btn-ver-facturas').style.display = 'block';
    if (!pagos.length) {
      histEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--ink3);font-size:12px;">Sin pagos registrados todavía.</div>';
      return;
    }
    histEl.innerHTML = pagos.map(p=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <div>
          <div style="font-weight:500;">${p.mes}</div>
          <div style="font-size:11px;color:var(--ink3);">${p.metodo}${p.fecha?` · ${p.fecha}`:''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:600;">$${(p.monto||0).toLocaleString('es-MX',{minimumFractionDigits:2})}</div>
          <span class="badge ${p.status==='Pagado'?'badge-green':'badge-amber'}">${p.status}</span>
          ${p.recibo?`<div><a href="${p.recibo}" target="_blank" style="font-size:11px;color:var(--navy2);">Ver recibo →</a></div>`:''}
        </div>
      </div>`).join('');
  } catch(e) {
    histEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--ink3);font-size:12px;">No se pudo cargar el historial de pagos.<br><span style="font-size:11px;">${e.message||e}</span></div>`;
  }
}

function solicitarUpgrade(planDestino){
  if (!confirm(`¿Solicitar el cambio a Plan ${planDestino}? Su asesor confirmará el cambio y ajustará su cobro a partir del siguiente período.`)) return;
  goPanel('solicitudes');
  setTimeout(()=>{
    const desc = document.getElementById('sol-descripcion');
    const tipo = document.getElementById('sol-tipo');
    if (desc) desc.value = `Solicito cambiar mi suscripción del Plan ${clienteActual.plan} al Plan ${planDestino}.`;
    if (tipo) tipo.value = 'Otro';
  }, 50);
}

async function abrirPortalFacturacion(){
  const btn = document.getElementById('btn-ver-facturas');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generando enlace seguro...';
  try {
    const { data: _ses } = await sbAuth.auth.getSession();
    const _tok = _ses?.session?.access_token;
    if (!_tok) throw new Error('Sesión no válida. Inicie sesión nuevamente.');
    const resp = await fetch('/.netlify/functions/portal-facturacion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _tok },
      body: JSON.stringify({ rfc: clienteActual.rfc }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se pudo generar el enlace.');
    window.open(data.url, '_blank');
  } catch(e) {
    alert('No se pudo abrir el portal de facturación: ' + (e.message || e));
  }
  btn.disabled = false;
  btn.textContent = textoOriginal;
}

function renderNotifPrefs(){
  const prefs = [
    {label:'Alertas de vencimiento', desc:'7 días antes de cada obligación', id:'np-venc', default:true},
    {label:'Resumen semanal', desc:'Resumen de estado del compliance cada lunes', id:'np-resumen', default:true},
    {label:'Cambios en la LFT', desc:'Notificaciones ante reformas legislativas', id:'np-ley', default:true},
    {label:'Respuesta del asesor', desc:'Cuando su asesor responde una solicitud', id:'np-asesor', default:true},
    {label:'Nuevos documentos disponibles', desc:'Cuando se agreguen documentos a su expediente', id:'np-docs', default:false},
  ];
  document.getElementById('notif-prefs').innerHTML = prefs.map(p=>`
    <div class="notif-row">
      <div class="notif-info">
        <div class="notif-label">${p.label}</div>
        <div class="notif-desc">${p.desc}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${p.default?'checked':''}>
        <div class="toggle-track"></div>
        <div class="toggle-thumb"></div>
      </label>
    </div>`).join('');
}

// ════════════════════════════════════════════
// NAVEGACIÓN
// ════════════════════════════════════════════
const panelTitles = {
  inicio:'Inicio', compliance:'Mi compliance', alertas:'Alertas',
  comisiones:'Comisiones mixtas — Guía de implementación',
  generadores:'Generar documento', reportes:'Reportes gerenciales',
  solicitudes:'Solicitar asesoría', calculadora:'Calculadora laboral',
  asistente:'Asistente Legal IA',
  nom035:'NOM-035 — Dashboard de cumplimiento',
  historial:'Historial de movimientos de plantilla',
  firmas:'Mis firmas electrónicas',
  suscripcion:'Mi suscripción', configuracion:'Configuración'
};

function goPanel(id){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const el = document.getElementById('panel-'+id);
  if(el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[onclick="goPanel('${id}')"]`);
  if(nav) nav.classList.add('active');
  document.getElementById('topbar-title').textContent = panelTitles[id]||id;
  if(id==='solicitudes') cargarSolicitudesRecientes();
  if(id==='comisiones') renderComisiones();
  if(id==='calculadora') calcCargarRoster();
  if(id==='reportes') renderReportes();
  if(id==='asistente' && !window._asistInited) asistInit();
  if(id==='nom035') renderNom035();
  if(id==='historial') renderHistorial();
  if(id==='firmas') { cargarMisFirmas(); cargarCreditosFirma(); }
  cerrarSidebarMobile();
}

// ════════════════════════════════════════════
// MENÚ MÓVIL — sidebar deslizable para pantallas ≤900px
// ════════════════════════════════════════════
function toggleSidebarMobile(){
  document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('sb-overlay').classList.toggle('show');
}
function cerrarSidebarMobile(){
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('show');
}

// ════════════════════════════════════════════
// CONSULTA RÁPIDA — busca en la base de preguntas frecuentes
// (sin IA en vivo; ver faq-data.js)
// ════════════════════════════════════════════
const FAQ_STOPWORDS = new Set(['cuando','como','que','cual','cuales','donde','quien','quienes','para','por','con','sin','sobre','este','esta','estos','estas','ese','esa','esos','esas','debo','debe','deben','puedo','puede','pueden','hay','estan','esto','son','las','los','una','unos','unas','del','les','muy','mas','todo','toda','todos','todas','tengo','tiene','tienen','dias','dia','anos','ano','sera','seria','tipo','tipos','sido','siendo','desde','hasta','entre','cada','otro','otra','algun','alguna','algunos','tener','hacer','haber','tambien','solo','si','no','mi','su','sus']);
const FAQ_CODIGOS_CORTOS = new Set(['nom','lft','imss','ptu','sdi','dc3','dc-3','repse','cfcrl','reps','infonavit','art']);

function normalizarTxt(txt){
  return txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function tokenizarFAQ(txt){
  return normalizarTxt(txt).split(/[^a-z0-9]+/).filter(w=>{
    if(!w) return false;
    if(FAQ_STOPWORDS.has(w)) return false;
    if(w.length>3) return true;
    if(/^\d+$/.test(w)) return true;
    if(FAQ_CODIGOS_CORTOS.has(w)) return true;
    return false;
  });
}
let _faqDF=null, _faqN=0;
function construirIndiceFAQ(){
  if(_faqDF || typeof FAQ_DATA==='undefined') return;
  _faqDF={}; _faqN=FAQ_DATA.length;
  FAQ_DATA.forEach(item=>{
    new Set(tokenizarFAQ(item.q+' '+item.a)).forEach(w=>{ _faqDF[w]=(_faqDF[w]||0)+1; });
  });
}
function idfFAQ(w){ return Math.log((_faqN+1)/((_faqDF[w]||0)+1))+1; }

function buscarMejorRespuestaFAQ(pregunta){
  construirIndiceFAQ();
  if(!_faqDF) return null;
  const palabras = tokenizarFAQ(pregunta);
  if(!palabras.length) return null;
  let mejor=null, mejorScore=0;
  FAQ_DATA.forEach(item=>{
    const tokensPregunta = tokenizarFAQ(item.q);
    const tokensRespuesta = tokenizarFAQ(item.a);
    let score=0;
    palabras.forEach(p=>{
      const peso = idfFAQ(p);
      if(tokensPregunta.includes(p)) score += peso*2;
      else if(tokensRespuesta.includes(p)) score += peso*0.5;
    });
    if(score>mejorScore){ mejorScore=score; mejor=item; }
  });
  return mejorScore>=6 ? mejor : null;
}

function preguntarIA(){
  const pregunta = document.getElementById('ia-quick-input').value.trim();
  if(!pregunta) return;
  const resp = document.getElementById('ia-quick-response');
  resp.style.display = 'block';
  resp.innerHTML = '<div class="ia-loading">⟳ Buscando en la base de conocimiento legal...</div>';

  setTimeout(()=>{
    const match = buscarMejorRespuestaFAQ(pregunta);
    if(match){
      resp.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,.5);margin-bottom:8px;">📚 De nuestra base de preguntas frecuentes:</div>
        <div style="font-weight:600;margin-bottom:6px;">${match.q}</div>
        <div style="font-size:13px;line-height:1.6;">${match.a}</div>
        <a href="consultas-legales.html" target="_blank" style="display:inline-block;margin-top:10px;font-size:12px;color:#7dd3fc;">Ver más en Consultas legales →</a>`;
      return;
    }

    // Respaldo: glosario de artículos LFT por palabra clave
    const articulos = (typeof buscarEnGlosarioLFT === 'function') ? buscarEnGlosarioLFT(pregunta, 5) : [];
    if(articulos.length){
      resp.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,.5);margin-bottom:8px;">📖 No tenemos una respuesta exacta en nuestras preguntas frecuentes, pero estos artículos de la LFT están relacionados con su consulta:</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${articulos.map(a=>`
            <div style="background:rgba(255,255,255,.06);border-radius:8px;padding:10px 12px;">
              <div style="font-weight:700;font-size:12.5px;color:#7dd3fc;">Art. ${a.art} LFT — ${a.tema}</div>
              <div style="font-size:12.5px;line-height:1.55;margin-top:4px;">${a.resumen}</div>
            </div>`).join('')}
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:10px;">Esta es una referencia general, no sustituye asesoría legal específica para su caso.</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <a href="consultas-legales.html" target="_blank" class="ia-btn" style="text-decoration:none;display:inline-block;">Buscar en Consultas legales</a>
          <button class="ia-btn" onclick="goPanel('solicitudes')" style="background:transparent;border:1px solid rgba(255,255,255,.3);">Preguntarle a su asesor</button>
        </div>`;
      return;
    }

    resp.innerHTML = `<div style="font-size:13px;">No encontramos esto en nuestra base de preguntas frecuentes ni en el glosario de la LFT.</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <a href="consultas-legales.html" target="_blank" class="ia-btn" style="text-decoration:none;display:inline-block;">Buscar en Consultas legales</a>
        <button class="ia-btn" onclick="goPanel('solicitudes')" style="background:transparent;border:1px solid rgba(255,255,255,.3);">Preguntarle a su asesor</button>
      </div>`;
  }, 400);
}

// ════════════════════════════════════════════
// ASISTENTE LEGAL IA — keyword routing + TF-IDF sobre FAQ_DATA
// ════════════════════════════════════════════
window._asistInited = false;

const ASIS_WA = '5213339263817';
function asistLinkWA(msg){ return `https://wa.me/${ASIS_WA}?text=${encodeURIComponent(msg)}`; }

const ASIS_CAT_LABELS = {
  contratos:'Contratos', rescision:'Rescisión y despido',
  liquidacion:'Liquidación y finiquito', jornada:'Jornada y descansos',
  salario:'Salario y prestaciones', imss:'IMSS y seguridad social',
  noms:'NOMs y seguridad', reglamento:'Reglamento interior',
  actas:'Actas administrativas', especiales:'Modalidades especiales',
  stps:'STPS e inspecciones'
};

const ASIS_KMAP = [
  // Rescisión / despido
  {k:['despid','corrido','corrio','corrieron','echaron','corrieron','despedido','cesado','rescision47','art47'], cat:'rescision', hint:'despido o rescisión'},
  {k:['renuncia','renunci','resignacion'], cat:'rescision', hint:'renuncia voluntaria', prio:0},
  {k:['rescision51','art51','rescision trabajador'], cat:'rescision', hint:'rescisión por parte del trabajador', prio:1},
  {k:['convenio terminacion','convenio baja','mutuo acuerdo'], cat:'rescision', hint:'convenio de terminación', prio:2},
  {k:['carta','aviso','notificacion despido'], cat:'rescision', hint:'aviso o carta de despido', prio:3},
  // Liquidación / finiquito
  {k:['finiquito','partes proporcional'], cat:'liquidacion', hint:'finiquito', prio:0},
  {k:['liquidacion','indemnizacion','90 dias','tres meses','3 meses','20 dias','indemniz'], cat:'liquidacion', hint:'liquidación e indemnización', prio:1},
  {k:['prima antiguedad','antiguedad'], cat:'liquidacion', hint:'prima de antigüedad', prio:2},
  {k:['aguinaldo'], cat:'liquidacion', hint:'aguinaldo', prio:3},
  {k:['vacaciones','prima vacacional','dias vacacion'], cat:'liquidacion', hint:'vacaciones y prima vacacional', prio:4},
  {k:['utilidades','ptu','reparto'], cat:'salario', hint:'PTU / utilidades'},
  // Contratos
  {k:['contrato','contratar','tipo contrato','modalidad contrato'], cat:'contratos', hint:'contratos de trabajo'},
  {k:['periodo prueba','prueba','capacitacion'], cat:'contratos', hint:'periodo de prueba', prio:1},
  {k:['trabajador confianza','empleado confianza'], cat:'especiales', hint:'trabajadores de confianza'},
  {k:['teletrabajo','home office','trabajo distancia'], cat:'noms', hint:'teletrabajo'},
  // Jornada / horario
  {k:['jornada','horario','horas trabajo','tiempo trabajo'], cat:'jornada', hint:'jornada laboral', prio:0},
  {k:['horas extra','tiempo extra','extraordinar','sobretiempo'], cat:'jornada', hint:'horas extras', prio:1},
  {k:['descanso','dia descanso','dia libre','domingo'], cat:'jornada', hint:'días de descanso', prio:2},
  {k:['dias festivos','festivo','feriado'], cat:'jornada', hint:'días festivos', prio:3},
  {k:['turno nocturno','nocturno','mixto'], cat:'jornada', hint:'turno nocturno o mixto', prio:4},
  // Salario
  {k:['salario','sueldo','pago','remunera'], cat:'salario', hint:'salario y pagos', prio:0},
  {k:['salario minimo','smi','smg'], cat:'salario', hint:'salario mínimo', prio:1},
  {k:['descuento','deduccion','retencion'], cat:'salario', hint:'descuentos al salario', prio:2},
  // IMSS / seguridad social
  {k:['imss','seguro social','cotizar','cotizacion','afiliacion'], cat:'imss', hint:'IMSS y seguridad social', prio:0},
  {k:['infonavit','credito vivienda'], cat:'imss', hint:'INFONAVIT', prio:1},
  {k:['incapacidad','enfermedad','accidente trabajo'], cat:'imss', hint:'incapacidades', prio:2},
  // NOMs
  {k:['nom035','nom 035','psicosocial','riesgo psicosocial'], cat:'noms', hint:'NOM-035', prio:0},
  {k:['nom036','nom 036','factor ergonomico'], cat:'noms', hint:'NOM-036', prio:1},
  {k:['seguridad higiene','equipo proteccion','epi','epp'], cat:'noms', hint:'seguridad e higiene', prio:2},
  // Reglamento
  {k:['reglamento interior','reglamento empresa'], cat:'reglamento', hint:'Reglamento Interior de Trabajo'},
  // Actas
  {k:['acta administrativa','acta disciplinaria','apercibimiento','sancion'], cat:'actas', hint:'actas administrativas'},
  // STPS / inspecciones
  {k:['stps','inspector','inspeccion','visita inspector','autoridad trabajo'], cat:'stps', hint:'inspecciones STPS'},
];

const ASIS_SALUDOS = [
  '¡Hola! Soy Lex, su asistente legal laboral. Cuénteme su duda y la busco en nuestra base de conocimiento verificada.',
  '¡Buenos días! Soy Lex. Estoy aquí para ayudarle con sus consultas sobre la Ley Federal del Trabajo. ¿Cuál es su pregunta hoy?',
  '¡Hola! Puedo orientarle sobre contratos, despidos, finiquitos, jornadas y más. ¿Qué le preocupa?',
];
const ASIS_ENCONTRE = [
  'Encontré algo que puede ayudarle:',
  'En nuestra base de conocimiento tenemos esto:',
  'Esto es lo que dice la Ley al respecto:',
  'Aquí hay información verificada sobre su consulta:',
];
const ASIS_MULTIPLES = [
  'Encontré varias entradas relacionadas con {hint}:',
  'Sobre {hint} tenemos más de una pregunta frecuente:',
  'Hay varias respuestas que pueden ayudarle con {hint}:',
];
const ASIS_NOTFOUND = [
  'No encontré una respuesta exacta en la base de conocimiento para eso.',
  'Hmm, esa consulta específica no está en nuestras preguntas frecuentes.',
  'No tengo una respuesta verificada para eso en este momento.',
];
const ASIS_SEGUIMIENTO = [
  '¿Le quedó alguna duda adicional?',
  '¿Esto resuelve su pregunta, o necesita más detalle?',
  '¿Hay algo más en lo que pueda orientarle?',
];

function asistRand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function asistNorm(txt){
  return txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ');
}

function asistDetectar(txt){
  const n = asistNorm(txt);
  let mejor = null, mejorPrio = 999;
  for(const entry of ASIS_KMAP){
    for(const kw of entry.k){
      if(n.includes(kw)){
        const p = entry.prio !== undefined ? entry.prio : 99;
        if(!mejor || p < mejorPrio){ mejor = entry; mejorPrio = p; }
        break;
      }
    }
  }
  return mejor;
}

function asistBuscarEnCat(cat, query, maxN){
  construirIndiceFAQ();
  const items = typeof FAQ_DATA !== 'undefined' ? FAQ_DATA.filter(f=>f.cat===cat) : [];
  if(!items.length) return [];
  const palabras = tokenizarFAQ(query);
  const scored = items.map(item=>{
    const tq = tokenizarFAQ(item.q), ta = tokenizarFAQ(item.a);
    let s=0;
    palabras.forEach(p=>{ const idf=idfFAQ(p); if(tq.includes(p)) s+=idf*2.5; else if(ta.includes(p)) s+=idf*0.6; });
    return {item, s};
  }).sort((a,b)=>b.s-a.s);
  const top = scored.filter(x=>x.s>0).slice(0,maxN||2);
  if(!top.length) return items.slice(0,1).map(x=>({item:x,s:0}));
  return top;
}

function asistFmtA(a){
  // Strip HTML tags from faq answers since they contain <strong>, <br> etc.
  return a.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').trim();
}

function asistRenderFaqCard(f){
  return `<div class="asis-faq-card">
    <div class="asis-faq-cat">${ASIS_CAT_LABELS[f.cat]||f.cat}</div>
    <div class="asis-faq-q">${f.q}</div>
    <div class="asis-faq-a"><p>${asistFmtA(f.a).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,' ')}</p></div>
  </div>`;
}

function asistMsgBot(html, cards, actions){
  const msgsEl = document.getElementById('asis-msgs');
  const div = document.createElement('div');
  div.className = 'asis-msg bot';
  let inner = `<div class="asis-sender">Lex</div><div class="asis-bubble">${html}</div>`;
  if(cards && cards.length){
    inner += cards.map(asistRenderFaqCard).join('');
  }
  if(actions && actions.length){
    inner += `<div class="asis-actions">${actions.map(a=>`<button class="asis-action-btn ${a.cls||''}" onclick="${a.fn}">${a.label}</button>`).join('')}</div>`;
  }
  div.innerHTML = inner;
  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function asistMsgUser(txt){
  const msgsEl = document.getElementById('asis-msgs');
  const div = document.createElement('div');
  div.className = 'asis-msg usr';
  div.innerHTML = `<div class="asis-sender">Usted</div><div class="asis-bubble">${txt.replace(/</g,'&lt;')}</div>`;
  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

let _asistTypingEl = null;
function asistTyping(){
  const msgsEl = document.getElementById('asis-msgs');
  _asistTypingEl = document.createElement('div');
  _asistTypingEl.className = 'asis-msg bot';
  _asistTypingEl.innerHTML = '<div class="asis-sender">Lex</div><div class="asis-typing"><span></span><span></span><span></span></div>';
  msgsEl.appendChild(_asistTypingEl);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}
function asistRemoveTyping(){
  if(_asistTypingEl){ _asistTypingEl.remove(); _asistTypingEl=null; }
}

function asistResponder(query){
  asistTyping();
  const delay = 600 + Math.random()*600;
  setTimeout(()=>{
    asistRemoveTyping();

    // 1. Try keyword detection → category → TF-IDF within category
    const detected = asistDetectar(query);
    if(detected){
      const resultados = asistBuscarEnCat(detected.cat, query, 3);
      const tieneScore = resultados.some(r=>r.s>0);

      if(resultados.length===1 || !tieneScore){
        const res = asistFmtA(resultados[0].item.a);
        const intro = asistRand(ASIS_ENCONTRE);
        asistMsgBot(`<p>${intro}</p>`, [resultados[0].item], [
          {label:'📚 Ver biblioteca completa', fn:`window.open('consultas-legales.html','_blank')`, cls:''},
          {label:'💬 Hablar con abogado', fn:`window.open('${asistLinkWA('Hola, tengo una duda sobre: '+detected.hint)}','_blank')`, cls:'wa'},
        ]);
      } else {
        const intro = asistRand(ASIS_MULTIPLES).replace('{hint}', detected.hint);
        asistMsgBot(`<p>${intro}</p>`, resultados.map(r=>r.item), [
          {label:'📚 Ver biblioteca completa', fn:`window.open('consultas-legales.html','_blank')`, cls:''},
          {label:'💬 Hablar con abogado', fn:`window.open('${asistLinkWA('Hola, tengo una duda sobre: '+detected.hint)}','_blank')`, cls:'wa'},
        ]);
      }

      // Follow-up after slight delay
      setTimeout(()=>{
        asistMsgBot(`<p>${asistRand(ASIS_SEGUIMIENTO)}</p>`);
      }, 1800);
      return;
    }

    // 2. Fallback: global TF-IDF across all FAQ
    const global = buscarMejorRespuestaFAQ(query);
    if(global){
      asistMsgBot(`<p>${asistRand(ASIS_ENCONTRE)}</p>`, [global], [
        {label:'📚 Ver biblioteca completa', fn:`window.open('consultas-legales.html','_blank')`, cls:''},
        {label:'💬 Hablar con abogado', fn:`window.open('${asistLinkWA('Hola, busqué sobre "'+query+'" y necesito ayuda')}','_blank')`, cls:'wa'},
      ]);
      setTimeout(()=>{ asistMsgBot(`<p>${asistRand(ASIS_SEGUIMIENTO)}</p>`); }, 1800);
      return;
    }

    // 3. No match
    asistMsgBot(
      `<p>${asistRand(ASIS_NOTFOUND)}</p><p>Para esta consulta le recomiendo hablar directamente con un abogado del equipo — le atenderán por WhatsApp en horario hábil.</p>`,
      null,
      [
        {label:'📚 Buscar en biblioteca', fn:`window.open('consultas-legales.html','_blank')`, cls:''},
        {label:'💬 Contactar abogado', fn:`window.open('${asistLinkWA('Hola, tengo una consulta laboral que no está en la base de preguntas frecuentes: '+query)}','_blank')`, cls:'wa'},
      ]
    );
  }, delay);
}

function asistInit(){
  window._asistInited = true;
  document.getElementById('asis-msgs').innerHTML = '';
  setTimeout(()=>{
    asistMsgBot(`<p>${asistRand(ASIS_SALUDOS)}</p><p>Puede escribir su pregunta o elegir un tema de los accesos rápidos de abajo.</p>`);
  }, 300);
}

function asistEnviar(){
  const inp = document.getElementById('asis-input');
  const txt = inp.value.trim();
  if(!txt) return;
  inp.value = '';
  asistAutoResize(inp);
  // Hide chips after first interaction
  document.getElementById('asis-chips').style.display = 'none';
  asistMsgUser(txt);
  asistResponder(txt);
}

function asistChip(texto){
  document.getElementById('asis-chips').style.display = 'none';
  asistMsgUser(texto);
  asistResponder(texto);
}

function asistKeydown(e){
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); asistEnviar(); }
}

function asistAutoResize(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

// ════════════════════════════════════════════
// EXPEDIENTE — documentos requeridos por trabajador
// ════════════════════════════════════════════
const DOCS_REQUERIDOS = [
  { id:'contrato',  label:'Contrato de trabajo',      kw:/contrat/i },
  { id:'imss',      label:'Alta IMSS',                kw:/imss|inscripci/i },
  { id:'ine',       label:'Identificación oficial',   kw:/\bine\b|identif|pasaporte/i },
  { id:'curp',      label:'CURP',                     kw:/curp/i },
  { id:'rfc',       label:'RFC / Constancia fiscal',  kw:/\brfc\b|c[eé]dula.?fiscal|constancia.?fiscal/i },
  { id:'domicilio', label:'Comprobante de domicilio', kw:/domicilio|comprobante/i },
  { id:'solicitud', label:'Solicitud de empleo',      kw:/solicitud/i },
  { id:'dc3',       label:'DC-3 Capacitación',        kw:/dc.?3|capacitac|adiestr/i },
  { id:'nom035',    label:'NOM-035 Evaluación',       kw:/nom.?0?35|psicosocial/i },
];

// ════════════════════════════════════════════
// ACCIONES
// ════════════════════════════════════════════
// ⚠️ Número de WhatsApp del abogado — reemplazar con el real.
// (Es el mismo placeholder que falta llenar en faq-app.js)
const WHATSAPP_NUMERO_ASESOR = '5213339263817';

async function enviarSolicitud(){
  const tipo = document.getElementById('sol-tipo').value;
  const prioridad = document.getElementById('sol-prioridad').value;
  const desc = document.getElementById('sol-descripcion').value.trim();
  const trabajador = document.getElementById('sol-trabajador').value.trim();
  const antiguedad = document.getElementById('sol-antiguedad').value.trim();
  const salario = document.getElementById('sol-salario').value;
  if(!desc){ alert('Por favor describa su consulta'); return; }

  const btn = event.target;
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const { error } = await sbAuth.from('solicitudes').insert({
      cliente_rfc: clienteActual.rfc,
      empresa: clienteActual.empresa,
      tipo, prioridad, descripcion: desc,
      trabajador: trabajador || null,
      antiguedad: antiguedad || null,
      salario: salario ? parseFloat(salario) : null,
      status: 'pendiente',
    });
    if (error) throw error;

    btn.textContent = '✓ Solicitud enviada';
    btn.style.background = 'var(--green)';

    // Urgente o crítica: además de guardar, abrimos WhatsApp con el mensaje listo para enviar al abogado
    if (prioridad === 'urgente' || prioridad === 'critica') {
      const msg = `🚨 Solicitud ${prioridad.toUpperCase()} — ${clienteActual.empresa}\nTipo: ${tipo}\n${desc}`;
      window.open(`https://wa.me/${WHATSAPP_NUMERO_ASESOR}?text=${encodeURIComponent(msg)}`, '_blank');
    }

    document.getElementById('sol-descripcion').value = '';
    document.getElementById('sol-trabajador').value = '';
    document.getElementById('sol-antiguedad').value = '';
    document.getElementById('sol-salario').value = '';
    await cargarSolicitudesRecientes();
  } catch(e) {
    alert('No se pudo enviar la solicitud. Verifique que la migración SQL ya se haya ejecutado en Supabase.\n\n'+(e.message||e));
    btn.textContent = textoOriginal;
  } finally {
    btn.disabled = false;
    setTimeout(()=>{ btn.textContent = textoOriginal; btn.style.background=''; }, 3000);
  }
}

async function cargarSolicitudesRecientes(){
  const cont = document.getElementById('solicitudes-recientes');
  try {
    const { data, error } = await sbAuth.from('solicitudes').select('*')
      .eq('cliente_rfc', clienteActual.rfc)
      .order('created_at', { ascending:false }).limit(8);
    if (error) throw error;
    if (!data || !data.length) {
      cont.innerHTML = '<div style="font-size:13px;color:var(--ink3);text-align:center;padding:20px 0;">Sin solicitudes previas</div>';
      return;
    }
    const estadoColor = { pendiente:'var(--amber-bg)', en_proceso:'var(--sky)', resuelta:'var(--green-bg)' };
    const estadoTexto = { pendiente:'⏳ Pendiente', en_proceso:'🔧 En proceso', resuelta:'✓ Resuelta' };
    cont.innerHTML = data.map(s=>`
      <div style="padding:10px;background:${estadoColor[s.status]||'var(--surface)'};border-radius:8px;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:600;">${estadoTexto[s.status]||s.status}</div>
        <div style="font-size:11px;color:var(--ink2);margin-top:4px;">${s.tipo||''}</div>
        <div style="font-size:11px;color:var(--ink3);">${new Date(s.created_at).toLocaleString('es-MX')}</div>
        ${s.respuesta?`<div style="font-size:11px;color:var(--ink2);margin-top:6px;padding-top:6px;border-top:1px solid rgba(0,0,0,.08);"><strong>Respuesta:</strong> ${s.respuesta}</div>`:''}
      </div>`).join('');
  } catch(e) {
    cont.innerHTML = '<div style="font-size:12px;color:var(--ink3);text-align:center;padding:20px 0;">No se pudieron cargar las solicitudes.</div>';
    console.error(e.message||e);
  }
}

async function guardarConfig(){
  const contacto = document.getElementById('cfg-contacto').value.trim();
  const email    = document.getElementById('cfg-email').value.trim();
  const tel      = document.getElementById('cfg-tel').value.trim();

  if(!contacto){ alert('⚠️ El nombre del contacto no puede quedar vacío.'); return; }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ alert('⚠️ El email no tiene un formato válido.'); return; }

  const btn = document.querySelector('#panel-configuracion .btn-primary');
  const btnTxt = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    // Escritura vía función serverless (misma arquitectura que mutar-datos-cliente):
    // valida el token y solo permite campos de contacto — nunca plan/rfc/role.
    const { data: sesData } = await sbAuth.auth.getSession();
    const accessToken = sesData?.session?.access_token;
    if(!accessToken) throw new Error('Sesión expirada. Inicie sesión nuevamente.');

    const resp = await fetch('/api/actualizar-config-cliente', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+accessToken },
      body: JSON.stringify({ contacto_rrhh: contacto, email_contacto: email, tel: tel })
    });
    const resultado = await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error(resultado.error || 'Error del servidor ('+resp.status+')');

    // Refrescar la sesión local para que user_metadata traiga los nuevos valores
    await sbAuth.auth.refreshSession().catch(()=>{});

    // Actualizar estado en memoria
    if(clienteActual){
      clienteActual.contacto = contacto;
      clienteActual.email    = email;
      clienteActual.tel      = tel;
    }

    // Reflejar de inmediato en el menú lateral
    const sbName = document.getElementById('sb-contacto-name');
    if(sbName) sbName.textContent = contacto;

    alert('✅ Configuración guardada correctamente.');
  } catch(e){
    console.error('guardarConfig:', e.message||e);
    alert('❌ No se pudo guardar la configuración: ' + (e.message||'error de conexión') + '\nIntente de nuevo.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = btnTxt; }
  }
}

// ════════════════════════════════════════════
// RESTAURAR SESIÓN EXISTENTE — evita pedir login de nuevo al volver
// de otra página del portal (ej. asistencias-vacaciones.html → "Volver")
// ════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// COMISIONES MIXTAS — Guía con checklist para el cliente
// ════════════════════════════════════════════════════════
function renderComisiones(){
  if(document.getElementById('com-checklist-wrap').children.length) return; // ya renderizado

  const COMISIONES = [
    {
      id:'sh', icon:'🦺', nombre:'Comisión Mixta de Seguridad e Higiene',
      base:'Art. 509 LFT + NOM-019-STPS-2011', colorBadge:'badge-red',
      desc:'Obligatoria para <strong>todas las empresas</strong> sin importar tamaño. Identifica y previene riesgos de trabajo. Requiere reuniones mensuales y recorridos trimestrales.',
      pasos:[
        'Designar al menos 1 representante patronal y 1 trabajador (propietario + suplente cada uno)',
        'Elaborar y firmar el Acta de Integración con nombres, puestos y RFC de integrantes',
        'Registrar la comisión ante la STPS en el SIRCE (Sistema de Registro de Comisiones)',
        'Elaborar el Programa Anual de Seguridad e Higiene con fechas de recorridos',
        'Realizar recorridos de verificación mínimo cada 3 meses y levantar acta',
        'Celebrar reuniones mensuales y documentarlas en Acta de Sesión',
        'Publicar en tablero de avisos los resultados y medidas correctivas',
        'Conservar documentación: 1 año (recorridos), 3 años (actas de sesión)',
      ]
    },
    {
      id:'cap', icon:'🎓', nombre:'Comisión Mixta de Capacitación y Adiestramiento',
      base:'Art. 153-E LFT', colorBadge:'badge-blue',
      desc:'Obligatoria con <strong>20 o más trabajadores</strong>. Planifica y vigila el programa anual de capacitación. El incumplimiento puede derivar en multas del IMSS e INFONAVIT.',
      pasos:[
        'Integrar al menos 1 representante patronal y 1 trabajador',
        'Elaborar el Acta de Integración y registrar ante la STPS (SRFT)',
        'Detectar necesidades de capacitación (DNC) con cada trabajador',
        'Elaborar el Plan y Programa Anual de Capacitación (formulario DC-2)',
        'Contratar o designar al instructor / organismo capacitador (OEC)',
        'Ejecutar los cursos y recabar firmas de asistencia',
        'Emitir Constancias de Habilidades Laborales (DC-3) a cada trabajador capacitado',
        'Reunión trimestral para revisar avances del programa',
        'Archivar DC-3, listas y planes de capacitación (mínimo 5 años)',
      ]
    },
    {
      id:'ptu', icon:'💰', nombre:'Comisión Mixta para la Determinación de PTU',
      base:'Art. 125 LFT', colorBadge:'badge-green',
      desc:'Obligatoria en empresas que generen utilidades. Verifica y dictamina el cálculo correcto de la Participación de los Trabajadores en las Utilidades.',
      pasos:[
        'Integrar la comisión en febrero de cada año',
        'Solicitar al patrón copia de la declaración anual del ISR presentada al SAT',
        'Verificar la renta gravable base del cálculo',
        'Elaborar el Dictamen de PTU firmado por la comisión',
        'Publicar el dictamen en el tablero de avisos de la empresa',
        'Pagar la PTU: mayo (PM) o junio (PF) — máximo 60 días después de declaración',
        'Recabar firma de cada trabajador al momento de cobrar',
        'Conservar la documentación mínimo 5 años',
      ]
    },
    {
      id:'esc', icon:'📈', nombre:'Comisión Mixta de Escalafón',
      base:'Arts. 158-159 LFT', colorBadge:'badge-amber',
      desc:'Obligatoria con <strong>más de 20 trabajadores</strong>. Define las reglas objetivas de ascenso y promoción, evitando conflictos y demandas por discriminación.',
      pasos:[
        'Integrar la comisión e incluirla en el Reglamento Interior de Trabajo',
        'Definir los criterios de escalafón: antigüedad, aptitud, conocimientos y disciplina',
        'Elaborar el reglamento interno de la comisión',
        'Sesionar cada vez que exista una vacante definitiva o puesto de nueva creación',
        'Documentar cada resolución de ascenso en acta firmada por ambas partes',
        'Publicar los criterios vigentes en tablero de avisos',
      ]
    },
    {
      id:'rit', icon:'📖', nombre:'Comisión Mixta de Revisión del Reglamento Interior',
      base:'Art. 424 LFT', colorBadge:'badge-gray',
      desc:'Revisa el Reglamento Interior de Trabajo cada <strong>dos años</strong> o cuando haya cambios legislativos relevantes. El RIT debe estar depositado en el CFCRL.',
      pasos:[
        'Integrar la comisión (pueden ser los mismos representantes de otra comisión)',
        'Revisar el RIT vigente frente a cambios de la LFT y condiciones de la empresa',
        'Redactar las modificaciones o ratificar el texto vigente mediante acuerdo firmado',
        'Firmar el Acuerdo de Revisión entre trabajadores y patrón',
        'Depositar el RIT actualizado ante la CFCRL (Centro Federal de Conciliación)',
        'Publicar el RIT en tablero de avisos y entregar copia a cada trabajador',
      ]
    },
  ];

  document.getElementById('com-checklist-wrap').innerHTML = COMISIONES.map(com=>{
    const n = com.pasos.length;
    return `
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;">
        <div style="font-size:28px;line-height:1;">${com.icon}</div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <div style="font-size:14px;font-weight:700;color:var(--navy2);">${com.nombre}</div>
            <span class="badge ${com.colorBadge}" style="font-size:10px;">${com.base}</span>
          </div>
          <div style="font-size:12px;color:var(--ink2);line-height:1.6;">${com.desc}</div>
        </div>
        <div id="com-prog-${com.id}" style="text-align:center;min-width:52px;flex-shrink:0;">
          <div style="font-size:18px;font-weight:800;color:var(--ink3);">0/${n}</div>
          <div style="font-size:10px;color:var(--ink3);">pasos</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${com.pasos.map((paso,i)=>`
          <label id="com-row-${com.id}-${i}" style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:8px 10px;border-radius:var(--r-sm);border:1px solid var(--border);font-size:12px;color:var(--ink2);line-height:1.5;transition:background .1s;">
            <input type="checkbox" id="com-chk-${com.id}-${i}" style="margin-top:2px;accent-color:var(--navy2);flex-shrink:0;" onchange="actualizarProgresoComPortal('${com.id}',${n})">
            <span><strong style="color:var(--ink3);font-size:10px;">Paso ${i+1}.</strong> ${paso}</span>
          </label>`).join('')}
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" onclick="window.open('comisiones-mixtas.html?empresa='+encodeURIComponent(clienteActual.empresa)+'&rfc='+encodeURIComponent(clienteActual.rfc))">📄 Generar documentos de esta comisión</button>
        <button class="btn btn-ghost btn-sm" onclick="goPanel('solicitudes')">📨 Consultar a mi asesor</button>
      </div>
    </div>`;
  }).join('');
}

function actualizarProgresoComPortal(id, total){
  const checks = document.querySelectorAll(`[id^="com-chk-${id}-"]`);
  const completados = Array.from(checks).filter(c=>c.checked).length;
  const el = document.getElementById(`com-prog-${id}`);
  if(!el) return;
  const pct = Math.round(completados/total*100);
  const color = pct===100?'var(--green)':pct>=50?'#d97706':'var(--ink3)';
  el.innerHTML = `<div style="font-size:18px;font-weight:800;color:${color};">${completados}/${total}</div><div style="font-size:10px;color:${color};">${pct===100?'✅ Listo':'pasos'}</div>`;
  // Marcar visualmente las filas completadas
  checks.forEach((c,i)=>{
    const row = document.getElementById(`com-row-${id}-${i}`);
    if(row) row.style.background = c.checked ? '#f0fdf4' : '';
  });
}
// Prima de Antigüedad (LFT vigente con reforma 2023)
// ════════════════════════════════════════════════════════

function calcSetTab(tab){
  ['completo','finiquito','liquidacion','vacaciones','antiguedad'].forEach(t=>{
    document.getElementById('calc-panel-'+t).style.display = t===tab ? '' : 'none';
    const btn = document.getElementById('calc-tab-'+t);
    if(btn){ btn.className = t===tab ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'; }
  });
}

// ── Calculadora — Autocompletado desde roster ──
let _calcRoster = [];

async function calcCargarRoster() {
  if (_calcRoster.length > 0) return;
  try {
    const rfc = clienteActual?.rfc;
    if (!rfc) return;
    const { data } = await sbAuth.from('trabajadores')
      .select('id,nombre,puesto,fecha_ingreso,activo')
      .eq('cliente_rfc', rfc).eq('activo', true).order('nombre');
    _calcRoster = data || [];
    const sel = document.getElementById('calc-select-trabajador');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccionar del roster (opcional) —</option>';
    _calcRoster.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.dataset.nombre  = t.nombre;
      opt.dataset.puesto  = t.puesto || '';
      opt.dataset.ingreso = t.fecha_ingreso || '';
      opt.textContent = t.nombre + (t.puesto ? ' — ' + t.puesto : '');
      sel.appendChild(opt);
    });
  } catch(e) { console.error('calcCargarRoster:', e.message||e); }
}

function calcAutocompletarTrabajador() {
  const sel = document.getElementById('calc-select-trabajador');
  const opt = sel?.options[sel.selectedIndex];
  const infoEl = document.getElementById('calc-trab-info');
  if (!opt?.value) { if(infoEl) infoEl.textContent=''; return; }
  const nombre = opt.dataset.nombre||'', puesto = opt.dataset.puesto||'', ingreso = opt.dataset.ingreso||'';
  const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
  const hoy = new Date().toISOString().split('T')[0];
  // Cálculo completo
  setVal('cu-nombre', nombre); setVal('cu-puesto', puesto);
  if (ingreso) setVal('cu-ingreso', ingreso);
  // Finiquito
  setVal('fq-nombre', nombre); setVal('fq-puesto', puesto);
  if (ingreso) setVal('fq-ingreso', ingreso);
  // Liquidación
  setVal('lq-nombre', nombre);
  if (ingreso) setVal('lq-ingreso', ingreso);
  // Vacaciones
  if (ingreso) { setVal('vac-ingreso', ingreso); setVal('vac-corte', hoy); }
  // Antigüedad
  if (ingreso) setVal('ant-ingreso', ingreso);
  if (infoEl) infoEl.textContent =
    nombre + (puesto?' · '+puesto:'') + (ingreso?' · Ingreso: '+new Date(ingreso+'T12:00:00').toLocaleDateString('es-MX'):'');
  calcCompleto(); calcFiniquito(); calcLiquidacion(); calcVacaciones(); calcAntiguedad();
}

function imprimirCalculadora(tipo) {
  const nombre  = document.getElementById('fq-nombre')?.value || '';
  const empresa = clienteActual?.empresa || '';
  const resId   = tipo==='finiquito' ? 'fq-resultado' : 'lq-resultado';
  const res     = document.getElementById(resId);
  if (!res) return;
  const titulo  = tipo==='finiquito' ? 'FINIQUITO' : 'LIQUIDACIÓN';
  const w = window.open('', '_blank', 'width=720,height=650');
  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>${titulo}</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:40px auto;color:#1a1a1a;}
      h1{font-size:22px;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:8px;margin:0;}
      .sub{font-size:13px;color:#666;margin:4px 0 20px;}
      .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;font-size:14px;}
      .total{display:flex;justify-content:space-between;padding:14px 0;font-size:17px;font-weight:800;border-top:2px solid #1a3a5c;color:#1a3a5c;}
      .label{opacity:.7;} .value{font-family:monospace;font-weight:600;}
      .nota{margin-top:24px;font-size:10px;color:#999;line-height:1.6;border-top:1px solid #eee;padding-top:12px;}
      @media print{@page{margin:18mm;}}
    </style>
  </head><body>
    <h1>${titulo}</h1>
    <div class="sub">${empresa}${nombre?' · '+nombre:''} · ${new Date().toLocaleDateString('es-MX',{dateStyle:'long'})}</div>
    ${res.innerHTML
      .replace(/class="calc-row"/g,'class="row"')
      .replace(/class="calc-row-total"/g,'class="total"')
      .replace(/class="calc-label"/g,'class="label"')
      .replace(/class="calc-value"/g,'class="value"')}
    <div class="nota">⚠️ Cálculo orientativo basado en la LFT vigente. Los montos reales pueden variar. Consulte a su asesor ante cualquier caso específico.<br>Generado mediante ClickLaboral.mx · ${new Date().toLocaleString('es-MX')}</div>
    <script>window.print(); setTimeout(()=>window.close(),1200);<\/script>
  </body></html>`);
  w.document.close();
}

function abrirGenTrabajador(gen, idx) {
  const t = (window._repActivos || [])[idx];
  if (!t) return;
  const p = new URLSearchParams({
    empresa:  clienteActual?.empresa || '',
    rfc:      clienteActual?.rfc || '',
    trabajador: t.nombre || '',
    puesto:     t.puesto || '',
    ingreso:    t.fecha_ingreso || '',
    nss:        t.nss || '',
    salario:    t.salario_diario != null ? String(t.salario_diario) : ''
  });
  window.open(gen + '?' + p.toString(), '_blank');
}

function generarDocumentoDesdeCalc(tipo) {
  const get = id => document.getElementById(id)?.value || '';
  const resEl   = document.getElementById(tipo==='finiquito'?'fq-resultado':'lq-resultado');
  const totalEl = resEl?.querySelector('.calc-row-total .calc-value');

  const fq = window._fqCalcData || {};
  const lq = window._lqCalcData || {};

  const params = new URLSearchParams({
    empresa:       clienteActual?.empresa || '',
    rfc:           clienteActual?.rfc || '',
    tipo,
    trabajador:    get(tipo === 'liquidacion' ? 'lq-nombre' : 'fq-nombre'),
    puesto:        get('fq-puesto'),
    salario:       get(tipo==='finiquito'?'fq-salario':'lq-salario'),
    ingreso:       get(tipo==='finiquito'?'fq-ingreso':'lq-ingreso'),
    baja:          get(tipo==='finiquito'?'fq-baja':'lq-despido'),
    sal_pend_dias: tipo==='finiquito' ? (fq.salPendDias||0) : 0,
    vac_prev_dias: tipo==='finiquito' ? (fq.vacPrevDias||0) : 0,
    vac_prop_dias: tipo==='finiquito' ? (fq.vacPropDias||0) : (lq.vacPropDias||0),
    ag_dias:       get('fq-aguinaldo-dias'),
    total_calc:    totalEl?.textContent || '',
  });
  window.open('cartas-laborales.html?' + params.toString(), '_blank');
}

function mxn(n){ return '$'+n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function diffDias(fechaInicio, fechaFin){
  const d1 = new Date(fechaInicio), d2 = new Date(fechaFin);
  return Math.max(0, Math.round((d2-d1)/(1000*60*60*24)));
}
function diffAnios(fechaInicio, fechaFin){
  const d1 = new Date(fechaInicio), d2 = new Date(fechaFin);
  let anios = d2.getFullYear() - d1.getFullYear();
  const m = d2.getMonth() - d1.getMonth();
  if(m < 0 || (m===0 && d2.getDate()<d1.getDate())) anios--;
  return Math.max(0, anios);
}

// Tabla de vacaciones Art. 76 LFT (reforma 2023 "vacaciones dignas")
function diasVacacionesPorAnios(anios){
  if(anios < 1) return 0;
  if(anios === 1) return 12;
  if(anios === 2) return 14;
  if(anios === 3) return 16;
  if(anios === 4) return 18;
  if(anios === 5) return 20;
  if(anios <= 10) return 22;
  if(anios <= 15) return 24;
  if(anios <= 20) return 26;
  // 21+ años: 26 + 2 días por cada 5 años adicionales (a partir de los 21)
  return 26 + (Math.floor((anios-20)/5)*2);
}

function renderFilas(filas){
  return filas.map(([label,val,bold])=>
    bold
      ? `<div class="calc-row-total"><span>${label}</span><span>${val}</span></div>`
      : `<div class="calc-row"><span class="calc-label">${label}</span><span class="calc-value">${val}</span></div>`
  ).join('');
}

function calcFiniquito(){
  const sal = parseFloat(document.getElementById('fq-salario').value);
  const ing = document.getElementById('fq-ingreso').value;
  const baj = document.getElementById('fq-baja').value;
  const vacPrevPend = parseFloat(document.getElementById('fq-vac-pend').value)||0;
  const agDias = parseFloat(document.getElementById('fq-aguinaldo-dias').value)||15;
  const res = document.getElementById('fq-resultado');

  if(!sal||sal<=0||!ing||!baj||new Date(baj)<=new Date(ing)){
    res.innerHTML='<div style="text-align:center;padding:20px;opacity:.4;font-size:13px;">Complete los datos correctamente</div>';
    return;
  }

  const anios = diffAnios(ing, baj);
  const salPendEl = parseFloat(document.getElementById('fq-sal-pend')?.value)||0;

  // Aguinaldo proporcional: días trabajados en el año calendario actual
  const inicioAnio = new Date(new Date(baj).getFullYear(), 0, 1).toISOString().split('T')[0];
  const diasAnio = diffDias(inicioAnio, baj);

  // Vacaciones proporcionales del período actual en curso (Art. 79 LFT)
  // Días trabajados desde el último aniversario hasta la baja
  const ultimoAnivDate = new Date(ing);
  ultimoAnivDate.setFullYear(new Date(ing).getFullYear() + anios);
  const ultimoAniv = ultimoAnivDate.toISOString().split('T')[0];
  const diasEnPeriodoActual = diffDias(ultimoAniv, baj);
  const diasVacSigPeriodo = diasVacacionesPorAnios(anios + 1);
  const diasVacProp = Math.round(diasEnPeriodoActual / 365 * diasVacSigPeriodo * 100) / 100;

  // Vacaciones períodos anteriores no gozadas (manual)
  const vacPrevImporte = vacPrevPend * sal;
  const primVacPrev = vacPrevImporte * 0.25;

  // Proporcionales período actual
  const vacPropImporte = diasVacProp * sal;
  const primVacProp = vacPropImporte * 0.25;

  const aguinaldo = (diasAnio / 365) * agDias * sal;
  const salPendientes = salPendEl * sal;

  const total = salPendientes + vacPrevImporte + primVacPrev + vacPropImporte + primVacProp + aguinaldo;

  const filasFq = [];
  if(salPendEl > 0) filasFq.push(['Salarios pendientes ('+salPendEl+' días)', mxn(salPendientes)]);
  if(vacPrevPend > 0){
    filasFq.push(['Vac. períodos ant. no gozadas ('+vacPrevPend+' días)', mxn(vacPrevImporte)]);
    filasFq.push(['Prima vacacional períodos ant. (25%)', mxn(primVacPrev)]);
  }
  filasFq.push(['Vac. proporcionales período actual ('+diasVacProp+' días — Art. 79)', mxn(vacPropImporte)]);
  filasFq.push(['Prima vacacional proporcional (25%)', mxn(primVacProp)]);
  filasFq.push(['Aguinaldo proporcional ('+Math.round(diasAnio)+' días del año)', mxn(aguinaldo)]);
  filasFq.push(['TOTAL FINIQUITO', mxn(total), true]);
  res.innerHTML = renderFilas(filasFq);
  // Guardar para generarDocumentoDesdeCalc
  window._fqCalcData = { salPendDias: salPendEl, vacPrevDias: vacPrevPend, vacPropDias: diasVacProp };
  const btnDiv = document.getElementById('fq-botones');
  if (btnDiv) btnDiv.style.display = 'flex';
}

function calcLiquidacion(){
  const sal = parseFloat(document.getElementById('lq-salario').value);
  const ing = document.getElementById('lq-ingreso').value;
  const des = document.getElementById('lq-despido').value;
  const tipo = document.getElementById('lq-tipo').value;
  const inclAnt = document.getElementById('lq-antiguedad').value === 'si';
  const salMin = parseFloat(document.getElementById('lq-salmin').value)||315.04;
  const res = document.getElementById('lq-resultado');

  if(!sal||sal<=0||!ing||!des||new Date(des)<=new Date(ing)){
    res.innerHTML='<div style="text-align:center;padding:20px;opacity:.4;font-size:13px;">Complete los datos correctamente</div>';
    return;
  }

  const anios = diffAnios(ing, des);
  const diasTotal = diffDias(ing, des);
  const inicioAnio = new Date(new Date(des).getFullYear(), 0, 1).toISOString().split('T')[0];
  const diasAnio = diffDias(inicioAnio, des);

  // Prestaciones de liquidación (Art. 48 LFT)
  const fraccionAnio = (diasTotal - anios * 365) / 365;
  const aniosTotales = anios + fraccionAnio;
  const tresMeses = sal * 90;
  const veinteDias = sal * 20 * Math.max(aniosTotales, 1/12);

  // Vacaciones proporcionales del período actual en curso (Art. 79 LFT)
  // Se calcula sobre los días del período de aniversario en curso, no sobre años completos
  const ultimoAnivDate = new Date(ing);
  ultimoAnivDate.setFullYear(new Date(ing).getFullYear() + anios);
  const ultimoAniv = ultimoAnivDate.toISOString().split('T')[0];
  const diasEnPeriodoActual = diffDias(ultimoAniv, des);
  const diasVacSigPeriodo = diasVacacionesPorAnios(anios + 1);
  const diasVacProp = Math.round(diasEnPeriodoActual / 365 * diasVacSigPeriodo * 100) / 100;
  const vacaciones = diasVacProp * sal;
  const primaVac = vacaciones * 0.25;

  const aguinaldo = (diasAnio / 365) * 15 * sal;

  // Prima de antigüedad Art. 162 LFT
  const salAntiguedad = Math.min(sal, salMin * 2);
  const primaAntiguedad = inclAnt ? (salAntiguedad * 12 * Math.max(1, anios)) : 0;

  const subtotalBase = tresMeses + veinteDias + vacaciones + primaVac + aguinaldo;
  const total = subtotalBase + primaAntiguedad;

  const filas = [
    ['3 meses de salario (Art. 48 LFT)', mxn(tresMeses)],
    ['20 días × año ('+aniosTotales.toFixed(1)+' años — Art. 48 LFT)', mxn(veinteDias)],
    ['Vac. proporcionales período actual ('+diasVacProp+' días — Art. 79)', mxn(vacaciones)],
    ['Prima vacacional proporcional (25%)', mxn(primaVac)],
    ['Aguinaldo proporcional ('+Math.round(diasAnio)+' días del año)', mxn(aguinaldo)],
  ];
  if(inclAnt) filas.push(['Prima de antigüedad (12 días × '+Math.max(1,anios)+' años — Art. 162)', mxn(primaAntiguedad)]);
  filas.push(['TOTAL LIQUIDACIÓN', mxn(total), true]);
  res.innerHTML = renderFilas(filas);
  res.innerHTML += '<div style="margin-top:10px;font-size:11px;color:var(--ink3);padding:8px 10px;background:rgba(0,0,0,.04);border-radius:6px;line-height:1.6;">Nota: Si el trabajador tiene vacaciones de períodos anteriores no gozadas, estas se suman al total. Ingrese esos días en la calculadora de Finiquito.</div>';
  // Guardar para generarDocumentoDesdeCalc
  window._lqCalcData = { vacPropDias: diasVacProp };
  const btnDiv = document.getElementById('lq-botones');
  if (btnDiv) btnDiv.style.display = 'flex';
}

function calcVacaciones(){
  const ing = document.getElementById('vac-ingreso').value;
  const cor = document.getElementById('vac-corte').value;
  const sal = parseFloat(document.getElementById('vac-salario').value)||0;
  const res = document.getElementById('vac-resultado');

  if(!ing || !cor || new Date(cor) <= new Date(ing)){
    res.innerHTML='<div style="text-align:center;padding:20px;opacity:.4;font-size:13px;">Ingrese las fechas de ingreso y de corte para calcular</div>';
    return;
  }

  const d1 = new Date(ing), d2 = new Date(cor);
  const anios = diffAnios(ing, cor);

  let totalMeses = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
  if(d2.getDate() < d1.getDate()) totalMeses--;
  totalMeses = Math.max(0, totalMeses);
  const mesesResto = totalMeses % 12;

  // Días en el período de aniversario actual (para proporcionales Art. 79)
  const ultimoAnivDate = new Date(d1);
  ultimoAnivDate.setFullYear(d1.getFullYear() + anios);
  const ultimoAniv = ultimoAnivDate.toISOString().split('T')[0];
  const diasEnPeriodoActual = diffDias(ultimoAniv, cor);

  // Próximo aniversario
  const sigAnivDate = new Date(d1);
  sigAnivDate.setFullYear(d1.getFullYear() + anios + 1);
  const fmtSigAniv = sigAnivDate.toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'});

  // Días que corresponderán al completar el período actual
  const diasVacSigPeriodo = diasVacacionesPorAnios(anios + 1);
  // Días proporcionales del período actual (Art. 79)
  const diasProp = Math.round(diasEnPeriodoActual / 365 * diasVacSigPeriodo * 100) / 100;

  const headerStyle = 'font-size:12px;font-weight:700;color:var(--navy);padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:10px;';
  const headerStyleInv = 'font-size:12px;font-weight:700;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.2);margin-bottom:10px;';
  const noteStyle = 'font-size:11px;color:var(--ink3);margin-bottom:10px;line-height:1.6;padding:8px;background:rgba(0,0,0,.03);border-radius:6px;';
  const noteStyleInv = 'font-size:11px;opacity:.8;margin-bottom:10px;line-height:1.6;';

  let html = '';

  if(anios < 1){
    // — Sección 1: Vacaciones para descanso (en formación)
    html += `<div class="card" style="margin-bottom:12px;">
      <div style="${headerStyle}">Vacaciones para descanso (Art. 76 LFT)</div>
      <div style="${noteStyle}">En formación — el derecho a vacaciones nace al cumplir el <strong>primer aniversario laboral</strong>. Hasta entonces el trabajador no tiene días de vacaciones para tomar como descanso.</div>
      ${renderFilas([
        ['Tiempo trabajado', totalMeses + ' mes' + (totalMeses===1?'':'es')],
        ['Primer aniversario (nace el derecho)', fmtSigAniv],
        ['Días de vacaciones al cumplir 1 año', diasVacSigPeriodo + ' días'],
        sal ? ['Importe de vacaciones (al aniversario)', mxn(diasVacSigPeriodo * sal)] : null,
        sal ? ['Prima vacacional (25%)', mxn(diasVacSigPeriodo * sal * 0.25)] : null,
        sal ? ['Total estimado al aniversario', mxn(diasVacSigPeriodo * sal * 1.25), true] : null,
      ].filter(Boolean))}
    </div>`;
    // — Sección 2: Partes proporcionales (Art. 79)
    html += `<div class="card" style="background:var(--navy);color:#fff;">
      <div style="${headerStyleInv}">Partes proporcionales si termina hoy (Art. 79 LFT)</div>
      <div style="${noteStyleInv}">Si la relación laboral terminara hoy, el trabajador tiene derecho a una remuneración proporcional al tiempo trabajado, aunque no haya completado el año. Esto NO es para descanso, es un pago en efectivo.</div>
      ${renderFilas([
        ['Días trabajados en período actual', diasEnPeriodoActual + ' días'],
        ['Fórmula: ' + diasEnPeriodoActual + '/365 × ' + diasVacSigPeriodo + ' días', diasProp + ' días proporcionales'],
        sal ? ['Importe proporcional', mxn(diasProp * sal)] : null,
        sal ? ['Prima vacacional proporcional (25%)', mxn(diasProp * sal * 0.25)] : null,
        sal ? ['Total partes proporcionales', mxn(diasProp * sal * 1.25), true] : null,
      ].filter(Boolean))}
    </div>`;
  } else {
    const diasVacUltimoPeriodo = diasVacacionesPorAnios(anios);
    const antiguedadStr = anios + ' año' + (anios===1?'':'s') + (mesesResto > 0 ? ' y ' + mesesResto + ' mes' + (mesesResto===1?'':'es') : '');

    // — Sección 1: Vacaciones para descanso (período completado más reciente)
    html += `<div class="card" style="margin-bottom:12px;">
      <div style="${headerStyle}">Vacaciones para descanso (Art. 76 LFT)</div>
      <div style="${noteStyle}">Días que el trabajador tiene derecho a disfrutar como descanso. Se generan al completar cada año de servicio. Deben tomarse dentro del período siguiente al que los generó.</div>
      ${renderFilas([
        ['Antigüedad', antiguedadStr],
        ['Período completado más reciente (año ' + anios + ')', diasVacUltimoPeriodo + ' días para descanso'],
        ['Siguiente período (año ' + (anios+1) + ') se completa el', fmtSigAniv],
        ['Días que generará el año ' + (anios+1), diasVacSigPeriodo + ' días'],
        sal ? ['Importe vacaciones año ' + anios, mxn(diasVacUltimoPeriodo * sal)] : null,
        sal ? ['Prima vacacional (25%)', mxn(diasVacUltimoPeriodo * sal * 0.25)] : null,
        sal ? ['Total vacaciones + prima período ' + anios, mxn(diasVacUltimoPeriodo * sal * 1.25), true] : null,
      ].filter(Boolean))}
    </div>`;

    // — Sección 2: Partes proporcionales (Art. 79)
    html += `<div class="card" style="background:var(--navy);color:#fff;">
      <div style="${headerStyleInv}">Partes proporcionales si termina hoy (Art. 79 LFT)</div>
      <div style="${noteStyleInv}">Si la relación laboral terminara hoy, se pagan los días proporcionales del período en curso (año ${anios+1}). Esto es un PAGO en efectivo, no días de descanso. Si además hay vacaciones de períodos anteriores no gozadas, también se pagan.</div>
      ${renderFilas([
        ['Período actual (año ' + (anios+1) + ')', diasEnPeriodoActual + ' días trabajados'],
        ['Fórmula: ' + diasEnPeriodoActual + '/365 × ' + diasVacSigPeriodo + ' días', diasProp + ' días proporcionales'],
        sal ? ['Importe proporcional', mxn(diasProp * sal)] : null,
        sal ? ['Prima vacacional proporcional (25%)', mxn(diasProp * sal * 0.25)] : null,
        sal ? ['Total partes proporcionales', mxn(diasProp * sal * 1.25), true] : null,
      ].filter(Boolean))}
    </div>`;
  }

  res.innerHTML = html;
}

function calcAntiguedad(){
  const motivo = document.getElementById('ant-motivo').value;
  const sal = parseFloat(document.getElementById('ant-salario').value);
  const salMin = parseFloat(document.getElementById('ant-salmin').value)||248.93;
  const ing = document.getElementById('ant-ingreso').value;
  const baj = document.getElementById('ant-baja').value;
  const res = document.getElementById('ant-resultado');
  const avisoRenuncia = document.getElementById('ant-aviso-renuncia');

  // Mostrar aviso cuando es renuncia voluntaria
  avisoRenuncia.style.display = motivo === 'renuncia' ? 'block' : 'none';

  if(!motivo){
    res.innerHTML='<div style="text-align:center;padding:20px;opacity:.4;font-size:13px;">Seleccione el motivo de la terminación para calcular</div>';
    return;
  }

  if(!ing || !baj || new Date(baj) <= new Date(ing)){
    res.innerHTML='<div style="text-align:center;padding:20px;opacity:.4;font-size:13px;">Ingrese las fechas de ingreso y baja</div>';
    return;
  }

  const anios = Math.max(1, diffAnios(ing, baj));

  // Verificar condición de 15 años para renuncia voluntaria
  if(motivo === 'renuncia' && anios < 15){
    res.innerHTML=`
      <div style="background:rgba(220,38,38,.15);border:1px solid rgba(220,38,38,.3);border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:24px;margin-bottom:8px;">❌</div>
        <div style="font-weight:700;margin-bottom:6px;color:#fca5a5;">No aplica la prima de antigüedad</div>
        <div style="font-size:12px;opacity:.8;line-height:1.6;">El trabajador tiene <strong>${anios} año${anios===1?'':'s'}</strong> de servicio. Para que aplique la prima de antigüedad por renuncia voluntaria se requieren <strong>15 años o más</strong> (Art. 162, fracc. I, LFT).</div>
      </div>`;
    return;
  }

  if(!sal || sal <= 0){
    res.innerHTML='<div style="text-align:center;padding:20px;opacity:.4;font-size:13px;">Ingrese el salario diario para obtener el monto</div>';
    return;
  }

  const salAplicable = Math.min(sal, salMin * 2);
  const primaAntiguedad = salAplicable * 12 * anios;
  const motivoLabel = {
    despido_injust: 'Despido injustificado',
    art51: 'Rescisión imputable al patrón (Art. 51)',
    renuncia: 'Renuncia voluntaria (15+ años)',
    fallecimiento: 'Fallecimiento',
    incapacidad: 'Incapacidad permanente',
  }[motivo] || motivo;

  res.innerHTML = renderFilas([
    ['Motivo', motivoLabel],
    ['Años de antigüedad', anios+' año'+(anios===1?'':'s')],
    ['Salario diario del trabajador', mxn(sal)],
    ['Tope máximo (2 × '+mxn(salMin)+')', mxn(salMin*2)],
    ['Salario aplicable para el cálculo', mxn(salAplicable)+(sal>salMin*2?' (topado)':'')],
    ['Fórmula: 12 × '+anios+' años × '+mxn(salAplicable), ''],
    ['PRIMA DE ANTIGÜEDAD', mxn(primaAntiguedad), true],
  ]);
}

// ════════════════════════════════════════════════════════

(async function restaurarSesion(){
  try {
    const { data } = await sbAuth.auth.getSession();
    const session = data?.session;
    if (!session) return;
    const meta = session.user?.user_metadata || {};
    // Despacho mode: viene desde panel-despacho.html con cl_gestion en sessionStorage
    if (meta.tipo === 'despacho') {
      const gestionRaw = sessionStorage.getItem('cl_gestion');
      if (gestionRaw) {
        try {
          const cl = JSON.parse(gestionRaw);
          if (cl?.rfc) {
            _modoDespacho = cl;
            await cargarDatosCliente(cl.rfc);
            return;
          }
        } catch(e) { /* JSON inválido — dejar en login */ }
      }
      return; // despacho sin cl_gestion — no autoentrar
    }
    // Cliente directo normal
    const rfc = meta.rfc;
    if (!rfc) return; // sin sesión activa — se queda en la pantalla de login normal
    await cargarDatosCliente(rfc);
  } catch (e) {
    console.error('No se pudo restaurar la sesión existente, se mostrará el login:', e.message || e);
  }
})();

// ── Menú flotante de generadores por trabajador ──
var _genMenuIdx = -1;
function toggleGenMenu(event, idx) {
  event.stopPropagation();
  var menu = document.getElementById('gen-menu');
  if (_genMenuIdx === idx && menu.style.display !== 'none') { cerrarGenMenu(); return; }
  _genMenuIdx = idx;
  var rect = event.currentTarget.getBoundingClientRect();
  var sy = window.pageYOffset || document.documentElement.scrollTop;
  var sx = window.pageXOffset || document.documentElement.scrollLeft;
  menu.style.top  = (rect.bottom + sy + 4) + 'px';
  menu.style.left = Math.min(rect.left + sx, window.innerWidth + sx - 240) + 'px';
  menu.style.display = 'block';
}
function cerrarGenMenu() {
  var menu = document.getElementById('gen-menu');
  if (menu) menu.style.display = 'none';
  _genMenuIdx = -1;
}
document.addEventListener('click', cerrarGenMenu);
document.getElementById('gen-menu').addEventListener('click', function(e) {
  var btn = e.target.closest('.gm-item');
  if (!btn || _genMenuIdx < 0) return;
  if (btn.getAttribute('data-action') === 'baja') {
    abrirBajaWizard(_genMenuIdx);
  } else {
    abrirGenTrabajador(btn.getAttribute('data-gen'), _genMenuIdx);
  }
  cerrarGenMenu();
});

// ── Exportar tabla de trabajadores a Excel (SpreadsheetML) ──
function exportarExcelTrabajadores() {
  var activos = window._repActivos || [];
  if (activos.length === 0) { alert('Sin trabajadores para exportar.'); return; }
  var empresa = (window._repEmpresa || window._repRFC || 'plantilla').replace(/[^a-zA-Z0-9_-]/g, '_');
  var hoy = new Date();
  var fechaStr = hoy.toISOString().split('T')[0];
  var esc = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  var sCell = function(v, sid){ return '<Cell'+(sid?' ss:StyleID="'+sid+'"':'')+' ><Data ss:Type="String">'+esc(v)+'</Data></Cell>'; };
  var nCell = function(v){ return '<Cell><Data ss:Type="Number">'+Number(v)+'</Data></Cell>'; };
  var antigCalc = function(fi) {
    if(!fi) return '';
    var d = Math.floor((hoy - new Date(fi+'T12:00:00'))/86400000);
    if(d<30) return d+' días';
    if(d<365) return Math.floor(d/30)+' meses';
    return (d/365).toFixed(1)+' años';
  };
  var headers = ['Nombre','Puesto','Fecha de ingreso','Antigüedad','NSS','Salario diario','Salario mensual est.'];
  var rows = '<Row>' + headers.map(function(h){ return sCell(h,'hdr'); }).join('') + '</Row>\n';
  activos.forEach(function(t){
    var hasSal = t.salario_diario != null && t.salario_diario > 0;
    rows += '<Row>'
      + sCell(t.nombre||'') + sCell(t.puesto||'') + sCell(t.fecha_ingreso||'')
      + sCell(antigCalc(t.fecha_ingreso)) + sCell(t.nss||'')
      + (hasSal ? nCell(t.salario_diario) + nCell(Math.round(t.salario_diario*30.4)) : sCell('')+sCell(''))
      + '</Row>\n';
  });
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n'
    +'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n'
    +' <Styles>\n'
    +'  <Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F2640" ss:Pattern="Solid"/></Style>\n'
    +' </Styles>\n'
    +' <Worksheet ss:Name="Trabajadores">\n'
    +'  <Table ss:DefaultColumnWidth="120">\n'
    +'   <Column ss:Width="200"/><Column ss:Width="160"/><Column ss:Width="110"/><Column ss:Width="100"/><Column ss:Width="130"/><Column ss:Width="110"/><Column ss:Width="140"/>\n'
    + rows
    +'  </Table>\n'
    +' </Worksheet>\n'
    +'</Workbook>';
  var blob = new Blob([xml], {type:'application/vnd.ms-excel;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = empresa+'_trabajadores_'+fechaStr+'.xls';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Exportar reporte gerencial a PDF ──
function exportarPDFReporte() {
  var contenido = document.getElementById('rep-contenido');
  if (!contenido || !contenido.innerHTML.trim()) { alert('El reporte aún no ha cargado.'); return; }
  var empresa = window._repEmpresa || window._repRFC || 'Empresa';
  var periodoEl = document.getElementById('rep-periodo');
  var periodoLabel = periodoEl ? periodoEl.options[periodoEl.selectedIndex].text : '';
  var hoy = new Date().toLocaleDateString('es-MX', {day:'2-digit', month:'long', year:'numeric'});

  var css = [
    ':root{--navy:#0f2640;--navy2:#1a3a5c;--white:#fff;--surface:#f5f4f0;',
    '      --ink:#1a1a18;--ink2:#4a4a46;--ink3:#888880;--border:rgba(0,0,0,.1);',
    '      --teal:#0d9488;--teal-bg:#ccfbf1;}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    '     font-size:12px;color:#1a1a18;background:#fff;margin:0;padding:0;}',
    /* hide interactive elements */
    'button,input[type=search],.sort-ind{display:none!important;}',
    /* strip box-shadows for print */
    '*{box-shadow:none!important;}',
    /* tables */
    'table{border-collapse:collapse;width:100%;page-break-inside:auto;}',
    'tr{page-break-inside:avoid;}',
    'th,td{padding:5px 8px;}',
    /* card sections: keep border, remove white bg flash */
    'div[style*="border-radius:10px"]{border:1px solid #e2e8f0;break-inside:avoid;}',
    /* urgency chips keep color in print */
    '@media print{',
    '  @page{margin:15mm 12mm;size:A4;}',
    '  a[href]:after{content:none!important;}',
    '  .no-print{display:none;}',
    '}',
  ].join('');

  var header = '<div style="display:flex;justify-content:space-between;align-items:flex-start;'
    + 'margin-bottom:18px;padding-bottom:12px;border-bottom:2.5px solid #0f2640;">'
    + '<div>'
    + '<div style="font-size:18px;font-weight:800;color:#0f2640;">📊 Reporte Gerencial</div>'
    + '<div style="font-size:13px;font-weight:700;color:#1a3a5c;margin-top:2px;">' + empresa + '</div>'
    + '<div style="font-size:11px;color:#888880;margin-top:2px;">' + periodoLabel + ' · Generado el ' + hoy + '</div>'
    + '</div>'
    + '<img src="' + (document.querySelector('.logo-img, .logo, img[alt*="logo"]')?.src || '') + '" style="height:36px;opacity:.8;" onerror="this.style.display=\'none\'">'
    + '</div>';

  var html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
    + '<title>Reporte Gerencial — ' + empresa + '</title>'
    + '<style>' + css + '</style>'
    + '</head><body style="padding:16px;">'
    + header
    + contenido.innerHTML
    + '</body></html>';

  var w = window.open('', '_blank', 'width=960,height=750,menubar=yes');
  if (!w) { alert('Permite ventanas emergentes en tu navegador para exportar el PDF.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  w.onafterprint = function(){ w.close(); };
  setTimeout(function(){ w.print(); }, 600);
}

// ── Ordenamiento de columnas en tabla de trabajadores ──
var _trabSortCol = null, _trabSortDir = 1;
function ordenarTrabajadores(th) {
  var col = th.getAttribute('data-col');
  if (_trabSortCol === col) { _trabSortDir *= -1; } else { _trabSortCol = col; _trabSortDir = 1; }
  th.closest('thead').querySelectorAll('.sort-ind').forEach(function(s){ s.textContent = ''; });
  th.querySelector('.sort-ind').textContent = _trabSortDir === 1 ? ' ▲' : ' ▼';
  var tbody = th.closest('table').querySelector('tbody');
  if (!tbody) return;
  var rows = Array.from(tbody.querySelectorAll('tr.trab-row'));
  var isNum = col === 'antig';
  rows.sort(function(a, b) {
    var av = a.getAttribute('data-' + col) || '', bv = b.getAttribute('data-' + col) || '';
    if (isNum) return _trabSortDir * (Number(av) - Number(bv));
    return _trabSortDir * av.localeCompare(bv, 'es');
  });
  rows.forEach(function(r){ tbody.appendChild(r); });
}

// ── Filtro de búsqueda en tabla de trabajadores ──
function filtrarTrabajadores(q) {
  var term = q.toLowerCase().trim();
  document.querySelectorAll('.trab-row').forEach(function(tr) {
    var txt = (tr.getAttribute('data-search') || '').toLowerCase();
    tr.style.display = (!term || txt.indexOf(term) !== -1) ? '' : 'none';
  });
}

// ── Flujo guiado de terminación laboral ──
var _baja = { idx:-1, tipo:null, fecha:'', sal:0, paso:1 };

var BAJA_TIPOS = [
  {id:'renuncia',    icon:'✋', label:'Renuncia voluntaria',                        sub:'Art. 49 LFT — El trabajador decide retirarse',                          liq:false},
  {id:'rescision47', icon:'⚠️', label:'Rescisión sin responsabilidad del patrón',   sub:'Art. 47 LFT — Despido justificado por causa grave',                      liq:false},
  {id:'convenio',   icon:'🤝', label:'Convenio de terminación',                     sub:'Mutuo acuerdo entre patrón y trabajador',                                liq:false},
  {id:'termino',    icon:'📅', label:'Término de contrato',                         sub:'Vencimiento del plazo pactado',                                          liq:false},
  {id:'rescision51', icon:'🔴', label:'Rescisión sin responsabilidad del trabajador', sub:'Art. 51 LFT — El trabajador se va por falta del patrón → liquidación',  liq:true },
];

function _diasVacLFT(a){ if(a<=4) return 10+a*2; if(a<=5) return 20; if(a<=10) return 22; if(a<=15) return 24; if(a<=20) return 26; if(a<=25) return 28; if(a<=30) return 30; return 32; }

function abrirBajaWizard(idx) {
  var t = (window._repActivos || [])[idx];
  if (!t) return;
  _baja.idx   = idx;
  _baja.tipo  = null;
  _baja.paso  = 1;
  _baja.sal   = t.salario_diario || 0;
  _baja.fecha = new Date().toISOString().split('T')[0];
  document.getElementById('baja-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  bajaRender();
}

function cerrarBajaWizard() {
  document.getElementById('baja-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function bajaTrabajador() { return (window._repActivos || [])[_baja.idx] || {}; }

function bajaRender() {
  var t = bajaTrabajador();
  document.getElementById('baja-trab-nombre').textContent = t.nombre || '—';
  document.getElementById('baja-trab-puesto').textContent = t.puesto || '—';
  for (var i=1;i<=4;i++) {
    var el = document.getElementById('baja-step-'+i);
    el.className = 'baja-step'+(i===_baja.paso?' active':i<_baja.paso?' done':'');
  }
  var prevBtn = document.getElementById('baja-btn-prev');
  var nextBtn = document.getElementById('baja-btn-next');
  var finBtn  = document.getElementById('baja-btn-finish');
  prevBtn.style.display = _baja.paso > 1 ? '' : 'none';
  nextBtn.style.display = _baja.paso < 4 ? '' : 'none';
  finBtn.style.display  = _baja.paso === 4 ? '' : 'none';
  nextBtn.disabled      = _baja.paso === 1 && !_baja.tipo;
  nextBtn.style.opacity = nextBtn.disabled ? '.4' : '1';
  var steps = [null, bajaStep1, bajaStep2, bajaStep3, bajaStep4];
  document.getElementById('baja-content').innerHTML = steps[_baja.paso]();
}

function bajaStep1() {
  var html = '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:14px;">¿Cómo termina la relación laboral?</div>';
  BAJA_TIPOS.forEach(function(tipo) {
    var sel = _baja.tipo === tipo.id;
    html += '<div class="baja-tipo-card'+(sel?' sel':'')+'" onclick="selBajaTipo(\''+tipo.id+'\')">';
    html += '<span style="font-size:22px;flex-shrink:0;">'+tipo.icon+'</span>';
    html += '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:var(--navy);">'+tipo.label+'</div>';
    html += '<div style="font-size:11px;color:var(--ink3);margin-top:2px;">'+tipo.sub+'</div></div>';
    if (sel) html += '<span style="color:var(--navy);font-size:18px;flex-shrink:0;">✓</span>';
    html += '</div>';
  });
  return html;
}

function selBajaTipo(id) { _baja.tipo=id; bajaRender(); }

function bajaStep2() {
  var t = bajaTrabajador();
  var tipo = BAJA_TIPOS.find(function(x){return x.id===_baja.tipo;});
  var html = '<div style="background:var(--surface);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--navy2);">';
  html += tipo.icon+' <strong>'+tipo.label+'</strong></div>';
  html += '<label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:5px;">Fecha efectiva de baja</label>';
  html += '<input id="baja-fecha-in" type="date" value="'+_baja.fecha+'" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:14px;">';
  html += '<label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:5px;">Salario diario (MXN)</label>';
  html += '<input id="baja-sal-in" type="number" min="0" step="0.01" value="'+(_baja.sal||'')+'" placeholder="0.00" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;">';
  html += t.salario_diario
    ? '<div style="font-size:10px;color:var(--ink3);margin-top:4px;">Registrado en expediente: $'+t.salario_diario+'/día</div>'
    : '<div style="font-size:10px;color:#d97706;margin-top:4px;">⚠️ Sin salario registrado — ingrésalo para calcular prestaciones</div>';
  if (t.fecha_ingreso) {
    var ing = new Date(t.fecha_ingreso+'T12:00:00');
    var anios = ((new Date(_baja.fecha+'T12:00:00')-ing)/86400000/365).toFixed(1);
    html += '<div style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-top:16px;font-size:12px;color:#15803d;">';
    html += '📅 Ingreso: <strong>'+ing.toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})+'</strong> &nbsp;·&nbsp; <strong>'+anios+' años</strong> de servicio</div>';
  }
  return html;
}

function bajaCalculo() {
  var t = bajaTrabajador();
  var sal = _baja.sal || 0;
  if (!t.fecha_ingreso || !sal) return null;
  var ing     = new Date(t.fecha_ingreso+'T12:00:00');
  var fechaBaja = new Date(_baja.fecha+'T12:00:00');
  var diasTotales  = Math.floor((fechaBaja-ing)/86400000);
  var aniosTotales = diasTotales/365;
  var aniosCump    = Math.floor(aniosTotales);
  var ultimoAniv   = new Date(ing); ultimoAniv.setFullYear(fechaBaja.getFullYear());
  if (ultimoAniv > fechaBaja) ultimoAniv.setFullYear(fechaBaja.getFullYear()-1);
  var diasPeriodo  = Math.floor((fechaBaja-ultimoAniv)/86400000);
  var diasAnio     = 365;
  var diasVacPer   = _diasVacLFT(aniosCump+1);
  var vacProp      = (diasPeriodo/diasAnio)*diasVacPer;
  var vacImporte   = vacProp*sal;
  var primaVac     = vacImporte*0.25;
  var diaAnioIni   = new Date(fechaBaja.getFullYear(),0,1);
  var diasCalend   = Math.floor((fechaBaja-diaAnioIni)/86400000)+1;
  var aguinaldo    = (diasCalend/365)*15*sal;
  var subtotal     = vacImporte+primaVac+aguinaldo;
  var liq = null;
  var tipoObj = BAJA_TIPOS.find(function(x){return x.id===_baja.tipo;});
  if (tipoObj && tipoObj.liq) {
    var tresMeses  = 90*sal;
    var veinteDias = 20*aniosTotales*sal;
    liq = {tresMeses:tresMeses, veinteDias:veinteDias, total:tresMeses+veinteDias};
  }
  return {sal:sal,diasTotales:diasTotales,aniosTotales:aniosTotales,aniosCump:aniosCump,diasPeriodo:diasPeriodo,diasVacPer:diasVacPer,vacProp:vacProp,vacImporte:vacImporte,primaVac:primaVac,aguinaldo:aguinaldo,subtotal:subtotal,liq:liq,total:subtotal+(liq?liq.total:0)};
}

function bajaStep3() {
  var mxn = function(n){ return '$'+Math.round(n).toLocaleString('es-MX'); };
  var t    = bajaTrabajador();
  var tipo = BAJA_TIPOS.find(function(x){return x.id===_baja.tipo;});
  var calc = bajaCalculo();
  if (!t.fecha_ingreso) return '<div style="background:#fef3c7;border-radius:8px;padding:14px;color:#92400e;">⚠️ Este trabajador no tiene fecha de ingreso registrada. El cálculo no es posible.</div>';
  if (!calc) return '<div style="background:#fef3c7;border-radius:8px;padding:14px;color:#92400e;">⚠️ Ingresa el salario diario en el paso anterior para calcular las prestaciones.</div>';
  var row = function(lbl,val,bold){
    return '<tr style="border-bottom:1px solid var(--border);"><td style="padding:7px 10px;font-size:12px;'+(bold?'font-weight:700;':'')+'">'+lbl+'</td><td style="padding:7px 10px;font-size:12px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;'+(bold?'color:var(--navy);':'color:var(--ink2);')+'">'+val+'</td></tr>';
  };
  var html = '<div style="background:var(--surface);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:var(--ink3);">';
  html += tipo.icon+' <strong style="color:var(--navy);">'+tipo.label+'</strong>';
  html += ' &nbsp;·&nbsp; '+calc.aniosTotales.toFixed(1)+' años ('+calc.diasTotales+' días) &nbsp;·&nbsp; $'+calc.sal+'/día</div>';
  html += '<table style="width:100%;border-collapse:collapse;">';
  html += '<thead><tr><th style="text-align:left;padding:5px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Concepto</th><th style="text-align:right;padding:5px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);">Importe</th></tr></thead><tbody>';
  html += row('Vacaciones proporcionales ('+calc.vacProp.toFixed(1)+' días — Art. 76 LFT)', mxn(calc.vacImporte));
  html += row('Prima vacacional proporcional (25%)', mxn(calc.primaVac));
  html += row('Aguinaldo proporcional (Art. 87 LFT)', mxn(calc.aguinaldo));
  if (calc.liq) {
    html += row('3 meses de salario (Art. 50 LFT)', mxn(calc.liq.tresMeses));
    html += row('20 días × '+calc.aniosTotales.toFixed(1)+' años (Art. 50 LFT)', mxn(calc.liq.veinteDias));
  }
  html += row('TOTAL ESTIMADO', mxn(calc.total), true);
  html += '</tbody></table>';
  html += '<div style="font-size:10px;color:var(--ink3);margin-top:10px;line-height:1.5;">* Estimación. No incluye salarios pendientes, días de vacaciones anteriores no gozados, ni retenciones fiscales.</div>';
  return html;
}

function bajaStep4() {
  var t      = bajaTrabajador();
  var tipo   = BAJA_TIPOS.find(function(x){return x.id===_baja.tipo;});
  var calc   = bajaCalculo();
  var mxn    = function(n){ return '$'+Math.round(n).toLocaleString('es-MX'); };
  var params = new URLSearchParams({
    empresa:    clienteActual?.empresa||'', rfc: clienteActual?.rfc||'',
    trabajador: t.nombre||'', puesto: t.puesto||'',
    ingreso:    t.fecha_ingreso||'', nss: t.nss||'',
    salario:    String(_baja.sal||t.salario_diario||''),
    fecha_baja: _baja.fecha
  }).toString();
  var btnPri = 'display:block;width:100%;padding:11px 16px;margin-bottom:10px;background:var(--navy);color:#fff;border:none;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;text-align:left;';
  var btnSec = 'display:block;width:100%;padding:11px 16px;margin-bottom:10px;background:var(--white);color:var(--navy2);border:1.5px solid var(--border);border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;text-align:left;';
  var GEN_MAP = {
    renuncia:    [{lbl:'📤 Carta de renuncia', gen:'cartas-laborales.html', pri:true},{lbl:'💵 Finiquito', gen:'finiquito.html', pri:true},{lbl:'🧰 Resguardo de activos', gen:'asignacion-recursos.html', pri:false}],
    rescision47: [{lbl:'📝 Acta administrativa', gen:'acta-administrativa.html', pri:false},{lbl:'⚠️ Aviso de rescisión', gen:'aviso-rescision.html', pri:true},{lbl:'💵 Finiquito', gen:'finiquito.html', pri:true},{lbl:'🧰 Resguardo de activos', gen:'asignacion-recursos.html', pri:false}],
    convenio:    [{lbl:'🤝 Convenio económico', gen:'convenios-economicos.html', pri:true},{lbl:'💵 Finiquito', gen:'finiquito.html', pri:true}],
    termino:     [{lbl:'💵 Finiquito', gen:'finiquito.html', pri:true}],
    rescision51: [{lbl:'⚠️ Aviso de rescisión', gen:'aviso-rescision.html', pri:true},{lbl:'💵 Finiquito + Liquidación', gen:'aviso-rescision.html', pri:true}],
  };
  var gens = GEN_MAP[_baja.tipo] || [];
  var html = '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:5px;">Documentos a generar</div>';
  html += '<div style="font-size:11px;color:var(--ink3);margin-bottom:14px;">Los generadores se abrirán con los datos del trabajador prellenados.</div>';
  gens.forEach(function(g){
    html += '<button style="'+(g.pri?btnPri:btnSec)+'" onclick="window.open(\''+g.gen+'?'+params+'\',\'_blank\')">'+g.lbl+'</button>';
  });
  if (calc) {
    html += '<div style="background:var(--surface);border-radius:8px;padding:12px 14px;margin-top:6px;display:flex;justify-content:space-between;align-items:center;">';
    html += '<div style="font-size:12px;color:var(--ink3);">Total estimado de prestaciones</div>';
    html += '<div style="font-size:16px;font-weight:800;color:var(--navy);">'+mxn(calc.total)+'</div></div>';
  }
  return html;
}

function bajaWizardNext() {
  if (_baja.paso === 1 && !_baja.tipo) return;
  if (_baja.paso === 2) {
    var fi = document.getElementById('baja-fecha-in');
    var si = document.getElementById('baja-sal-in');
    if (fi) _baja.fecha = fi.value || _baja.fecha;
    if (si) _baja.sal   = parseFloat(si.value) || _baja.sal;
  }
  _baja.paso++;
  bajaRender();
}

function bajaWizardPrev() {
  if (_baja.paso > 1) { _baja.paso--; bajaRender(); }
}

// ── Integración AllSign ──────────────────────────────────────────────────────
var _allsign = { tipo: null, firmantes: [], archivoBase64: null, archivoNombre: null };

function abrirModalAllSign(tipo) {
  _allsign.tipo = tipo || 'documento';
  _allsign.firmantes = [];
  _allsign.archivoBase64 = null;
  _allsign.archivoNombre = null;

  var uploadSec = document.getElementById('allsign-upload-section');
  var subtitle  = document.getElementById('allsign-subtitle');
  if (tipo === 'upload') {
    uploadSec.style.display = '';
    if (subtitle) subtitle.textContent = 'Subir PDF existente · Powered by AllSign';
  } else {
    uploadSec.style.display = 'none';
    if (subtitle) subtitle.textContent = 'Reporte gerencial · Powered by AllSign';
  }

  // Limpiar input de archivo
  var fi = document.getElementById('allsign-file-input');
  if (fi) fi.value = '';
  var fl = document.getElementById('allsign-file-label');
  if (fl) fl.textContent = '📂 Haz clic para seleccionar un PDF';

  allsignMostrarForm();
  _allsign.firmantes = [];
  if (clienteActual) {
    _allsign.firmantes.push({ nombre: clienteActual.empresa || clienteActual.rfc || '', email: clienteActual.email || '' });
  } else {
    _allsign.firmantes.push({ nombre: '', email: '' });
  }
  allsignRenderFirmantes();
  document.getElementById('allsign-overlay').style.display = 'flex';
}

function cerrarModalAllSign() {
  document.getElementById('allsign-overlay').style.display = 'none';
}

function allsignMostrarForm() {
  document.getElementById('allsign-form').style.display = '';
  document.getElementById('allsign-sending').style.display = 'none';
  document.getElementById('allsign-success').style.display = 'none';
  document.getElementById('allsign-error').style.display = 'none';
  document.getElementById('allsign-footer').style.display = 'flex';
}

function allsignAgregarFirmante() {
  _allsign.firmantes.push({ nombre: '', email: '' });
  allsignRenderFirmantes();
}

function allsignRenderFirmantes() {
  var cont = document.getElementById('allsign-firmantes-list');
  if (!cont) return;
  cont.innerHTML = '';
  _allsign.firmantes.forEach(function(f, i) {
    var div = document.createElement('div');
    div.style.cssText = 'background:var(--surface);border-radius:8px;padding:12px;margin-bottom:8px;position:relative;';
    div.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--ink3);margin-bottom:8px;">Firmante ' + (i+1) + '</div>'
      + '<div style="display:grid;gap:6px;">'
      + '<input placeholder="Nombre completo *" value="' + esc(f.nombre) + '" oninput="_allsign.firmantes['+i+'].nombre=this.value" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;background:var(--white);width:100%;box-sizing:border-box;">'
      + '<input placeholder="Correo electrónico *" type="email" value="' + esc(f.email) + '" oninput="_allsign.firmantes['+i+'].email=this.value" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;background:var(--white);width:100%;box-sizing:border-box;">'
      + '</div>';
    if (_allsign.firmantes.length > 1) {
      var btn = document.createElement('button');
      btn.textContent = '✕';
      btn.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--ink3);';
      btn.onclick = (function(idx){ return function(){ _allsign.firmantes.splice(idx,1); allsignRenderFirmantes(); }; })(i);
      div.appendChild(btn);
    }
    cont.appendChild(div);
  });
}

function allsignArchivoSeleccionado(input) {
  var file = input.files && input.files[0];
  var label = document.getElementById('allsign-file-label');
  if (!file) { label.textContent = '📂 Haz clic para seleccionar un PDF'; return; }
  label.textContent = '📄 ' + file.name;
  _allsign.archivoNombre = file.name;
  var reader = new FileReader();
  reader.onload = function(e) { _allsign.archivoBase64 = e.target.result.split(',')[1]; };
  reader.readAsDataURL(file);
}

async function allsignEnviar() {
  var validos = _allsign.firmantes.filter(function(f){ return f.nombre.trim() && f.email.trim(); });
  if (validos.length === 0) { alert('Agrega al menos un firmante con nombre y correo.'); return; }

  document.getElementById('allsign-form').style.display = 'none';
  document.getElementById('allsign-footer').style.display = 'none';
  document.getElementById('allsign-sending').style.display = '';

  try {
    var pdfBase64, filename, tipo, folio;
    var hoy = new Date().toISOString().split('T')[0];

    if (_allsign.tipo === 'upload') {
      // Modo subida de archivo
      if (!_allsign.archivoBase64) throw new Error('Selecciona un archivo PDF primero.');
      pdfBase64 = _allsign.archivoBase64;
      filename  = _allsign.archivoNombre || ('Documento-' + hoy + '.pdf');
      tipo  = (document.getElementById('allsign-doc-tipo')?.value || '').trim() || 'documento';
      folio = (document.getElementById('allsign-doc-folio')?.value || '').trim() || ('DOC-' + hoy);
      document.getElementById('allsign-sending-msg').textContent = 'Enviando PDF a AllSign…';
    } else {
      // Modo reporte: generar PDF de #rep-contenido
      document.getElementById('allsign-sending-msg').textContent = 'Generando PDF y enviando a AllSign…';
      var contenido = document.getElementById('rep-contenido');
      if (!contenido) throw new Error('No hay contenido de reporte para generar el PDF.');
      var empresa = window._repEmpresa || window._repRFC || 'Empresa';
      filename = 'Reporte-' + empresa.replace(/\s+/g,'-') + '-' + hoy + '.pdf';
      tipo  = 'reporte_gerencial';
      folio = 'REP-' + hoy;

      var pdfBlob = await html2pdf().set({
        filename: filename,
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(contenido).outputPdf('blob');

      pdfBase64 = await new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(){ resolve(reader.result.split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });
    }

    var token = '';
    try {
      var sesResult = await sbAuth.auth.getSession();
      token = sesResult?.data?.session?.access_token || '';
    } catch(e) { console.error('allsign getSession:', e); }
    if (!token) throw new Error('Sesión expirada. Recarga la página.');

    var clienteRfc = (clienteActual?.rfc || _rfcReal || '').toUpperCase();

    var res = await fetch('/api/allsign-enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        pdf_base64:  pdfBase64,
        filename:    filename,
        tipo:        tipo,
        folio:       folio,
        firmantes:   validos.map(function(f){ return { nombre: f.nombre, email: f.email }; }),
        cliente_rfc: clienteRfc,
      }),
    });

    var data = await res.json();

    // Sin créditos → cerrar modal y mostrar diálogo de compra
    if (res.status === 402 || data.error === 'sin_creditos') {
      document.getElementById('modal-allsign').style.display = 'none';
      mostrarDialogoSinCreditos(data.saldo_actual || 0, data.requeridos || 1);
      return;
    }

    if (!res.ok || !data.ok) {
      var detMsg = '';
      if (data.detalle) {
        try { detMsg = ' — ' + (typeof data.detalle === 'string' ? data.detalle : JSON.stringify(data.detalle)); } catch(_) {}
      }
      throw new Error((data.error || 'Error al enviar a AllSign.') + detMsg);
    }

    document.getElementById('allsign-sending').style.display = 'none';
    document.getElementById('allsign-success').style.display = '';

    var resContainer = document.getElementById('allsign-firmantes-result');
    resContainer.innerHTML = (data.firmantes_con_id || []).map(function(f) {
      return '<div style="padding:10px 14px;background:var(--surface);border-radius:8px;font-size:12px;">'
        + '<div style="font-weight:700;color:var(--navy);">' + esc(f.nombre || f.email) + '</div>'
        + '<div style="color:var(--ink3);margin-top:2px;">' + esc(f.email) + '</div>'
        + '<div style="margin-top:6px;color:#166534;font-size:11px;">📧 Invitación enviada por AllSign</div>'
        + '</div>';
    }).join('');

    // Refrescar panel de firmas y créditos
    if (document.getElementById('panel-firmas')?.style.display !== 'none') {
      cargarMisFirmas(true);
    }
    cargarCreditosFirma();

  } catch(err) {
    document.getElementById('allsign-sending').style.display = 'none';
    document.getElementById('allsign-error').style.display = '';
    document.getElementById('allsign-error-msg').textContent = err.message || 'Error inesperado.';
  }
}
// ── Mis Firmas ──────────────────────────────────────────────────────────────
var _firmasLoaded = false;

async function cargarMisFirmas(force) {
  if (_firmasLoaded && !force) return;
  _firmasLoaded = true;
  var contenedor = document.getElementById('firmas-lista');
  if (!contenedor) return;
  contenedor.innerHTML = '<div style="text-align:center;padding:48px;color:var(--ink3);">Cargando…</div>';
  try {
    var rfc = clienteActual && clienteActual.rfc;
    if (!rfc) throw new Error('No se pudo identificar el RFC del cliente.');
    var { data, error } = await sbAuth
      .from('firmas_electronicas')
      .select('*')
      .eq('cliente_rfc', rfc)
      .order('timestamp_servidor', { ascending: false });
    if (error) throw error;
    renderFirmas(data || []);
  } catch (err) {
    contenedor.innerHTML = '<div style="text-align:center;padding:48px;color:var(--error);">Error al cargar firmas: ' + esc(err.message) + '</div>';
  }
}

function renderFirmas(rows) {
  var contenedor = document.getElementById('firmas-lista');
  if (!rows.length) {
    contenedor.innerHTML = '<div class="card" style="text-align:center;padding:48px;color:var(--ink3);">'
      + '<div style="font-size:32px;margin-bottom:12px;">✍️</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--navy2);">Sin documentos enviados todavía</div>'
      + '<div style="font-size:12px;margin-top:4px;">Usa "Subir PDF para firma" o el botón "Firmar con AllSign" en Reportes gerenciales.</div>'
      + '</div>';
    return;
  }
  var estadoColor = { pendiente: '#d97706', firmado: '#166534', rechazado: '#dc2626', expirado: '#6b7280', eliminado: '#6b7280' };
  var estadoBg    = { pendiente: '#fef3c7', firmado: '#dcfce7', rechazado: '#fee2e2', expirado: '#f3f4f6', eliminado: '#f3f4f6' };

  contenedor.innerHTML = rows.map(function(r) {
    var firmantes = Array.isArray(r.firmantes) ? r.firmantes : [];
    var estado = r.allsign_estado || r.estado || 'pendiente';
    var fecha = r.timestamp_servidor ? new Date(r.timestamp_servidor).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    var firmanteHtml = firmantes.map(function(f) {
      var icono = f.firmado ? '✅' : '⏳';
      return '<div style="font-size:11px;color:var(--ink2);padding:2px 0;">'
        + icono + ' ' + esc(f.nombre || f.email) + ' <span style="color:var(--ink3);">(' + esc(f.email) + ')</span></div>';
    }).join('');
    var descargas = '';
    if (estado === 'firmado' && r.allsign_id) {
      // Descarga directa desde AllSign vía proxy (evita archivos corruptos en Supabase)
      descargas += '<button onclick="descargarFirmaAllSign(\'' + esc(r.allsign_id) + '\',\'' + esc(r.cliente_rfc) + '\',this)" '
        + 'class="btn btn-outline" style="font-size:11px;padding:4px 10px;">📄 Descargar PDF</button> ';
    } else if (r.signed_pdf_path) {
      descargas += '<button onclick="descargarFirma(\'' + r.signed_pdf_path.replace(/'/g,"\'") + '\',\'pdf\')" '
        + 'class="btn btn-outline" style="font-size:11px;padding:4px 10px;">📄 Descargar PDF</button> ';
    }
    if (estado === 'pendiente' && r.allsign_id) {
      descargas += '<button onclick="resyncFirma(\'' + esc(r.allsign_id) + '\',\'' + esc(r.cliente_rfc) + '\',this)" '
        + 'class="btn btn-outline" style="font-size:11px;padding:4px 10px;">↻ Sincronizar estado</button>';
    }
    return '<div class="card" style="margin-bottom:10px;">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;">'
      + '<div>'
      + '<div style="font-weight:700;color:var(--navy);font-size:13px;">'
        + esc(r.documento_tipo || 'Documento') + (r.documento_folio ? ' — ' + esc(r.documento_folio) : '') + '</div>'
      + '<div style="font-size:11px;color:var(--ink3);margin-top:2px;">' + fecha + (r.folio_firma ? ' · Folio ' + esc(r.folio_firma) : '') + '</div>'
      + '</div>'
      + '<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;'
        + 'color:' + (estadoColor[estado]||'#374151') + ';background:' + (estadoBg[estado]||'#f3f4f6') + ';">'
        + estado.charAt(0).toUpperCase() + estado.slice(1) + '</span>'
      + '</div>'
      + (firmanteHtml ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">' + firmanteHtml + '</div>' : '')
      + (descargas ? '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' + descargas + '</div>' : '')
      + '</div>';
  }).join('');
}

async function descargarFirma(path, ext) {
  try {
    var { data, error } = await sbAuth.storage.from('expedientes').createSignedUrl(path, 300);
    if (error) throw error;
    var a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = path.split('/').pop() || ('firma.' + ext);
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    alert('Error al descargar: ' + err.message);
  }
}
async function descargarFirmaAllSign(allsignId, clienteRfc, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Descargando…'; }
  try {
    var sesResult = await sbAuth.auth.getSession();
    var token = sesResult?.data?.session?.access_token || '';
    if (!token) throw new Error('Sesión expirada.');
    var url = '/api/allsign-download?allsign_id=' + encodeURIComponent(allsignId)
      + '&cliente_rfc=' + encodeURIComponent(clienteRfc);
    var res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) {
      var errData = await res.json().catch(() => ({}));
      console.error('[allsign-download] debug completo:', JSON.stringify(errData, null, 2));
      var debugStr = JSON.stringify(errData.debug || errData, null, 2);
      var msg = 'Error al descargar PDF firmado.\n\n'
        + 'Diagnóstico AllSign:\n' + debugStr.slice(0, 1200)
        + (debugStr.length > 1200 ? '\n...(ver consola para detalle completo)' : '');
      alert(msg);
      return;
    }
    var blob = await res.blob();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'firma-' + allsignId + '.pdf';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
  } catch (err) {
    alert('Error al descargar: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Descargar PDF'; }
  }
}

async function resyncFirma(allsignId, clienteRfc, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando…'; }
  try {
    var sesResult = await sbAuth.auth.getSession();
    var token = sesResult?.data?.session?.access_token || '';
    if (!token) throw new Error('Sesión expirada.');
    var res = await fetch('/api/allsign-resync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ allsign_id: allsignId, cliente_rfc: clienteRfc }),
    });
    var data = await res.json();
    console.log('[allsign-resync] respuesta:', JSON.stringify(data));
    if (!res.ok) throw new Error(data.error || 'Error al sincronizar.');
    await cargarMisFirmas(true);
  } catch (err) {
    alert('Error al sincronizar: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = '↻ Sincronizar estado'; }
  }
}
// ── Créditos de firma electrónica ────────────────────────────────────────────

async function cargarCreditosFirma() {
  var rfc = clienteActual && clienteActual.rfc;
  if (!rfc) return;
  try {
    var sesResult = await sbAuth.auth.getSession();
    var token = sesResult?.data?.session?.access_token || '';
    if (!token) return;
    var res = await fetch('/api/firmas-creditos?cliente_rfc=' + encodeURIComponent(rfc), {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return;
    var data = await res.json();
    var saldo = data.saldo ?? 0;
    // Actualizar número en el panel
    var numEl = document.getElementById('firmas-saldo-num');
    if (numEl) numEl.textContent = saldo;
    // Badge en sidebar
    var badge = document.getElementById('sb-firmas-creditos-badge');
    if (badge) {
      badge.textContent = saldo;
      badge.style.display = saldo > 0 ? '' : 'none';
    }
  } catch (e) { console.warn('[creditos-firma]', e.message); }
}

async function comprarCreditosFirma(paquete) {
  var rfc = clienteActual && clienteActual.rfc;
  if (!rfc) { alert('No se identificó el RFC.'); return; }
  try {
    var sesResult = await sbAuth.auth.getSession();
    var token = sesResult?.data?.session?.access_token || '';
    if (!token) throw new Error('Sesión expirada.');
    var res = await fetch('/api/firmas-creditos-compra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ paquete, cliente_rfc: rfc }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar pago.');
    if (data.url) window.location.href = data.url;
  } catch (e) {
    alert('Error al procesar pago: ' + e.message);
  }
}

function mostrarDialogoSinCreditos(saldoActual, requeridos) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  var box = document.createElement('div');
  box.style.cssText = 'background:var(--bg,#fff);border-radius:16px;padding:28px;max-width:400px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.18);';
  box.innerHTML = '<div style="font-size:32px;margin-bottom:8px;">✍️</div>'
    + '<div style="font-size:18px;font-weight:800;color:var(--navy,#1a3a5c);margin-bottom:6px;">Créditos insuficientes</div>'
    + '<div style="font-size:13px;color:var(--ink3,#666);margin-bottom:20px;">'
    + 'Tiene <strong>' + saldoActual + '</strong> crédito(s) y necesita <strong>' + requeridos + '</strong> para enviar este documento.</div>'
    + '<div style="display:flex;flex-direction:column;gap:10px;">'
    + '<button onclick="this.closest(\'div[data-cl-overlay]\').remove();comprarCreditosFirma(\'unitaria\')" '
    + 'style="background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;">➕ 1 firma — $89 MXN</button>'
    + '<button onclick="this.closest(\'div[data-cl-overlay]\').remove();comprarCreditosFirma(\'paquete6\')" '
    + 'style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;">📦 6 firmas — $350 MXN</button>'
    + '<a href="https://wa.me/5213339263817?text=Hola%2C%20necesito%20m%C3%A1s%20cr%C3%A9ditos%20de%20firma%20electr%C3%B3nica" target="_blank" rel="noopener" '
    + 'style="display:block;text-align:center;color:#25d366;font-size:13px;font-weight:600;padding:6px;">💬 Más firmas — WhatsApp</a>'
    + '<button onclick="this.closest(\'div[data-cl-overlay]\').remove()" '
    + 'style="background:none;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:10px;font-size:13px;cursor:pointer;color:var(--ink3,#666);">Cancelar</button>'
    + '</div>';
  overlay.setAttribute('data-cl-overlay', '1');
  overlay.appendChild(box);
  // Cerrar al clic en overlay
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── Fin AllSign ──────────────────────────────────────────────────────────────
