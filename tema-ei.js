// Tema "Estilo Internacional": dibuja la página pública de una barbería completa en el servidor (SEO y carga rápida).
// Todo sale de la base de datos: paquetes, extras, referencias, trabajos, preguntas y datos del negocio.
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
// Horario de la agenda: misma regla que todas() en server.js (espacios desde hora_ini:abre_min cada `intervalo`
// mientras su hora sea ≤ hora_fin); cierra al terminar el último espacio.
const horarioAgenda = n => {
  const ini = (+n.hora_ini || 0) * 60 + (+n.abre_min || 0), paso = +n.intervalo || 60;
  let ult = ini; while (Math.floor((ult + paso) / 60) <= +n.hora_fin) ult += paso;
  return `${hm12(ini)} a ${hm12(ult + paso)}`;
};
// Imagen ilustrativa (generada con IA) para un paquete sin foto propia, según de qué se trata.
const ilustracion = p => {
  const t = `${p.nombre} ${(p.incluye || []).join(' ')}`;
  return /vip|diamante|premium|toalla|facial/i.test(t) ? 'paq-vip' : /barba/i.test(t) ? 'paq-barba' : p.lavado || /lavado|fresco|peinado/i.test(t) ? 'paq-fresco' : 'paq-corte';
};

module.exports = d => {
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
    : `<figure class="package-photo"><img src="/img/tema/${ilustracion(p)}.jpg" alt="Imagen ilustrativa de ${esc(String(p.nombre).toLowerCase())}" loading="lazy" decoding="async" width="600" height="750"><figcaption>Imagen ilustrativa</figcaption></figure>`;
  const tarjeta = (p, i) => `<article class="package${p.id === premium ? ' premium' : ''}">${fotoPaq(p)}<span class="eyebrow">0${i + 1}${p.etiqueta ? ' / ' + esc(p.etiqueta) : ''}</span><h3>${esc(p.nombre)}</h3>
<p class="price">${money(p.precio)}<small> MXN</small></p><ul>${p.incluye.map(t => `<li>✓ ${esc(t)}</li>`).join('')}</ul>
<a class="button" href="${agenda}?servicio=${p.id}">Reservar ${esc(p.nombre)} ↗</a>${extras.length ? `<button class="plain" type="button" data-elige="${p.id}">Agregar extras +</button>` : ''}</article>`;

  const personaliza = extras.length && paquetes.length ? `<div class="customize" id="personaliza"><div><p class="eyebrow">A TU MEDIDA</p><h3>Un poco más para ti.</h3><p>Agrega solo lo que tu paquete no incluye.</p></div>
<div class="choices"><label for="paquete">Tu paquete</label><select id="paquete">${paquetes.map(p => `<option value="${p.id}" data-precio="${+p.precio}" data-lavado="${p.lavado ? 1 : 0}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)} — ${money(p.precio)} MXN</option>`).join('')}</select>
${extras.map(e => `<label class="extra"><input type="checkbox" data-id="${e.id}" data-precio="${+e.precio}" data-lavado="${e.lavado ? 1 : 0}" data-nombre="${esc(e.nombre)}"><span>${esc(e.nombre)}</span><b>+${money(e.precio)}</b></label>`).join('')}
<div class="total"><span>Total en MXN</span><strong id="total">${money(paquetes[0].precio)}</strong></div>
<a class="button" id="ir" href="${agenda}?servicio=${paquetes[0].id}">Reservar mi paquete ↗</a>${n.whatsapp ? `<a class="alt-wa" id="wa" rel="noopener noreferrer" target="_blank" href="${esc(whatsappUrl)}">¿Prefieres reservar por WhatsApp?</a>` : ''}</div></div>` : '';

  const estilos = referencias.length ? `<section class="section dark" id="estilos"><div class="heading"><div><p class="eyebrow">02 / INSPIRACIÓN PARA TU PRÓXIMO CORTE</p><h2>Encuentra<br><em>tu siguiente estilo.</em></h2></div>
<p>${avisoIA}El resultado se adapta a tu cabello.</p></div>
${referencias.length >= 2 && referencias.length <= 8 ? `<div class="filters" aria-label="Filtrar referencias"><button type="button" class="selected" aria-pressed="true" data-f="todos">Todos</button>${referencias.map(r => `<button type="button" aria-pressed="false" data-f="${Number(r.id)}">${esc(r.nombre)}</button>`).join('')}</div>` : ''}
<div class="styles">${referencias.map(r => { const et = etiquetaRef(r); return `<article data-s="${Number(r.id)}">${r.img ? `<button type="button" class="image-button" data-src="/i/${Number(r.img)}" data-cap="${esc(r.nombre + (et ? ' · ' + et : ''))}" aria-label="Ampliar ${esc(r.nombre)}"><img src="/i/${Number(r.img)}" alt="Referencia de ${esc(String(r.nombre).toLowerCase())}" loading="lazy" decoding="async"></button>` : ''}
<div class="style-copy"><span class="eyebrow">${esc(String(et || 'Referencia de estilo').toUpperCase())}</span><h3>${esc(r.nombre)}</h3>${r.descripcion ? `<p>${esc(r.descripcion)}</p>` : ''}${paquetes[0] ? `<a href="${agenda}?servicio=${paquetes[0].id}">Quiero este estilo · ${money(paquetes[0].precio)} ↗</a>` : ''}</div></article>`; }).join('')}</div>
<dialog class="lightbox" id="lb"><button type="button" class="button" id="lb-x">Cerrar ×</button><img id="lb-img" alt=""><p id="lb-cap"></p></dialog></section>` : '';

  const espacio = n.fotos ? `<section class="section space" id="espacio"><div class="heading"><div><p class="eyebrow">03 / ESTE ES NUESTRO ESPACIO</p><h2>Tu momento.<br><em>Nuestra barbería.</em></h2></div><p>${esc(n.nombre)} por dentro.<br>Fotografías reales de nuestro local.</p></div>
<div class="space-grid">${[['techo', 'El espacio'], ['vip', 'La silla VIP'], ['recepcion', 'La recepción'], ['bienvenido', 'La bienvenida']].map(([i, t]) => `<figure><img src="/img/${i}.jpg" alt="${t} de ${esc(n.nombre)}" loading="lazy" decoding="async"><figcaption>${t} <span>FOTO REAL ↗</span></figcaption></figure>`).join('')}</div></section>` : '';

  const trabajo = trabajos.length ? `<section class="section" id="trabajos"><div class="heading"><div><p class="eyebrow">NUESTRO TRABAJO</p><h2>Cortes <em>reales.</em></h2></div><p>Fotos de trabajos hechos en la barbería.</p></div>
<div class="work-grid">${trabajos.slice(0, 8).map(t => `<img src="/i/${t.img}" alt="Corte${t.servicio ? ' ' + esc(t.servicio) : ''}${t.barbero ? ' de ' + esc(t.barbero) : ''}" loading="lazy" decoding="async">`).join('')}</div></section>` : '';

  const acerca = mas ? `<section class="section" id="nosotros"><div class="heading"><div><p class="eyebrow">SOBRE NOSOTROS</p><h2>${esc(n.nombre)}</h2></div></div><p style="max-width:720px;font-size:17px">${esc(n.acerca).replace(/\n+/g, '<br>')}</p></section>` : '';
  const faq = preguntas.length ? `<section class="section" id="preguntas"><div class="heading"><div><p class="eyebrow">PREGUNTAS FRECUENTES</p><h2>Lo que <em>nos preguntan.</em></h2></div></div><div class="faq">${preguntas.map(p => `<details><summary>${esc(p.pregunta)}</summary><p>${esc(p.respuesta)}</p></details>`).join('')}</div></section>` : '';
  const tel = n.whatsapp ? `<a class="location-link" href="tel:+${esc(String(n.whatsapp).replace(/\D/g, ''))}">Tel. ${esc(telBonito(n.whatsapp))}</a>` : '';
  const ig = n.instagram ? `<a class="location-link" rel="noopener noreferrer" target="_blank" href="https://instagram.com/${esc(String(n.instagram).replace(/^@/, ''))}">Instagram @${esc(String(n.instagram).replace(/^@/, ''))}</a>` : '';
  const foto = n.fotos ? `<img src="/img/bienvenido.jpg" alt="Entrada de ${esc(n.nombre)}" loading="lazy" decoding="async">` : '';
  const resena = /^https:\/\//.test(n.resena || '') ? `<a class="location-link" rel="noopener noreferrer" target="_blank" href="${esc(n.resena)}">¿Ya nos visitaste? Déjanos tu reseña en Google ↗</a>` : '';

  // Así de fácil: los tres pasos reales de la agenda.
  const pasos = `<section class="section steps" id="como"><div class="steps-copy"><p class="eyebrow">ASÍ DE FÁCIL</p><h2>Tu cita en<br><em>un minuto.</em></h2>
<ol><li><b>Elige tu paquete</b><span>Y agrega extras si quieres. El total se ve antes de confirmar.</span></li><li><b>Escoge barbero y horario</b><span>Solo verás los horarios que de verdad están libres.</span></li><li><b>Llega y disfruta</b><span>Tu lugar queda apartado al confirmar. Sin llamadas ni mensajes.</span></li></ol>
<a class="button" href="${agenda}">Agendar ahora ↗</a></div><figure><img src="/img/tema/experiencia.jpg" alt="Imagen ilustrativa de un cliente satisfecho con su corte" loading="lazy" decoding="async" width="1200" height="800"><figcaption>Imagen ilustrativa</figcaption></figure></section>`;

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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;600;700;800&display=swap"><link rel="stylesheet" href="/tema-ei.css?v=2">
${hero ? `<link rel="preload" as="image" href="${esc(hero)}" fetchpriority="high">` : ''}
${ld.map(o => `<script type="application/ld+json">${json(o)}</script>`).join('\n')}</head><body>
<a class="skip" href="#paquetes">Saltar a paquetes</a>
<header class="header"><a class="brand" href="/${slug}" aria-label="${esc(n.nombre)} inicio"><span class="monogram">${esc(n.nombre.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase())}</span><span>${esc(n.nombre)}<small>BARBERÍA${ciudad ? ' · MÉRIDA' : ''}</small></span></a>
<nav aria-label="Principal"><a href="#paquetes">Paquetes</a>${referencias.length ? '<a href="#estilos">Estilos</a>' : ''}${equipoHtml ? '<a href="#equipo">Equipo</a>' : ''}${faq ? '<a href="#preguntas">Preguntas</a>' : ''}<a href="#ubicacion">Encuéntranos</a></nav><a class="button small" href="#paquetes">Elige tu paquete ↗</a></header>
${abierto ? '' : '<div class="notice" role="status">Esta barbería no está recibiendo citas en línea por ahora.</div>'}
<main><section class="hero"><img class="hero-photo" src="${esc(hero)}" alt="${heroReal ? `Interior de ${esc(n.nombre)}` : 'Imagen ilustrativa de una barbería'}" fetchpriority="high" decoding="async"><div class="hero-overlay"></div><div class="hero-copy">
<p class="eyebrow">${esc((n.zonas || n.direccion || 'Barbería').toUpperCase())}</p><h1>${esc(l1)}${lema2 ? `<br><em>${esc(lema2)}</em>` : ''}</h1>${sub ? `<p>${esc(sub).replace(/(?<=[.!?])\s+/g, '<br>')}</p>` : ''}
<a class="button" href="#paquetes">Encuentra tu paquete <span>↗</span></a><div class="hero-details">${desde !== null ? `<span>DESDE <b>${money(desde)} MXN</b></span>` : ''}<span>HORARIO <b>${esc(horario.toUpperCase().replace(' A ', ' — '))}</b></span></div></div><span class="hero-caption">${n.fotos || portada ? `FOTO REAL DE NUESTRO LOCAL / ${esc(n.nombre.toUpperCase())}` : 'IMAGEN ILUSTRATIVA'}</span></section>
<div class="ticker"><span>CORTE</span><i>✳</i><span>BARBA</span><i>✳</i><span>ACTITUD</span><i>✳</i><span>${esc(n.nombre.toUpperCase())}</span></div>
<section class="section" id="paquetes"><div class="heading"><div><p class="eyebrow">01 / ELIGE CÓMO RENOVARTE</p><h2>El look cambia.<br><em>El estilo es tuyo.</em></h2></div>
<p>${paquetes.length ? `${NUM[paquetes.length] || paquetes.length} ${paquetes.length === 1 ? 'forma' : 'formas'} de darle un nuevo aire a tu día.<br>` : ''}Precios en pesos mexicanos. Sin cargos por servicios ya incluidos.</p></div>
${paquetes.length ? `<div class="packages n${Math.min(paquetes.length, 4)}">${paquetes.map(tarjeta).join('')}</div>` : `<p>Pronto publicaremos nuestros paquetes. <a href="${agenda}" style="text-decoration:underline">Agenda tu cita aquí</a>.</p>`}
${personaliza}</section>
${pasos}${sellos}${estilos}${equipoHtml}${espacio}${trabajo}${acerca}${faq}
<section class="section location${foto ? '' : ' sin-foto'}" id="ubicacion"><div><p class="eyebrow">NOS VEMOS AQUÍ</p><h2>Encuentra<br><em>tu barbería.</em></h2>
<div class="address">${n.direccion ? `<p>${esc(n.direccion).replace(/,\s*/g, '<br>')}</p>` : ''}<p>HORARIO<br><strong>${esc(horario)}</strong>${cerrados.length ? `<br><small>Cerrado: ${esc(cerrados.join(', '))}</small>` : ''}</p></div>
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
