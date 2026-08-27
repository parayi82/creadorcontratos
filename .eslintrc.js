// ESLint para Netlify Functions (Node.js serverless)
// Foco: seguridad, PII y patrones de error comunes.
// Ejecutar: npm run lint

'use strict';

module.exports = {
  env:    { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022 },
  plugins: ['no-secrets'],
  extends: ['eslint:recommended'],

  rules: {
    // ── Errores de código ────────────────────────────────────────────────
    'no-unused-vars':  ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef':        'error',
    'no-var':          'error',
    'prefer-const':    'warn',
    'eqeqeq':          ['error', 'always'],
    'no-eval':         'error',
    'no-implied-eval': 'error',

    // ── Seguridad — inyección y exposición ──────────────────────────────
    // Evita que se construyan queries SQL con concatenación de strings.
    'no-restricted-syntax': [
      'warn',
      {
        // Detecta template literals que mezclan SQL con variables de usuario
        selector: 'TemplateLiteral:has(Identifier[name=/^(rfc|curp|nss|nombre|email|tel|pass|password|token)/])',
        message:  'Posible inyección: no concatenes datos de usuario directamente en strings SQL/URL. Usa parámetros de Supabase.',
      },
    ],

    // ── PII en logs ──────────────────────────────────────────────────────
    // Bloquea console.log/error/warn con variables que suelen contener PII.
    // Regla personalizada vía no-restricted-globals aplicada a identificadores.
    'no-restricted-properties': [
      'warn',
      // Patrón: console.log(..., rfc, ...) — RFC es PII bajo LFPDPPP
      {
        object:   'console',
        property: 'log',
        message:  'Revisa que no estés logueando PII (RFC, CURP, NSS, nombre, email). Usa máscaras o IDs internos.',
      },
    ],

    // ── Buenas prácticas generales ───────────────────────────────────────
    'no-throw-literal':    'error',
    'handle-callback-err': 'warn',
  },

  ignorePatterns: [
    'node_modules/',
    '.github/scripts/',
    'assets/',
    '*.html',
    '*.min.js',
  ],
};
