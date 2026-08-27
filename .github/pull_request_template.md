## ¿Qué cambia?
<!-- Una sola oración: qué hace este PR que antes no existía o era diferente. -->

## Tipo de cambio
- [ ] Nueva función / feature
- [ ] Bug fix
- [ ] Refactor (sin cambio de comportamiento)
- [ ] Migración / esquema de BD
- [ ] Configuración / infraestructura

---

## Checklist de seguridad y cumplimiento

### Datos y acceso
- [ ] Ningún `console.log/error/warn` imprime RFC, CURP, NSS, nombre completo, email o salario
- [ ] Las Netlify Functions nuevas o modificadas validan `Authorization: Bearer <token>` antes de operar
- [ ] Si se crea una tabla nueva en Supabase, lleva `ENABLE ROW LEVEL SECURITY` y al menos una política

### Código
- [ ] `npm audit --audit-level=high` pasa sin hallazgos de producción
- [ ] `npm run lint` pasa sin errores (warnings menores son aceptables si se justifican)
- [ ] No hay claves de API, tokens ni secrets hardcodeados en el código

### Frontend
- [ ] Los assets JS con cambios llevan `?v=YYYYMMDDX` actualizado en todas las referencias HTML
- [ ] No se usan `eval()`, `innerHTML` con datos de usuario ni concatenaciones de SQL en cliente

---

## Prueba realizada
<!-- Describe brevemente cómo verificaste que funciona. Capturas de pantalla si aplica. -->

## Notas para el revisor
<!-- Algo que no sea obvio en el diff, decisiones de diseño o alternativas descartadas. -->
