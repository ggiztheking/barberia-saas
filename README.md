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
| `PORT` | No | Puerto (por defecto 3000) |
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

- Stripe: `POST /webhooks/stripe` exige la firma `Stripe-Signature` (el evento trae los datos). Mercado Pago: `POST /webhooks/mercadopago` solo toma el id del aviso y vuelve a consultar el cobro y la suscripción en la API de MP con `MP_ACCESS_TOKEN`; por eso un aviso con firma `x-signature` que no coincide se procesa igual (queda `firma: no_valida` en el log, para corregir `MP_WEBHOOK_SECRET`) y nunca acredita nada que MP no confirme. Además, al abrir la pestaña Plan y cada hora se revisan en MP las suscripciones pendientes y vivas, así que un plan se activa aunque el aviso no llegue.
- Cada cobro aprobado suma 30 días al vencimiento, igual que `pagar_basico`/`pagar_pro` en `/super`. Cada evento se procesa una sola vez (tabla `pagos_eventos`), aunque el proveedor lo reenvíe.
- Un pago fallido o una cancelación no quitan el acceso: el negocio queda vigente hasta su `vence` y después `vigente()` bloquea las reservas.
- Stripe: crea un precio recurrente mensual por plan y pon su id en `STRIPE_PRICE_*`. Mercado Pago: la suscripción (`preapproval`) se crea con `PRECIO_*`. Eventos de Mercado Pago atendidos: `subscription_authorized_payment` (acredita) y `subscription_preapproval` (estado).
- **Una sola suscripción por negocio.** Cada enlace de pago se guarda como `pendiente`; al crear otro, el anterior se cancela en el proveedor. Si aun así se autorizan dos, la segunda queda `duplicada` y se cancela sola en el proveedor (su primer cobro sí suma días: el dinero ya entró). "Cancelar" cancela todas las vivas. Un aviso tardío nunca revive una suscripción cancelada.
- Mercado Pago liga la suscripción al correo de la cuenta de MP que paga: la pestaña Plan lo pide (por defecto, el del panel). Para probar con usuarios de prueba, `MP_PAYER_EMAIL_PRUEBA` lo reemplaza por el de la cuenta Comprador de prueba. Suscripciones no tiene credenciales `TEST-`: se prueba con el Access Token de producción de una cuenta Vendedor de prueba.
- **No depende solo de los avisos de MP.** Al abrir la pestaña Plan (como mucho cada 20 s) y cada hora, el servidor consulta en MP las suscripciones pendientes o vivas y aplica su estado. Cada cobro suma 30 días una sola vez: `suscripciones.cobros` guarda cuántos se acreditaron y se compara con `summarized.charged_quantity` del preapproval (o, si MP no lo trae, con los avisos de cobro aprobado).
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
  - Dice cómo se agenda para un menor de edad: lo hace su madre, padre o tutor, con sus propios datos, y da el consentimiento por él.
  - Si en **Legal** marcas "Mi WhatsApp lo contesta un asistente con inteligencia artificial" y escribes su proveedor (`legal_datos.asistente`), el aviso integral y el simplificado dicen que los mensajes, fotos y audios se procesan con ese proveedor y que el cliente puede pedir una persona. Sin marcarlo, no se menciona.
- Para que los documentos salgan completos:
  - En **Ajustes**, llena la dirección y el WhatsApp del negocio.
  - En **Legal**, llena el nombre o razón social del titular y, si quieres, un correo para temas de privacidad.
  - El "correo para avisos de citas" de Ajustes nunca se publica.
- Solo el dueño ve esta pestaña; los barberos no tienen acceso.
- Rutas:
  - `GET /api/:slug/admin/legal/pasos`
  - `POST /api/:slug/admin/legal/paso {paso, hecho?, nota?}`: lo que no mandes se conserva.
  - `POST /api/:slug/admin/legal/datos {titular?, correo?, asistente?}`
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
- **Plantilla v2 (tema-ei.js):** cada paquete muestra su foto (la que subió el dueño) o una imagen ilustrativa generada con IA según el paquete (`public/img/tema/paq-corte|fresco|barba|vip.jpg`), siempre marcada como "Imagen ilustrativa". Sin portada ni fotos, la página usa `public/img/tema/portada.jpg` con la leyenda "IMAGEN ILUSTRATIVA". Secciones nuevas: "Tu cita en un minuto" (pasos), "Nuestro equipo" (solo si algún barbero tiene foto, especialidad o bio en su perfil; botón para agendar con él), "Tarjeta de sellos" (solo si lealtad.js está activo con premio) y enlace de reseña de Google (`negocios.resena`). El horario sin `horario_texto` respeta `abre_min` e `intervalo`.
- **Portada en video (Estilo Internacional):** con `fotos` y sin portada subida por el dueño, la portada es un video real del local: `public/img/portada-ei.mp4` (1280×720) en pantallas anchas y `portada-ei-movil.mp4` (720×1280) en verticales, con sus pósteres `portada-ei.jpg` / `portada-ei-movil.jpg` (la foto que se ve mientras carga, y siempre si no hay video). El script de la página lo carga después del `load`, con la portada al menos 0.3 s en pantalla, y solo si el visitante no pidió menos movimiento ni ahorro de datos y su red no es lenta (2G/3G o menos de 1 Mbps); aparece cuando ya no se va a cortar (y si a los 10 s no lo logra, se queda la foto), se pausa fuera de pantalla, cambia de video al girar el celular y trae un botón "Pausar video". La leyenda dice "FOTO REAL" hasta que el video corre. Al reemplazar esos archivos, sube `PV` en `tema-ei.js` (`/img` se guarda 7 días en caché). `sw.js` no intercepta peticiones de video ni con `Range`.
- **Logo (Estilo Internacional):** con `fotos`, la página usa su medallón (`public/img/logo-ei.webp`: el círculo del logo original, con el aro dorado cerrado y fondo transparente) en lugar de las iniciales, en el encabezado y en el pie; su favicon y su apple-touch-icon son `logo-ei-192.png` / `logo-ei-180.png` (cuadrados crema), y el JSON-LD lleva `logo` (`logo-ei-512.png`). `GET /api/:slug/info` devuelve `logo`, `logo_icono` y `logo_apple` (null sin logo) para que la agenda muestre el medallón junto al nombre y cambie su ícono, y `/<slug>/manifest.json` usa `logo-ei-192/512.png` (también como maskable) con fondo y tema crema `#f1efe9`. Al reemplazar esos archivos, sube `LV` en `tema-ei.js`.
- Las referencias de estilo se editan desde Panel → Página, y la agenda puede ser cada 30 minutos y abrir a la media hora (ver las secciones más abajo).

## Términos, privacidad y soporte del SaaS

`sitio.js` sirve las páginas legales del propio servicio (las de cada barbería para sus clientes están en `legal.js`):

- `/terminos`: prueba de 14 días, precios (de `PRECIO_*`), cobro automático mensual con Mercado Pago, cancelación desde la pestaña Plan sin reembolso del periodo pagado, facturas, uso correcto y ley aplicable.
- `/privacidad`: aviso de privacidad para los dueños que crean una cuenta (datos, finalidades, proveedores, derechos ARCO, cookies). Para los datos de los clientes de cada barbería el SaaS actúa como encargado.
- Datos por variables: `SOPORTE_WHATSAPP` (también pone "Soporte por WhatsApp" en el pie de la página comercial), `SOPORTE_CORREO`, `SAAS_TITULAR` y `SAAS_DOMICILIO`. Sin ellas se muestra un texto genérico.
- El registro pide aceptar ambos documentos y guarda la fecha en `negocios.terminos`.
- Son textos orientativos: revísalos con un abogado o contador antes de vender a escala.

## Página comercial bilingüe (`/` y `/en`)

- `/` sirve `public/saas.html` (español de México) y `/en` sirve `public/saas-en.html` (inglés). Las dos pasan por `conPrecios` en `server.js`, que reemplaza `__PRECIO_BASICO__`, `__PRECIO_PRO__`, `__BASE__` y `__SOPORTE__`. En `/en` el enlace de soporte por WhatsApp sale en inglés con `soporte('en')` de `sitio.js`.
- **SEO:** cada página tiene su canonical (`/` y `/en`), su `og:locale` (`es_MX` / `en_US`) con la alternativa del otro idioma y su JSON-LD en su idioma: `SoftwareApplication` con precios en MXN y `FAQPage`. Las dos llevan `<link rel="alternate" hreflang>`: `es-MX` → `/`, `en` → `/en` y `x-default` → `/`.
- **Selector de idioma ES/EN** en el encabezado y en el pie, con `aria-current="page"` en el idioma actual.
- En inglés, los enlaces a páginas que solo existen en español (`/registro`, `/terminos`, `/privacidad`, `/estilo-internacional`) llevan `hreflang="es"` y la nota "(in Spanish)".
- **Imágenes:**
  - Reales: `public/img/landing/m-*.jpg` y `d-pagina.jpg` son capturas de Estilo Internacional, y `hero.jpg`, `vip.jpg` y `recepcion.jpg` son fotos del local.
  - Generadas con IA: `ia-*.jpg` (fade, cliente, navaja, dueño, herramientas) son **ilustraciones**. Su texto alternativo lo dice, nunca se atribuyen a la barbería ni a un cliente, y cada sección donde aparecen lleva el crédito "Imágenes ilustrativas generadas con IA" / "Illustrative AI-generated images".
- **Al cambiar el texto de la landing, cambia los dos archivos.** Tienen la misma estructura de secciones; la versión en inglés tiene una pregunta frecuente más. El servidor guarda el HTML en memoria la primera vez que lo lee: reinícialo para ver los cambios.
- **"Entrar a mi panel"** abre una ventana (`<dialog>`) y lleva a `/<slug>/admin`. Acepta:
  - el enlace de la barbería;
  - la dirección completa pegada;
  - el nombre con acentos o espacios ("Barbería José" → `barberia-jose`, igual que el enlace que propone el registro).

  Si no sale ningún enlace, avisa en lugar de quedarse sin hacer nada.
- **Pruebas:** `test/landing.test.js` revisa:
  - estado 200, idioma, hreflang y selector de idioma;
  - precios, que no queden marcadores y que el JSON-LD sea válido;
  - que existan todas las imágenes y que las de IA lleven su crédito;
  - la lógica de "Entrar a mi panel".

## Agenda: citas cada hora o cada 30 minutos

Cada barbería decide cada cuánto se pueden apartar citas y si abre en punto o a la media hora. Se configura en **Panel → Ajustes → Horario de citas**, que solo ve el dueño.

- **Columnas en `negocios`:** `intervalo` (60 por defecto o 30) y `abre_min` (0 por defecto o 30). Se crean al arrancar con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Con 60 y 0 la agenda funciona igual que antes, con horas completas.
- **Espacios del día (`todas(n)` en `server.js`):** empiezan en `hora_ini:abre_min` y avanzan de `intervalo` en `intervalo` mientras su hora sea menor o igual a `hora_fin` (la «última cita»). Ejemplos:
  - Cada 30 min, de 9 a 19: 9:00, 9:30 … 19:30.
  - Cada 30 min abriendo 9:30: 9:30, 10:00 … 19:30.
  - Cada hora abriendo 9:30: 9:30, 10:30 … 19:30.
- **Una cita ocupa un espacio.** `ranura(n, hora)` da el espacio que contiene una hora. Por eso una cita registrada a mano a las 10:17, o una de cuando la agenda era por hora, ocupa el espacio donde cae. Las citas que ya existían siguen siendo válidas.
- **Bloqueos:** un bloqueo con hora tapa solo ese espacio. Un bloqueo sin hora tapa todo el día.
- **Horas pasadas:** `pasada(fecha, hora)` compara con los minutos actuales de Mérida (`ahoraM()`). A las 10:15 ya pasó el espacio de las 10:00, pero no el de las 10:30.
- **Reservas:** `POST /citas` y `/reprogramar` solo aceptan un espacio exacto del horario. Rechazan con 409 lo que `ocupadas()` marca como ocupado, igual que `/horarios`. `POST /admin/cita` admite cualquier hora (por ejemplo, «ahora · ya llegó»), pero no permite dos citas pendientes en el mismo espacio del mismo barbero.
- **Agenda llena (`tiempo.js`):** recibe `todas`, `ranura` y `pasada` de `server.js`. Así «libre» significa exactamente lo mismo que en la agenda del cliente.
- **Rutas:**
  - `GET /api/:slug/info` y `GET /admin/ajustes` ahora también devuelven `intervalo`, `abre_min`, `horas` (los espacios del día) y `termina` (cuándo acaba el último espacio).
  - `GET /admin/agenda/config` y `POST /admin/agenda/config` (`{ intervalo: 30|60, abre_min: 0|30 }`): solo el dueño. Un barbero recibe 403 y un valor inválido, 400.
- **Pantallas:** la agenda del cliente, la página del negocio y el panel muestran las horas en formato de 12 h («9:30 a. m.»).
- **Pruebas:** `test/agenda.test.js`.

**Notas de la revisión:**
- **Patrón histórico (Agenda llena):** si dos citas caen en el mismo espacio (por ejemplo, un «no llegó» a las 10:00 y alguien sin cita que llegó a las 10:20), las dos ocupan ese espacio y la inasistencia se sigue contando.
- **Panel, agenda del día:** «Siguiente» toma el espacio que contiene la hora actual según el horario de la barbería. Con «cada hora a la media hora», la cita de las 9:30 sigue siendo la siguiente a las 10:15.
- **Cambios que endurecen la regla, también con intervalo 60:** `POST /citas` y `/reprogramar` ya no aceptan horas fuera de los espacios (antes se colaba «10:30» en una agenda por hora). Una cita registrada a una hora que no es en punto («ahora · ya llegó» a las 10:17) ahora ocupa su espacio, que de todos modos ya pasó.

## Referencias de estilo editables

- **Referencias de estilo (editables):** se editan en la pestaña **Página** del panel → "Referencias de estilo" (`public/admin-referencias.js`). Son filas de `estilos` con `tipo='referencia'`. Además tienen `orden` (su lugar en la página) e `ia` (la marca "generada con IA"). Su foto es una fila de `imagenes` con `tipo='servicio'` y `ref` = id del estilo. El dueño puede:
  - crear o editar con `POST /api/:slug/admin/referencia` `{id?, nombre (40), descripcion (160), etiqueta? (40), ia}`;
  - listar con `GET /api/:slug/admin/referencias`;
  - borrar con `POST /api/:slug/admin/referencia/borrar` `{id}` (también borra la foto);
  - reordenar con `POST /api/:slug/admin/referencias/orden` `{ids:[...]}` (la lista completa de sus referencias, en el orden nuevo);
  - subir o cambiar la foto con `POST /api/:slug/admin/referencia/foto` `{id, data:'data:image/jpeg;base64,...'}`. Solo acepta JPG (se comprueba por sus bytes `FF D8 FF`) de 750 KB como máximo, y el panel la achica a 1200 px antes de subirla. Si llegan dos subidas a la vez para la misma referencia, una responde 409;
  - quitar la foto con `POST /api/:slug/admin/referencia/foto/borrar` `{id}`.
- Máximo 24 referencias por barbería. Solo el dueño puede editarlas: el barbero recibe 403 y sin sesión la respuesta es 401.
- En la página con el tema Estilo Internacional salen en el orden elegido. La leyenda "Referencia generada con IA" aparece solo en las que tienen la marca `ia`; una etiqueta que mencione "IA" no basta. El aviso del encabezado cambia según el caso: todas de IA, una mezcla o ninguna. Los botones de filtro salen solo con 2 a 8 referencias. Sin referencias no aparecen ni la sección ni su enlace en el menú.
- **Migración:** al arrancar, la leyenda vieja escrita en `etiqueta` ("Referencia generada con IA") se convierte en `ia=true` y la etiqueta queda vacía. Es idempotente, así que las 6 referencias sembradas de Estilo Internacional se ven igual y no se duplican.
- Pruebas: `test/referencias.test.js`.

## Programa de lealtad (tarjeta de sellos)

Pestaña **Clientes** del panel, sección "Tarjeta de sellos". Ayuda a que los clientes regresen: cada visita atendida suma un sello y al juntar las visitas que pide el programa el cliente gana su premio.

**Reglas**
- Una visita es una cita en estado `completada`. Las citas pendientes, canceladas o en las que el cliente no llegó (`no_llego`) no cuentan.
- Solo cuentan las visitas con fecha igual o posterior a la **fecha de inicio** del programa y posteriores al **último premio canjeado** por ese cliente. Al registrar un premio, su conteo vuelve a cero.
- Se identifica al cliente por su teléfono: los últimos 10 dígitos, así que `+52 999 111 0001`, `529991110001` y `999-111-0001` son la misma persona. Las citas sin un teléfono de 10 dígitos no entran al programa.
- El número de visitas para el premio va de 3 a 20. Si el programa está activo, hay que escribir cuál es el premio (máximo 120 caracteres). La fecha de inicio no puede ser futura; si no se indica, empieza hoy.
- El premio solo se registra si el cliente ya juntó las visitas y el programa está activo. Si se da clic dos veces, no se registra dos veces.

**Rutas del dueño** (un barbero recibe 403)
- `GET /api/:slug/admin/lealtad/config`: devuelve `{activo, cada, premio, desde, min, max, hoy}`.
- `POST /api/:slug/admin/lealtad/config` con `{activo, cada, premio, desde}`: se puede mandar solo lo que cambia; lo demás se conserva.
- `GET /api/:slug/admin/lealtad/clientes`: devuelve `{config, resumen:{clientes, listos, canjes}, clientes:[{tel, nombre, visitas, faltan, listo, ultima, canjes, ultimos:[{fecha, nota}], wa}]}`. Aparecen primero los clientes listos para su premio y después los que están más cerca. `wa` es un enlace de WhatsApp (wa.me) con el mensaje sugerido: "te faltan N visitas para tu premio" o "¡ya ganaste tu premio…!".
- `POST /api/:slug/admin/lealtad/canje` con `{telefono, nota}`: registra el premio entregado con la fecha de hoy en Mérida. Responde 400 si al cliente le faltan visitas o si el programa está apagado.

**Ruta pública**
- `GET /api/:slug/lealtad?tel=XXXXXXXXXX` devuelve solo `{activo, cada, premio, visitas, faltan}` de ese teléfono, sin nombres ni datos de otros clientes. Si el programa está apagado devuelve `{activo:false}`. Admite 30 consultas cada 10 minutos por IP y no se guarda en caché. La idea es mostrarlo más adelante en la agenda del cliente.

**Tablas**
- `lealtad_config(negocio_id PK, activo, cada, premio, desde, actualizado)`
- `lealtad_canjes(id, negocio_id, telefono, fecha, nota, visitas, creado)`, con un índice en `(negocio_id, telefono, fecha)`.

**Pruebas:** `node --test test/lealtad.test.js`

**Notas de la revisión:**
- En `GET /api/:slug/admin/lealtad/clientes`, `wa` es `null` si el programa está apagado o no tiene premio, y el panel oculta entonces el botón "Enviar por WhatsApp". Así no se le promete al cliente un premio que no existe.
- Si el programa nunca se configuró, la lista del dueño cuenta las visitas desde hoy, que es la fecha que tomará al activarse sin indicar otra. Para darle crédito a clientes de antes, hay que elegir una fecha de inicio pasada.
- El enlace a la agenda dentro del mensaje usa PUBLIC_URL sin la diagonal final.
- Pendiente conocido: al registrar el premio, las visitas que pasen de las requeridas no se guardan para la siguiente tarjeta.

## Dónde alojarlo

- **Ahora:** un servidor de Akamai Cloud con todo (agenda, PostgreSQL, agente de WhatsApp y HTTPS automático), que se actualiza solo con cada push a `main`. Ver `infra/akamai` en el repo AgenteWhatsapp.
- **Con dominio propio:** Cloudflare delante (DNS, CDN, HTTPS), fotos en R2 en lugar de la tabla `imagenes` (hoy guarda los archivos dentro de PostgreSQL) y un dominio por barbería con Cloudflare for SaaS (incluye 100).
- **Crecer:** si hay decenas de barberías pagando o la base y las fotos crecen mucho, un servidor más grande en Akamai, o la base en un servicio administrado. Confirma los precios en las páginas oficiales antes de comprar; cambian seguido.

## App instalable (PWA)

Cada barbería se puede instalar como app desde su página (`/<slug>`): botón "Instalar app" en Android/Chrome, o Compartir → Añadir a pantalla de inicio en iPhone. El manifest (`/<slug>/manifest.json`) usa el nombre del negocio (y, si tiene logo propio, sus íconos y el fondo crema) y `public/sw.js` muestra `offline.html` sin internet; las citas nunca se guardan en caché.

## SEO

La landing sale con título, descripción, vista previa para WhatsApp/redes y URL canónica generados por el servidor. Hay `GET /sitemap.xml` (negocios vigentes) y `public/robots.txt`.

## Despliegue (Akamai)

El servidor de Akamai sigue este repo (rama `main`): cada 2 minutos revisa GitHub y, si hay cambios, recompila la agenda y la reinicia. Producción en `https://agendabarberias.xyz` (en cuanto el dominio apunte a `172.235.141.127`; mientras, `https://agenda.172-235-141-127.sslip.io`). `DATABASE_URL`, `PORT` y `PUBLIC_URL` los pone el servidor; las demás variables viven en `/opt/estilo/barberia.env` (comandos `claves` y `migrar-railway`). Los detalles están en `infra/akamai` del repo AgenteWhatsapp. Railway ya no se usa.

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

**Cuentas de clientes** (`/api/:slug/cliente/...`, cookie del cliente): `POST registro · entrar · salir · datos · borrar` · `GET yo`. Con `borrar` (pide su contraseña) el cliente borra su cuenta desde "Mi cuenta": se cierran todas sus sesiones y sus citas se quedan en la agenda del negocio, sin cuenta ligada. Pruebas: `test/cuentas.test.js`.

**API de administración** (`/api/:slug/admin/...`, cabecera `x-admin: <contraseña>`)

`GET citas · corte · catalogo · insights · bloqueos · clientes · ajustes` · `POST cita · bloqueo · bloqueo/borrar · item · borrar`

**Otras**

- `POST /api/registro` — crea una barbería (limitado a 5 por hora por IP)
- `GET /api/super/negocios`, `GET /api/super/insights`, `POST /api/super/negocio/:id` — requieren cabecera `x-super: <SUPER_PASS>`
- `GET /health`, `GET /sitemap.xml`

Los intentos fallidos de contraseña (admin y super) se limitan a 8 cada 10 minutos por IP.
