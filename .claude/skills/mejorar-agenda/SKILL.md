---
name: mejorar-agenda
description: Programa una mejora, un arreglo o una función nueva en el SaaS de agendas (página de la barbería, agenda de clientes, panel del dueño y los barberos, cobros, CRM, finanzas, marketing), la prueba completa con un recorrido en el navegador y, con el visto bueno de la persona, la publica en Railway y en el servidor de Akamai. Úsala cuando pidan cambiar, agregar o arreglar algo de la agenda, el panel o la página de Estilo Internacional u otra barbería.
---

# /mejorar-agenda: de una idea a la agenda en producción

El flujo es el de Hercules, pero sobre el SaaS real: la persona describe en sus palabras lo que quiere ("que el
cliente pueda pagar anticipo", "reporte de ventas por barbero"); tú lo programas, lo pruebas, le enseñas cómo
quedó y, cuando dice que sí, lo publicas y confirmas que ya está en línea. Habla siempre en español y en términos
de lo que verán el dueño, los barberos o los clientes (pantallas, botones, avisos), nunca de tablas o rutas.

## Lo que hay que saber

- `CLAUDE.md` tiene la arquitectura y las reglas del repo; el `README.md` documenta cada módulo (rutas, reglas,
  pendientes). Lee la sección del módulo antes de tocarlo.
- Dónde vive cada cosa:

  | Lo que ve la persona | Archivos |
  | --- | --- |
  | Página pública de Estilo Internacional (tema claro) | `tema-ei.js`, `public/tema-ei.css` |
  | Página pública de otras barberías (tema oscuro) | `public/negocio.html` |
  | Agenda del cliente (agendar, mi cuenta, cambiar o cancelar) | `public/app-agenda.html`, `public/agenda-ei.css`, rutas en `server.js` |
  | Panel: Hoy, Resumen, Plan, Ajustes | `public/app-admin.html`, `server.js`; módulo de Ajustes en `public/admin-agenda.js` |
  | Panel: Finanzas | `contabilidad.js`, `public/admin-contabilidad.js` |
  | Panel: Clientes y lealtad | `lealtad.js`, `public/admin-lealtad.js` |
  | Panel: Página (fotos, reseñas, trabajos) | `paquetes.js`, `public/admin-referencias.js` |
  | Panel: Agenda llena (huecos libres) | `tiempo.js`, `public/admin-tiempo.js` |
  | Panel: Marketing, Legal, Plan (cobro del SaaS) | `marketing.js`, `legal.js` + `public/admin-legal.js`, `billing.js` |
  | CRM | `crm.js`, `public/app-crm.html`, `public/crm-app.js` |
  | Página del SaaS, registro, términos | `public/saas.html`, `public/registro.html`, `sitio.js` |

- **Publicar = que el commit llegue a `main`.** De ahí sale solo a dos lugares: Railway (la agenda que usan hoy los
  clientes, con **datos reales**) y el servidor de Akamai (revisa GitHub cada 2 minutos, recompila y reinicia; su
  base empezó de cero). `CLAUDE.md` pide aprobación antes de cada push a `main`: respétalo siempre.
- La base de producción es real: los cambios de tablas solo agregan (`ADD COLUMN IF NOT EXISTS`, tablas nuevas tras
  `listo`). Nunca borres ni renombres columnas, ni cambies datos existentes sin que la persona lo pida y lo apruebe.

## Pasos

1. **Entender.** Si la descripción alcanza, no preguntes: decide con criterio y di qué supusiste. Pregunta
   (máximo 2 preguntas, con AskUserQuestion) solo lo que cambia el diseño y no se puede suponer: quién lo usa
   (cliente, barbero, dueño), si cuesta dinero, si cambia algo que los clientes ya conocen.
2. **Leer antes de tocar:** la sección del `README.md`, el módulo y sus pruebas en `test/`. Busca si ya existe
   algo parecido (`grep`) para extenderlo en vez de duplicarlo; la regla de horarios libres es una sola
   (`todas/cerrado/bars/ranura/pasada`).
3. **Rama:** `git fetch origin main && git checkout -b mejora/<nombre-corto> origin/main`.
4. **Programar** con las convenciones del repo:
   - Código, textos y mensajes en español de México, tuteando, como el resto de la app.
   - Sin dependencias nuevas (solo `express` y `pg`; los servicios externos con `fetch`), salvo que la persona
     lo apruebe.
   - Cada consulta filtra por `negocio_id = q.neg.id`; fechas con `HOY()` y la zona `America/Merida`; el precio
     siempre lo calcula el servidor; HTML escapado (`esc`/`he`); `limita` en los POST públicos; los barberos solo
     llegan a las rutas de `BARB_OK`.
   - Un módulo nuevo sigue el patrón `(app, api, deps) => {...}`, se monta en `server.js` y se agrega a `check`
     en `package.json` (igual que todo `.js` nuevo).
   - Si cambias un `.js`/`.css` de `public/`, sube su `?v=N` donde se carga (HTML o `tema-ei.js`).
   - Si cambia algo que el `README.md` documenta (rutas, reglas, pendientes), actualízalo en el mismo commit.
5. **Pruebas nuevas** en `test/<modulo>.test.js` con `arranca`/`registra` de `test/helpers.js` y slugs únicos:
   la regla nueva, un caso de error (dato inválido, otra barbería, barbero sin permiso) y lo que no debe cambiar.
6. **Probar, siempre, antes de enseñar:**
   `SALIDA=<tu carpeta temporal>/prueba-agenda bash herramientas/probar.sh`. Revisa las reglas del repo (archivos
   en `check`, `?v=N`), corre `npm run check` y todas las pruebas en una base nueva, y hace un recorrido en el
   navegador sobre otra base nueva: abre la página de Estilo Internacional, agenda una cita como cliente, crea la
   cuenta del dueño, busca la cita en "Hoy", abre cada pestaña del panel y repite en celular. Las capturas
   quedan en `$SALIDA` (`1-pagina`, `2-agenda`, `3-cita-agendada`, `4-panel-hoy`, `5-panel-<pestaña>`,
   `6-celular-*`). Mientras programas, `PRUEBAS=test/<modulo>.test.js` corre solo esas; la corrida final es la
   completa. Corrige y vuelve a probar hasta que diga "Pasó todo".
7. **Ver lo que cambió:** mira con Read las capturas de las pantallas que tocaste y las de celular. Si tu cambio
   está en una pantalla que el recorrido no abre (un aviso, un paso nuevo de la agenda, otra barbería), haz su
   captura con un script corto de Playwright contra un servidor de prueba (igual que en `herramientas/recorrido.cjs`)
   y míralo. Si es un flujo principal nuevo, agrégalo a `recorrido.cjs`.
8. **Enseñar y pedir el visto bueno.** En pocas líneas, qué cambia y para quién; manda 1 o 2 capturas con
   SendUserFile y pregunta con AskUserQuestion si se publica ("Publicar ahora (Recomendado)" / "Cambiar algo
   antes"). Recuérdale que se publica en la agenda que usan sus clientes. Solo si en esta misma petición ya dijo
   claramente que lo publiques, no vuelvas a preguntar.
9. **Publicar.** Commit con mensaje en español como los del repo (`feat: ...`, `arreglo: ...`). Trae `main` otra
   vez (`git fetch origin main`); si avanzó, `git merge origin/main` y vuelve a correr `probar.sh`. Luego
   `git push origin HEAD:main` (y la rama de trabajo de la sesión, si tiene una). Si el push es rechazado porque
   `main` avanzó, repite este paso.
10. **Confirmar en línea.** `/health` solo dice que el servidor vive; comprueba algo propio del cambio (la ruta
    nueva responde, el HTML trae el `?v=N` nuevo o el texto nuevo):
    - Akamai: `https://agenda.172-235-141-127.sslip.io/estilo-internacional` (revisa cada 20 s, hasta 10 minutos).
    - Railway: la dirección pública de la agenda (su `PUBLIC_URL`). Si no la conoces, pídela una vez y anótala
      aquí. Railway publica solo en 2 o 3 minutos.
    Si no aparece, revisa que el commit esté en `main` y que las pruebas pasen; desde aquí no hay acceso a los
    registros de Railway ni del servidor.
11. **Entregar** en pocas líneas: qué cambió y dónde verlo (enlaces), qué supusiste, qué pruebas agregaste, y una
    o dos ideas de lo siguiente que podría pedir. Si hace falta configurar algo (una variable en Railway, una
    clave), di cuál y dónde; cambiar variables en Railway también requiere su aprobación.

## Si algo sale mal en producción

Lo más rápido es deshacer: `git revert <commit>` en una rama nueva desde `origin/main`, `probar.sh`, y con la
aprobación de la persona, `git push origin HEAD:main`. Los cambios de tablas no se deshacen con el revert (las
columnas nuevas se quedan, sin estorbar). Después busca la causa con calma y vuelve al paso 4.
