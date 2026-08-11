/* ── Meta Pixel ── */
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '772478098942349');
fbq('track', 'PageView');

/* ── WhatsApp number ── */
const WHATSAPP_NUMERO = '5213339263817';

/* ── Modal contacto ── */
function abrirContacto(origen) {
  const textos = {
    'CTA final':       'Hola, quiero el diagnóstico gratuito de ClickLaboral.mx',
    'Calculadora ROI': 'Hola, vi la calculadora de ClickLaboral.mx y me interesa saber mi ahorro potencial',
    'Empresa grande':  'Hola, tenemos más de 500 trabajadores y necesitamos un plan a medida de ClickLaboral.mx',
    'Consulta desde nav': 'Hola, quiero el diagnóstico gratuito de ClickLaboral.mx',
  };
  const msg = textos[origen] || 'Hola, me interesa ClickLaboral.mx';
  if (typeof fbq === 'function') fbq('track', 'Contact', {content_name: origen || 'WhatsApp'});
  window.open('https://wa.me/' + WHATSAPP_NUMERO + '?text=' + encodeURIComponent(msg), '_blank');
}

function cerrarContacto() {
  document.getElementById('modal-contacto').style.display = 'none';
}

function enviarContacto() {
  const nombre  = document.getElementById('f-nombre').value.trim();
  const empresa = document.getElementById('f-empresa').value.trim();
  const email   = document.getElementById('f-email').value.trim();
  const tel     = document.getElementById('f-tel').value.trim();
  const trab    = document.getElementById('f-trab').value;
  const plan    = document.getElementById('f-plan').value;
  const mensaje = document.getElementById('f-mensaje').value.trim();
  if (!nombre || !empresa || !email) { alert('Por favor complete nombre, empresa y email'); return; }

  if (typeof fbq === 'function') {
    fbq('track', 'Lead', { content_name: plan || 'Contacto general', value: 0, currency: 'MXN' });
  }

  const texto = `Hola, soy ${nombre} de ${empresa}.\nEmail: ${email}${tel ? '\nTeléfono: ' + tel : ''}\nTrabajadores: ${trab || 'no especificado'}\nPlan de interés: ${plan}${mensaje ? '\n\nMensaje: ' + mensaje : ''}`;
  window.open(`https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(texto)}`, '_blank');

  const btn = document.querySelector('.modal-submit');
  btn.textContent = '✓ Abriendo WhatsApp...';
  btn.style.background = 'var(--green)';
  setTimeout(() => {
    cerrarContacto();
    btn.textContent = 'Solicitar diagnóstico gratuito →';
    btn.style.background = '';
  }, 1500);
}

/* ── Menú móvil ── */
function toggleNavMobile() {
  const links  = document.getElementById('nav-links');
  const abierto = links.classList.toggle('open');
  document.getElementById('burger-line-1').style.transform = abierto ? 'translateY(7px) rotate(45deg)' : 'none';
  document.getElementById('burger-line-2').style.opacity   = abierto ? '0' : '1';
  document.getElementById('burger-line-3').style.transform = abierto ? 'translateY(-7px) rotate(-45deg)' : 'none';
  document.body.style.overflow = abierto ? 'hidden' : '';
}

function cerrarNavMobile() {
  const links = document.getElementById('nav-links');
  if (!links.classList.contains('open')) return;
  links.classList.remove('open');
  document.getElementById('burger-line-1').style.transform = 'none';
  document.getElementById('burger-line-2').style.opacity   = '1';
  document.getElementById('burger-line-3').style.transform = 'none';
  document.body.style.overflow = '';
}

/* ── FAQ ── */
function toggleFaq(el) {
  el.closest('.faq-item').classList.toggle('open');
}

/* ── Calculadora ROI ── */
function planPorTrabajadores(trab) {
  if (trab <= 15)  return {nombre: 'Plan Micro',   precio: 899};
  if (trab <= 50)  return {nombre: 'Plan PyME',    precio: 1999};
  if (trab <= 150) return {nombre: 'Plan Mediana', precio: 4499};
  return {nombre: 'Plan Empresa', precio: 9999};
}

function calcROI() {
  const trab = parseInt(document.getElementById('c-trab').value);
  const sal  = parseInt(document.getElementById('c-sal').value);
  const rot  = parseInt(document.getElementById('c-rot').value);
  document.getElementById('c-trab-val').textContent = trab + ' trabajadores';
  document.getElementById('c-sal-val').textContent  = '$' + sal.toLocaleString('es-MX') + ' MXN';
  document.getElementById('c-rot-val').textContent  = rot + '% anual';
  const rotan    = Math.round(trab * rot / 100);
  const riesgo   = rotan * sal * 3;
  const planta   = sal >= 25000 ? 20000 * 12 : 12000 * 12;
  const planInfo = planPorTrabajadores(trab);
  const plan     = planInfo.precio * 12;
  document.getElementById('r-rotan').textContent     = rotan;
  document.getElementById('r-riesgo').textContent    = '$' + riesgo.toLocaleString('es-MX');
  document.getElementById('r-planta').textContent    = '$' + planta.toLocaleString('es-MX');
  document.getElementById('r-plan-label').textContent = 'Costo ' + planInfo.nombre + ' (anual)';
  document.getElementById('r-plan').textContent      = '$' + plan.toLocaleString('es-MX');
  document.getElementById('r-ahorro').textContent    = '$' + Math.max(0, Math.min(riesgo, planta) - plan).toLocaleString('es-MX');
  document.getElementById('r-factor').textContent    = (plan > 0 ? (riesgo / plan) : 0).toFixed(1) + '×';
}

/* ── Ticket modal ── */
function abrirTicketModal(e) { if (e) e.stopPropagation(); document.getElementById('ticketModal').classList.add('open'); document.body.style.overflow = 'hidden'; }
function cerrarTicketModal() { document.getElementById('ticketModal').classList.remove('open'); document.body.style.overflow = ''; }

/* ── Wire up all event listeners once DOM is ready ── */
document.addEventListener('DOMContentLoaded', function () {

  /* Menú hamburguesa */
  document.getElementById('nav-burger').addEventListener('click', toggleNavMobile);

  /* Cierra menú al navegar */
  document.querySelectorAll('.nav-links a, .nav-links button').forEach(function (el) {
    el.addEventListener('click', cerrarNavMobile);
  });

  /* Nav CTA móvil → WhatsApp */
  var navCtaMobile = document.querySelector('.nav-links-mobile .nav-cta');
  if (navCtaMobile) navCtaMobile.addEventListener('click', function () { abrirContacto('Consulta desde nav'); });

  /* Ticket info buttons → event delegation en el documento */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.ticket-info-btn');
    if (btn) abrirTicketModal(e);
  });

  /* Empresa grande link */
  document.querySelectorAll('[data-wa-origen]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      abrirContacto(el.dataset.waOrigen);
    });
  });

  /* Calculadora sliders */
  ['c-trab', 'c-sal', 'c-rot'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', calcROI);
  });

  /* Calculadora CTA button */
  var calcBtn = document.querySelector('[data-wa-calc]');
  if (calcBtn) calcBtn.addEventListener('click', function () { abrirContacto('Calculadora ROI'); });

  /* FAQ — event delegation */
  document.addEventListener('click', function (e) {
    var q = e.target.closest('.faq-q');
    if (q) toggleFaq(q);
  });

  /* Modal contacto — cerrar al hacer clic en el overlay */
  var modalOverlay = document.getElementById('modal-contacto');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) cerrarContacto();
    });
  }

  /* Modal contacto — botones */
  var closeBtn = document.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', cerrarContacto);

  var submitBtn = document.querySelector('.modal-submit');
  if (submitBtn) submitBtn.addEventListener('click', enviarContacto);

  /* Ticket modal — cerrar al hacer clic en el overlay */
  var ticketOverlay = document.getElementById('ticketModal');
  if (ticketOverlay) {
    ticketOverlay.addEventListener('click', function (e) {
      if (e.target === ticketOverlay) cerrarTicketModal();
    });
  }

  /* Ticket modal — botón cerrar */
  var tmCloseBtn = document.querySelector('.tm-close-btn');
  if (tmCloseBtn) tmCloseBtn.addEventListener('click', cerrarTicketModal);

  /* Escape key */
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarTicketModal(); });

  /* Scroll reveal — IntersectionObserver */
  (function () {
    var sel = '.section-label,.section-title,.section-sub,.feature-card,.risk-card,.step,.precio-card,.faq-item,.doc-showcase,.service-item,.hero-eyebrow,.hero h1,.hero-sub,.hero-ctas,.hero-trust > *,.cta-final h2,.cta-final p,.calc-inner';
    var els = Array.prototype.slice.call(document.querySelectorAll(sel));
    els.forEach(function (e) { e.classList.add('reveal-init'); });
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });
    els.forEach(function (e) { io.observe(e); });
  })();

  /* WA link tracking */
  document.querySelectorAll('a[href*="wa.me"]').forEach(function (el) {
    el.addEventListener('click', function () {
      if (typeof fbq === 'function') fbq('track', 'Contact', {content_name: 'WhatsApp click'});
    });
  });

  /* Initial calc render */
  calcROI();
});
