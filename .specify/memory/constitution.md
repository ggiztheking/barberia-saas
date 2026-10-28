<!--
Sync Impact Report
- Versión: (plantilla) → 1.0.0 — primera constitución, sacada de CLAUDE.md, README.md y del skill /mejorar-agenda;
  no agrega reglas que no se sigan ya.
- Plantillas revisadas: .specify/templates/plan-template.md (Constitution Check usa estos principios),
  spec-template.md y tasks-template.md sin cambios necesarios.
-->
# Constitución de barberia-saas (Agenda de Barberías)

## Principios

### I. Español de México y lenguaje del negocio
Código, comentarios, mensajes de la API, textos de las páginas y commits van en español de México, tuteando. Las
especificaciones hablan de lo que ven el dueño, los barberos y los clientes, no de tablas ni rutas.

### II. Simple a propósito
Un solo proceso Express + PostgreSQL (`pg`), sin ORM, sin build y sin framework de frontend. Dependencias: solo
`express` y `pg`; los servicios externos se llaman con `fetch`. Un módulo nuevo sigue el patrón
`(app, api, deps) => {...}` y se agrega a `npm run check`.

### III. Cada barbería ve solo lo suyo (no negociable)
Multi-negocio por slug: toda consulta filtra por `negocio_id = q.neg.id`. Los barberos solo llegan a las rutas de
`BARB_OK`; lo demás del panel es del dueño.

### IV. Los datos de producción son reales (no negociable)
Las citas, clientes y servicios de Estilo Internacional son datos reales. Los cambios de base solo agregan
(`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`); nunca se borran ni renombran columnas ni se cambian
datos sin aprobación. Fechas con `HOY()` en America/Merida. El precio final siempre lo calcula el servidor. La
regla de horarios libres es una sola (`todas/cerrado/bars/ranura/pasada`).

### V. Probado antes de publicar (no negociable)
Cada cambio trae sus pruebas (`test/*.test.js` con `arranca`/`registra`, slugs únicos) y pasa
`bash herramientas/probar.sh`: reglas del repo, `npm run check`, todas las pruebas en una base nueva y el recorrido
en el navegador con capturas. Al cambiar un `.js`/`.css` del frontend se sube su `?v=N`.

## Clientes, privacidad y accesibilidad
- Aviso de privacidad conforme a la LFPDPPP (DOF 20/03/2025); solo se piden los datos necesarios (nombre y WhatsApp).
- El cliente puede borrar su cuenta; no hay cobros ocultos (el total se ve antes de confirmar) ni patrones oscuros
  (la suscripción se cancela desde el panel).
- Páginas de clientes con contraste AA y controles accesibles (revisión con axe sin fallas).
- Sin rastreadores ni cookies de publicidad; HTML escapado (`esc`/`he`) y `limita` en los POST públicos.

## Flujo de trabajo y publicación
- Producción: el servidor de Akamai sigue `main` y se actualiza solo cada 2 minutos. **Cada push a `main` publica**:
  se pide aprobación a Gael antes de hacerlo y antes de cambiar variables del servidor.
- Mejoras del día a día: `/mejorar-agenda`. Funciones grandes o con varias piezas: el flujo de Spec Kit
  (`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`), revisado contra esta
  constitución y terminando con `herramientas/probar.sh` y las capturas de `/mejorar-agenda`.
- El `README.md` documenta cada módulo y se actualiza en el mismo commit que el cambio.

## Gobierno
Esta constitución manda sobre las demás prácticas del repo; `CLAUDE.md` da el detalle técnico. Cambiarla requiere
el visto bueno de Gael, subir la versión (MAYOR: quitar o contradecir un principio; MENOR: agregar uno; PARCHE:
aclarar) y actualizar las plantillas afectadas. Cada plan (`/speckit-plan`) revisa estos principios en su
"Constitution Check".

**Versión**: 1.0.0 | **Ratificada**: 2026-10-28 | **Última modificación**: 2026-10-28
