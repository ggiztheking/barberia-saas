// Marco legal México (fase 4): checklist guiado para abrir y operar una barbería en Mérida, Yucatán,
// documentos imprimibles con los datos del negocio y la página pública del aviso de privacidad.
// Es orientación general, NO asesoría legal: cada paso trae su fuente oficial o pide verificar con quien corresponde.
// Fuentes revisadas en octubre de 2026 (ver 'fuente' de cada paso).
module.exports = (app, api, d) => {
  const { pool, auth, wrap, listo } = d;
  const Q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  (listo || Promise.resolve()).then(async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS legal_pasos (negocio_id INT NOT NULL, paso TEXT NOT NULL, hecho BOOLEAN NOT NULL DEFAULT false, nota TEXT,
      actualizado TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (negocio_id, paso))`);
    await pool.query('CREATE TABLE IF NOT EXISTS legal_datos (negocio_id INT PRIMARY KEY, titular TEXT, actualizado TIMESTAMPTZ DEFAULT now())');
    // Correo que el dueño decide publicar para temas de privacidad. No se usa el "correo para avisos de citas" de Ajustes,
    // que es privado y terminaría en una página pública indexada por buscadores.
    await pool.query('ALTER TABLE legal_datos ADD COLUMN IF NOT EXISTS correo TEXT');
  }).catch(console.error);

  const AVISO = 'Esto es orientación general para ayudarte a ordenarte, no es asesoría legal ni fiscal. Los requisitos y costos cambian: confirma cada paso con la autoridad que lo emite, con tu contador o con un abogado.';
  const VERSION = '14 de octubre de 2026'; // fecha de la última revisión de los textos de este módulo
  const LEY_DATOS = 'https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo125102.html';
  const LFT = 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf';
  const PORTAL_MERIDA = 'https://portalciudadano.merida.gob.mx/';

  const GRUPOS = [
    { id: 'sat', titulo: 'SAT (impuestos)' }, { id: 'municipio', titulo: 'Ayuntamiento de Mérida' }, { id: 'salud', titulo: 'Salud e higiene' },
    { id: 'trabajo', titulo: 'Tu equipo de barberos' }, { id: 'datos', titulo: 'Datos personales de tus clientes' }];

  // Cada paso: id estable (no cambiarlo: es la llave guardada en legal_pasos), qué es, por qué importa, qué necesitas, dónde se hace,
  // costo (solo si es oficial y verificable; si no, null) y fuente oficial (o null).
  const PASOS = [
    { id: 'sat-rfc', grupo: 'sat', titulo: 'Inscríbete en el RFC',
      porque: 'Sin RFC no puedes facturar ni sacar la licencia de funcionamiento: el Ayuntamiento de Mérida pide acreditarlo (constancia de situación fiscal, e.firma u otro comprobante del SAT).',
      necesitas: 'CURP vigente, domicilio fiscal y un correo. Si te inscribes con obligaciones fiscales, después tramitas tu contraseña o e.firma.',
      donde: 'En línea en el portal del SAT con tu CURP, o en una oficina del SAT con cita (citas.sat.gob.mx).', costo: 'Gratuito',
      fuente: 'https://www.gob.mx/cms/uploads/attachment/file/850586/Ficha_3_CFF.pdf' },
    { id: 'sat-regimen', grupo: 'sat', titulo: 'Elige tu régimen fiscal (RESICO u otro)',
      porque: 'En el Régimen Simplificado de Confianza (RESICO) las personas físicas con ingresos menores a 3.5 millones de pesos al año pagan entre 1 % y 2.5 % de sus ingresos, pero no pueden deducir gastos. Si tienes muchos gastos (renta, sueldos, equipo), otro régimen podría convenirte.',
      necesitas: 'Un estimado de tus ingresos y gastos del año. Decide con tu contador antes de dar de alta tus obligaciones.',
      donde: 'Al inscribirte en el RFC o con un aviso de actualización de actividades en el portal del SAT.', costo: null,
      fuente: 'https://www.gob.mx/sat/es/articulos/sabes-a-quien-beneficiara-el-nuevo-regimen-simplificado-de-confianza?idiom=es' },
    { id: 'sat-efirma', grupo: 'sat', titulo: 'Tramita tu e.firma',
      porque: 'Con ella haces en línea el alta patronal del IMSS y el aviso de funcionamiento en COFEPRIS, y sirve para acreditar tu RFC en la licencia de funcionamiento de Mérida.',
      necesitas: 'Cita en el SAT, identificación oficial vigente, un correo y una memoria USB. Revisa en el portal del SAT los requisitos vigentes antes de ir.',
      donde: 'En una oficina del SAT, con cita en citas.sat.gob.mx.', costo: null,
      fuente: 'https://www.sat.gob.mx/personas/tramites-del-rfc' },
    { id: 'sat-cfdi', grupo: 'sat', titulo: 'Factura CFDI 4.0 y factura global',
      porque: 'Al cliente que te pida factura le emites un CFDI 4.0. Lo que vendes al público en general se ampara con una factura global (RFC genérico XAXX010101000) con la periodicidad que te corresponda (por ejemplo, diaria, semanal, quincenal o mensual); confírmala con tu contador.',
      necesitas: 'RFC, contraseña o e.firma y los datos fiscales del cliente (RFC, nombre, código postal, régimen y uso del CFDI).',
      donde: 'Servicio gratuito de facturación del SAT o un proveedor de certificación autorizado.', costo: 'Gratuito en el portal del SAT',
      fuente: 'https://www.sat.gob.mx/aplicacion/75169/servicio-de-facturacion-cfdi-version-4.0-' },
    { id: 'sat-declaraciones', grupo: 'sat', titulo: 'Presenta tus declaraciones',
      porque: 'En RESICO presentas pagos mensuales y una declaración anual. No presentarlas genera multas y te puede sacar del régimen.',
      necesitas: 'Tus facturas emitidas y recibidas del mes. El SAT tiene un visor que precarga tus facturas.',
      donde: 'Portal del SAT, sección Declaraciones, o con tu contador. Verifica con tu contador las fechas límite que te aplican.', costo: null,
      fuente: 'https://wwwmat.sat.gob.mx/declaracion/53359/simulador-de-declaraciones-de-pagos-mensuales-y-definitivos' },

    { id: 'mid-uso-suelo', grupo: 'municipio', titulo: 'Licencia de uso de suelo para funcionamiento',
      porque: 'Es requisito previo de la licencia de funcionamiento: confirma que en ese local se permite una barbería. La emite la Dirección de Desarrollo Urbano y sus inspectores pueden clausurar si no la tienes.',
      necesitas: 'Documento que acredite la posesión del local (escritura o contrato de arrendamiento), predial al corriente y lo que pida la solicitud según tu caso (planos, fotografías, descripción de la actividad).',
      donde: 'Portal Ciudadano del Ayuntamiento de Mérida o en ventanilla de Desarrollo Urbano. El costo depende de la zona y la superficie: consúltalo en el portal.', costo: null,
      fuente: PORTAL_MERIDA },
    { id: 'mid-licencia', grupo: 'municipio', titulo: 'Licencia de funcionamiento municipal',
      porque: 'Sin ella el Ayuntamiento puede clausurar tu negocio. Vale hasta que termina la administración municipal que la emitió y se revalida en los primeros seis meses de cada administración nueva; no revalidarla tiene multa.',
      necesitas: 'Solicitud, identificación oficial, comprobante de RFC (constancia de situación fiscal o e.firma), predial al corriente, pago vigente de recolección de basura, documento notariado de posesión si el local no es tuyo y, antes, la licencia de uso de suelo.',
      donde: 'En línea en el Portal Ciudadano o en la Dirección de Finanzas y Tesorería Municipal: Calle 62 núm. 494 entre 59 y 61, Centro, Mérida (lunes a viernes de 8:00 a 15:00).',
      costo: '5 UMA según el Portal Ciudadano (586.55 pesos al consultarlo en octubre de 2026); verifica el monto vigente',
      fuente: 'https://portalciudadano.merida.gob.mx/TramitesEnLinea/detalle-tramite/189' },
    { id: 'mid-anuncio', grupo: 'municipio', titulo: 'Permiso para tu anuncio o letrero',
      porque: 'Los anuncios en fachada requieren permiso de la Dirección de Desarrollo Urbano (Imagen Publicitaria) del Ayuntamiento.',
      necesitas: 'La solicitud de anuncios del Portal Ciudadano y los documentos que pida según el tamaño y tipo de anuncio. Verifica los requisitos y el costo en el portal o en la ventanilla.',
      donde: 'Portal Ciudadano del Ayuntamiento de Mérida o ventanilla de Desarrollo Urbano.', costo: null, fuente: PORTAL_MERIDA },
    { id: 'mid-proteccion-civil', grupo: 'municipio', titulo: 'Protección Civil',
      porque: 'Protección Civil puede revisar y suspender locales con riesgos. Una guía del Ayuntamiento pide registrar un Programa Interno de Protección Civil en inmuebles donde pueden estar más de 25 personas a la vez. Verifica con Protección Civil municipal qué le toca a tu local.',
      necesitas: 'Como buena práctica, aunque no te lo pidan: extintor vigente, botiquín, salida libre y señalizada e instalación eléctrica en buen estado.',
      donde: 'Protección Civil del Ayuntamiento de Mérida.', costo: null, fuente: 'https://merida.gob.mx/proteccioncivil/content/documents/guia.pdf' },

    { id: 'salud-aviso', grupo: 'salud', titulo: 'Aviso de funcionamiento sanitario',
      porque: 'La ficha oficial del aviso de funcionamiento de establecimientos de productos y servicios incluye a "peluquerías y salones de belleza". Confirma con COFEPRIS o con Servicios de Salud de Yucatán si aplica a tu barbería.',
      necesitas: 'Alta en DIGIPRiS (trámites en línea de COFEPRIS), identificación oficial vigente y e.firma.',
      donde: 'En línea en DIGIPRiS de COFEPRIS.', costo: 'Gratuito',
      fuente: 'https://ventanillamipymes.economia.gob.mx/presentacion-de-aviso-de-funcionamiento-del-establecimiento-de-productos-y-servicios-persona-fisica/' },
    { id: 'salud-reglamento', grupo: 'salud', titulo: 'Reglamento interno de higiene y atención',
      porque: 'Deja por escrito cómo se limpian las herramientas, se usan las navajas y se atiende al cliente. Protege a tus clientes y te ayuda ante una inspección o una queja.',
      necesitas: 'Imprime el reglamento de esta pestaña, ajústalo a tu local y pégalo a la vista del equipo.',
      donde: 'En tu barbería.', costo: null, fuente: null },

    { id: 'trab-relacion', grupo: 'trabajo', titulo: 'Define si cada barbero es empleado o comisionista',
      porque: 'Para la Ley Federal del Trabajo hay relación de trabajo cuando alguien trabaja de forma personal y subordinada a cambio de un pago, sin importar cómo se llame el contrato (art. 20), y se presume que existe entre quien presta el trabajo y quien lo recibe (art. 21). Si pones horario, das órdenes, exiges exclusividad o pagas un sueldo fijo, lo más probable es que se le considere empleado aunque cobre por comisión.',
      necesitas: 'Revisar cómo trabaja en la práctica cada barbero. Si es independiente, el contrato de prestación de servicios de esta pestaña; si es empleado, contrato laboral y alta en el IMSS.',
      donde: 'Con tu contador o un abogado laboral.', costo: null, fuente: LFT },
    { id: 'trab-imss', grupo: 'trabajo', titulo: 'Alta patronal en el IMSS (si tienes empleados)',
      porque: 'Te registras como patrón desde que contratas al primer trabajador, e inscribes a cada uno en el IMSS. Verifica con el IMSS o tu contador el plazo para cada aviso.',
      necesitas: 'En línea: e.firma y comprobante de domicilio del local. En oficina: RFC, comprobante de domicilio, croquis de ubicación, identificación oficial y CURP.',
      donde: 'En línea en el portal del IMSS con tu e.firma, o en tu Subdelegación del IMSS.', costo: 'Gratuito',
      fuente: 'https://www.gob.mx/imss/es/articulos/alta-patronal-e-inscripcion-en-el-seguro-de-riesgos-de-trabajo-o-reanudacion-de-actividades-para-personas-fisicas' },
    { id: 'trab-nomina', grupo: 'trabajo', titulo: 'Impuesto estatal sobre nómina (si pagas sueldos)',
      porque: 'En Yucatán quien paga sueldos o remuneraciones por trabajo bajo su dirección paga el Impuesto sobre Erogaciones por Remuneración al Trabajo Personal (tasa publicada de 3.75 %), a más tardar el día 10 del mes siguiente.',
      necesitas: 'Tu nómina del mes. Confirma con tu contador si te aplica algún estímulo para micro y pequeñas empresas.',
      donde: 'Agencia de Administración Fiscal de Yucatán (AAFY).', costo: null, fuente: 'https://tramites.yucatan.gob.mx/tramite/21ed8512' },

    { id: 'datos-aviso', grupo: 'datos', titulo: 'Publica tu aviso de privacidad',
      porque: 'La Ley Federal de Protección de Datos Personales en Posesión de los Particulares (DOF 20 de marzo de 2025) te obliga a informar qué datos recabas y para qué (art. 15). En medios electrónicos se da el aviso simplificado con el enlace al integral (art. 16). La autoridad ahora es la Secretaría Anticorrupción y Buen Gobierno, que asumió las funciones del INAI.',
      necesitas: 'Tu dirección y el WhatsApp del negocio en Ajustes y, si quieres, un correo para temas de privacidad en esta pestaña. El sistema ya genera tu aviso integral y simplificado con lo que la agenda realmente guarda.',
      donde: 'Tu página pública de aviso de privacidad (enlace abajo). Ponla también a la vista en el local.', costo: null, fuente: LEY_DATOS },
    { id: 'datos-arco', grupo: 'datos', titulo: 'Atiende las solicitudes de tus clientes (derechos ARCO)',
      porque: 'Tus clientes pueden pedir acceder, corregir, cancelar u oponerse al uso de sus datos. Debes responder en máximo 20 días hábiles y hacerlo efectivo en los 15 siguientes; esos plazos solo se pueden ampliar una vez, por un periodo igual y si el caso lo justifica (art. 31). Si no respondes, pueden acudir a la Secretaría Anticorrupción y Buen Gobierno (art. 40).',
      necesitas: 'Decide quién revisa el correo o WhatsApp que aparece en tu aviso y lleva un registro de cada solicitud.',
      donde: 'Desde tu correo o WhatsApp de contacto.', costo: null, fuente: LEY_DATOS },
    { id: 'datos-promos', grupo: 'datos', titulo: 'Respeta a quien no quiere promociones',
      porque: 'Las promociones, felicitaciones y solicitudes de reseña son finalidades secundarias: el cliente puede negarse sin perder su cita (art. 15, fracciones III y IV).',
      necesitas: 'Cuando alguien te lo pida, desmarca "Recibe avisos y promociones" en su ficha del CRM.',
      donde: 'CRM → Clientes.', costo: null, fuente: LEY_DATOS },
    { id: 'datos-seguridad', grupo: 'datos', titulo: 'Cuida el acceso a los datos de tus clientes',
      porque: 'La ley exige medidas de seguridad administrativas, técnicas y físicas para proteger los datos personales (art. 18).',
      necesitas: 'Una cuenta por persona (nunca compartas tu contraseña), desactivar a quien deje el equipo y borrar los archivos de Excel exportados cuando ya no los uses.',
      donde: 'Ajustes → Equipo.', costo: null, fuente: LEY_DATOS }];
  const PASO = new Map(PASOS.map(p => [p.id, p])); // Map: un 'paso' como "__proto__" o "constructor" no se cuela como válido

  const DOCS = [
    { tipo: 'aviso-integral', titulo: 'Aviso de privacidad integral', desc: 'El completo. Es el mismo que se publica en tu página.' },
    { tipo: 'aviso-simplificado', titulo: 'Aviso de privacidad simplificado', desc: 'Versión corta para el mostrador, carteles o la agenda.' },
    { tipo: 'contrato', titulo: 'Contrato con barbero comisionista', desc: 'Prestación de servicios independientes, con advertencia sobre la subordinación.' },
    { tipo: 'reglamento', titulo: 'Reglamento interno de higiene y atención', desc: 'Reglas básicas del local para el equipo.' }];
  const DOC = new Map(DOCS.map(x => [x.tipo, x]));

  // ---- Datos del negocio que usan los documentos
  const tel = v => { const x = String(v || '').replace(/\D/g, ''), t = x.length === 12 && x.startsWith('52') ? x.slice(2) : x; return t.length === 10 ? `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}` : t; };
  const datos = async n => {
    const r = (await Q('SELECT titular,correo FROM legal_datos WHERE negocio_id=$1', [n.id]))[0] || {};
    // El WhatsApp del negocio ya es público (landing y agenda); el correo es el que el dueño captura aquí para privacidad.
    return { nombre: n.nombre, titular: String(r.titular || '').trim(), direccion: String(n.direccion || '').trim(), correo: String(r.correo || '').trim(), whatsapp: tel(n.whatsapp), slug: n.slug };
  };
  const correoOk = v => /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/.test(v);
  const faltan = x => [!x.direccion && 'direccion', !x.correo && !x.whatsapp && 'contacto', !x.titular && 'titular'].filter(Boolean);
  const base = q => `${q.protocol}://${q.get('host')}`;
  const barberos = n => String(n.barberos || '').split(',').map(t => t.trim()).filter(Boolean);

  // ---- Documentos (HTML imprimible). 'pend' marca en amarillo lo que falta llenar; en la página pública no se usa.
  const pend = t => `<mark>[${esc(t)}]</mark>`;
  const v = (x, txt, pub) => x ? esc(x) : pub ? '' : pend(txt);
  // Medio para ejercer derechos ARCO y negarse a promociones (art. 15 fr. IV y V). Sin correo ni WhatsApp, la página pública remite al local.
  const contacto = (x, pub) => [x.correo && `por correo a <b>${esc(x.correo)}</b>`, x.whatsapp && `por WhatsApp al <b>${esc(x.whatsapp)}</b>`].filter(Boolean).join(' o ')
    || (pub ? 'en persona en nuestra barbería' : pend('pon el WhatsApp del negocio en Ajustes o un correo de privacidad en la pestaña Legal'));
  const responsable = (x, pub) => x.titular ? `<b>${esc(x.titular)}</b>, que opera la barbería <b>${esc(x.nombre)}</b>` : `<b>${esc(x.nombre)}</b>${pub ? '' : ' ' + pend('nombre completo o razón social del titular')}`;
  const domicilio = (x, pub) => x.direccion ? `, con domicilio en ${esc(x.direccion)}` : pub ? '' : `, con domicilio en ${pend('completa la dirección en Ajustes')}`;

  const avisoIntegral = (x, url, pub) => `
<h1>Aviso de privacidad integral</h1>
<p class="sub">${esc(x.nombre)} · Última actualización: ${VERSION}</p>
<h2>1. Quién es responsable de tus datos</h2>
<p>${responsable(x, pub)}${domicilio(x, pub)}, es responsable del tratamiento de tus datos personales. Para cualquier tema de privacidad comunícate con nosotros ${contacto(x, pub)}.</p>
<h2>2. Qué datos tratamos</h2>
<ul>
<li><b>Cuando agendas una cita:</b> tu nombre, tu número de WhatsApp, el servicio y los extras que eliges, el barbero, la fecha y la hora, el precio, el código de la cita y su estado (pendiente, atendida, cancelada o no llegó).</li>
<li><b>Si creas una cuenta (es opcional):</b> tu nombre, tu WhatsApp y una contraseña. La contraseña se guarda cifrada; nadie del equipo puede verla.</li>
<li><b>Si te apuntas a un evento:</b> tu nombre y tu WhatsApp.</li>
<li><b>Lo que el equipo puede anotar para atenderte mejor:</b> notas sobre tu servicio (por ejemplo, el corte que prefieres), etiquetas, el día y mes de tu cumpleaños si nos lo das, tu preferencia para recibir promociones y el registro de los mensajes que te enviamos.</li>
</ul>
<p>No te pedimos datos sensibles (como datos de salud, religión u orientación sexual) ni datos financieros o patrimoniales: el pago se hace en la barbería. Pedimos al equipo no anotar datos sensibles en tus notas.</p>
<h2>3. Para qué usamos tus datos</h2>
<p><b>Finalidades necesarias</b> (sin ellas no podemos darte el servicio):</p>
<ul><li>Agendar, confirmar, reprogramar o cancelar tus citas y avisar al barbero que te atenderá.</li><li>Enviarte recordatorios de tu cita.</li>
<li>Llevar el historial de tus servicios para atenderte mejor.</li><li>Administrar tu cuenta, si la creas, y registrar tu asistencia a eventos.</li><li>Cumplir obligaciones legales y fiscales.</li></ul>
<p><b>Finalidades secundarias</b> (no son necesarias y puedes negarte):</p>
<ul><li>Enviarte promociones, campañas y mensajes para invitarte a regresar.</li><li>Felicitarte en tu cumpleaños.</li><li>Pedirte que califiques nuestro servicio o dejes una reseña.</li><li>Hacer estadísticas internas de nuestro negocio.</li></ul>
<p><b>Cómo negarte:</b> dinos "No quiero promociones" ${contacto(x, pub)}. Te quitamos de esas listas y seguirás recibiendo solo lo relacionado con tus citas. Negarte no afecta tus citas.</p>
<h2>4. Con quién compartimos tus datos</h2>
<p>No vendemos tus datos ni los transferimos a terceros sin tu consentimiento, salvo en los casos que permite el artículo 36 de la ley (por ejemplo, cuando lo exige una ley o es necesario para la procuración o administración de justicia).</p>
<p>Usamos proveedores de tecnología que tratan tus datos solo por nuestra cuenta y siguiendo nuestras instrucciones: la plataforma de agenda en línea y su alojamiento, el servicio de correo y, en su caso, la herramienta de automatización con los que recibimos los avisos de citas, y WhatsApp cuando lo usamos para enviarte mensajes. Algunos de estos proveedores pueden tener sus servidores fuera de México.</p>
<h2>5. Cookies y almacenamiento en tu dispositivo</h2>
<p>La agenda usa una cookie técnica para mantener abierta tu sesión si creas una cuenta, y guarda en tu propio navegador los códigos de tus citas para que puedas verlas, cambiarlas o cancelarlas. No usamos cookies de publicidad. Puedes borrarlas desde tu navegador; solo tendrías que volver a iniciar sesión.</p>
<h2>6. Tus derechos (ARCO) y cómo ejercerlos</h2>
<p>Puedes <b>acceder</b> a tus datos, <b>rectificarlos</b> si están mal, <b>cancelarlos</b> u <b>oponerte</b> a su uso, además de revocar tu consentimiento o limitar el uso de tus datos. Haz tu solicitud ${contacto(x, pub)} con tu nombre, el WhatsApp con el que agendas, qué derecho quieres ejercer y una descripción clara de lo que pides. Podemos pedirte que confirmes tu identidad.</p>
<p>Te responderemos en un plazo máximo de 20 días hábiles y, si procede, lo haremos efectivo dentro de los 15 días hábiles siguientes (artículo 31 de la ley). Si tienes cuenta, puedes corregir tu nombre en "Mi cuenta" de la agenda. Si no estás conforme con nuestra respuesta, o no te respondemos, puedes iniciar el procedimiento de protección de derechos ante la Secretaría Anticorrupción y Buen Gobierno (artículo 40 de la ley).</p>
<h2>7. Cuánto tiempo guardamos tus datos</h2>
<p>Mientras tengas citas o cuenta con nosotros y sean necesarios para las finalidades de este aviso, y por el tiempo que exijan las leyes. Después los cancelamos.</p>
<h2>8. Tu consentimiento</h2>
<p>Si agendas después de conocer este aviso y no manifiestas lo contrario, consientes el tratamiento de tus datos para las finalidades necesarias (artículo 7 de la ley). Para las secundarias puedes negarte en cualquier momento como se indica arriba.</p>
<h2>9. Cambios a este aviso</h2>
<p>Publicaremos cualquier cambio en ${url ? `<a href="${esc(url)}">${esc(url)}</a>` : 'nuestra página'}, con su fecha de actualización.</p>
<p class="ley">Fundamento: Ley Federal de Protección de Datos Personales en Posesión de los Particulares, publicada en el Diario Oficial de la Federación el 20 de marzo de 2025.</p>`;

  const avisoSimplificado = (x, url, pub) => `
<h1>Aviso de privacidad simplificado</h1>
<p class="sub">${esc(x.nombre)} · Última actualización: ${VERSION}</p>
<p>${responsable(x, pub)}${domicilio(x, pub)}, usará tu nombre, tu WhatsApp y los datos de tus citas (servicio, barbero, fecha, hora, precio y asistencia) y, si creas una cuenta, tu contraseña cifrada, para <b>agendar y administrar tus citas, enviarte recordatorios y llevar tu historial de servicios</b>.</p>
<p>Si no te opones, también los usaremos para <b>enviarte promociones, felicitarte en tu cumpleaños y pedirte una reseña</b>. Para negarte, dinos "No quiero promociones" ${contacto(x, pub)}; tus citas no se verán afectadas.</p>
<p>Consulta el aviso de privacidad integral en ${url ? `<a href="${esc(url)}">${esc(url)}</a>` : 'nuestra página'}.</p>`;

  const contrato = (x, b) => `
<div class="alerta"><b>Advertencia antes de firmar.</b> Este contrato solo sirve si el barbero de verdad trabaja de forma independiente. Para la Ley Federal del Trabajo hay relación laboral cuando alguien presta un trabajo personal subordinado a cambio de un pago, sin importar el nombre del contrato (art. 20), y se presume que existe entre quien presta el trabajo y quien lo recibe (art. 21). Si le fijas horario, le das órdenes sobre cómo trabajar, le exiges exclusividad, le pones multas o le pagas un sueldo fijo, en un juicio se le puede considerar empleado y tendrías que pagar prestaciones, cuotas del IMSS e indemnizaciones. Revísalo con un abogado laboral.</div>
<h1>Contrato de prestación de servicios independientes</h1>
<p>Que celebran, por una parte, ${x.titular ? `<b>${esc(x.titular)}</b>` : pend('nombre completo o razón social del titular')}, quien opera la barbería <b>${esc(x.nombre)}</b>${domicilio(x)}, a quien en adelante se le llama "LA BARBERÍA"; y por la otra, <b>${b.nombre ? esc(b.nombre) : pend('nombre completo del barbero')}</b>, con RFC ${pend('RFC del barbero')} y domicilio en ${pend('domicilio del barbero')}, a quien en adelante se le llama "EL PRESTADOR", de acuerdo con las siguientes cláusulas.</p>
<h2>Cláusulas</h2>
<ol>
<li><b>Objeto.</b> EL PRESTADOR prestará servicios de corte de cabello, arreglo de barba y servicios relacionados a los clientes que lo elijan en el local de LA BARBERÍA, con sus propios conocimientos y criterio profesional.</li>
<li><b>Independencia.</b> EL PRESTADOR decide los días y horas en que está disponible y los registra en la agenda; puede prestar servicios a otras personas o negocios; no está sujeto a un horario ni a órdenes sobre la forma de hacer su trabajo, salvo las reglas de higiene y convivencia del local, y usa sus propias herramientas de trabajo (máquinas, tijeras y navajas).</li>
<li><b>Pago.</b> EL PRESTADOR recibirá el ${b.comision ? esc(b.comision) + ' %' : pend('porcentaje') + ' %'} de lo cobrado por los servicios que él atienda, sin incluir la venta de productos. El pago se hará cada ${pend('semana / quincena')} con el desglose de los servicios registrados en la agenda. EL PRESTADOR entregará un comprobante fiscal (CFDI) por cada pago y cada parte cumplirá por su cuenta sus obligaciones fiscales.</li>
<li><b>Lo que pone LA BARBERÍA.</b> El local, la silla, los servicios del local y el sistema de citas en línea.</li>
<li><b>Datos de los clientes.</b> Los datos personales de los clientes son responsabilidad de LA BARBERÍA. EL PRESTADOR los usará solo para atender las citas, no los copiará, no los usará para fines propios y guardará confidencialidad aun después de terminar este contrato, de acuerdo con el aviso de privacidad de LA BARBERÍA.</li>
<li><b>Higiene y seguridad.</b> EL PRESTADOR cumplirá las reglas de higiene y seguridad del local, que se anexan.</li>
<li><b>Responsabilidad.</b> EL PRESTADOR responde por los daños que cause a los clientes o a terceros por negligencia en sus servicios.</li>
<li><b>Vigencia y terminación.</b> Este contrato es por tiempo indefinido. Cualquiera de las partes puede darlo por terminado avisando por escrito con ${pend('número')} días de anticipación.</li>
<li><b>Naturaleza del contrato.</b> Las partes declaran que este es un contrato de prestación de servicios y que no existe subordinación entre ellas. Esta declaración no tiene efecto si en la práctica la relación funciona de otra forma.</li>
<li><b>Jurisdicción.</b> Para interpretar y cumplir este contrato, las partes se someten a las leyes y a los tribunales competentes de Mérida, Yucatán.</li>
</ol>
<p>Firmado en Mérida, Yucatán, el ${pend('fecha')}.</p>
<div class="firmas"><div>LA BARBERÍA<br>${x.titular ? esc(x.titular) : '&nbsp;'}</div><div>EL PRESTADOR<br>${b.nombre ? esc(b.nombre) : '&nbsp;'}</div></div>`;

  const reglamento = x => `
<h1>Reglamento interno de higiene y atención</h1>
<p class="sub">${esc(x.nombre)}${x.direccion ? ' · ' + esc(x.direccion) : ''}</p>
<h2>Higiene</h2>
<ol>
<li>Lávate las manos antes y después de atender a cada cliente.</li>
<li>Limpia y desinfecta peines, tijeras, máquinas y cuchillas entre un cliente y otro.</li>
<li>Usa una hoja de navaja nueva con cada cliente y deséchala en un recipiente rígido para objetos cortantes.</li>
<li>Usa toalla, capa limpia y cuello desechable con cada cliente.</li>
<li>Barre el cabello después de cada servicio y limpia la silla y el área de trabajo.</li>
<li>Mantén los productos cerrados, etiquetados y dentro de su fecha de caducidad.</li>
<li>Si el cliente tiene una herida, irritación o infección visible en la zona, no hagas el servicio en esa área y explícale por qué.</li>
<li>No comas en el área de trabajo. Si tienes una enfermedad contagiosa, avisa y no atiendas.</li>
</ol>
<h2>Atención al cliente</h2>
<ol>
<li>Registra cada cita y cada servicio en la agenda y márcalo como atendido al terminar.</li>
<li>Cobra los precios publicados. Cualquier descuento se registra.</li>
<li>Respeta la hora de cada cita. La tolerancia para clientes que llegan tarde es de ${pend('minutos')} minutos.</li>
<li>Trata a todos los clientes con respeto, sin discriminar a nadie.</li>
<li>No uses el celular para asuntos personales mientras atiendes.</li>
<li>Los datos de los clientes son confidenciales: no los copies, no los compartas y no los uses para fines personales.</li>
<li>Pide permiso al cliente antes de tomarle fotos o publicarlas.</li>
</ol>
<h2>Seguridad</h2>
<ol>
<li>Mantén libres las salidas y los pasillos.</li>
<li>Conoce dónde están el extintor y el botiquín, y avisa si algo falta o está vencido.</li>
<li>Desconecta los aparatos eléctricos al terminar el día y reporta cables dañados.</li>
</ol>
<p class="ley">Si trabajas con barberos comisionistas independientes, presenta estas reglas como normas de higiene y convivencia del local. Evita multas o sanciones disciplinarias, que son propias de una relación laboral.</p>
<div class="firmas"><div>Nombre y firma de quien lo recibe</div><div>Fecha</div></div>`;

  const CSS = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:#1d1b16;font:16px/1.6 Georgia,'Times New Roman',serif}
main{max-width:780px;margin:0 auto;padding:24px 18px 48px;background:#fff}h1{font-size:26px;line-height:1.2;margin:14px 0 4px}h2{font-size:18px;margin:24px 0 6px}
.sub{color:#6b665b;margin:0 0 14px;font-size:14px}ul,ol{padding-left:22px}li{margin:4px 0}a{color:#7a5b12}mark{background:#fff1a8;padding:0 3px}
.nota{border:1px solid #d9c48a;background:#fffaf0;padding:10px 14px;font:14px/1.5 system-ui,sans-serif;margin:0 0 14px}
.alerta{border:2px solid #b5452f;background:#fdf1ee;padding:12px 14px;font:14px/1.5 system-ui,sans-serif;margin:8px 0 10px}
.barra{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font:14px system-ui,sans-serif;margin-bottom:14px}.barra button{font:inherit;padding:10px 16px;border:0;background:#1d1b16;color:#fff;cursor:pointer}
.ley{font-size:13px;color:#6b665b;margin-top:22px}.firmas{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:56px;text-align:center;font-size:14px}.firmas div{border-top:1px solid #1d1b16;padding-top:6px}
@media print{body{background:#fff}main{padding:0;max-width:none}.barra,.no-imprimir{display:none}mark{background:none;border-bottom:1px solid #1d1b16}a{color:inherit}}`;
  const pagina = ({ titulo, cuerpo, robots, extra = '', pie = '' }) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="${robots}"><title>${esc(titulo)}</title>${extra}<style>${CSS}</style></head><body><main>${cuerpo}${pie}</main></body></html>`;
  const notaGeneral = `<p class="nota">${esc(AVISO)} Revisa el documento y ajústalo a tu caso antes de usarlo.</p>`;

  // ---- Rutas del dueño
  api.get('/admin/legal/pasos', auth, wrap(async (q, s) => {
    const [filas, x] = await Promise.all([Q('SELECT paso,hecho,nota,actualizado FROM legal_pasos WHERE negocio_id=$1', [q.neg.id]), datos(q.neg)]);
    const F = Object.fromEntries(filas.filter(f => PASO.has(f.paso)).map(f => [f.paso, f]));
    const hechos = PASOS.filter(p => F[p.id] && F[p.id].hecho).length;
    s.json({ aviso: AVISO, version: VERSION, total: PASOS.length, hechos, progreso: Math.round(hechos * 100 / PASOS.length),
      grupos: GRUPOS.map(g => ({ ...g, pasos: PASOS.filter(p => p.grupo === g.id).map(p => ({ ...p, hecho: !!(F[p.id] && F[p.id].hecho), nota: (F[p.id] && F[p.id].nota) || '', actualizado: (F[p.id] && F[p.id].actualizado) || null })) })),
      docs: DOCS, privacidad: `/${q.neg.slug}/privacidad`, titular: x.titular, correo: x.correo, faltan: faltan(x), barberos: barberos(q.neg) });
  }));

  api.post('/admin/legal/paso', auth, wrap(async (q, s) => {
    const paso = String(q.body.paso || '');
    if (!PASO.has(paso)) return s.status(400).json({ error: 'Ese paso no existe' });
    // Si no se manda 'hecho' (por ejemplo, solo se guarda una nota) se conserva el valor anterior en vez de desmarcar el paso.
    const h = q.body.hecho, hecho = h === undefined || h === null ? null : h === true || h === 'true' || h === 1 || h === '1';
    const nota = q.body.nota === undefined || q.body.nota === null ? null : String(q.body.nota).trim().slice(0, 500);
    const r = await Q(`INSERT INTO legal_pasos(negocio_id,paso,hecho,nota,actualizado) VALUES($1,$2,COALESCE($3::boolean,false),COALESCE($4,''),now())
      ON CONFLICT (negocio_id,paso) DO UPDATE SET hecho=COALESCE($3::boolean,legal_pasos.hecho), nota=COALESCE($4,legal_pasos.nota), actualizado=now() RETURNING hecho`, [q.neg.id, paso, hecho, nota]);
    const hechos = (await Q('SELECT COUNT(*)::int n FROM legal_pasos WHERE negocio_id=$1 AND hecho AND paso=ANY($2)', [q.neg.id, PASOS.map(p => p.id)]))[0].n;
    s.json({ ok: true, paso, hecho: r[0].hecho, hechos, total: PASOS.length, progreso: Math.round(hechos * 100 / PASOS.length) });
  }));

  // Nombre completo o razón social del titular (el aviso de privacidad y el contrato deben identificar al responsable)
  // y correo para temas de privacidad, que se publica en el aviso. Cada campo es opcional: el que no se manda se conserva.
  api.post('/admin/legal/datos', auth, wrap(async (q, s) => {
    const limpia = (v, n) => v === undefined || v === null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n);
    const titular = limpia(q.body.titular, 120), correo = limpia(q.body.correo, 120);
    if (correo && !correoOk(correo)) return s.status(400).json({ error: 'Escribe un correo válido o déjalo vacío' });
    const r = await Q(`INSERT INTO legal_datos(negocio_id,titular,correo,actualizado) VALUES($1,COALESCE($2,''),COALESCE($3,''),now())
      ON CONFLICT (negocio_id) DO UPDATE SET titular=COALESCE($2,legal_datos.titular), correo=COALESCE($3,legal_datos.correo), actualizado=now() RETURNING titular,correo`, [q.neg.id, titular, correo]);
    s.json({ ok: true, titular: r[0].titular || '', correo: r[0].correo || '' });
  }));

  api.get('/admin/legal/doc/:tipo', auth, wrap(async (q, s) => {
    const tipo = q.params.tipo, doc = DOC.get(tipo);
    if (!doc) return s.status(404).json({ error: 'Ese documento no existe' });
    const x = await datos(q.neg), url = `${base(q)}/${encodeURIComponent(q.neg.slug)}/privacidad`;
    let cuerpo;
    if (tipo === 'aviso-integral') cuerpo = avisoIntegral(x, url, false);
    else if (tipo === 'aviso-simplificado') cuerpo = avisoSimplificado(x, url, false);
    else if (tipo === 'reglamento') cuerpo = reglamento(x);
    else {
      // Si se elige un barbero de la lista del negocio, se llenan su nombre y su comisión registrada en Finanzas.
      const nom = String(q.query.barbero || '');
      const b = barberos(q.neg).includes(nom) ? { nombre: nom, comision: ((await Q('SELECT comision::float c FROM perfiles WHERE negocio_id=$1 AND barbero=$2', [q.neg.id, nom]))[0] || {}).c || '' } : {};
      cuerpo = contrato(x, b);
    }
    const barra = `<div class="barra"><button onclick="print()">Imprimir o guardar como PDF</button><span>Lo marcado en amarillo falta por llenar.</span></div>`;
    s.set('Cache-Control', 'no-store').type('html').send(pagina({ titulo: `${doc.titulo} · ${q.neg.nombre}`, robots: 'noindex, nofollow', cuerpo: barra + notaGeneral + cuerpo }));
  }));

  // ---- Página pública del aviso de privacidad: /<slug>/privacidad
  app.get('/:slug/privacidad', wrap(async (q, s) => {
    const n = (await Q('SELECT * FROM negocios WHERE slug=$1', [q.params.slug]))[0];
    if (!n) return s.status(404).type('html').send(pagina({ titulo: 'Barbería no encontrada', robots: 'noindex', cuerpo: '<h1>No encontramos esta barbería</h1><p>Revisa el enlace.</p><p><a href="/">Ir al inicio</a></p>' }));
    const x = await datos(n), slug = encodeURIComponent(n.slug), url = `${base(q)}/${slug}/privacidad`;
    const volver = `<p class="no-imprimir"><a href="/${slug}">← Volver a ${esc(n.nombre)}</a></p>`;
    s.type('html').send(pagina({ titulo: `Aviso de privacidad · ${n.nombre}`, robots: 'index, follow',
      extra: `<meta name="description" content="${esc(`Aviso de privacidad de ${n.nombre}: qué datos usamos al agendar tu cita, para qué y cómo ejercer tus derechos.`)}"><link rel="canonical" href="${esc(url)}">`,
      cuerpo: volver + avisoIntegral(x, url, true) + '<hr>' + avisoSimplificado(x, url, true).replace('<h1>', '<h2 id="simplificado">').replace('</h1>', '</h2>'),
      pie: volver }));
  }));
};
