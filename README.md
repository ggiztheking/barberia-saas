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

`npm run check` revisa la sintaxis y `npm test` arranca el servidor real y prueba registro, páginas públicas y paneles. Necesita `DATABASE_URL` (sin ella las pruebas se omiten); en CI GitHub levanta un PostgreSQL de servicio. Usa una base de desarrollo, nunca la de producción. Los archivos de prueba corren uno a la vez (`--test-concurrency=1`): en una base vacía, dos servidores creando las tablas a la vez chocan. La base debe ser UTF8 (en Windows, `initdb` usa WIN1252 por defecto y rechaza emojis).

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
- **Una sola suscripción por negocio.** Cada enlace de pago se guarda como `pendiente`; al crear otro, el anterior se cancela en el proveedor. Si aun así se autorizan dos, la segunda queda `duplicada` y se cancela sola en el proveedor (su primer cobro sí suma días: el dinero ya entró). "Cancelar" cancela todas las vivas. Un aviso tardío nunca revive una suscripción cancelada.
- Mercado Pago liga la suscripción al correo de la cuenta de MP que paga: la pestaña Plan lo pide (por defecto, el del panel). Para probar con usuarios de prueba, `MP_PAYER_EMAIL_PRUEBA` lo reemplaza por el de la cuenta Comprador de prueba. Suscripciones no tiene credenciales `TEST-`: se prueba con el Access Token de producción de una cuenta Vendedor de prueba.
- Si MP avisa de un recurso que no existe (p. ej. "Simular notificación"), se responde 200 `no_encontrado` para que no reintente; las caídas de MP sí responden 500 para que reintente. Los cobros no aprobados se registran en el log con su estado y motivo.
- Antes de cobrar de verdad, prueba cada proveedor en su modo de pruebas.

## Marketing con IA

La pestaña **Marketing** del panel (`marketing.js`) genera, con los datos reales de la barbería (servicios, agenda de la semana, clientes por reactivar): qué hacer esta semana, plan de lanzamiento de 30 días, promociones, textos para redes, calendario de contenido y reseñas de Google.

- **Sin `ANTHROPIC_API_KEY`** entrega plantillas editables y no gasta cuota. **Con clave** usa Claude (`claude-sonnet-5-5` por defecto, `ANTHROPIC_MODEL` para cambiarlo) con un tope mensual por plan (`IA_CUOTA_*`). Si la IA falla se entrega la plantilla y no se descuenta.
- A la IA solo se le manda el nombre, la dirección, los servicios, la carga de la agenda y conteos de clientes; nunca contraseñas, teléfonos ni correos.
- Cada pieza se puede copiar, **programar** como publicación (aparece en CRM → Contenido) o **enviar por WhatsApp** a un grupo del CRM como campaña (`{nombre}` lo llena el CRM por cliente).
- Pendiente: probar con una clave real de Anthropic (las pruebas usan un servidor simulado) y que la IA lea también las reseñas y la competencia.

## Contabilidad (para tu contador)

- Está al final de la pestaña **Finanzas** del panel. Elige el mes con su propio selector. Cuando Finanzas se recarga (cambias de mes con las flechas, registras un gasto o una venta, pagas una comisión), la contabilidad se actualiza con el mismo mes.
- **Estado de resultados:** ingresos por servicios (citas completadas) y otras ventas; comisiones por barbero; gastos de operación por categoría; utilidad de operación y margen. Todo se redondea a centavos.
- **Comisiones:** se cuenta lo que le toca a cada barbero según su porcentaje actual. Si se le pagó más, cuenta lo pagado. Esos pagos no se restan dos veces como gasto.
- **Inversión:** se muestra aparte y no afecta la utilidad.
- **Comparativo** contra el mes anterior, en pesos y en porcentaje.
- **Punto de equilibrio:** "necesitas X cortes al mes, unos Y por día de trabajo". Usa tus gastos fijos, el ticket promedio y la comisión promedio. Los días de trabajo descuentan los días que cierra la barbería.
- **Proyección de cierre** del mes en curso, con el ritmo de los días de trabajo que ya pasaron. Los gastos fijos (ligados a un gasto fijo o de una categoría que tienes como gasto fijo) cuentan una sola vez; solo los gastos variables se proyectan.
- **ISR estimado (RESICO persona física):** tabla mensual del art. 113-E de la LISR (1.00 % hasta $25,000; 1.10 % hasta $50,000; 1.50 % hasta $83,333.33; 2.00 % hasta $208,333.33; 2.50 % hasta $3,500,000). La tasa se aplica a todos los ingresos del mes. La ley usa lo efectivamente cobrado y facturado (CFDI) **sin IVA**. El reporte usa todo lo cobrado que registraste y además muestra la base y el ISR quitando el IVA (16 %), por si tus precios ya lo incluyen. También muestra lo acumulado en el año: el RESICO deja de aplicar a partir del mes siguiente a que los ingresos del año pasen de $3.5 millones. **Es una estimación orientativa y no sustituye a un contador. No calcula el IVA ni otros regímenes.**
- **Descargar reporte:** archivo CSV que abre bien en Excel, con acentos (UTF-8 con BOM). Se llama `contabilidad-<tu-enlace>-<mes>.csv`.
- API (solo el dueño): `GET /api/<slug>/admin/contabilidad/reporte?mes=AAAA-MM` y `GET /api/<slug>/admin/contabilidad/export?mes=AAAA-MM`.
- Pruebas: `node --test test/contabilidad.test.js`.

## Agenda llena (optimización de tiempo)

- Pestaña **Agenda llena** del panel del dueño (`tiempo.js` + `public/admin-tiempo.js`).
- **Huecos de los próximos 7 o 14 días**: por día y hora, cuántos barberos están libres y el % de ocupación. Usa la misma regla que la agenda del cliente (horario, días que no abre, descansos y citas), así que lo que aparece libre es exactamente lo que se puede reservar. Las horas que ya pasaron hoy no salen.
- **Promo relámpago**: elige las horas vacías de un día y el descuento, y obtienes el texto listo para WhatsApp, estados o redes con el enlace a tu agenda (`PUBLIC_URL` o el dominio actual). Antes de armarla revisa que esas horas sigan libres. Se puede copiar, compartir por WhatsApp o mandar como campaña del CRM a un segmento (todos, frecuentes, VIP, en riesgo, etc.).
- **Cómo se llena tu semana**: mapa de calor por día y hora de las últimas 4, 8 o 12 semanas (citas atendidas o en las que el cliente no llegó, entre la capacidad). Muestra el número en cada celda, así que se lee también sin color. Incluye las horas muertas y el % de faltas por día.
- **Que no te dejen plantado**: clientes con 2 o más faltas en los últimos 90 días, citas de mañana de clientes que suelen faltar y cuántos recordatorios de mañana faltan por enviar (según lo registrado en el CRM; no cuenta a los clientes que pidieron no recibir avisos), con un botón para abrir el CRM y mandarlos.
- Endpoints: `GET /api/:slug/admin/tiempo/huecos`, `GET /api/:slug/admin/tiempo/patron`, `POST /api/:slug/admin/tiempo/relampago`, `GET /api/:slug/admin/tiempo/inasistencias` (solo el dueño, con sesión).
- Pruebas: `node --test test/tiempo.test.js`.

## Marco legal (pestaña Legal)

Orientación general para abrir y operar una barbería en Mérida, Yucatán. **No es asesoría legal ni fiscal**: confirma cada paso con la autoridad que lo emite, con tu contador o con un abogado.

- **Checklist guiado** de 18 pasos en 5 grupos:
  - SAT: RFC, régimen RESICO u otro, e.firma, CFDI 4.0 y factura global, declaraciones.
  - Ayuntamiento de Mérida: uso de suelo, licencia de funcionamiento, anuncio y Protección Civil.
  - Salud: aviso de funcionamiento en COFEPRIS/DIGIPRiS y reglamento de higiene.
  - Equipo: empleado o comisionista, alta patronal en el IMSS e impuesto estatal sobre nómina.
  - Datos personales: aviso de privacidad, derechos ARCO, promociones y seguridad.
- Cada paso explica por qué importa, qué necesitas, dónde se hace y su **fuente oficial**. Solo se muestra el costo cuando la fuente oficial lo publica. Marca los pasos listos, agrega notas (folio, vencimiento) y ve tu **progreso en %**.
- **Documentos imprimibles** con los datos de tu barbería. Se abren en otra pestaña para imprimir o guardar como PDF:
  - aviso de privacidad integral y simplificado;
  - contrato con barbero comisionista, con advertencia sobre la subordinación laboral;
  - reglamento interno de higiene y atención.
- **Aviso de privacidad público** en `/<tu-enlace>/privacidad`, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (DOF 20/03/2025). La autoridad es la Secretaría Anticorrupción y Buen Gobierno.
- Para que los documentos salgan completos:
  - En **Ajustes**, llena la dirección y el WhatsApp del negocio.
  - En **Legal**, llena el nombre o razón social del titular y, si quieres, un correo para temas de privacidad.
  - El "correo para avisos de citas" de Ajustes nunca se publica.
- Solo el dueño ve esta pestaña; los barberos no tienen acceso.
- Rutas:
  - `GET /api/:slug/admin/legal/pasos`
  - `POST /api/:slug/admin/legal/paso {paso, hecho?, nota?}`: lo que no mandes se conserva.
  - `POST /api/:slug/admin/legal/datos {titular?, correo?}`
  - `GET /api/:slug/admin/legal/doc/:tipo`
  - `GET /:slug/privacidad`
- Pruebas: `node --test test/legal.test.js`.

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
