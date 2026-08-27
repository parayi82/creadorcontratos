/**
 * form-persist.js — lightweight localStorage form persistence
 *
 * Usage:
 *   FormPersist.init({
 *     key: 'ley_silla',           // unique key for this page (required)
 *     rfc: rfcURL || '',          // RFC for multi-tenant isolation (optional)
 *     extra: {                    // hook for non-field state (e.g. dynamic arrays)
 *       save: () => JSON.stringify(puestos),
 *       restore: (raw) => { puestos = JSON.parse(raw); pintarPuestos(); }
 *     },
 *     afterRestore: () => render() // called once after state is restored
 *   });
 */
(function (global) {
  'use strict';

  const DEBOUNCE_MS = 1400;
  let _cfg = null;
  let _timer = null;
  let _indicator = null;

  function storageKey() {
    return `cl_fp_${_cfg.key}_${_cfg.rfc || 'anon'}`;
  }

  // ── collect all form field values ────────────────────────────────────────
  function collectFields() {
    const state = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
      if (!el.id) return;
      if (el.type === 'radio') {
        // handled separately by name
        return;
      }
      if (el.type === 'checkbox') {
        state[el.id] = el.checked;
      } else {
        state[el.id] = el.value;
      }
    });
    // radio groups — save by name
    const seen = new Set();
    document.querySelectorAll('input[type="radio"]').forEach(el => {
      if (!el.name || seen.has(el.name)) return;
      seen.add(el.name);
      const checked = document.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
      if (checked) state['__radio__' + el.name] = checked.value;
    });
    return state;
  }

  // ── restore field values ─────────────────────────────────────────────────
  function applyFields(state) {
    Object.entries(state).forEach(([key, val]) => {
      if (key.startsWith('__radio__')) {
        const name = key.slice(9);
        const el = document.querySelector(`input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(val)}"]`);
        if (el) el.checked = true;
        return;
      }
      const el = document.getElementById(key);
      if (!el) return;
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else {
        el.value = val;
      }
    });
  }

  // ── save ─────────────────────────────────────────────────────────────────
  function save(showToast) {
    if (!_cfg) return;
    try {
      const payload = { fields: collectFields() };
      if (_cfg.extra && typeof _cfg.extra.save === 'function') {
        payload.extra = _cfg.extra.save();
      }
      localStorage.setItem(storageKey(), JSON.stringify(payload));
      if (showToast !== false) flashIndicator();
    } catch (e) {
      // quota exceeded or private mode — ignore silently
    }
  }

  // ── restore ──────────────────────────────────────────────────────────────
  function restore() {
    if (!_cfg) return false;
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return false;
      const payload = JSON.parse(raw);
      if (payload.fields) applyFields(payload.fields);
      if (payload.extra && _cfg.extra && typeof _cfg.extra.restore === 'function') {
        _cfg.extra.restore(payload.extra);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── clear ────────────────────────────────────────────────────────────────
  function clear() {
    if (!_cfg) return;
    try { localStorage.removeItem(storageKey()); } catch (e) {}
  }

  // ── debounced save triggered by any input event ──────────────────────────
  function onInput() {
    clearTimeout(_timer);
    _timer = setTimeout(() => save(true), DEBOUNCE_MS);
  }

  // ── small "✓ Guardado" indicator ─────────────────────────────────────────
  function createIndicator() {
    const el = document.createElement('div');
    el.id = 'fp-saved-toast';
    el.textContent = '✓ Guardado';
    el.style.cssText = [
      'position:fixed;bottom:18px;right:18px;z-index:9999',
      'background:#0d9488;color:#fff;font-size:12px;font-weight:700',
      'padding:6px 14px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.18)',
      'opacity:0;transition:opacity .25s;pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function flashIndicator() {
    if (!_indicator) _indicator = createIndicator();
    _indicator.style.opacity = '1';
    clearTimeout(_indicator._t);
    _indicator._t = setTimeout(() => { _indicator.style.opacity = '0'; }, 1800);
  }

  // ── public API ────────────────────────────────────────────────────────────
  function init(cfg) {
    _cfg = cfg;
    _cfg.rfc = cfg.rfc || '';

    // Wait for DOM to be ready
    const run = () => {
      const restored = restore();
      if (restored && typeof cfg.afterRestore === 'function') {
        cfg.afterRestore();
      }

      // Listen to all form mutations
      document.addEventListener('input', onInput, true);
      document.addEventListener('change', onInput, true);

      // Also listen to form resets or manual triggers
      global.FormPersist._save = save;
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      // Small delay so page init (like addPuesto() / render()) runs first
      setTimeout(run, 80);
    }
  }

  global.FormPersist = { init, save, restore, clear };
})(window);
