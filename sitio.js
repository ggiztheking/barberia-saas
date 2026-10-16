// Páginas del propio SaaS (no de cada barbería): términos y condiciones, aviso de privacidad y contacto de soporte.
// Los datos del titular y del soporte salen de variables de entorno (ver .env.example); los precios, de PRECIO_*,
// igual que lo que se cobra en billing.js. El aviso de privacidad de cada barbería para SUS clientes vive en legal.js.
module.exports = (app, d) => {
  const { esc } = d;
  const E = process.env;
  const VERSION = '16 de octubre de 2026'; // actualízala a mano cuando cambie el texto
  const precio = p => Number(E['PRECIO_' + p]) || { BASICO: 399, PRO: 899 }[p];
  const wa = () => { const x = String(E.SOPORTE_WHATSAPP || '').replace(/\D/g, ''); return x.length === 10 ? x : ''; };
  const titular = () => String(E.SAAS_TITULAR || '').trim() || 'el titular del servicio Agenda de Barberías';
  const domicilio = () => String(E.SAAS_DOMICILIO || '').trim() || 'Mérida, Yucatán, México';
  // Medios de contacto en texto y en HTML (enlaces), según lo que esté configurado.
  const contacto = () => {
    const L = [];
    if (wa()) L.push(`WhatsApp <a href="https://wa.me/52${wa()}">${esc(wa().replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3'))}</a>`);
    if (E.SOPORTE_CORREO) L.push(`correo <a href="mailto:${esc(E.SOPORTE_CORREO)}">${esc(E.SOPORTE_CORREO)}</a>`);
    return L.length ? L.join(' o ') : 'los medios de contacto publicados en la página principal';
  };
  // Enlace de soporte para el pie de la página comercial (vacío si no hay WhatsApp configurado).
  const soporte = () => (wa() ? ` · <a href="https://wa.me/52${wa()}?text=${encodeURIComponent('Hola, tengo una duda sobre Agenda de Barberías')}" style="color:var(--gold)">Soporte por WhatsApp</a>` : '');

  const pagina = (titulo, desc, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Agenda de Barberías</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="index, follow"><meta name="theme-color" content="#07090f">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500&family=Jost:wght@300;400&display=swap" rel="stylesheet"><link rel="icon" href="/icon-192.png"><link rel="stylesheet" href="/s.css?v=18">
<style>main{max-width:760px}main h2{margin-top:34px}main li{margin:6px 0}main a{color:var(--gold)}.v{color:var(--dim);font-size:14px}</style></head><body>
<header><a class="logo" href="/" style="text-decoration:none">AGENDA DE BARBERÍAS</a></header><main>
<h1>${esc(titulo)}</h1><p class="v">Última actualización: ${VERSION}</p>${cuerpo}
<p style="margin-top:40px"><a href="/">← Volver a Agenda de Barberías</a> · <a href="/terminos">Términos</a> · <a href="/privacidad">Privacidad</a></p></main></body></html>`;

  app.get('/terminos', (q, s) => s.type('html').send(pagina('Términos y condiciones', 'Términos del servicio de página web y agenda de citas para barberías.', `
<p>Estos términos regulan el uso de Agenda de Barberías (el "servicio"), que ofrece ${esc(titular())} (el "titular"), con domicilio en ${esc(domicilio())}, a barberías y negocios de belleza (el "cliente"). Al crear una cuenta aceptas estos términos.</p>
<h2>1. El servicio</h2>
<p>Página web para tu barbería, agenda de citas en línea, panel de administración y las herramientas que se describen en la página principal. Las herramientas de contabilidad, marco legal y marketing son orientativas: no sustituyen a un contador, a un abogado ni a tu propio criterio.</p>
<h2>2. Prueba gratis</h2>
<p>Cada barbería nueva tiene 14 días de prueba con todo incluido, sin pedir tarjeta. Si al terminar no contratas un plan, tu página deja de recibir citas en línea; tus datos se conservan para que puedas contratar después.</p>
<h2>3. Planes y precios</h2>
<ul><li><b>Básico:</b> $${precio('BASICO')} MXN al mes, hasta 3 barberos.</li><li><b>Pro:</b> $${precio('PRO')} MXN al mes, hasta 8 barberos.</li></ul>
<p>Los precios son el total a pagar en pesos mexicanos. Si cambian, te avisamos con al menos 30 días de anticipación y el nuevo precio aplica desde tu siguiente cobro; si no estás de acuerdo, puedes cancelar antes.</p>
<h2>4. Cobro automático mensual</h2>
<p>El pago se hace en línea con Mercado Pago. Al contratar autorizas un cobro automático cada mes por el precio de tu plan, hasta que canceles. Cada pago aprobado agrega 30 días a tu servicio. No guardamos los datos de tu tarjeta: los maneja Mercado Pago. Si un cobro no se aprueba, conservas el servicio hasta la fecha que ya tenías pagada; después, tu página deja de recibir citas en línea hasta que se regularice el pago.</p>
<h2>5. Cancelación y reembolsos</h2>
<p>Puedes cancelar cuando quieras desde la pestaña <b>Plan</b> de tu panel, sin contratos ni penalizaciones. Al cancelar ya no se te cobra más y conservas el servicio hasta el final del periodo que ya pagaste. <b>Lo pagado no se reembolsa</b>, ni de forma total ni proporcional, salvo que la ley aplicable lo exija o que el cobro haya sido un error nuestro.</p>
<h2>6. Facturas</h2>
<p>Si necesitas factura (CFDI), pídela por ${contacto()} con tus datos fiscales dentro del mismo mes del pago.</p>
<h2>7. Tus datos y los de tus clientes</h2>
<p>La información de tu barbería y de tus clientes es tuya. Tú eres responsable de tratarla conforme a la ley y de dar tu propio aviso de privacidad a tus clientes (el sistema te genera uno en la pestaña <b>Legal</b>). Nosotros la tratamos solo para darte el servicio, como se explica en el <a href="/privacidad">aviso de privacidad</a>.</p>
<h2>8. Uso correcto</h2>
<p>No uses el servicio para actividades ilegales, para enviar mensajes no solicitados masivos, para suplantar a otra persona o para intentar acceder a cuentas ajenas. Podemos suspender una cuenta que lo haga.</p>
<h2>9. Disponibilidad y responsabilidad</h2>
<p>Trabajamos para que el servicio esté disponible siempre, pero puede haber interrupciones por mantenimiento o fallas de proveedores (alojamiento, internet, Mercado Pago, WhatsApp). No somos responsables de ganancias perdidas por esas interrupciones; nuestra responsabilidad máxima ante ti es el monto que pagaste en los últimos 3 meses.</p>
<h2>10. Cambios a estos términos</h2>
<p>Si cambiamos estos términos te avisamos en tu panel o por correo. Si sigues usando el servicio después del aviso, aceptas los cambios.</p>
<h2>11. Ley aplicable y contacto</h2>
<p>Estos términos se rigen por las leyes de México. Para cualquier duda o aclaración escríbenos por ${contacto()}. Como consumidor también puedes acudir a la Procuraduría Federal del Consumidor (Profeco).</p>`)));

  app.get('/privacidad', (q, s) => s.type('html').send(pagina('Aviso de privacidad', 'Cómo trata Agenda de Barberías los datos de las barberías que usan el servicio.', `
<h2>1. Quién es responsable de tus datos</h2>
<p>${esc(titular())}, con domicilio en ${esc(domicilio())}, es responsable del tratamiento de los datos personales de las personas que crean y administran una cuenta en Agenda de Barberías, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares. Contacto: ${contacto()}.</p>
<h2>2. Qué datos tratamos</h2>
<ul><li><b>De tu cuenta:</b> nombre, correo electrónico, WhatsApp y una contraseña que se guarda cifrada (nadie puede leerla).</li>
<li><b>De tu barbería:</b> nombre, dirección, horarios, servicios, precios, fotos y la información que captures en tu panel (citas, gastos, comisiones, notas).</li>
<li><b>De tus pagos:</b> el plan, las fechas y el estado de tus cobros. Los datos de tu tarjeta los maneja Mercado Pago; nosotros no los recibimos.</li></ul>
<p>Los datos de los clientes de tu barbería (nombre, WhatsApp, citas) los tratamos <b>por cuenta tuya</b>, solo para darte el servicio: en ese caso tú eres el responsable y nosotros actuamos como encargados.</p>
<h2>3. Para qué los usamos</h2>
<p><b>Finalidades necesarias:</b> crear y operar tu cuenta, mostrar tu página y tu agenda, cobrar tu plan, emitir facturas, darte soporte, mantener la seguridad del servicio y cumplir obligaciones legales.</p>
<p><b>Finalidades adicionales:</b> avisarte de funciones nuevas o promociones del servicio. Si no quieres recibirlas, escríbenos por ${contacto()}; negarte no afecta tu servicio.</p>
<h2>4. Con quién los compartimos</h2>
<p>Solo con proveedores que necesitamos para dar el servicio y que los tratan por nuestra cuenta: alojamiento de servidores y base de datos (Railway, con servidores fuera de México), cobros (Mercado Pago) y envío de correos o avisos automáticos cuando los actives. Si activas el asistente de marketing con inteligencia artificial, se envían a su proveedor (Anthropic) los datos de tu negocio necesarios para generar ideas, nunca contraseñas ni los teléfonos de tus clientes. No vendemos tus datos.</p>
<h2>5. Tus derechos</h2>
<p>Puedes pedir acceso, rectificación, cancelación u oposición al uso de tus datos (derechos ARCO) y revocar tu consentimiento escribiéndonos por ${contacto()}, con tu nombre, el enlace de tu barbería y lo que solicitas. Te respondemos en un máximo de 20 días hábiles. Muchos datos los puedes corregir tú mismo desde tu panel.</p>
<h2>6. Cookies</h2>
<p>Usamos solo las cookies necesarias para mantener tu sesión iniciada en el panel. No usamos cookies de publicidad.</p>
<h2>7. Cambios a este aviso</h2>
<p>Si este aviso cambia, publicaremos la versión nueva en esta página con su fecha de actualización.</p>`)));

  return { soporte };
};
