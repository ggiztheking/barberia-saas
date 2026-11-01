// Tema "Urbano": página pública en negro y dorado para barberías de diseños, freestyle y fades. Se dibuja en el servidor
// con los mismos datos que el tema Estilo Internacional (paquetes, extras, trabajos, equipo, preguntas) y sus mismas
// reglas de horario y de abierto/cerrado (tema-ei.js). Aquí mandan las fotos reales de trabajos: no usa imágenes de IA.
const { estadoAhora, util } = require('./tema-ei');
const { esc, money, json, NUM, DIAS, resumen, telBonito, horarioAgenda, citasEnLinea, marcaExtras } = util;

// Hexágono de la portada (las luces del techo de muchas barberías urbanas). Solo decoración: aria-hidden.
const HEX = '<svg class="hex" viewBox="0 0 200 174" aria-hidden="true" focusable="false"><polygon points="50,2 150,2 198,87 150,172 50,172 2,87"/><polygon points="72,40 128,40 156,87 128,134 72,134 44,87"/></svg>';
const sinArroba = t => String(t || '').replace(/^@/, '');

const dibuja = d => {
  const { n, base, paquetes, extras, trabajos, preguntas, portada, abierto, whatsappUrl, equipo = [], lealtad = null } = d;
  const slug = encodeURIComponent(n.slug), agenda = `/${slug}/agenda`, url = `${base}/${slug}`;
  const horario = n.horario_texto || horarioAgenda(n), citas = abierto ? citasEnLinea(n) : '';
  const cerrados = (n.cierra || '').split(',').filter(x => x !== '').map(x => DIAS[+x]).filter(Boolean);
  const desde = paquetes.length ? Math.min(...paquetes.map(p => +p.precio)) : null;
  // Portada: la que subió el dueño; si no hay, su trabajo más reciente; si tampoco, solo el fondo con el hexágono.
  const heroId = portada || (trabajos[0] && trabajos[0].img) || null, hero = heroId ? `/i/${Number(heroId)}` : '';
  const iniciales = t => String(t).split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
  const marca = `<span class="mono" aria-hidden="true">${esc(iniciales(n.nombre))}</span>`;
  const [l1, ...l2] = String(n.lema || 'Tu estilo habla por ti.').split(/(?<=\.)\s+/), lema2 = l2.join(' ');
  const sub = resumen(n.acerca), mas = String(n.acerca || '').length > sub.length + 10;
  const ciudad = /mérida/i.test(n.direccion || '') ? ' en Mérida' : '';
  const titulo = `${n.nombre}${/barber/i.test(n.nombre) ? '' : ' | Barbería'}${ciudad}`;
  const descr = `${n.lema ? n.lema + ' ' : ''}${desde !== null ? `Cortes desde ${money(desde)}` : 'Cortes'}, diseños y reservas en línea.${n.direccion ? ' ' + n.direccion + '.' : ''} ${horario}.`.replace(/\s+/g, ' ').trim();
  const og = hero ? base + hero : '';
  const estado = estadoAhora(n), estadoHtml = estado ? `<span class="status ${estado.abierto ? 'on' : 'off'}"><i aria-hidden="true"></i>${esc(estado.texto)}</span>` : '';
  const premium = paquetes.length >= 3 ? paquetes.reduce((a, p) => (+p.precio > +a.precio ? p : a), paquetes[0]).id : null;
  const ig = sinArroba(n.instagram);

  const ld = [{ '@context': 'https://schema.org', '@type': 'BarberShop', name: n.nombre, url, ...(og ? { image: og } : {}), description: descr,
    ...(n.direccion ? { address: { '@type': 'PostalAddress', streetAddress: n.direccion, addressCountry: 'MX' } } : {}),
    ...(n.whatsapp ? { telephone: '+' + String(n.whatsapp).replace(/\D/g, '') } : {}), ...(n.maps ? { hasMap: n.maps } : {}),
    ...(ig ? { sameAs: [`https://instagram.com/${ig}`] } : {}),
    ...(desde !== null ? { priceRange: `${money(desde)}–${money(Math.max(...paquetes.map(p => +p.precio)))} MXN` } : {}),
    ...(paquetes.length ? { makesOffer: paquetes.map(p => ({ '@type': 'Offer', name: p.nombre, price: +p.precio, priceCurrency: 'MXN', url: `${base}${agenda}?servicio=${p.id}` })) } : {}) }];
  if (preguntas.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: preguntas.map(p => ({ '@type': 'Question', name: p.pregunta, acceptedAnswer: { '@type': 'Answer', text: p.respuesta } })) });

  // El trabajo: la galería es lo primero después de la portada. Cada foto se puede ampliar. La primera ocupa 2×2, así que
  // con 5, 9 o 13 fotos la rejilla queda completa en 4 columnas (escritorio) y en 2 (celular); con menos de 5 salen todas.
  const muro = trabajos.length < 5 ? trabajos : trabajos.slice(0, [13, 9, 5].find(k => k <= trabajos.length));
  const trabajo = muro.length ? `<section class="sec" id="trabajos"><div class="head"><p class="kicker">01 / EL TRABAJO HABLA</p><h2>Diseños, fades<br><em>y detalle.</em></h2><p>Fotos reales de cortes hechos en ${esc(n.nombre)}.</p></div>
<div class="wall">${muro.map(t => { const cap = `Corte${t.servicio ? ' ' + t.servicio : ''}${t.barbero ? ' de ' + t.barbero : ''}`;
    return `<button type="button" class="tile" data-src="/i/${Number(t.img)}" data-cap="${esc(cap)}" aria-label="Ampliar foto: ${esc(cap)}"><img src="/i/${Number(t.img)}" alt="${esc(cap)}" loading="lazy" decoding="async" width="600" height="800"></button>`; }).join('')}</div>
${ig ? `<a class="ghost" rel="noopener noreferrer" target="_blank" href="https://instagram.com/${esc(ig)}">Más trabajos en Instagram @${esc(ig)} ↗</a>` : ''}
<dialog class="lightbox" id="lb" aria-labelledby="lb-cap"><button type="button" class="btn" id="lb-x">Cerrar <span aria-hidden="true">×</span></button><img id="lb-img" alt=""><p id="lb-cap"></p></dialog></section>` : '';

  const tarjeta = (p, i) => `<article class="card${p.id === premium ? ' top' : ''}">${p.img ? `<img src="/i/${Number(p.img)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async" width="600" height="750">` : ''}
<p class="kicker">${String(i + 1).padStart(2, '0')}${p.etiqueta ? ' / ' + esc(String(p.etiqueta).toUpperCase()) : ''}</p><h3>${esc(p.nombre)}</h3><p class="price">${money(p.precio)}<small> MXN</small></p>
<ul>${p.incluye.map(t => `<li>${esc(t)}</li>`).join('')}</ul><a class="btn" href="${agenda}?servicio=${p.id}">Reservar ${esc(p.nombre)} ↗</a>${extras.length ? `<button class="plain" type="button" data-elige="${p.id}" aria-label="Agregar extras a ${esc(p.nombre)}">Agregar extras +</button>` : ''}</article>`;

  // Extras: el mismo personalizador del tema Estilo Internacional (marcaExtras), con el total antes de reservar.
  const personaliza = extras.length && paquetes.length ? `<div class="custom" id="personaliza"><div><p class="kicker">A TU MEDIDA</p><h3>Súmale algo.</h3><p>Agrega solo lo que tu servicio no incluye. El total final lo confirma la agenda.</p></div>
<div class="choices"><label for="paquete">Tu servicio</label><select id="paquete">${paquetes.map(p => `<option value="${p.id}" data-precio="${+p.precio}" data-lavado="${p.lavado ? 1 : 0}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)} — ${money(p.precio)} MXN</option>`).join('')}</select>
${extras.map(e => `<label class="extra"><input type="checkbox" data-id="${e.id}" data-precio="${+e.precio}" data-lavado="${e.lavado ? 1 : 0}" data-nombre="${esc(e.nombre)}"><span>${esc(e.nombre)}</span><b>+${money(e.precio)}</b></label>`).join('')}
<div class="total" aria-live="polite"><span>Total en MXN</span><strong id="total">${money(paquetes[0].precio)}</strong></div>
<a class="btn" id="ir" href="${agenda}?servicio=${paquetes[0].id}">Reservar ↗</a>${n.whatsapp ? `<a class="ghost" id="wa" rel="noopener noreferrer" target="_blank" href="${esc(whatsappUrl)}">¿Prefieres reservar por WhatsApp?</a>` : ''}</div></div>` : '';

  const servicios = `<section class="sec alt" id="servicios"><div class="head"><p class="kicker">02 / SERVICIOS Y PRECIOS</p><h2>Elige tu corte.<br><em>Aparta tu silla.</em></h2>
<p>${paquetes.length ? `${NUM[paquetes.length] || paquetes.length} ${paquetes.length === 1 ? 'opción' : 'opciones'}. ` : ''}Precios en pesos mexicanos.</p></div>
${paquetes.length ? `<div class="cards">${paquetes.map(tarjeta).join('')}</div>` : `<p>Pronto publicaremos nuestros precios. <a class="link" href="${agenda}">Agenda tu cita aquí</a>.</p>`}${personaliza}</section>`;

  const pasos = `<section class="sec steps"><div class="head"><p class="kicker">ASÍ DE FÁCIL</p><h2>Tu cita en<br><em>un minuto.</em></h2></div>
<ol><li><b>Elige tu servicio</b><span>Y agrega extras si quieres. El total se ve antes de confirmar.</span></li><li><b>Escoge barbero y horario</b><span>Solo verás los horarios que de verdad están libres.</span></li><li><b>Llega y luce tu corte</b><span>Tu lugar queda apartado al confirmar.</span></li></ol>
<a class="btn" href="${agenda}">Agendar ahora ↗</a></section>`;

  const conPerfil = equipo.filter(b => b.foto || b.especialidad || b.bio);
  const equipoHtml = conPerfil.length ? `<section class="sec" id="equipo"><div class="head"><p class="kicker">EL EQUIPO</p><h2>Manos que<br><em>dibujan con navaja.</em></h2><p>Elige con quién quieres tu próximo corte.</p></div>
<div class="team">${equipo.map(b => `<article>${b.foto ? `<img src="/i/${Number(b.foto)}" alt="${esc(b.nombre)}, barbero" loading="lazy" decoding="async" width="500" height="600">` : `<div class="mono big" aria-hidden="true">${esc(iniciales(b.nombre))}</div>`}
<h3>${esc(b.nombre)}</h3>${b.especialidad ? `<p class="kicker">${esc(String(b.especialidad).toUpperCase())}</p>` : ''}${b.bio ? `<p>${esc(b.bio)}</p>` : ''}
<div class="links"><a href="${agenda}?barbero=${encodeURIComponent(b.nombre)}">Agendar con ${esc(String(b.nombre).split(/\s+/)[0])} ↗</a>${b.instagram ? `<a rel="noopener noreferrer" target="_blank" href="https://instagram.com/${esc(sinArroba(b.instagram))}">@${esc(sinArroba(b.instagram))}</a>` : ''}</div></article>`).join('')}</div></section>` : '';

  const sellos = lealtad && lealtad.premio ? `<section class="loyalty" aria-label="Tarjeta de sellos"><p class="kicker">TARJETA DE SELLOS</p><p class="big-line">Cada <b>${Number(lealtad.cada)} visitas</b>, ${esc(lealtad.premio)}.</p>
<div class="stamps" aria-hidden="true">${Array.from({ length: Math.min(Number(lealtad.cada) || 0, 12) }, (_, k) => `<i${k === Number(lealtad.cada) - 1 ? ' class="gift"' : ''}></i>`).join('')}</div><p class="fine">Tus visitas se cuentan solas con tu número de WhatsApp al reservar.</p></section>` : '';

  const acerca = mas ? `<section class="sec" id="nosotros"><div class="head"><p class="kicker">SOBRE NOSOTROS</p><h2>${esc(n.nombre)}</h2></div><p class="prose">${esc(n.acerca).replace(/\n+/g, '<br>')}</p></section>` : '';
  const faq = preguntas.length ? `<section class="sec alt" id="preguntas"><div class="head"><p class="kicker">PREGUNTAS FRECUENTES</p><h2>Lo que <em>nos preguntan.</em></h2></div><div class="faq">${preguntas.map(p => `<details><summary>${esc(p.pregunta)}</summary><p>${esc(p.respuesta)}</p></details>`).join('')}</div></section>` : '';
  const tel = n.whatsapp ? `<a class="ghost" href="tel:+${esc(String(n.whatsapp).replace(/\D/g, ''))}">Tel. ${esc(telBonito(n.whatsapp))}</a>` : '';
  const resena = /^https:\/\//.test(n.resena || '') ? `<a class="ghost" rel="noopener noreferrer" target="_blank" href="${esc(n.resena)}">¿Ya nos visitaste? Déjanos tu reseña en Google ↗</a>` : '';

  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><meta name="description" content="${esc(descr)}"><meta name="theme-color" content="#0b0b0d"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:locale" content="es_MX"><meta property="og:url" content="${esc(url)}"><meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(descr)}">${og ? `<meta property="og:image" content="${esc(og)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(og)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(titulo)}"><meta name="twitter:description" content="${esc(descr)}">
<link rel="manifest" href="/${slug}/manifest.json"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap"><link rel="stylesheet" href="/tema-urbano.css?v=2">
${hero ? `<link rel="preload" as="image" href="${esc(hero)}" fetchpriority="high">` : ''}
${ld.map(o => `<script type="application/ld+json">${json(o)}</script>`).join('\n')}</head><body>
<a class="skip" href="#servicios">Saltar a servicios y precios</a>
<header class="bar"><a class="brand" href="/${slug}" aria-label="${esc(n.nombre)} inicio">${marca}<span>${esc(n.nombre)}</span></a>
<nav aria-label="Principal">${trabajo ? '<a href="#trabajos">Trabajos</a>' : ''}<a href="#servicios">Precios</a>${equipoHtml ? '<a href="#equipo">Equipo</a>' : ''}${faq ? '<a href="#preguntas">Preguntas</a>' : ''}<a href="#ubicacion">Ubicación</a></nav><a class="btn small" href="${agenda}">Agendar ↗</a></header>
${abierto ? '' : '<div class="notice" role="status">Esta barbería no está recibiendo citas en línea por ahora.</div>'}
<main><section class="hero${hero ? '' : ' sin-foto'}">${hero ? `<img class="hero-img" src="${esc(hero)}" alt="Trabajo de ${esc(n.nombre)}" fetchpriority="high" decoding="async" width="900" height="1200">` : ''}<div class="hero-shade"></div>${HEX}
<div class="hero-copy"><p class="kicker">${esc((n.zonas || n.direccion || 'Barbería').toUpperCase())}</p><h1>${esc(l1)}${lema2 ? `<br><em>${esc(lema2)}</em>` : ''}</h1>${sub ? `<p class="lead">${esc(sub)}</p>` : ''}
<div class="cta"><a class="btn" href="${agenda}">Agenda tu cita ↗</a>${n.whatsapp ? `<a class="btn line" rel="noopener noreferrer" target="_blank" href="${esc(whatsappUrl)}">WhatsApp</a>` : ''}</div>
<div class="facts">${desde !== null ? `<span>DESDE <b>${money(desde)} MXN</b></span>` : ''}<span>HORARIO <b>${esc(horario)}</b>${citas ? `<small>${esc(citas)}</small>` : ''}</span>${estadoHtml ? `<span>HOY ${estadoHtml}</span>` : ''}</div></div></section>
<div class="ticker" aria-hidden="true"><div><span>DISEÑOS</span><i>◆</i><span>FADES</span><i>◆</i><span>FREESTYLE</span><i>◆</i><span>${esc(n.nombre.toUpperCase())}</span><i>◆</i><span>DISEÑOS</span><i>◆</i><span>FADES</span><i>◆</i><span>FREESTYLE</span><i>◆</i><span>${esc(n.nombre.toUpperCase())}</span><i>◆</i></div></div>
${trabajo}${servicios}${pasos}${sellos}${equipoHtml}${acerca}${faq}
<section class="sec where" id="ubicacion"><div class="head"><p class="kicker">NOS VEMOS AQUÍ</p><h2>Encuentra<br><em>tu barbería.</em></h2></div>
<div class="where-grid"><div>${n.direccion ? `<p class="addr">${esc(n.direccion).replace(/,\s*/g, '<br>')}</p>` : ''}<p>HORARIO<br><strong>${esc(horario)}</strong>${citas ? `<br><small>${esc(citas)}</small>` : ''}${cerrados.length ? `<br><small>Cerrado: ${esc(cerrados.join(', '))}</small>` : ''}${estadoHtml ? `<br>${estadoHtml}` : ''}</p></div>
<div class="where-links">${n.maps ? `<a class="btn" rel="noopener noreferrer" target="_blank" href="${esc(n.maps)}">Cómo llegar · Google Maps ↗</a>` : ''}${tel}${ig ? `<a class="ghost" rel="noopener noreferrer" target="_blank" href="https://instagram.com/${esc(ig)}">Instagram @${esc(ig)}</a>` : ''}${resena}${n.estacionamiento ? `<p class="fine">Estacionamiento: ${esc(n.estacionamiento)}</p>` : ''}</div></div></section></main>
<footer><a class="brand" href="/${slug}">${marca}<span>${esc(n.nombre)}</span></a><span>${esc(n.lema || '')}</span><a href="/${slug}/privacidad">Aviso de privacidad</a><small>© ${new Date().getFullYear()} ${esc(n.nombre)}</small></footer>
<a class="mobile-book btn" href="${agenda}">Agenda tu cita ↗</a>
<script>
(function(){var $=function(s,r){return(r||document).querySelector(s)},$$=function(s,r){return[].slice.call((r||document).querySelectorAll(s))};
var sel=$('#paquete');if(sel){var cajas=$$('.extra input'),tot=$('#total'),ir=$('#ir'),wa=$('#wa'),A=${json(agenda)},N=${json(n.nombre)},W=${json(whatsappUrl || '')};
${String(marcaExtras)}
function pinta(inicio){var o=sel.options[sel.selectedIndex],s=+o.dataset.precio,ids=[],nom=[],cobra=marcaExtras(o.dataset.lavado==='1',cajas,inicio===true);
cajas.forEach(function(c){c.parentNode.querySelector('b').textContent=c.disabled?'Incluido':'+$'+c.dataset.precio});
cobra.forEach(function(c){s+=+c.dataset.precio;ids.push(c.dataset.id);nom.push(c.dataset.nombre+' ($'+c.dataset.precio+' MXN)')});
tot.textContent='$'+s;ir.href=A+'?servicio='+o.value+(ids.length?'&extras='+ids.join(','):'');ir.firstChild.nodeValue='Reservar · $'+s+' ↗';
if(wa&&W){var t='Hola, quiero reservar en '+N+'. Servicio: '+o.dataset.nombre+' ($'+o.dataset.precio+' MXN).'+(nom.length?' Extras: '+nom.join(', ')+'.':'')+' ¿Qué horarios tienen disponibles?';wa.href=W.split('?text=')[0]+'?text='+encodeURIComponent(t)}}
sel.onchange=pinta;cajas.forEach(function(c){c.onchange=pinta});pinta(true);
$$('[data-elige]').forEach(function(b){b.onclick=function(){sel.value=b.dataset.elige;pinta();$('#personaliza').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});sel.focus({preventScroll:true})}})}
var lb=$('#lb');if(lb){$$('.tile').forEach(function(b){b.onclick=function(){$('#lb-img').src=b.dataset.src;$('#lb-img').alt=b.dataset.cap;$('#lb-cap').textContent=b.dataset.cap;lb.showModal()}});
$('#lb-x').onclick=function(){lb.close()};lb.onclick=function(e){if(e.target===lb)lb.close()}}
if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})})();
</script></body></html>`;
};

module.exports = dibuja;
