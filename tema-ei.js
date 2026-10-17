// Tema "Estilo Internacional": dibuja la página pública de una barbería completa en el servidor (SEO y carga rápida).
// Todo sale de la base de datos: paquetes, extras, referencias, trabajos, preguntas y datos del negocio.
const fs = require('fs'), path = require('path');
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => '$' + (Number.isInteger(+v) ? +v : (+v).toFixed(2));
const h12 = h => (h % 12 || 12) + ':00 ' + (h < 12 || h === 24 ? 'AM' : 'PM');
const json = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(new RegExp('[\\u2028\\u2029]', 'g'), ' '); // seguro dentro de <script>
const NUM = ['Cero', 'Una', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez', 'Once', 'Doce'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Primeras frases de un texto, hasta ~max caracteres, cortando en un punto.
const resumen = (t, max = 170) => {
  const f = String(t || '').trim().split(/(?<=[.!?])\s+/); let r = '';
  for (const x of f) { if ((r + ' ' + x).trim().length > max && r) break; r = (r + ' ' + x).trim(); }
  return r;
};
const telBonito = w => { const d = String(w || '').replace(/\D/g, ''); return d.length === 12 && d.startsWith('52') ? `+52 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : d ? '+' + d : ''; };

// Hora en minutos → "9:30 AM".
const hm12 = m => { const h = Math.floor(m / 60) % 24, x = m % 60; return `${h % 12 || 12}:${String(x).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const aLas = m => (Math.floor(m / 60) % 12 === 1 ? 'a la ' : 'a las ') + hm12(m); // "a la 1:00 PM", "a las 10:00 AM"
// Horario de la agenda: misma regla que todas() en server.js (espacios desde hora_ini:abre_min cada `intervalo`
// mientras su hora sea ≤ hora_fin); cierra al terminar el último espacio. Devuelve minutos desde medianoche.
const rango = n => {
  // Igual que paso()/abreMin() de server.js: solo 30 o 60 minutos, y abre en punto o a la media hora.
  const paso = +n.intervalo === 30 ? 30 : 60, ini = (+n.hora_ini || 0) * 60 + (+n.abre_min === 30 ? 30 : 0);
  let ult = ini; while (Math.floor((ult + paso) / 60) <= +n.hora_fin && ult + paso < 1440) ult += paso;
  return { ini, fin: ult + paso };
};
const horarioAgenda = n => { const { ini, fin } = rango(n); return `${hm12(ini)} a ${hm12(fin)}`; };
// Un horario_texto sencillo ("9:30 AM a 11:00 PM", "10 am - 8 pm") → minutos. Cualquier otra cosa (días, dos turnos,
// pasar de medianoche) → null: entonces no sabemos de verdad cuándo abre y la página no muestra abierto/cerrado.
const hTexto = (h, m, ap) => (+h % 12) * 60 + +(m || 0) + (/p/i.test(ap) ? 720 : 0);
const rangoTexto = t => {
  const m = String(t || '').trim().match(/^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?\s*m\.?\s*(?:a(?:\s+las?)?|-|–|—)\s*(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?\s*m\.?$/i);
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[4] < 1 || +m[4] > 12) return null;
  const ini = hTexto(m[1], m[2], m[3]), fin = hTexto(m[4], m[5], m[6]) || 1440; // "12:00 AM" al cerrar = medianoche
  return fin > ini ? { ini, fin } : null;
};

// "Abierto ahora" / "Cerrado · abre a las X", en hora de Mérida. Se calcula en cada petición (nunca al cargar el módulo).
// Debe coincidir con el horario que se ve junto a él: si hay horario_texto, manda ese texto (si no se puede leer con
// certeza, no se muestra estado); si no, los campos numéricos de la agenda. Los días cerrados salen de negocios.cierra
// (números 0-6 de getDay separados por coma).
const RELOJ = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Merida', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
const SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const estadoAhora = (n, ahora = new Date()) => {
  let r;
  if (n.horario_texto) r = rangoTexto(n.horario_texto);
  else if (n.hora_ini != null && n.hora_fin != null && +n.hora_fin >= +n.hora_ini) r = rango(n);
  if (!r) return null;
  const p = Object.fromEntries(RELOJ.formatToParts(ahora).map(x => [x.type, x.value]));
  const dia = SEMANA[p.weekday], min = (+p.hour % 24) * 60 + +p.minute, { ini, fin } = r;
  const cierra = new Set(String(n.cierra || '').split(',').filter(x => /^[0-6]$/.test(x.trim())).map(x => +x));
  const abreDia = x => !cierra.has(x);
  if (abreDia(dia) && min >= ini && min < fin) return { abierto: true, texto: 'Abierto ahora', cierra: hm12(fin) };
  if (abreDia(dia) && min < ini) return { abierto: false, texto: `Cerrado · abre ${aLas(ini)}` };
  for (let k = 1; k <= 7; k++) {
    const x = (dia + k) % 7;
    if (abreDia(x)) return { abierto: false, texto: `Cerrado · abre ${k === 1 ? 'mañana' : 'el ' + DIAS[x]} ${aLas(ini)}` };
  }
  return { abierto: false, texto: 'Cerrado' };
};

// Fotos ilustrativas (generadas con IA) de public/img/tema que de verdad existen. Se revisa una sola vez al cargar
// el módulo para que la página nunca muestre una imagen rota; si falta un archivo, esa foto simplemente no sale.
const TEMA = ['portada', 'experiencia', 'paq-corte', 'paq-barba', 'paq-fresco', 'paq-vip', 'extra-cejas', 'extra-lavado', 'extra-masaje',
  'galeria-llegada', 'galeria-toalla', 'galeria-navaja', 'galeria-degradado', 'galeria-productos', 'galeria-peinado'];
const HAY = new Set(TEMA.filter(f => fs.existsSync(path.join(__dirname, 'public', 'img', 'tema', f + '.jpg'))));
const hay = f => HAY.has(f);

// Imagen ilustrativa (generada con IA) para un paquete sin foto propia, según de qué se trata.
const ilustracion = p => {
  const t = `${p.nombre} ${(p.incluye || []).join(' ')}`;
  return /vip|diamante|premium|toalla|facial/i.test(t) ? 'paq-vip' : /barba/i.test(t) ? 'paq-barba' : p.lavado || /lavado|fresco|peinado/i.test(t) ? 'paq-fresco' : 'paq-corte';
};
// Miniatura ilustrativa de un extra, por palabra clave del nombre. Sin coincidencia (o sin archivo), sin foto.
const fotoExtra = e => {
  const t = String(e.nombre || ''), f = /ceja/i.test(t) ? 'extra-cejas' : /lavad/i.test(t) ? 'extra-lavado' : /masaje/i.test(t) ? 'extra-masaje' : null;
  return f && hay(f) ? f : null;
};
// Galería "La experiencia": [archivo, leyenda, orientación] (h = horizontal, ocupa 2 columnas; v = vertical, 1 columna).
// El orden cuenta una visita: llegada → toalla → navaja → resultado → productos → peinado.
// (Leyendas distintas a las de las fotos reales del local, para que nadie confunda una ilustración con "La bienvenida" real.)
const GALERIA = [['galeria-llegada', 'Un buen recibimiento', 'h'], ['galeria-toalla', 'Toalla caliente', 'v'], ['galeria-navaja', 'Perfilado con navaja', 'v'],
  ['galeria-degradado', 'Un degradado limpio', 'v'], ['galeria-productos', 'Productos para tu estilo', 'v'], ['galeria-peinado', 'El toque final', 'h']];

const dibuja = d => {
  const { n, base, paquetes, extras, referencias, trabajos, preguntas, portada, abierto, whatsappUrl, equipo = [], lealtad = null } = d;
  const slug = encodeURIComponent(n.slug), agenda = `/${slug}/agenda`, url = `${base}/${slug}`;
  const horario = n.horario_texto || horarioAgenda(n);
  const cerrados = (n.cierra || '').split(',').filter(x => x !== '').map(x => DIAS[+x]).filter(Boolean);
  const desde = paquetes.length ? Math.min(...paquetes.map(p => +p.precio)) : null;
  // Portada: la que subió el dueño, las fotos reales de Estilo Internacional, o una ilustrativa para que ninguna página se vea vacía.
  const heroReal = portada ? `/i/${portada}` : n.fotos ? '/img/hero.jpg' : null, hero = heroReal || '/img/tema/portada.jpg';
  const [l1, ...l2] = String(n.lema || 'Tu estilo.').split(/(?<=\.)\s+/), lema2 = l2.join(' ');
  const sub = resumen(n.acerca), mas = String(n.acerca || '').length > sub.length + 10;
  const ciudad = /mérida/i.test(n.direccion || '') ? ' en Mérida' : '';
  const titulo = `${n.nombre}${/barber/i.test(n.nombre) ? '' : ' | Barbería'}${ciudad}`;
  const descr = `${n.lema ? n.lema + ' ' : ''}${desde !== null ? `Cortes desde ${money(desde)}, paquetes` : 'Cortes y paquetes'} y reservas en línea.${n.direccion ? ' ' + n.direccion + '.' : ''} ${horario}.`.replace(/\s+/g, ' ').trim();
  const og = hero ? base + hero : '';
  // Referencias de estilo: ya vienen en el orden que eligió el dueño. La leyenda de IA sale solo en las marcadas.
  // Solo la marca `ia` decide (o la leyenda vieja exacta, por si la migración aún no corrió): una etiqueta como
  // "Foto real, sin IA" no debe hacer que la página diga que las fotos son de IA.
  const LEYENDA = 'Referencia generada con IA', vieja = t => String(t || '').trim().toLowerCase() === LEYENDA.toLowerCase();
  const esIA = r => !!r.ia || vieja(r.etiqueta), nIA = referencias.filter(esIA).length;
  const etiquetaRef = r => !esIA(r) ? r.etiqueta || '' : !r.etiqueta || vieja(r.etiqueta) ? LEYENDA : /generad[ao]s? con IA/i.test(r.etiqueta) ? r.etiqueta : `${r.etiqueta} · Generada con IA`;
  const avisoIA = !nIA ? 'Referencias para inspirarte. ' : nIA === referencias.length ? 'Estas imágenes son referencias generadas con IA. No son trabajos realizados por nuestra barbería. '
    : 'Las imágenes marcadas como generadas con IA no son trabajos realizados por nuestra barbería. ';
  const premium = paquetes.length >= 3 ? paquetes.reduce((a, p) => (+p.precio > +a.precio ? p : a), paquetes[0]).id : null;

  const ld = [{ '@context': 'https://schema.org', '@type': 'BarberShop', name: n.nombre, url, ...(og ? { image: og } : {}), description: descr,
    ...(n.direccion ? { address: { '@type': 'PostalAddress', streetAddress: n.direccion, addressCountry: 'MX' } } : {}),
    ...(n.whatsapp ? { telephone: '+' + String(n.whatsapp).replace(/\D/g, '') } : {}), ...(n.maps ? { hasMap: n.maps } : {}),
    ...(desde !== null ? { priceRange: `${money(desde)}–${money(Math.max(...paquetes.map(p => +p.precio)))} MXN` } : {}),
    ...(paquetes.length ? { makesOffer: paquetes.map(p => ({ '@type': 'Offer', name: p.nombre, price: +p.precio, priceCurrency: 'MXN', url: `${base}${agenda}?servicio=${p.id}` })) } : {}) }];
  if (preguntas.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: preguntas.map(p => ({ '@type': 'Question', name: p.pregunta, acceptedAnswer: { '@type': 'Answer', text: p.respuesta } })) });

  const fotoPaq = p => p.img ? `<figure class="package-photo"><img src="/i/${Number(p.img)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async" width="600" height="750"></figure>`
    : !hay(ilustracion(p)) ? ''
    : `<figure class="package-photo"><img src="/img/tema/${ilustracion(p)}.jpg" alt="Imagen ilustrativa de ${esc(String(p.nombre).toLowerCase())}" loading="lazy" decoding="async" width="600" height="750"><figcaption>Imagen ilustrativa</figcaption></figure>`;
  const tarjeta = (p, i) => `<article class="package${p.id === premium ? ' premium' : ''}">${fotoPaq(p)}<span class="eyebrow">0${i + 1}${p.etiqueta ? ' / ' + esc(p.etiqueta) : ''}</span><h3>${esc(p.nombre)}</h3>
<p class="price">${money(p.precio)}<small> MXN</small></p><ul>${p.incluye.map(t => `<li>✓ ${esc(t)}</li>`).join('')}</ul>
<a class="button" href="${agenda}?servicio=${p.id}">Reservar ${esc(p.nombre)} ↗</a>${extras.length ? `<button class="plain" type="button" data-elige="${p.id}">Agregar extras +</button>` : ''}</article>`;

  const personaliza = extras.length && paquetes.length ? `<div class="customize" id="personaliza"><div><p class="eyebrow">A TU MEDIDA</p><h3>Un poco más para ti.</h3><p>Agrega solo lo que tu paquete no incluye.</p></div>
<div class="choices"><label for="paquete">Tu paquete</label><select id="paquete">${paquetes.map(p => `<option value="${p.id}" data-precio="${+p.precio}" data-lavado="${p.lavado ? 1 : 0}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)} — ${money(p.precio)} MXN</option>`).join('')}</select>
${extras.map(e => { const f = fotoExtra(e); return `<label class="extra${f ? ' con-foto' : ''}"><input type="checkbox" data-id="${e.id}" data-precio="${+e.precio}" data-lavado="${e.lavado ? 1 : 0}" data-nombre="${esc(e.nombre)}">${f ? `<span class="extra-photo" aria-hidden="true" title="Imagen ilustrativa generada con IA"><img src="/img/tema/${f}.jpg" alt="" loading="lazy" decoding="async" width="120" height="90"><small>Ilustrativa</small></span>` : ''}<span class="extra-name">${esc(e.nombre)}</span><b>+${money(e.precio)}</b></label>`; }).join('')}
${extras.some(fotoExtra) ? '<p class="extra-note">Las fotos de los extras son imágenes ilustrativas generadas con IA.</p>' : ''}
<div class="total"><span>Total en MXN</span><strong id="total">${money(paquetes[0].precio)}</strong></div>
<a class="button" id="ir" href="${agenda}?servicio=${paquetes[0].id}">Reservar mi paquete ↗</a>${n.whatsapp ? `<a class="alt-wa" id="wa" rel="noopener noreferrer" target="_blank" href="${esc(whatsappUrl)}">¿Prefieres reservar por WhatsApp?</a>` : ''}</div></div>` : '';

  const estilos = referencias.length ? `<section class="section dark" id="estilos"><div class="heading"><div><p class="eyebrow">02 / INSPIRACIÓN PARA TU PRÓXIMO CORTE</p><h2>Encuentra<br><em>tu siguiente estilo.</em></h2></div>
<p>${avisoIA}El resultado se adapta a tu cabello.</p></div>
${referencias.length >= 2 && referencias.length <= 8 ? `<div class="filters" aria-label="Filtrar referencias"><button type="button" class="selected" aria-pressed="true" data-f="todos">Todos</button>${referencias.map(r => `<button type="button" aria-pressed="false" data-f="${Number(r.id)}">${esc(r.nombre)}</button>`).join('')}</div>` : ''}
<div class="styles">${referencias.map(r => { const et = etiquetaRef(r); return `<article data-s="${Number(r.id)}">${r.img ? `<button type="button" class="image-button" data-src="/i/${Number(r.img)}" data-cap="${esc(r.nombre + (et ? ' · ' + et : ''))}" aria-label="Ampliar ${esc(r.nombre)}"><img src="/i/${Number(r.img)}" alt="Referencia de ${esc(String(r.nombre).toLowerCase())}" loading="lazy" decoding="async" width="800" height="1000"></button>` : ''}
<div class="style-copy"><span class="eyebrow">${esc(String(et || 'Referencia de estilo').toUpperCase())}</span><h3>${esc(r.nombre)}</h3>${r.descripcion ? `<p>${esc(r.descripcion)}</p>` : ''}${paquetes[0] ? `<a href="${agenda}?servicio=${paquetes[0].id}">Quiero este estilo · ${money(paquetes[0].precio)} ↗</a>` : ''}</div></article>`; }).join('')}</div>
<dialog class="lightbox" id="lb"><button type="button" class="button" id="lb-x">Cerrar ×</button><img id="lb-img" alt=""><p id="lb-cap"></p></dialog></section>` : '';

  const espacio = n.fotos ? `<section class="section space tone" id="espacio"><div class="heading"><div><p class="eyebrow">03 / ESTE ES NUESTRO ESPACIO</p><h2>Tu momento.<br><em>Nuestra barbería.</em></h2></div><p>${esc(n.nombre)} por dentro.<br>Fotografías reales de nuestro local.</p></div>
<div class="space-grid">${[['techo', 'El espacio', 700, 353], ['vip', 'La silla VIP', 600, 892], ['recepcion', 'La recepción', 600, 627], ['bienvenido', 'La bienvenida', 700, 468]].map(([i, t, w, h]) => `<figure><img src="/img/${i}.jpg" alt="${t} de ${esc(n.nombre)}" loading="lazy" decoding="async" width="${w}" height="${h}"><figcaption>${t} <span>FOTO REAL ↗</span></figcaption></figure>`).join('')}</div></section>` : '';

  const trabajo = trabajos.length ? `<section class="section" id="trabajos"><div class="heading"><div><p class="eyebrow">NUESTRO TRABAJO</p><h2>Cortes <em>reales.</em></h2></div><p>Fotos de trabajos hechos en la barbería.</p></div>
<div class="work-grid">${trabajos.slice(0, 8).map(t => `<img src="/i/${Number(t.img)}" alt="Corte${t.servicio ? ' ' + esc(t.servicio) : ''}${t.barbero ? ' de ' + esc(t.barbero) : ''}" loading="lazy" decoding="async" width="600" height="750">`).join('')}</div></section>` : '';

  // Galería "La experiencia": solo fotos ilustrativas (IA), marcadas una por una y en el encabezado. Si la barbería ya
  // tiene 4 o más fotos reales de trabajos, no sale: las reales mandan. experiencia.jpg ya aparece en "Así de fácil";
  // solo se suma aquí para completar si faltan fotos de la galería.
  const fotosGal = GALERIA.filter(([f]) => hay(f));
  if (fotosGal.length < GALERIA.length && hay('experiencia')) fotosGal.push(['experiencia', 'Listo para tu día', 'h']);
  const colsGal = fotosGal.reduce((s, g) => s + (g[2] === 'h' ? 2 : 1), 0), faltaGal = (4 - colsGal % 4) % 4;
  const verticales = fotosGal.filter(g => g[2] === 'v'), soloMovil = verticales.length % 2 ? verticales[verticales.length - 1] : null;
  const galeria = trabajos.length < 4 && fotosGal.length >= 3 ? `<section class="section dark experience" id="experiencia"><div class="heading"><div><p class="eyebrow">LA EXPERIENCIA</p><h2>Más que un corte.<br><em>Un rato para ti.</em></h2></div>
<p>Toalla caliente, navaja, detalle y buen trato: la idea de una buena visita a la barbería.<br><b>Imágenes ilustrativas generadas con IA.</b> No son fotos de nuestro local, de nuestro equipo ni de nuestros trabajos.</p></div>
<div class="gallery">${fotosGal.map((g, i) => { const [f, t, o] = g, ultima = i === fotosGal.length - 1 && faltaGal, cls = [o === 'h' ? 'g-h' : 'g-v', ultima ? 'g-wide' : '', g === soloMovil ? 'g-solo' : ''].filter(Boolean).join(' ');
    return `<figure class="${cls}"${ultima ? ` style="--span:${(o === 'h' ? 2 : 1) + faltaGal}"` : ''}><img src="/img/tema/${f}.jpg" alt="Imagen ilustrativa generada con IA: ${esc(t.toLowerCase())}" loading="lazy" decoding="async" width="${o === 'h' ? 1200 : 800}" height="${o === 'h' ? 800 : 1000}"><figcaption><span>${esc(t)}</span><small>Imagen ilustrativa</small></figcaption></figure>`; }).join('')}</div>
<a class="button" href="${agenda}">Aparta tu lugar ↗</a></section>` : '';

  const acerca = mas ? `<section class="section" id="nosotros"><div class="heading"><div><p class="eyebrow">SOBRE NOSOTROS</p><h2>${esc(n.nombre)}</h2></div></div><p style="max-width:720px;font-size:17px">${esc(n.acerca).replace(/\n+/g, '<br>')}</p></section>` : '';
  const faq = preguntas.length ? `<section class="section tone" id="preguntas"><div class="heading"><div><p class="eyebrow">PREGUNTAS FRECUENTES</p><h2>Lo que <em>nos preguntan.</em></h2></div></div><div class="faq">${preguntas.map(p => `<details><summary>${esc(p.pregunta)}</summary><p>${esc(p.respuesta)}</p></details>`).join('')}</div></section>` : '';
  const tel = n.whatsapp ? `<a class="location-link" href="tel:+${esc(String(n.whatsapp).replace(/\D/g, ''))}">Tel. ${esc(telBonito(n.whatsapp))}</a>` : '';
  const ig = n.instagram ? `<a class="location-link" rel="noopener noreferrer" target="_blank" href="https://instagram.com/${esc(String(n.instagram).replace(/^@/, ''))}">Instagram @${esc(String(n.instagram).replace(/^@/, ''))}</a>` : '';
  const foto = n.fotos ? `<img src="/img/bienvenido.jpg" alt="Entrada de ${esc(n.nombre)}" loading="lazy" decoding="async" width="700" height="468">` : '';
  // Abierto o cerrado en este momento (hora de Mérida): se calcula en cada petición.
  const estado = estadoAhora(n), estadoHtml = estado ? `<span class="status ${estado.abierto ? 'on' : 'off'}"><i aria-hidden="true"></i>${esc(estado.texto)}</span>` : '';
  const resena = /^https:\/\//.test(n.resena || '') ? `<a class="location-link" rel="noopener noreferrer" target="_blank" href="${esc(n.resena)}">¿Ya nos visitaste? Déjanos tu reseña en Google ↗</a>` : '';

  // Así de fácil: los tres pasos reales de la agenda.
  const pasos = `<section class="section steps" id="como"><div class="steps-copy"><p class="eyebrow">ASÍ DE FÁCIL</p><h2>Tu cita en<br><em>un minuto.</em></h2>
<ol><li><b>Elige tu paquete</b><span>Y agrega extras si quieres. El total se ve antes de confirmar.</span></li><li><b>Escoge barbero y horario</b><span>Solo verás los horarios que de verdad están libres.</span></li><li><b>Llega y disfruta</b><span>Tu lugar queda apartado al confirmar. Sin llamadas ni mensajes.</span></li></ol>
<a class="button" href="${agenda}">Agendar ahora ↗</a></div>${hay('experiencia') ? '<figure><img src="/img/tema/experiencia.jpg" alt="Imagen ilustrativa de un cliente satisfecho con su corte" loading="lazy" decoding="async" width="1200" height="800"><figcaption>Imagen ilustrativa</figcaption></figure>' : ''}</section>`;

  // Equipo: solo si al menos un barbero tiene foto o algo escrito en su perfil.
  const conPerfil = equipo.filter(b => b.foto || b.especialidad || b.bio);
  const iniciales = t => String(t).split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
  const equipoHtml = conPerfil.length ? `<section class="section" id="equipo"><div class="heading"><div><p class="eyebrow">NUESTRO EQUIPO</p><h2>Manos que<br><em>saben lo que hacen.</em></h2></div><p>Elige con quién quieres tu próximo corte.</p></div>
<div class="team">${equipo.map(b => `<article>${b.foto ? `<img src="/i/${Number(b.foto)}" alt="${esc(b.nombre)}, barbero" loading="lazy" decoding="async" width="500" height="600">` : `<div class="team-mono" aria-hidden="true">${esc(iniciales(b.nombre))}</div>`}
<h3>${esc(b.nombre)}</h3>${b.especialidad ? `<p class="eyebrow">${esc(String(b.especialidad).toUpperCase())}</p>` : ''}${b.bio ? `<p>${esc(b.bio)}</p>` : ''}
<div class="team-links"><a href="${agenda}?barbero=${encodeURIComponent(b.nombre)}">Agendar con ${esc(String(b.nombre).split(/\s+/)[0])} ↗</a>${b.instagram ? `<a rel="noopener noreferrer" target="_blank" href="https://instagram.com/${esc(String(b.instagram).replace(/^@/, ''))}">@${esc(String(b.instagram).replace(/^@/, ''))}</a>` : ''}</div></article>`).join('')}</div></section>` : '';

  // Tarjeta de sellos (lealtad.js), si el dueño la activó.
  const sellos = lealtad && lealtad.premio ? `<section class="loyalty" aria-label="Tarjeta de sellos"><p class="eyebrow">TARJETA DE SELLOS</p><p class="loyalty-main">Cada <b>${Number(lealtad.cada)} visitas</b>, ${esc(lealtad.premio)}.</p>
<div class="stamps" aria-hidden="true">${Array.from({ length: Math.min(Number(lealtad.cada) || 0, 12) }, (_, k) => `<i${k === Number(lealtad.cada) - 1 ? ' class="gift"' : ''}></i>`).join('')}</div><p class="fine">Tus visitas se cuentan solas con tu número de WhatsApp al reservar.</p></section>` : '';

  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><meta name="description" content="${esc(descr)}"><meta name="theme-color" content="#f1efe9"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:locale" content="es_MX"><meta property="og:url" content="${esc(url)}"><meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(descr)}">${og ? `<meta property="og:image" content="${esc(og)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(og)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(titulo)}"><meta name="twitter:description" content="${esc(descr)}">
<link rel="manifest" href="/${slug}/manifest.json"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;600;700;800&display=swap"><link rel="stylesheet" href="/tema-ei.css?v=3">
${hero ? `<link rel="preload" as="image" href="${esc(hero)}" fetchpriority="high">` : ''}
${ld.map(o => `<script type="application/ld+json">${json(o)}</script>`).join('\n')}</head><body>
<a class="skip" href="#paquetes">Saltar a paquetes</a>
<header class="header"><a class="brand" href="/${slug}" aria-label="${esc(n.nombre)} inicio"><span class="monogram">${esc(n.nombre.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase())}</span><span>${esc(n.nombre)}<small>BARBERÍA${ciudad ? ' · MÉRIDA' : ''}</small></span></a>
<nav aria-label="Principal"><a href="#paquetes">Paquetes</a>${referencias.length ? '<a href="#estilos">Estilos</a>' : ''}${equipoHtml ? '<a href="#equipo">Equipo</a>' : ''}${galeria ? '<a href="#experiencia">Experiencia</a>' : ''}${faq ? '<a href="#preguntas">Preguntas</a>' : ''}<a href="#ubicacion">Encuéntranos</a></nav><a class="button small" href="#paquetes">Elige tu paquete ↗</a></header>
${abierto ? '' : '<div class="notice" role="status">Esta barbería no está recibiendo citas en línea por ahora.</div>'}
<main><section class="hero"><img class="hero-photo" src="${esc(hero)}" alt="${heroReal ? `Interior de ${esc(n.nombre)}` : 'Imagen ilustrativa de una barbería'}" fetchpriority="high" decoding="async" width="1600" height="1000"><div class="hero-overlay"></div><div class="hero-copy">
<p class="eyebrow">${esc((n.zonas || n.direccion || 'Barbería').toUpperCase())}</p><h1>${esc(l1)}${lema2 ? `<br><em>${esc(lema2)}</em>` : ''}</h1>${sub ? `<p>${esc(sub).replace(/(?<=[.!?])\s+/g, '<br>')}</p>` : ''}
<a class="button" href="#paquetes">Encuentra tu paquete <span>↗</span></a><div class="hero-details">${desde !== null ? `<span>DESDE <b>${money(desde)} MXN</b></span>` : ''}<span>HORARIO <b>${esc(horario.toUpperCase().replace(' A ', ' — '))}</b></span>${estadoHtml ? `<span>HOY ${estadoHtml}</span>` : ''}</div></div><span class="hero-caption">${n.fotos || portada ? `FOTO REAL DE NUESTRO LOCAL / ${esc(n.nombre.toUpperCase())}` : 'IMAGEN ILUSTRATIVA'}</span></section>
<div class="ticker"><span>CORTE</span><i>✳</i><span>BARBA</span><i>✳</i><span>ACTITUD</span><i>✳</i><span>${esc(n.nombre.toUpperCase())}</span></div>
<section class="section" id="paquetes"><div class="heading"><div><p class="eyebrow">01 / ELIGE CÓMO RENOVARTE</p><h2>El look cambia.<br><em>El estilo es tuyo.</em></h2></div>
<p>${paquetes.length ? `${NUM[paquetes.length] || paquetes.length} ${paquetes.length === 1 ? 'forma' : 'formas'} de darle un nuevo aire a tu día.<br>` : ''}Precios en pesos mexicanos. Sin cargos por servicios ya incluidos.</p></div>
${paquetes.length ? `<div class="packages n${Math.min(paquetes.length, 4)}">${paquetes.map(tarjeta).join('')}</div>` : `<p>Pronto publicaremos nuestros paquetes. <a href="${agenda}" style="text-decoration:underline">Agenda tu cita aquí</a>.</p>`}
${personaliza}</section>
${pasos}${sellos}${estilos}${equipoHtml}${espacio}${galeria}${trabajo}${acerca}${faq}
<section class="section location${foto ? '' : ' sin-foto'}" id="ubicacion"><div><p class="eyebrow">NOS VEMOS AQUÍ</p><h2>Encuentra<br><em>tu barbería.</em></h2>
<div class="address">${n.direccion ? `<p>${esc(n.direccion).replace(/,\s*/g, '<br>')}</p>` : ''}<p>HORARIO<br><strong>${esc(horario)}</strong>${cerrados.length ? `<br><small>Cerrado: ${esc(cerrados.join(', '))}</small>` : ''}${estadoHtml ? `<br>${estadoHtml}` : ''}</p></div>
${n.maps ? `<a class="button" rel="noopener noreferrer" target="_blank" href="${esc(n.maps)}">Cómo llegar · Google Maps ↗</a>` : ''}${tel}${ig}${resena}${n.estacionamiento ? `<p class="fine">Estacionamiento: ${esc(n.estacionamiento)}</p>` : ''}
<p class="fine">Elige tu paquete, tu barbero y tu horario en la agenda. Tu cita queda apartada al confirmar.</p></div>${foto}</section></main>
<footer><a class="brand" href="/${slug}"><span class="monogram">${esc(n.nombre.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase())}</span><span>${esc(n.nombre)}</span></a><span>${esc(n.lema || '')}</span><a href="/${slug}/privacidad">Aviso de privacidad</a><small>© ${new Date().getFullYear()} ${esc(n.nombre)}</small></footer>
<a class="mobile-book button" href="#paquetes">Elige tu paquete y reserva ↗</a>
<script>
(function(){var $=function(s,r){return(r||document).querySelector(s)},$$=function(s,r){return[].slice.call((r||document).querySelectorAll(s))};
var sel=$('#paquete');if(sel){var cajas=$$('.extra input'),tot=$('#total'),ir=$('#ir'),wa=$('#wa'),A=${json(agenda)},N=${json(n.nombre)},W=${json(whatsappUrl || '')};
function pinta(){var o=sel.options[sel.selectedIndex],lav=o.dataset.lavado==='1',s=+o.dataset.precio,ids=[],nom=[];
cajas.forEach(function(c){var inc=lav&&c.dataset.lavado==='1',b=c.parentNode.querySelector('b');c.disabled=inc;if(inc)c.checked=true;b.textContent=inc?'Incluido':'+$'+c.dataset.precio;
if(c.checked&&!inc){s+=+c.dataset.precio;ids.push(c.dataset.id);nom.push(c.dataset.nombre+' ($'+c.dataset.precio+' MXN)')}});
tot.textContent='$'+s;ir.href=A+'?servicio='+o.value+(ids.length?'&extras='+ids.join(','):'');ir.firstChild.nodeValue='Reservar mi paquete · $'+s+' ↗';
if(wa&&W){var t='Hola, quiero reservar en '+N+'. Paquete: '+o.dataset.nombre+' ($'+o.dataset.precio+' MXN).'+(nom.length?' Extras: '+nom.join(', ')+'.':'')+' ¿Qué horarios tienen disponibles?';wa.href=W.split('?text=')[0]+'?text='+encodeURIComponent(t)}}
sel.onchange=pinta;cajas.forEach(function(c){c.onchange=pinta});pinta();
$$('[data-elige]').forEach(function(b){b.onclick=function(){sel.value=b.dataset.elige;pinta();$('#personaliza').scrollIntoView({behavior:'smooth',block:'center'})}})}
var fb=$$('.filters button');fb.forEach(function(b){b.onclick=function(){fb.forEach(function(x){var on=x===b;x.classList.toggle('selected',on);x.setAttribute('aria-pressed',on)});
$$('.styles article').forEach(function(a){a.hidden=b.dataset.f!=='todos'&&a.dataset.s!==b.dataset.f})}});
var lb=$('#lb');if(lb){$$('.image-button').forEach(function(b){b.onclick=function(){$('#lb-img').src=b.dataset.src;$('#lb-img').alt=b.dataset.cap;$('#lb-cap').textContent=b.dataset.cap;lb.showModal()}});
$('#lb-x').onclick=function(){lb.close()};lb.onclick=function(e){if(e.target===lb)lb.close()}}
if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})})();
</script></body></html>`;
};

module.exports = dibuja;
module.exports.estadoAhora = estadoAhora; // para probar el cálculo de abierto/cerrado con horas fijas
module.exports.fotosTema = () => [...HAY]; // fotos ilustrativas disponibles (las que existen en public/img/tema)
