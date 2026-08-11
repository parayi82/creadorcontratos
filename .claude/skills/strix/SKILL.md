# Strix — Penetration Testing Autónomo

Strix es una plataforma de pentesting con IA que lanza agentes autónomos para
encontrar y validar vulnerabilidades reales en ClickLaboral.mx.

**Instalación**: `pip install strix-agent` (requiere Docker y Python 3.12+)
**Fuente**: https://github.com/usestrix/strix

## Cuándo usar esta skill

- Antes de un deploy a producción con cambios en auth, pagos o APIs
- Al agregar un nuevo endpoint en `netlify/functions/`
- Al modificar políticas RLS en Supabase
- Al cambiar la lógica de webhooks (Stripe, Mifiel, WhatsApp)
- Revisión de seguridad periódica del codebase

## Cómo ejecutar

### Escanear el codebase (seguro, sin tráfico a producción)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./scripts/strix-scan.sh
```

### Escanear la URL de producción (lanza peticiones reales)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./scripts/strix-scan.sh --live
```

### Solo codebase, escaneo profundo

```bash
./scripts/strix-scan.sh --code-only --mode deep
```

### Ver resultados en dashboard local

```bash
strix view
```

## Configuración (variables de entorno)

| Variable | Valor | Dónde |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Terminal / Netlify env |
| `STRIX_LLM` | `anthropic/claude-sonnet-4-6` | Auto-set en el script |
| `STRIX_REASONING_EFFORT` | `high` | Auto-set en el script |

## Focos de atención para ClickLaboral

El script ya viene configurado para priorizar:

1. **Funciones Netlify** — bypass de auth, injection, validación de input
2. **Supabase RLS** — escalación de privilegios, fuga de datos entre tenants
3. **Webhook Stripe** — verificación de firma, replay attacks
4. **Webhook Mifiel** — bypass de token, SSRF
5. **Bot WhatsApp** — inyección en state machine, abuso de lógica de negocio
6. **Secrets** — keys hardcodeadas, env vars expuestas en JS del cliente
7. **OWASP Top 10** — XSS, CSRF, open redirects, IDOR

## Resultados

Los resultados se guardan en `strix_runs/` (en `.gitignore`).
Cada run genera un reporte con PoCs validados y pasos de remediación.

## Integrar en CI (GitHub Actions)

```yaml
- name: Strix security scan
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    pip install strix-agent
    ./scripts/strix-scan.sh --code-only --mode standard
```
