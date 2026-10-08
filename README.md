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

Abre http://localhost:3000. Las tablas y el negocio inicial `onyx` se crean solos al arrancar.

## Variables de entorno

Ver [`.env.example`](.env.example) para la lista completa con descripciones.

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a PostgreSQL |
| `PORT` | No | Puerto (Railway lo define; por defecto 3000) |
| `ADMIN_PASS` | No | Contraseña inicial del admin de `onyx` (si falta, se genera una aleatoria) |
| `BARBEROS` | No | Barberos iniciales de `onyx`, separados por coma |
| `CORREO_ONYX` | No | Correo de avisos de `onyx` |
| `SUPER_PASS` | Para `/super` | Contraseña del panel del dueño |
| `RESEND_API_KEY` | No | Avisos de citas por correo |
| `MAIL_FROM` | No | Remitente de los correos |
| `RESEND_URL` | No | URL alterna de la API de Resend |
| `MAKE_WEBHOOK_URL` | No | Webhook de Make para avisos de citas nuevas/canceladas |

## Despliegue (Railway)

El servicio `app` está conectado a este repo (rama `main`). Cada `git push` a `main` dispara un build y despliegue automáticos. Las variables se configuran en el dashboard de Railway; `DATABASE_URL` viene del servicio Postgres del mismo proyecto.

- Health check: `GET /health` → `ok`
- Arranque: `npm start`

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
- `GET /health`

Los intentos fallidos de contraseña (admin y super) se limitan a 8 cada 10 minutos por IP.
