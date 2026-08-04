// edicion-libre.js
// Opción B: Edición libre de la vista previa con bloqueo del render automático.
// Incluir DESPUÉS de que el documento defina render() y doc-preview.
// Compatible con todos los generadores de Clicklaboral.

(function () {

  let modoEdicion = false;

  // ── Inyectar botón en la barra superior ──────────────────────────────────
  function inyectarBoton() {
    const acciones = document.querySelector('.header-actions');
    if (!acciones || document.getElementById('btn-edicion-libre')) return;

    const btn = document.createElement('button');
    btn.id = 'btn-edicion-libre';
    btn.className = 'btn btn-outline';
    btn.style.cssText = 'gap:6px;';
    btn.innerHTML = '✏️ Editar libremente';
    btn.onclick = toggleEdicion;

    // Insertar antes del botón de imprimir
    const btnImprimir = acciones.querySelector('button:last-child');
    acciones.insertBefore(btn, btnImprimir);
  }

  // ── Activar / desactivar modo edición ───────────────────────────────────
  function toggleEdicion() {
    const preview = document.getElementById('doc-preview');
    const btn     = document.getElementById('btn-edicion-libre');
    if (!preview || !btn) return;

    modoEdicion = !modoEdicion;

    if (modoEdicion) {
      // Activar: el div se vuelve editable y se bloquea render()
      preview.contentEditable = 'true';
      preview.style.outline   = '2px dashed #0f766e';
      preview.style.cursor    = 'text';
      btn.innerHTML  = '🔄 Restaurar campos';
      btn.style.background = '#f0fdf4';
      btn.style.borderColor = '#0f766e';
      btn.style.color = '#0f766e';
      // Mostrar aviso
      mostrarAviso(preview);
    } else {
      // Desactivar: volver al modo automático y re-renderizar
      preview.contentEditable = 'false';
      preview.style.outline   = '';
      preview.style.cursor    = '';
      btn.innerHTML  = '✏️ Editar libremente';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
      quitarAviso();
      if (typeof render === 'function') render();
    }
  }

  // ── Aviso flotante dentro del doc ───────────────────────────────────────
  function mostrarAviso(preview) {
    const aviso = document.createElement('div');
    aviso.id = 'aviso-edicion-libre';
    aviso.style.cssText = [
      'position:sticky','top:0','z-index:10','background:#f0fdf4',
      'border-bottom:1px solid #86efac','padding:8px 14px',
      'font-size:11px','color:#166534','display:flex',
      'justify-content:space-between','align-items:center',
    ].join(';');
    aviso.innerHTML = `
      <span>✏️ <strong>Modo edición libre activo</strong> — haz clic sobre cualquier parte del documento y edita directo.
      Los cambios en los campos del formulario izquierdo no afectarán la vista.</span>
      <button onclick="document.getElementById('btn-edicion-libre').click()"
        style="border:1px solid #86efac;background:#dcfce7;color:#166534;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;margin-left:10px;">
        🔄 Restaurar campos
      </button>`;
    preview.insertBefore(aviso, preview.firstChild);
  }

  function quitarAviso() {
    const aviso = document.getElementById('aviso-edicion-libre');
    if (aviso) aviso.remove();
  }

  // ── Interceptar render() para bloquear cuando está en modo edición ───────
  // Esperar a que el documento defina render() y luego envolverla
  function interceptarRender() {
    if (typeof render !== 'function') {
      setTimeout(interceptarRender, 100);
      return;
    }
    const renderOriginal = render;
    window.render = function (...args) {
      if (modoEdicion) return; // bloquear si está en modo edición
      return renderOriginal.apply(this, args);
    };
  }

  // ── Interceptar window.print() para imprimir el HTML editado ─────────────
  // No necesita intercepción: window.print() imprime el DOM tal como está,
  // incluyendo los cambios manuales del contenteditable.

  // ── Guardar en expediente: usar innerHTML del doc (ya incluye cambios) ────
  // Los helpers de expediente-helper.js y guardarDoc() ya leen doc-preview.innerHTML,
  // así que funciona automáticamente.

  // ── Init ────────────────────────────────────────────────────────────────
  function init() {
    // Esperar a que el DOM cargue y el header-actions exista
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { inyectarBoton(); interceptarRender(); });
    } else {
      inyectarBoton();
      interceptarRender();
    }
  }

  init();

})();
