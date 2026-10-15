# barberia-saas

SaaS de agendas para barberías (Mérida, México). Cada barbería tiene su propia página pública de reservas, agenda y panel de administración, todo bajo `/<slug>`.

**Stack:** Node 22 · Express 4 · PostgreSQL (`pg`) · frontend estático en `public/`.

## Correr en local

Requisitos: Node >= 18 y una base PostgreSQL.

```bash
npm install
cp .env.example .env      # rellena DATABASE_URL como mínimo
export $(grep -v '^#' .env | xargs)   # el servidor lee process.env; no carga .env por sí mismo
npm start
```

Abre http://localhost:3000. Las tablas y el negocio inicial `estilo-internacional` se crean solos al arrancar. Si la base todavía lo tiene como `onyx` (su nombre anterior), se renombra solo y `/onyx/...` redirige al enlace nuevo.

## Pruebas

`npm run check` revisa la sintaxis y `npm test` arranca el servidor real y prueba registro, páginas públicas y paneles. Necesita `DATABASE_URL` (sin ella las pruebas se omiten); en CI GitHub levanta un PostgreSQL de servicio. Usa una base de desarrollo, nunca la de producción.

## Variables de entorno

Ver [`.env.example`](.env.example) para la lista completa con descripciones.

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a PostgreSQL |
| `PORT` | No | Puerto (Railway lo define; por defecto 3000) |
| `ADMIN_PASS` | No | Contraseña inicial del admin de `estilo-internacional` (si falta, se genera una aleatoria) |
| `BARBEROS` | No | Barberos iniciales de `estilo-internacional`, separados por coma |
| `CORREO_PRINCIPAL` | No | Correo de avisos de `estilo-internacional` (`CORREO_ONYX` sigue valiendo) |
| `SUPER_PASS` | Para `/super` | Contraseña del panel del dueño |
| `RESEND_API_KEY` | No | Avisos de citas por correo |
| `MAIL_FROM` | No | Remitente de los correos |
| `RESEND_URL` | No | URL alterna de la API de Resend |
| `MAKE_WEBHOOK_URL` | No | Webhook de Make para avisos de citas nuevas/canceladas |

## Cobro de suscripciones

`billing.js` cobra los planes Básico y Pro con Stripe (tarjeta) y Mercado Pago. El dueño contrata, ve su estado y cancela en la pestaña **Plan** del panel.

- Los webhooks son la única fuente de verdad: `POST /webhooks/stripe` (firma `Stripe-Signature`) y `POST /webhooks/mercadopago` (firma `x-signature`). Configura ambos en el panel de cada proveedor.
- Cada cobro aprobado suma 30 días al vencimiento, igual que `pagar_basico`/`pagar_pro` en `/super`. Cada evento se procesa una sola vez (tabla `pagos_eventos`), aunque el proveedor lo reenvíe.
- Un pago fallido o una cancelación no quitan el acceso: el negocio queda vigente hasta su `vence` y después `vigente()` bloquea las reservas.
- Stripe: crea un precio recurrente mensual por plan y pon su id en `STRIPE_PRICE_*`. Mercado Pago: la suscripción (`preapproval`) se crea con `PRECIO_*`. Eventos de Mercado Pago atendidos: `subscription_authorized_payment` (acredita) y `subscription_preapproval` (estado).
- Antes de cobrar de verdad, prueba cada proveedor en su modo de pruebas.

## Página pública: tema "Estilo Internacional", paquetes y extras

El diseño del sitio de Estilo Internacional es un tema del SaaS (`tema-ei.js` + `public/tema-ei.css`). Se dibuja en el servidor con datos de la base, así que Google lee la página completa y cada barbería nueva puede estrenarla con sus propios datos.

- **Elegir tema:** pestaña **Página** del panel → "Diseño de tu página" (`POST /api/:slug/admin/tema`). Sin tema, la página sigue siendo la oscura de siempre.
- **Paquetes y extras:** se editan en la misma pestaña. Un paquete es un `estilos` con `tipo='paquete'` (más `incluye`, `etiqueta`, `lavado`); los extras están en la tabla `extras`. Sin paquetes, la plantilla usa los servicios de la barbería.
- **Reservar:** "Reservar" abre la agenda con `?servicio=<id>&extras=<ids>`. El precio final lo calcula siempre el servidor; un extra de lavado no se cobra si el paquete ya lo incluye. La cita guarda `"Paquete + Extra"` en `servicio`, y las estadísticas agrupan por el nombre base.
- **Estilo Internacional** trae su catálogo real, sembrado una sola vez al arrancar (4 paquetes, 3 extras y 6 referencias de estilo). Las referencias se marcan como generadas con IA porque no son trabajos de la barbería.
- **Rutas viejas:** el negocio se llamaba `onyx`; se renombra solo y `/onyx/...` y `/api/onyx/...` redirigen.
- **Pendiente:** las referencias de estilo aún no se editan desde el panel, y los espacios de la agenda son por hora completa (el horario "9:30 AM" se muestra como texto, pero las citas empiezan a la hora en punto).

## Dónde alojarlo

- **Ahora:** Railway, tal como está (se despliega solo con cada push a `main`). No hace falta nada más mientras no haya dominio propio.
- **Con dominio propio:** Cloudflare delante (DNS, CDN, HTTPS), fotos en R2 en lugar de la tabla `imagenes` (hoy guarda los archivos dentro de PostgreSQL) y un dominio por barbería con Cloudflare for SaaS (incluye 100).
- **Pasar a un VPS:** solo si la factura de Railway supera de forma sostenida unos USD 40–50/mes, o hay decenas de barberías pagando, o la base o las fotos crecen mucho. Confirma los precios en las páginas oficiales antes de comprar; cambian seguido.

## App instalable (PWA)

Cada barbería se puede instalar como app desde su página (`/<slug>`): botón "Instalar app" en Android/Chrome, o Compartir → Añadir a pantalla de inicio en iPhone. El manifest (`/<slug>/manifest.json`) usa el nombre del negocio y `public/sw.js` muestra `offline.html` sin internet; las citas nunca se guardan en caché.

## SEO

La landing sale con título, descripción, vista previa para WhatsApp/redes y URL canónica generados por el servidor. Hay `GET /sitemap.xml` (negocios vigentes) y `public/robots.txt`.

## Despliegue (Railway)

El servicio `app` está conectado a este repo (rama `main`). Cada `git push` a `main` dispara un build y despliegue automáticos. Las variables se configuran en el dashboard de Railway; `DATABASE_URL` viene del servicio Postgres del mismo proyecto.

- Health check: `GET /health` → `ok`
- Arranque: `npm start` · desarrollo: `npm run dev` · verificación de sintaxis: `npm run check`

## Endpoints principales

**Páginas**

| Ruta | Descripción |
|---|---|
| `/` | Página comercial del SaaS |
| `/registro` | Alta de una barbería nueva |
| `/super` | Panel del dueño del SaaS |
| `/:slug` | Página pública de la barbería |
| `/:slug/agenda` · `/:slug/admin` · `/:slug/cartel` | Agenda, administración y cartel QR |

**API pública** (`/api/:slug/...`)

`GET info · estilos · productos · horarios` · `POST citas · mis-citas · cancelar`

**API de administración** (`/api/:slug/admin/...`, cabecera `x-admin: <contraseña>`)

`GET citas · corte · catalogo · insights · bloqueos · clientes · ajustes` · `POST cita · bloqueo · bloqueo/borrar · item · borrar`

**Otras**

- `POST /api/registro` — crea una barbería (limitado a 5 por hora por IP)
- `GET /api/super/negocios`, `GET /api/super/insights`, `POST /api/super/negocio/:id` — requieren cabecera `x-super: <SUPER_PASS>`
- `GET /health`, `GET /sitemap.xml`

Los intentos fallidos de contraseña (admin y super) se limitan a 8 cada 10 minutos por IP.
