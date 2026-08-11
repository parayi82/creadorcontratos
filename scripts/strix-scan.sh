#!/usr/bin/env bash
# Strix security scan for ClickLaboral.mx
# Requires: strix-agent (pip install strix-agent), Docker running, ANTHROPIC_API_KEY
#
# Usage:
#   ./scripts/strix-scan.sh                    # scan codebase + staging URL
#   ./scripts/strix-scan.sh --live             # scan production (careful)
#   ./scripts/strix-scan.sh --code-only        # only scan the codebase
#   ./scripts/strix-scan.sh --mode deep        # deep scan (slower, more thorough)

set -euo pipefail

MODE="standard"
TARGET_URL="https://clicklaboral.mx"
SCAN_CODE=true
SCAN_URL=false
LIVE=false

# Parse args
for arg in "$@"; do
  case $arg in
    --live)       LIVE=true; SCAN_URL=true ;;
    --code-only)  SCAN_URL=false ;;
    --url-only)   SCAN_CODE=false; SCAN_URL=true ;;
    --mode)       shift; MODE="$1" ;;
    --mode=*)     MODE="${arg#*=}" ;;
    --help|-h)
      sed -n '2,10p' "$0" | sed 's/^# //'
      exit 0
      ;;
  esac
done

# Require API key
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "❌ ANTHROPIC_API_KEY no está definida."
  echo "   Agrega: export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

export STRIX_LLM="anthropic/claude-sonnet-4-6"
export LLM_API_KEY="$ANTHROPIC_API_KEY"
export STRIX_REASONING_EFFORT="high"

TIMESTAMP=$(date +%Y%m%d-%H%M)
RUN_NAME="clicklaboral-$TIMESTAMP"

echo "🔒 Strix — ClickLaboral Security Scan"
echo "   Modo: $MODE | Run: $RUN_NAME"
echo ""

# Instrucciones específicas para el stack de ClickLaboral
INSTRUCTION="Focus on: \
1. Netlify Functions (Node.js) — auth bypass, injection, missing input validation. \
2. Supabase RLS policies — privilege escalation, data leakage between tenants. \
3. Stripe webhook — signature verification, replay attacks. \
4. Mifiel webhook — token bypass, SSRF. \
5. WhatsApp bot — state machine injection, business logic abuse. \
6. Secrets — hardcoded keys, env vars exposed in client-side JS. \
7. OWASP Top 10 — XSS, CSRF, open redirects, insecure direct object refs."

if [ "$SCAN_CODE" = true ]; then
  echo "📁 Escaneando codebase..."
  strix \
    --target "$(pwd)" \
    --instruction "$INSTRUCTION" \
    --mode "$MODE" \
    --max-budget 5 \
    -n \
    2>&1 | tee "strix_runs/$RUN_NAME-code.log" || true
  echo ""
fi

if [ "$SCAN_URL" = true ]; then
  if [ "$LIVE" = false ]; then
    echo "⚠️  Para escanear la URL de producción usa --live"
    echo "   Esto lanzará peticiones reales contra clicklaboral.mx"
    exit 0
  fi
  echo "🌐 Escaneando URL: $TARGET_URL"
  strix \
    --target "$TARGET_URL" \
    --instruction "$INSTRUCTION" \
    --mode "$MODE" \
    --max-budget 10 \
    -n \
    2>&1 | tee "strix_runs/$RUN_NAME-url.log" || true
fi

echo ""
echo "✅ Scan completo. Ver resultados: strix view $RUN_NAME"
echo "   O abrir dashboard: strix view"
