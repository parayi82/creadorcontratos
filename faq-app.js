// ════════════════════════════════════════════════════════
// CONFIGURACIÓN — cambiar aquí cuando tengas el número real
// ════════════════════════════════════════════════════════
// TODO: cambiar por el número real de WhatsApp Business del despacho
// Formato: código de país + número, sin espacios, sin signos (+, -)
// Ejemplo real: '5213312345678' (52 = México, 1 = celular, resto el número)
const WHATSAPP_NUMERO = '5213339263817';

const WHATSAPP_MENSAJE_DEFAULT = 'Hola, tengo una consulta legal laboral que no encontré en la base de preguntas frecuentes.';

function linkWhatsApp(mensaje) {
  const texto = encodeURIComponent(mensaje || WHATSAPP_MENSAJE_DEFAULT);
  return `https://wa.me/${WHATSAPP_NUMERO}?text=${texto}`;
}

// ════════════════════════════════════════════════════════
// PLAN DEL CLIENTE — WhatsApp directo está incluido en los
// 2 planes vigentes (Estándar, Pro) + Básico legacy, sin gating por nivel.
// ════════════════════════════════════════════════════════
const urlParams = new URLSearchParams(window.location.search);
const planCliente = (urlParams.get('plan') || 'Estándar').trim();
const tieneWhatsAppDirecto = true;

function renderBotonWhatsApp(mensaje, claseExtra) {
  return `<a class="wa-btn ${claseExtra||''}" href="${linkWhatsApp(mensaje)}" target="_blank">💬 Escribir por WhatsApp</a>`;
}

function mostrarUpgradeWhatsApp() {
  document.getElementById('upgrade-modal').style.display = 'flex';
}
function cerrarUpgradeModal() {
  document.getElementById('upgrade-modal').style.display = 'none';
}

// ════════════════════════════════════════════════════════
// ESTADO
// ════════════════════════════════════════════════════════
let categoriaActual = 'todas';
let busquedaActual = '';

const NOMBRES_CATEGORIA = {
  todas: 'Todas las preguntas',
  contratos: 'Contratos',
  rescision: 'Rescisión y despido',
  liquidacion: 'Liquidación y finiquito',
  jornada: 'Jornada y descansos',
  salario: 'Salario y prestaciones',
  imss: 'IMSS y seguridad social',
  noms: 'NOMs y seguridad',
  reglamento: 'Reglamento interior',
  actas: 'Actas administrativas',
  especiales: 'Modalidades especiales',
  stps: 'STPS e inspecciones',
};

// ════════════════════════════════════════════════════════
// INIT — contar preguntas por categoría
// ════════════════════════════════════════════════════════
function actualizarContadores() {
  document.getElementById('count-todas').textContent = FAQ_DATA.length;
  Object.keys(NOMBRES_CATEGORIA).forEach(cat => {
    if (cat === 'todas') return;
    const count = FAQ_DATA.filter(f => f.cat === cat).length;
    const el = document.getElementById('count-' + cat);
    if (el) el.textContent = count;
  });
}

// ════════════════════════════════════════════════════════
// NAVEGACIÓN POR CATEGORÍA
// ════════════════════════════════════════════════════════
function setCategoria(cat, el) {
  categoriaActual = cat;
  busquedaActual = '';
  document.getElementById('search-input').value = '';
  document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('main-title').textContent = NOMBRES_CATEGORIA[cat];
  document.getElementById('main-sub').textContent = cat === 'todas'
    ? 'Base de conocimiento legal laboral — respuestas verificadas conforme a la LFT vigente'
    : `${FAQ_DATA.filter(f => f.cat === cat).length} preguntas en esta categoría`;
  document.getElementById('search-info').style.display = 'none';
  render();
}

// ════════════════════════════════════════════════════════
// BÚSQUEDA
// ════════════════════════════════════════════════════════
function normalizar(txt) {
  return txt.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita acentos
}

function buscar(texto) {
  busquedaActual = texto.trim();
  if (busquedaActual) {
    document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
    document.querySelector('.cat-item[onclick*="todas"]').classList.add('active');
    categoriaActual = 'todas';
  }
  render();
}

function filtrarPreguntas() {
  let resultado = FAQ_DATA;

  if (categoriaActual !== 'todas') {
    resultado = resultado.filter(f => f.cat === categoriaActual);
  }

  if (busquedaActual) {
    const q = normalizar(busquedaActual);
    resultado = resultado.filter(f =>
      normalizar(f.q).includes(q) || normalizar(f.a).includes(q)
    );
  }

  return resultado;
}

// ════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════
function render() {
  const resultados = filtrarPreguntas();
  const cont = document.getElementById('faq-list');
  const searchInfo = document.getElementById('search-info');

  if (busquedaActual) {
    searchInfo.style.display = 'block';
    searchInfo.textContent = `${resultados.length} resultado(s) para "${busquedaActual}"`;
    document.getElementById('main-title').textContent = 'Resultados de búsqueda';
  }

  if (resultados.length === 0) {
    cont.innerHTML = renderSinResultados();
    return;
  }

  cont.innerHTML = resultados.map((f, idx) => `
    <div class="faq-item" id="faq-${idx}">
      <div class="faq-q" onclick="toggleFaq(${idx})">
        <div>
          <div class="faq-tag-cat">${NOMBRES_CATEGORIA[f.cat] || f.cat}</div>
          <div>${f.q}</div>
        </div>
        <span class="faq-chevron">▼</span>
      </div>
      <div class="faq-a">
        ${f.a}
        <div class="faq-inline-wa">
          <div class="faq-inline-wa-text">¿Su situación es distinta o necesita asesoría sobre su caso específico?</div>
          ${renderBotonWhatsApp('Hola, tengo una duda relacionada con: \"' + f.q + '\"', 'wa-btn-small')}
        </div>
      </div>
    </div>
  `).join('');
}

function renderSinResultados() {
  const mensaje = busquedaActual
    ? `Hola, busqué información sobre "${busquedaActual}" en la base de preguntas frecuentes y no encontré una respuesta. ¿Podrían ayudarme?`
    : WHATSAPP_MENSAJE_DEFAULT;

  return `
  <div class="empty-results">
    <div class="empty-icon">🔍</div>
    <div class="empty-title">No encontramos una respuesta exacta</div>
    <div class="empty-sub">Su pregunta puede requerir análisis de su caso particular. Un abogado de nuestro equipo puede ayudarle directamente por WhatsApp.</div>
    <div class="wa-cta">
      <div class="wa-cta-header">
        <div class="wa-icon">💬</div>
        <div>
          <div class="wa-title">Hable con un abogado ahora</div>
        </div>
      </div>
      <div class="wa-time-badge">⚡ Respuesta casi inmediata · máximo 24 horas</div>
      <div class="wa-sub">Nuestro equipo legal atiende consultas por WhatsApp en horario hábil con tiempo de respuesta casi inmediato. Como máximo, su consulta será atendida dentro de las próximas 24 horas.</div>
      ${renderBotonWhatsApp(mensaje)}
    </div>
  </div>`;
}

function toggleFaq(idx) {
  const item = document.getElementById('faq-' + idx);
  const wasOpen = item.classList.contains('open');
  // Cerrar todas las demás (acordeón) — opcional, se puede quitar para permitir varias abiertas
  item.classList.toggle('open');
}

// ════════════════════════════════════════════════════════
// CALCULADORAS INLINE (lógica fija, sin IA)
// ════════════════════════════════════════════════════════
function calcIndemnizacion90() {
  const salario = parseFloat(document.getElementById('calc-ind90-salario')?.value) || 0;
  const total = salario * 90;
  const box = document.getElementById('calc-ind90-resultado');
  if (salario > 0) {
    box.style.display = 'block';
    document.getElementById('calc-ind90-total').textContent = '$' + total.toLocaleString('es-MX', {minimumFractionDigits:2});
  } else {
    box.style.display = 'none';
  }
}

const SMG_REFERENCIA = 278.80;

function calcPrimaAntiguedad() {
  const salario = parseFloat(document.getElementById('calc-prima-salario')?.value) || 0;
  const anios = parseFloat(document.getElementById('calc-prima-anios')?.value) || 0;
  const tope = SMG_REFERENCIA * 2;
  const salarioAplicado = Math.min(salario, tope);
  const total = salarioAplicado * 12 * anios;
  const box = document.getElementById('calc-prima-resultado');
  if (salario > 0 && anios > 0) {
    box.style.display = 'block';
    document.getElementById('calc-prima-salario-aplicado').textContent = '$' + salarioAplicado.toLocaleString('es-MX', {minimumFractionDigits:2}) + (salario > tope ? ' (con tope aplicado)' : '');
    document.getElementById('calc-prima-total').textContent = '$' + total.toLocaleString('es-MX', {minimumFractionDigits:2});
  } else {
    box.style.display = 'none';
  }
}

// ════════════════════════════════════════════════════════
// BOTÓN DE WHATSAPP EN EL HEADER
// ════════════════════════════════════════════════════════
document.getElementById('wa-header-btn').addEventListener('click', () => {
  window.open(linkWhatsApp(WHATSAPP_MENSAJE_DEFAULT), '_blank');
});

// ════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════
actualizarContadores();
render();
