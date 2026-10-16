# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SaaS de agendas para barberías en México (Mérida). Todo el código, los comentarios, los mensajes de la API y los commits están en español: mantenlo así. El `README.md` documenta cada módulo funcionalmente (rutas, reglas de negocio, pendientes); léelo antes de tocar un módulo.

## Comandos

```bash
npm start            # node server.js (puerto PORT, por defecto 3000)
npm run dev          # node --watch server.js
npm run check        # node --check de cada archivo (lista explícita en package.json: agrega ahí los archivos nuevos)
npm test             # todas las pruebas, en serie
node --test test/tiempo.test.js                              # un archivo
node --test --test-name-pattern="Stripe" test/billing.test.js # una prueba
```

- El servidor **no lee `.env`**: carga las variables en la sesión antes de `npm start`/`npm test`. En PowerShell:
  `foreach ($l in Get-Content .env -Encoding UTF8) { if ($l -match '^\s*([A-Z_]+)=(.*)$') { Set-Item -Path ("Env:" + $Matches[1]) -Value $Matches[2] } }`
- Las pruebas necesitan `DATABASE_URL` (sin ella se marcan como omitidas, no fallan). Usa una base de desarrollo UTF8, nunca la de producción. En esta PC la base local es `embedded-postgres` en `C:\Users\Onixbarber\barberia-dev-db` (`node start-db.mjs`, base `barberia_utf8`).
- `--test-concurrency=1` es obligatorio: varios servidores creando tablas a la vez en una base vacía chocan.

## Arquitectura

**Un solo proceso Express + PostgreSQL (`pg`), sin ORM, sin build, sin framework de frontend.** Dependencias: solo `express` y `pg`. Las llamadas a Stripe, Mercado Pago, Resend, Meta y Anthropic se hacen con `fetch` directo.

- **`server.js`** es el núcleo: crea/migra las tablas base al arrancar (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; no hay archivos de migración), sesiones, multi-negocio, agenda, panel y páginas renderizadas en el servidor. La promesa `listo` marca el fin de ese arranque.
- **Multi-negocio por slug:** `app.use('/api/:slug', ...)` carga el negocio en `q.neg` y pasa al router `api`; todas las tablas llevan `negocio_id` y cada consulta debe filtrar por `q.neg.id`. Las páginas viven en `/:slug`, `/:slug/agenda`, `/:slug/admin`, etc. El negocio inicial es `PRINCIPAL = 'estilo-internacional'` (antes `onyx`; existen redirecciones `/onyx` → nuevo slug).
- **Autenticación propia por cookie** (tabla `sesiones`, token hasheado, cookie por tipo y slug): `staff` (dueño o barbero, middleware `auth`) y `cliente`. Los barberos solo pueden las rutas de `BARB_OK`; lo demás del panel es solo del dueño. `/super` usa la cabecera `x-super: SUPER_PASS`. (El README aún menciona `x-admin`; ya no se usa para el panel.) Los POST del router `api` rechazan `Origin` de otro host.
- **Módulos de dominio** (`crm.js`, `billing.js`, `paquetes.js`, `marketing.js`, `contabilidad.js`, `tiempo.js`, `legal.js`): cada uno exporta `(app, api, deps) => {...}` y se monta en `server.js` (~línea 453) recibiendo utilidades compartidas (`pool, auth, wrap, HOY, limita, listo, ...`). Crean sus propias tablas tras `listo` y registran rutas en `api` (`/admin/...`). Para un módulo nuevo sigue el mismo patrón y agrégalo a `npm run check`.
- **Utilidades compartidas clave en `server.js`:** `HOY()` (fecha en zona `America/Merida`; usa siempre esta zona), `wrap` (errores async → 500), `limita` (rate limit en memoria), `vigente(n)` (suscripción activa; bloquea reservas), `todas/cerrado/bars/ranura/pasada` (la regla de disponibilidad de la agenda; los espacios pueden ser cada 60 o 30 minutos según `negocios.intervalo`, y `ahoraH` ya no se usa para la agenda). `tiempo.js` recibe estas mismas funciones para que "libre" signifique exactamente lo mismo que en la agenda del cliente: no dupliques esa regla.
- **Cobro (`billing.js`):** Stripe se activa por webhook (`/webhooks/stripe`, HMAC sobre el cuerpo crudo `q.raw`, capturado por `express.json` solo en `/webhooks/`). Mercado Pago no confía en el aviso: con su id vuelve a consultar la API de MP (por eso una firma `x-signature` que no coincide no se rechaza, solo se registra) y además `sincronizaMP` revisa las suscripciones al abrir la pestaña Plan y cada hora; `suscripciones.cobros` y `pagos_eventos` evitan contar dos veces un cobro. Cada pago aprobado suma 30 días a `negocios.vence`.
- **Tema "Estilo Internacional" (`tema-ei.js` + `public/tema-ei.css`):** HTML generado en el servidor con datos de la base (SEO). Los paquetes son filas de `estilos` con `tipo='paquete'`; los extras, tabla `extras`. El precio final de una cita siempre lo calcula el servidor.
- **Frontend (`public/`):** HTML estático con JS inline y CSS propio (`s.css`). El panel (`app-admin.html`) tiene módulos en `public/admin-*.js` que se registran con `modulo('<pestaña>', fn)` y dibujan en `#mod-<pestaña>` usando los globales del panel (`$, J, P, esc, toast`). **Al cambiar un `.js`/`.css` del panel, sube su `?v=N`** en el HTML (caché del navegador y del service worker `sw.js`).
- **Imágenes** se guardan como `BYTEA` en la tabla `imagenes` (mover a R2 está planeado para cuando haya dominio).

## Pruebas

`test/helpers.js` arranca el `server.js` real en un puerto aleatorio (`arranca(env)`) y registra una barbería (`registra(base, slug)` → cookie del dueño). Los proveedores externos se simulan con servidores HTTP locales pasando `STRIPE_API_URL`, `MP_API_URL`, `ANTHROPIC_API_URL`, `RESEND_URL` en `env`. La base de desarrollo persiste entre corridas: usa slugs e ids únicos por corrida (sufijo con `Date.now().toString(36)`).

## Despliegue y precauciones

- Railway con despliegue automático: **cada push a `main` publica en producción**. Pide aprobación antes de hacer push o de cambiar variables en Railway.
- El CI de GitHub (`.github/workflows/ci.yml`: Postgres 16, `npm run check` + `npm test`) no corre mientras la cuenta tenga bloqueo de facturación.
- Escribe archivos en UTF-8 (en Windows, `Get-Content`/`Set-Content` sin `-Encoding utf8` corrompen los acentos).
- Los servicios, paquetes y citas de `estilo-internacional` en producción son datos reales del cliente.
