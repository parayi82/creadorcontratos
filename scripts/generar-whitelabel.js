#!/usr/bin/env node
// scripts/generar-whitelabel.js
//
// Genera un ZIP white-label listo para desplegar en Netlify.
// Lee el proyecto actual y produce una copia con los valores del cliente.
//
// Uso:
//   node scripts/generar-whitelabel.js config.json
//   node scripts/generar-whitelabel.js config.json ./output-dir
//
// La config (JSON) debe tener:
//   marca          : nombre del despacho (ej. "Despacho García & Asociados")
//   marca_corta    : nombre corto sin espacios (ej. "GarciaAsociados")
//   dominio        : dominio del cliente (ej. "garcialaboral.mx")
//   supabase_url   : URL del proyecto Supabase del cliente
//   supabase_anon  : Anon key (sb_publishable_...) del proyecto Supabase del cliente
//   color_primario : (opcional) color hex principal, ej. "#1a3a5c"
//   color_acento   : (opcional) color hex de acento, ej. "#e85d00"

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Valores originales que se reemplazarán ──────────────────────────────────
const ORIG = {
  supabase_url:     'https://hpzgqaplrywwjuvrzhcp.supabase.co',
  supabase_host:    'hpzgqaplrywwjuvrzhcp.supabase.co',
  supabase_proj_id: 'hpzgqaplrywwjuvrzhcp',   // ID en URLs del dashboard Supabase
  supabase_anon:    'sb_publishable_1g8US8iFJ8CxnSaF_4MHgA_gqyyAr3W',
  marca_titulo:     'ClickLaboral.mx',
  marca_upper:      'CLICKLABORAL.MX',          // variante toda mayúsculas
  marca_normal:     'ClickLaboral',
  marca_capitalized:'Clicklaboral',             // variante con solo primera mayúscula
  marca_lower:      'clicklaboral',
  dominio:          'clicklaboral.mx',
};

// Extensiones de texto que se procesan con find & replace
const TEXT_EXTS = new Set([
  '.html', '.js', '.css', '.json', '.xml', '.txt', '.md',
  '.toml', '.sql', '.sh', '.yaml', '.yml', '.ts',
]);

// Directorios/archivos que se excluyen del ZIP
const EXCLUDE = new Set([
  '.git', 'node_modules', '.netlify', '.claude',
  'skills', 'tests', 'playwright.config.js',
  'scripts', // el script mismo no va al ZIP del cliente
]);

// ── Leer argumentos ─────────────────────────────────────────────────────────
const [,, configPath, outputArg] = process.argv;
if (!configPath) {
  console.error('Uso: node scripts/generar-whitelabel.js config.json [./output]');
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('Error leyendo config:', e.message);
  process.exit(1);
}

const required = ['marca', 'marca_corta', 'dominio', 'supabase_url', 'supabase_anon'];
for (const k of required) {
  if (!cfg[k]) { console.error(`Falta campo obligatorio: ${k}`); process.exit(1); }
}

const srcDir  = path.resolve(__dirname, '..');
const outDir  = path.resolve(outputArg || `./whitelabel-${cfg.marca_corta}`);
const zipName = `${cfg.marca_corta}-netlify.zip`;
const zipPath = path.resolve(zipName);

console.log(`\n🏗  Generando white-label para: ${cfg.marca}`);
console.log(`   Fuente : ${srcDir}`);
console.log(`   Salida : ${outDir}`);

// ── Limpiar y crear directorio de salida ────────────────────────────────────
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true });
}
fs.mkdirSync(outDir, { recursive: true });

// ── Función de reemplazo de contenido ───────────────────────────────────────
function reemplazar(content) {
  const newHost    = new URL(cfg.supabase_url).host;
  const newProjId  = newHost.split('.')[0];
  const marcaLower = cfg.marca_corta.toLowerCase();

  // Supabase: primero URL completa, luego host, luego solo el ID de proyecto
  content = content
    .replaceAll(ORIG.supabase_url,     cfg.supabase_url)
    .replaceAll(ORIG.supabase_host,    newHost)
    .replaceAll(ORIG.supabase_proj_id, newProjId)
    .replaceAll(ORIG.supabase_anon,    cfg.supabase_anon);

  // Marca y dominio — orden: más específico primero
  const marcaUpper = (cfg.marca_corta + '.' + cfg.dominio).toUpperCase();
  content = content
    .replaceAll(ORIG.marca_upper,      marcaUpper)
    .replaceAll(ORIG.marca_titulo,     cfg.marca)
    .replaceAll(ORIG.marca_normal,     cfg.marca)
    .replaceAll(ORIG.marca_capitalized,cfg.marca)
    .replaceAll(ORIG.dominio,          cfg.dominio)
    .replaceAll(ORIG.marca_lower,      marcaLower);

  // Colores opcionales
  if (cfg.color_primario) {
    content = content.replaceAll('#0f2640', cfg.color_primario);
  }
  if (cfg.color_acento) {
    content = content.replaceAll('#0ea5e9', cfg.color_acento);
  }

  return content;
}

// ── Copiar árbol de archivos ─────────────────────────────────────────────────
let copiedCount = 0;
let skippedCount = 0;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src)) {
    if (EXCLUDE.has(entry)) { skippedCount++; continue; }

    const srcPath  = path.join(src,  entry);
    const destPath = path.join(dest, entry);
    const stat     = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      const ext = path.extname(entry).toLowerCase();
      if (TEXT_EXTS.has(ext)) {
        let content = fs.readFileSync(srcPath, 'utf8');
        content = reemplazar(content);
        fs.writeFileSync(destPath, content, 'utf8');
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
      copiedCount++;
    }
  }
}

copyDir(srcDir, outDir);

console.log(`\n✅ Archivos procesados : ${copiedCount}`);
console.log(`   Directorios omitidos: ${skippedCount}`);

// ── Generar ZIP ──────────────────────────────────────────────────────────────
console.log(`\n📦 Generando ZIP: ${zipName}`);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

try {
  execSync(`cd "${outDir}" && zip -r "${zipPath}" . -x "*.DS_Store"`, { stdio: 'pipe' });
  const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`   Tamaño: ${sizeMb} MB`);
  console.log(`\n🎉 Listo: ${zipPath}`);
  console.log(`\n   Próximos pasos:`);
  console.log(`   1. Sube ${zipName} a un nuevo sitio en Netlify`);
  console.log(`   2. Configura las variables de entorno en Netlify:`);
  console.log(`      SUPABASE_URL          = ${cfg.supabase_url}`);
  console.log(`      SUPABASE_SERVICE_KEY  = (service_role key del proyecto Supabase)`);
  console.log(`      STRIPE_SECRET_KEY     = (si aplica)`);
  console.log(`      STRIPE_WEBHOOK_SECRET = (si aplica)`);
  console.log(`   3. Ejecuta las migraciones SQL en el nuevo proyecto Supabase`);
  console.log(`      supabase/migrations/* en orden cronológico`);
  console.log(`      + sql-repse-proveedores.sql`);
  console.log(``);
} catch (e) {
  console.error('Error generando ZIP:', e.message);
  process.exit(1);
}
