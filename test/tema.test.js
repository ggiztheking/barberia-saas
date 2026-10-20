// Tema "ei": la página pública sale completa del servidor, con datos de la base, SEO y sin inyección de HTML.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
let base, parar, pool;
const sufijo = Date.now().toString(36);
const ld = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

before(async () => {
  if (sinBase) return;
  ({ base, parar } = await arranca());
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
after(async () => { if (parar) parar(); if (pool) await pool.end(); });

test('Estilo Internacional se dibuja con sus paquetes, extras y referencias', { skip: sinBase }, async () => {
  const r = await fetch(base + '/estilo-internacional');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const h = await r.text();
  for (const t of ['Elige tu corte', 'Corte y barba', 'Corte Fresco', 'VIP Diamante', '$450', 'Cejas', 'Masaje relajante de cuero cabludo'.replace('cabludo', 'cabelludo'), 'Degradado bajo', 'Texturizado', 'generadas con IA', 'maps.app.goo.gl/NpfSt23Eorm4wgd37', '+52 962 329 5413', '9:30 AM'])
    assert.ok(h.includes(t), 'falta: ' + t);
  assert.match(h, /<h1>Tu estilo\.<br><em>Sin fronteras\.<\/em><\/h1>/);
  assert.match(h, /href="\/estilo-internacional\/agenda\?servicio=\d+"/, 'cada paquete lleva a la agenda real');
  assert.ok(!h.includes('wa.me/529623295413?text=Hola%2C%20quiero%20reservar%20en%20Estilo%20Internacional.%20Paquete'), 'WhatsApp no es el camino principal');
  assert.ok(h.includes('wa.me/529623295413'), 'WhatsApp queda como alternativa');
});

test('SEO: título, canonical, OG, Twitter y datos estructurados válidos', { skip: sinBase }, async () => {
  const h = await (await fetch(base + '/estilo-internacional')).text();
  assert.match(h, /<title>Estilo Internacional \| Barbería en Mérida<\/title>/);
  assert.ok(h.includes(`<link rel="canonical" href="${base}/estilo-internacional">`));
  for (const m of ['og:title', 'og:description', 'og:image', 'og:locale', 'twitter:card', 'twitter:image']) assert.ok(h.includes(m), m);
  assert.ok(h.includes('<html lang="es-MX">'));
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1, 'un solo h1');
  assert.ok(!h.includes('@import'), 'sin @import bloqueante');
  const datos = ld(h), tienda = datos.find(x => x['@type'] === 'BarberShop');
  assert.equal(tienda.name, 'Estilo Internacional');
  assert.equal(tienda.makesOffer.length, 4);
  assert.deepEqual(tienda.makesOffer.map(o => o.price).sort((a, b) => a - b), [200, 280, 350, 450]);
  assert.equal(tienda.priceRange, '$200–$450 MXN');
  assert.ok(!('openingHoursSpecification' in tienda), 'no inventa días de apertura que el negocio no confirmó');
  assert.ok(datos.some(x => x['@type'] === 'FAQPage'), 'preguntas frecuentes como FAQPage');
});

test('todos los enlaces e imágenes internos de la página existen', { skip: sinBase }, async () => {
  const h = await (await fetch(base + '/estilo-internacional')).text();
  const urls = new Set([...h.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')).filter(u => u.startsWith('/') && !u.startsWith('//')));
  assert.ok(urls.size > 12, 'encontró enlaces: ' + urls.size);
  for (const u of urls) assert.equal((await fetch(base + u)).status, 200, u);
});

test('un nombre o texto malicioso no inyecta HTML', { skip: sinBase }, async () => {
  const slug = 'xss-' + sufijo;
  await registra(base, slug);
  const mal = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
  await pool.query("UPDATE negocios SET tema='ei', nombre=$2, lema=$2, acerca=$2, direccion=$2, instagram=$2, zonas=$2, horario_texto=$2 WHERE slug=$1", [slug, mal]);
  const id = (await pool.query('SELECT id FROM negocios WHERE slug=$1', [slug])).rows[0].id;
  await pool.query("INSERT INTO preguntas(negocio_id,pregunta,respuesta,orden) VALUES($1,$2,$2,1)", [id, mal]);
  await pool.query("INSERT INTO extras(negocio_id,nombre,precio) VALUES($1,$2,10)", [id, mal]);
  const h = await (await fetch(`${base}/${slug}`)).text();
  assert.equal((await fetch(`${base}/${slug}`)).status, 200);
  assert.ok(!h.includes('<script>alert(1)'), 'sin <script> inyectado');
  assert.ok(!/<img src=x onerror/i.test(h), 'sin <img> inyectado');
  const bloques = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(bloques.length >= 1);
  for (const b of bloques) { assert.ok(!b[1].includes('</script'), 'JSON-LD sin cierre de script'); JSON.parse(b[1]); }
});

test('sin paquetes, los servicios de la barbería hacen de paquetes', { skip: sinBase }, async () => {
  const slug = 'sp-' + sufijo;
  await registra(base, slug);
  await pool.query("UPDATE negocios SET tema='ei' WHERE slug=$1", [slug]);
  const h = await (await fetch(`${base}/${slug}`)).text();
  assert.ok(h.includes('Corte y barba'), 'usa los servicios sembrados');
  assert.match(h, new RegExp(`href="/${slug}/agenda\\?servicio=\\d+"`));
  assert.ok(!h.includes('id="personaliza"'), 'sin extras no hay personalizador');
  assert.ok(!h.includes('id="estilos"'), 'sin referencias no hay galería de referencias');
  assert.ok(!h.includes('FOTO REAL'), 'no presume fotos reales que no tiene');
});

test('el dueño cambia el tema y la página lo refleja; las demás siguen con el tema anterior', { skip: sinBase }, async () => {
  const slug = 'ct-' + sufijo, cookie = await registra(base, slug);
  const viejo = await (await fetch(`${base}/${slug}`)).text();
  assert.ok(viejo.includes('/s.css') || viejo.includes('Jost'), 'tema por defecto: el oscuro de siempre');
  const cambia = tema => fetch(`${base}/api/${slug}/admin/tema`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ tema }) });
  assert.equal((await cambia('rosa')).status, 400);
  assert.equal((await cambia('ei')).status, 200);
  assert.ok((await (await fetch(`${base}/${slug}`)).text()).includes('/tema-ei.css'));
  assert.equal((await cambia('oscuro')).status, 200);
  assert.ok(!(await (await fetch(`${base}/${slug}`)).text()).includes('/tema-ei.css'));
  assert.equal((await fetch(`${base}/api/${slug}/admin/tema`)).status, 401);
});

test('plantilla v2: sin fotos se ve completa con imágenes ilustrativas, y muestra equipo, sellos, reseña y horario reales', { skip: sinBase }, async () => {
  const slug = 'v2-' + sufijo;
  await registra(base, slug, '10.2.0.1');
  await pool.query("UPDATE negocios SET tema='ei', hora_ini=9, abre_min=30, intervalo=30, hora_fin=19, horario_texto=NULL, resena='https://g.page/r/ejemplo/review' WHERE slug=$1", [slug]);
  const id = (await pool.query('SELECT id, barberos FROM negocios WHERE slug=$1', [slug])).rows[0];
  const antes = await (await fetch(`${base}/${slug}`)).text();
  assert.ok(antes.includes('/img/tema/portada.jpg') && antes.includes('IMAGEN ILUSTRATIVA'), 'sin fotos usa una portada ilustrativa y lo dice');
  assert.ok(!antes.includes('FOTO REAL'), 'no presume fotos reales');
  assert.match(antes, /\/img\/tema\/paq-(corte|fresco|barba|vip)\.jpg/, 'los paquetes sin foto llevan imagen ilustrativa');
  assert.ok(antes.includes('Imagen ilustrativa'), 'cada imagen ilustrativa va marcada');
  assert.ok(antes.includes('id="como"'), 'sección de pasos');
  assert.ok(antes.includes('9:30 AM a 8:00 PM'), 'el horario respeta la apertura a la media hora y el último espacio');
  assert.ok(antes.includes('g.page/r/ejemplo/review'), 'enlace para dejar reseña');
  assert.ok(!antes.includes('id="equipo"'), 'sin perfiles no hay sección de equipo');
  assert.ok(!antes.includes('TARJETA DE SELLOS'), 'sin programa activo no hay tarjeta de sellos');
  const barbero = String(id.barberos).split(',')[0].trim();
  await pool.query("INSERT INTO perfiles(negocio_id,barbero,especialidad,bio) VALUES($1,$2,'Fades y barba','Diez años de oficio') ON CONFLICT (negocio_id,barbero) DO UPDATE SET especialidad=EXCLUDED.especialidad, bio=EXCLUDED.bio", [id.id, barbero]);
  await pool.query("INSERT INTO lealtad_config(negocio_id,activo,cada,premio,desde) VALUES($1,true,8,'el siguiente corte gratis',CURRENT_DATE) ON CONFLICT (negocio_id) DO UPDATE SET activo=true, cada=8, premio=EXCLUDED.premio", [id.id]);
  const h = await (await fetch(`${base}/${slug}`)).text();
  assert.ok(h.includes('id="equipo"') && h.includes('FADES Y BARBA') && h.includes('Diez años de oficio'), 'equipo con su perfil');
  assert.ok(h.includes(`/${slug}/agenda?barbero=${encodeURIComponent(barbero)}`), 'agendar con ese barbero');
  assert.ok(h.includes('TARJETA DE SELLOS') && h.includes('Cada <b>8 visitas</b>, el siguiente corte gratis.'), 'tarjeta de sellos con sus datos');
  const urls = new Set([...h.matchAll(/src="(\/img\/[^"]+)"/g)].map(m => m[1]));
  for (const u of urls) assert.equal((await fetch(base + u)).status, 200, u);
});

// ---- Plantilla v3: estado abierto/cerrado, extras con foto y galería "La experiencia" ----
const fs = require('node:fs');
const path = require('node:path');
const { estadoAhora } = require('../tema-ei');
const existe = f => fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'tema', f + '.jpg'));
const GAL = ['galeria-llegada', 'galeria-toalla', 'galeria-navaja', 'galeria-degradado', 'galeria-productos', 'galeria-peinado'];
const hayGaleria = GAL.filter(existe).length + (GAL.every(existe) || !existe('experiencia') ? 0 : 1) >= 3;
const imgsDe = h => [...new Set([...h.matchAll(/src="(\/img\/[^"]+)"/g)].map(m => m[1]))];
const extraDe = (h, nombre) => (h.match(new RegExp(`<label class="extra[^"]*">(?:(?!</label>).)*data-nombre="${nombre}"(?:(?!</label>).)*</label>`)) || [])[0];

test('estado abierto/cerrado en hora de Mérida (horas fijas)', () => {
  // Mérida es UTC-6 todo el año. 2026-10-14 es miércoles (getDay 3).
  const n = { hora_ini: 10, abre_min: 0, hora_fin: 19, intervalo: 60, cierra: '' }; // espacios de 10:00 a 19:00 → cierra 8:00 PM
  const en = iso => estadoAhora(n, new Date(iso));
  assert.deepEqual(en('2026-10-14T16:00:00Z'), { abierto: true, texto: 'Abierto ahora', cierra: '8:00 PM' }, '10:00 AM abre');
  assert.equal(en('2026-10-15T01:59:00Z').abierto, true, '7:59 PM sigue abierto');
  assert.deepEqual(en('2026-10-14T15:30:00Z'), { abierto: false, texto: 'Cerrado · abre a las 10:00 AM' }, '9:30 AM aún no abre');
  assert.deepEqual(en('2026-10-15T02:00:00Z'), { abierto: false, texto: 'Cerrado · abre mañana a las 10:00 AM' }, '8:00 PM ya cerró');
  assert.equal(en('2026-10-15T05:30:00Z').texto, 'Cerrado · abre mañana a las 10:00 AM', '11:30 PM (en UTC ya es otro día)');
  // Cierra los domingos (0): el sábado en la noche abre el lunes; el domingo, "mañana".
  const dom = { ...n, cierra: '0' };
  assert.equal(estadoAhora(dom, new Date('2026-10-18T03:00:00Z')).texto, 'Cerrado · abre el lunes a las 10:00 AM', 'sábado 9 PM');
  assert.deepEqual(estadoAhora(dom, new Date('2026-10-18T18:00:00Z')), { abierto: false, texto: 'Cerrado · abre mañana a las 10:00 AM' }, 'domingo a mediodía');
  assert.equal(estadoAhora(dom, new Date('2026-10-17T18:00:00Z')).abierto, true, 'sábado a mediodía abre');
  // Media hora y espacios de 30 minutos: abre 9:30, último espacio 7:30 → cierra 8:00 PM.
  const media = { hora_ini: 9, abre_min: 30, hora_fin: 19, intervalo: 30, cierra: '1,2' };
  assert.equal(estadoAhora(media, new Date('2026-10-16T15:15:00Z')).texto, 'Cerrado · abre a las 9:30 AM', 'viernes 9:15 AM');
  assert.equal(estadoAhora(media, new Date('2026-10-16T15:30:00Z')).abierto, true, 'viernes 9:30 AM');
  assert.equal(estadoAhora(media, new Date('2026-10-16T01:59:00Z')).abierto, true, 'jueves 7:59 PM');
  assert.equal(estadoAhora(media, new Date('2026-10-12T16:00:00Z')).texto, 'Cerrado · abre el miércoles a las 9:30 AM', 'lunes cerrado, martes también');
  assert.equal(estadoAhora({ ...n, hora_ini: 13 }, new Date('2026-10-14T16:00:00Z')).texto, 'Cerrado · abre a la 1:00 PM', '"a la" una');
  // Con horario_texto, el estado sigue a ese texto (el que se ve junto al estado), no a los espacios de la agenda.
  // Así está Estilo Internacional en producción: texto "9:30 AM a 11:00 PM" y agenda de 10:00 a 8:00 PM.
  const txt = { ...n, horario_texto: '9:30 AM a 11:00 PM' };
  assert.deepEqual(estadoAhora(txt, new Date('2026-10-15T03:00:00Z')), { abierto: true, texto: 'Abierto ahora', cierra: '11:00 PM' }, 'miércoles 9:00 PM: abierto según el horario que se muestra');
  assert.equal(estadoAhora(txt, new Date('2026-10-14T15:45:00Z')).abierto, true, '9:45 AM abierto');
  assert.equal(estadoAhora(txt, new Date('2026-10-14T15:15:00Z')).texto, 'Cerrado · abre a las 9:30 AM', '9:15 AM');
  assert.equal(estadoAhora(txt, new Date('2026-10-15T05:00:00Z')).texto, 'Cerrado · abre mañana a las 9:30 AM', '11:00 PM ya cerró');
  assert.equal(estadoAhora({ ...txt, cierra: '3' }, new Date('2026-10-14T18:00:00Z')).texto, 'Cerrado · abre mañana a las 9:30 AM', 'día cerrado también con texto');
  assert.equal(estadoAhora({ ...n, horario_texto: '10 am - 12 am' }, new Date('2026-10-15T05:59:00Z')).abierto, true, 'cierra a medianoche: 11:59 PM abierto');
  // Un texto que no se puede leer con certeza no inventa un estado (aunque haya horas numéricas).
  for (const t of ['Lunes a sábado de 10 a 8', '10:00 AM a 2:00 PM y 4:00 PM a 8:00 PM', '6:00 PM a 2:00 AM', '<script>alert(1)</script>', '13:00 PM a 8:00 PM'])
    assert.equal(estadoAhora({ ...n, horario_texto: t }, new Date('2026-10-14T18:00:00Z')), null, t);
  // Cerca de medianoche con horas numéricas: último espacio a las 11:00 PM → cierra a las 12:00 AM.
  const noche = { ...n, hora_fin: 23 };
  assert.deepEqual(estadoAhora(noche, new Date('2026-10-15T05:59:00Z')), { abierto: true, texto: 'Abierto ahora', cierra: '12:00 AM' }, '11:59 PM');
  assert.equal(estadoAhora(noche, new Date('2026-10-15T06:00:00Z')).texto, 'Cerrado · abre a las 10:00 AM', '12:00 AM del jueves');
  // Valores fuera de lo que admite la agenda se tratan como en server.js (intervalo 60, en punto).
  assert.equal(estadoAhora({ ...n, intervalo: 45, abre_min: 15 }, new Date('2026-10-14T16:00:00Z')).abierto, true);
  assert.equal(estadoAhora({ ...n, cierra: '0,1,2,3,4,5,6' }, new Date('2026-10-14T16:00:00Z')).texto, 'Cerrado', 'todos los días cerrados');
  assert.equal(estadoAhora({ hora_ini: null, hora_fin: null }), null, 'sin horario no inventa un estado');
});

test('Estilo Internacional: estado en la portada, extras con miniatura ilustrativa y todas las imágenes /img/ responden 200', { skip: sinBase }, async () => {
  const h = await (await fetch(base + '/estilo-internacional')).text();
  assert.match(h, /<div class="hero-details">.*<span class="status (on|off)"><i aria-hidden="true"><\/i>(Abierto ahora|Cerrado[^<]*)<\/span>/, 'estado junto al horario en la portada');
  for (const [nombre, f] of [['Cejas', 'extra-cejas'], ['Lavado', 'extra-lavado'], ['Masaje relajante de cuero cabelludo', 'extra-masaje']]) {
    const label = extraDe(h, nombre);
    assert.ok(label, 'falta el extra ' + nombre);
    if (existe(f)) assert.ok(label.includes(`/img/tema/${f}.jpg`) && label.includes('Ilustrativa') && label.includes('generada con IA'), `${nombre} lleva su miniatura marcada como ilustrativa`);
  }
  if (['extra-cejas', 'extra-lavado', 'extra-masaje'].some(existe)) assert.ok(h.includes('Las fotos de los extras son imágenes ilustrativas generadas con IA.'));
  // Fotos reales intactas, con su leyenda.
  for (const f of ['techo', 'vip', 'recepcion', 'bienvenido']) assert.ok(h.includes(`/img/${f}.jpg`), f);
  assert.ok(h.includes('FOTO REAL'));
  const imgs = imgsDe(h);
  assert.ok(imgs.length >= 8, 'imágenes: ' + imgs.length);
  for (const u of imgs) assert.equal((await fetch(base + u)).status, 200, u);
  // Toda imagen /img/tema/ (ilustrativa) va acompañada de su marca; ninguna se presenta como foto real.
  const tema = h.match(/<(figure|label)[^>]*>(?:(?!<\/\1>).)*?\/img\/tema\/(?:(?!<\/\1>).)*?<\/\1>/gs) || [];
  assert.equal(tema.length, (h.match(/src="\/img\/tema\//g) || []).length, 'cada imagen ilustrativa está dentro de un bloque con su marca');
  for (const b of tema) assert.match(b, /[Ii]lustrativa/, 'imagen ilustrativa sin marca: ' + b.slice(0, 120));
  for (const b of tema) assert.ok(!b.includes('FOTO REAL'), 'una ilustrativa no dice FOTO REAL');
  // Toda <img> lleva width/height, y todas menos la portada cargan en diferido.
  for (const t of h.match(/<img [^>]+>/g)) {
    if (t.includes('id="lb-img"')) continue;
    assert.match(t, /width="\d+" height="\d+"/, 'sin dimensiones: ' + t);
    if (!t.includes('hero-photo')) assert.ok(t.includes('loading="lazy"'), 'sin lazy: ' + t);
  }
});

test('extras: miniatura solo con palabra clave; galería "La experiencia" solo sin 4 trabajos reales y marcada como IA', { skip: sinBase }, async () => {
  const slug = 'v3-' + sufijo;
  await registra(base, slug, '10.3.0.1');
  await pool.query("UPDATE negocios SET tema='ei', cierra='' WHERE slug=$1", [slug]);
  const id = (await pool.query('SELECT id FROM negocios WHERE slug=$1', [slug])).rows[0].id;
  await pool.query("INSERT INTO extras(negocio_id,nombre,precio) VALUES($1,'Perfilado de cejas',40),($1,'Tinte de barba',90)", [id]);
  const h = await (await fetch(`${base}/${slug}`)).text();
  if (existe('extra-cejas')) assert.ok(extraDe(h, 'Perfilado de cejas').includes('/img/tema/extra-cejas.jpg'), 'cejas lleva foto');
  assert.ok(!extraDe(h, 'Tinte de barba').includes('<img'), 'sin coincidencia, sin foto');
  for (const u of imgsDe(h)) assert.equal((await fetch(base + u)).status, 200, u);

  if (hayGaleria) {
    assert.ok(h.includes('id="experiencia"') && h.includes('href="#experiencia"'), 'galería y su enlace en el menú');
    const sec = h.match(/<section class="section dark experience" id="experiencia">[\s\S]*?<\/section>/)[0];
    assert.ok(sec.includes('Imágenes ilustrativas generadas con IA'), 'la sección dice que son de IA');
    const figs = sec.match(/<figure[\s\S]*?<\/figure>/g);
    assert.ok(figs.length >= 3);
    for (const f of figs) assert.ok(f.includes('Imagen ilustrativa') && /alt="Imagen ilustrativa generada con IA/.test(f), 'cada foto va marcada');
    assert.ok(!sec.includes('FOTO REAL'));
  } else assert.ok(!h.includes('id="experiencia"'), 'sin fotos de galería no hay galería (ni imágenes rotas)');

  // Con 3 trabajos reales la galería sigue; con 4 se va (las reales mandan).
  const sube = async k => {
    for (let i = 0; i < k; i++) {
      const img = (await pool.query("INSERT INTO imagenes(negocio_id,tipo,ref,mime,data) VALUES($1,'trabajo',$2,'image/jpeg',$3) RETURNING id", [id, `t${sufijo}${Date.now()}${i}`, Buffer.from([0xff, 0xd8, 0xff, 0xd9])])).rows[0].id;
      await pool.query('INSERT INTO trabajos(negocio_id,img) VALUES($1,$2)', [id, img]);
    }
  };
  await sube(3);
  const tres = await (await fetch(`${base}/${slug}`)).text();
  assert.ok(tres.includes('id="trabajos"'));
  assert.equal(tres.includes('id="experiencia"'), hayGaleria, 'con 3 trabajos reales la galería ilustrativa sigue');
  await sube(1);
  const cuatro = await (await fetch(`${base}/${slug}`)).text();
  assert.ok(cuatro.includes('id="trabajos"') && cuatro.includes('Cortes <em>reales.</em>'));
  assert.ok(!cuatro.includes('id="experiencia"') && !cuatro.includes('/img/tema/galeria-'), 'con 4 trabajos reales no hay galería ilustrativa');
});

// ---- Personalizador y horario de citas en línea (se prueban sobre el HTML que dibuja tema-ei.js, sin base) ----
const vm = require('node:vm');
const dibuja = require('../tema-ei');
const pagina = (n = {}, extra = {}) => dibuja({
  n: { slug: 'prueba', nombre: 'Barbería Prueba', hora_ini: 10, hora_fin: 19, intervalo: 60, abre_min: 0, cierra: '', ...n }, base: 'http://x',
  paquetes: [{ id: 13, nombre: 'Elige tu corte', precio: 200, etiqueta: '', incluye: ['Corte'], lavado: false }, { id: 14, nombre: 'Corte Fresco', precio: 280, etiqueta: '', incluye: ['Corte', 'Lavado'], lavado: true }],
  extras: [{ id: 1, nombre: 'Cejas', precio: 50 }, { id: 2, nombre: 'Lavado', precio: 50, lavado: true }, { id: 3, nombre: 'Masaje', precio: 50 }],
  referencias: [], trabajos: [], preguntas: [], portada: null, abierto: true, whatsappUrl: '', ...extra });
// Corre el <script> de la página con un DOM mínimo hecho con el <select> y las casillas del mismo HTML.
// `antes` deja cambiar el estado antes de que corra (como cuando el navegador restaura el formulario al regresar).
const personalizador = (h, antes) => {
  const script = h.match(/<script>\n([\s\S]*?)<\/script><\/body>/)[1];
  const options = [...h.matchAll(/<option value="(\d+)" data-precio="([\d.]+)" data-lavado="([01])" data-nombre="([^"]*)">/g)].map(m => ({ value: m[1], dataset: { precio: m[2], lavado: m[3], nombre: m[4] } }));
  const sel = { options, selectedIndex: 0, get value() { return this.options[this.selectedIndex].value; }, set value(v) { this.selectedIndex = this.options.findIndex(o => o.value === String(v)); } };
  const cajas = [...h.matchAll(/<input type="checkbox" data-id="(\d+)" data-precio="([\d.]+)" data-lavado="([01])" data-nombre="([^"]*)">/g)].map(m => {
    const b = { textContent: '' };
    return { checked: false, disabled: false, dataset: { id: m[1], precio: m[2], lavado: m[3], nombre: m[4] }, parentNode: { querySelector: () => b }, b };
  });
  const total = { textContent: '' }, ir = { href: '', firstChild: { nodeValue: '' } };
  const uno = { '#paquete': sel, '#total': total, '#ir': ir, '#personaliza': { scrollIntoView() {} } };
  const document = { querySelector: s => uno[s] || null, querySelectorAll: s => (s === '.extra input' ? cajas : []) };
  if (antes) antes(sel, cajas);
  vm.runInNewContext(script, { document, navigator: {}, addEventListener() {} });
  const lavado = cajas.find(c => c.dataset.nombre === 'Lavado');
  return {
    paquete: nombre => { sel.selectedIndex = options.findIndex(o => o.dataset.nombre === nombre); sel.onchange({}); },
    marca: (nombre, v = true) => { const c = cajas.find(x => x.dataset.nombre === nombre); assert.ok(!c.disabled, nombre + ' no se puede tocar'); c.checked = v; c.onchange({}); },
    estado: () => ({ total: total.textContent, href: ir.href, lavado: lavado.checked, bloqueado: lavado.disabled, etiqueta: lavado.b.textContent }),
  };
};

test('personalizador: el lavado que se marcó solo por el paquete se desmarca al cambiar a uno que no lo incluye', () => {
  const p = personalizador(pagina());
  assert.deepEqual(p.estado(), { total: '$200', href: '/prueba/agenda?servicio=13', lavado: false, bloqueado: false, etiqueta: '+$50' });
  p.marca('Cejas'); p.marca('Masaje');
  assert.deepEqual(p.estado(), { total: '$300', href: '/prueba/agenda?servicio=13&extras=1,3', lavado: false, bloqueado: false, etiqueta: '+$50' });
  p.paquete('Corte Fresco');
  assert.deepEqual(p.estado(), { total: '$380', href: '/prueba/agenda?servicio=14&extras=1,3', lavado: true, bloqueado: true, etiqueta: 'Incluido' }, 'incluido: marcado, bloqueado y sin cobrarse');
  p.paquete('Elige tu corte');
  assert.deepEqual(p.estado(), { total: '$300', href: '/prueba/agenda?servicio=13&extras=1,3', lavado: false, bloqueado: false, etiqueta: '+$50' }, 'el lavado no queda marcado ni se cobra');
  // Ida y vuelta varias veces: siempre igual.
  p.paquete('Corte Fresco'); p.paquete('Elige tu corte');
  assert.equal(p.estado().total, '$300');
});

test('personalizador: si el cliente marcó el lavado él mismo, se respeta al cambiar de paquete', () => {
  const p = personalizador(pagina());
  p.marca('Lavado');
  assert.deepEqual(p.estado(), { total: '$250', href: '/prueba/agenda?servicio=13&extras=2', lavado: true, bloqueado: false, etiqueta: '+$50' });
  p.paquete('Corte Fresco');
  assert.deepEqual(p.estado(), { total: '$280', href: '/prueba/agenda?servicio=14', lavado: true, bloqueado: true, etiqueta: 'Incluido' }, 'incluido: no se cobra dos veces');
  p.paquete('Elige tu corte');
  assert.deepEqual(p.estado(), { total: '$250', href: '/prueba/agenda?servicio=13&extras=2', lavado: true, bloqueado: false, etiqueta: '+$50' }, 'sigue marcado porque el cliente lo eligió');
  p.marca('Lavado', false);
  assert.equal(p.estado().total, '$200');
  // Al regresar a la página, el navegador puede dejar el paquete con lavado y su casilla marcada: se toma como automática.
  const r = personalizador(pagina(), (sel, cajas) => { sel.selectedIndex = 1; cajas[1].checked = true; });
  assert.equal(r.estado().etiqueta, 'Incluido');
  r.paquete('Elige tu corte');
  assert.deepEqual(r.estado(), { total: '$200', href: '/prueba/agenda?servicio=13', lavado: false, bloqueado: false, etiqueta: '+$50' });
});

test('horario de citas en línea junto al horario del local (mismo formato que la agenda)', () => {
  const citas = h => [...h.matchAll(/<small class="citas-linea">([^<]*)<\/small>/g)].map(m => m[1]);
  const conTexto = pagina({ horario_texto: '9:30 AM a 11:00 PM' });
  assert.deepEqual(citas(conTexto), ['Citas en línea de 10:00 a. m. a 7:00 p. m.', 'Citas en línea de 10:00 a. m. a 7:00 p. m.'], 'en la portada y en "Encuéntranos"');
  assert.ok(conTexto.includes('HORARIO <b>9:30 AM — 11:00 PM</b>'), 'el horario del local sigue igual');
  // Cada 30 minutos y abriendo a la media hora: el último espacio es 19:30 (su hora, 19, es la última cita).
  assert.equal(citas(pagina({ horario_texto: '9 am - 9 pm', hora_ini: 9, abre_min: 30, intervalo: 30 }))[0], 'Citas en línea de 9:30 a. m. a 7:30 p. m.');
  assert.equal(citas(pagina({ horario_texto: '9 am - 9 pm', hora_ini: 11, hora_fin: 12 }))[0], 'Citas en línea de 11:00 a. m. a 12:00 p. m.');
  assert.equal(citas(pagina({ horario_texto: '9 am - 9 pm', hora_ini: 13, hora_fin: 13 }))[0], 'Citas en línea a la 1:00 p. m.');
  assert.deepEqual(citas(pagina({ horario_texto: '9 am - 9 pm', hora_ini: 20, hora_fin: 19 })), [], 'sin espacios en la agenda no hay línea');
  // Sin horario_texto el horario que se ve ya es el de la agenda: no se repite.
  const sinTexto = pagina({ horario_texto: null });
  assert.deepEqual(citas(sinTexto), []);
  assert.ok(!sinTexto.includes('Citas en línea'));
  // Si la barbería no recibe citas en línea, no se anuncian.
  assert.deepEqual(citas(pagina({ horario_texto: '9:30 AM a 11:00 PM' }, { abierto: false })), []);
  assert.ok(conTexto.includes('/tema-ei.css?v=5'), 'la hoja de estilos nueva no sale de la caché');
});

test('la línea de citas en línea coincide con los espacios que da la agenda del servidor', { skip: sinBase }, async () => {
  const slug = 'cl-' + sufijo, cookie = await registra(base, slug, '10.4.0.1');
  const h12 = h => { const H = +h.slice(0, 2) % 24; return (H % 12 || 12) + ':' + h.slice(3, 5) + (H < 12 ? ' a. m.' : ' p. m.'); }; // el de app-agenda.html
  for (const [ini, abre, int, fin] of [[10, 0, 60, 19], [9, 30, 30, 19], [8, 30, 60, 22]]) {
    await pool.query("UPDATE negocios SET tema='ei', horario_texto='9:30 AM a 11:00 PM', hora_ini=$2, abre_min=$3, intervalo=$4, hora_fin=$5 WHERE slug=$1", [slug, ini, abre, int, fin]);
    const { horas } = await (await fetch(`${base}/api/${slug}/admin/agenda/config`, { headers: { Cookie: cookie } })).json();
    const h = await (await fetch(`${base}/${slug}`)).text();
    assert.ok(h.includes(`Citas en línea de ${h12(horas[0])} a ${h12(horas[horas.length - 1])}`), `${ini}:${abre} cada ${int} hasta ${fin}: ${horas[0]}–${horas[horas.length - 1]}`);
  }
  await pool.query('UPDATE negocios SET horario_texto=NULL WHERE slug=$1', [slug]);
  assert.ok(!(await (await fetch(`${base}/${slug}`)).text()).includes('Citas en línea'), 'sin horario_texto no se duplica');
});

test('tema-ei.css: el naranja de texto sobre fondo claro tiene contraste ≥4.5:1', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'tema-ei.css'), 'utf8');
  const L = hex => { const c = hex.match(/[0-9a-f]{2}/gi).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contraste = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const texto = css.match(/--accent-text:\s*(#[0-9a-f]{6})/i)[1];
  for (const fondo of ['#f1efe9', '#e7e4da', '#e4e3dc']) assert.ok(contraste(texto, fondo) >= 4.5, `${texto} sobre ${fondo}: ${contraste(texto, fondo).toFixed(2)}`);
  // Ningún texto (color:) usa el naranja claro #cc7232; el contorno de foco y los fondos naranja no son texto.
  assert.ok(!/(?:^|[;{\s])color:\s*#cc7232/i.test(css), 'texto con #cc7232');
});

// ---- Portada en video (Estilo Internacional): HTML, script del navegador y archivos ----
// Corre el <script> de la página con un DOM mínimo: el <video> (que se pausa y se vacía al cambiar de archivo, como el real),
// el botón, la leyenda, matchMedia, IntersectionObserver, la red y relojes falsos.
const portadaVideo = (h, { reducido = false, ahorro = false, red, downlink, vertical = false, io = true, cargada = true } = {}) => {
  const script = h.match(/<script>\n([\s\S]*?)<\/script><\/body>/)[1];
  const tag = h.match(/<video class="hero-video"[^>]*>/)[0], dato = k => tag.match(new RegExp(`data-${k}="([^"]+)"`))[1];
  const llamadas = [], oyentes = {}, cambios = [], carga = [];
  let relojes = [], idReloj = 0, ahora = 0;
  const hv = { dataset: { vertical: dato('vertical'), ancha: dato('ancha') }, paused: true, muted: false, readyState: 0, currentTime: 0, adelante: 0, clases: new Set(), attrs: {},
    get src() { return this.attrs.src || ''; }, set src(v) { this.attrs.src = v; this.paused = true; this.readyState = 0; this.currentTime = 0; this.adelante = 0; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
    load() { llamadas.push('load'); this.paused = true; this.readyState = 0; this.adelante = 0; },
    get buffered() { const t = this.currentTime, a = this.adelante; return a ? { length: 1, start: () => t, end: () => t + a } : { length: 0 }; },
    classList: { add: c => hv.clases.add(c), remove: c => hv.clases.delete(c) }, addEventListener: (t, f) => { oyentes[t] = f; },
    play() { llamadas.push('play'); this.paused = false; return Promise.resolve(); }, pause() { llamadas.push('pause'); this.paused = true; } };
  const hp = { hidden: true, textContent: 'Pausar video' };
  const hc = { textContent: h.match(/<span class="hero-caption">([^<]*)<\/span>/)[1] };
  const mq = { matches: vertical, addEventListener: (t, f) => cambios.push(f) };
  let mira;
  const conexion = ahorro || red || downlink ? { connection: { saveData: ahorro, effectiveType: red, downlink } } : {};
  const ctx = { document: { readyState: cargada ? 'complete' : 'interactive', querySelector: s => ({ '.hero-video': hv, '.hero-pausa': hp, '.hero-caption': hc }[s] || null), querySelectorAll: () => [] },
    navigator: conexion, addEventListener: (t, f) => { if (t === 'load') carga.push(f); },
    setTimeout: (f, ms) => { relojes.push({ id: ++idReloj, f, en: ahora + ms }); return idReloj; }, clearTimeout: id => { relojes = relojes.filter(r => r.id !== id); },
    matchMedia: q => (/reduced-motion/.test(q) ? { matches: reducido } : q === '(max-aspect-ratio: 1/1)' ? mq : { matches: false }) };
  if (io) ctx.IntersectionObserver = function (cb) { mira = cb; this.observe = () => {}; };
  vm.runInNewContext(script, ctx);
  const pasa = ms => { ahora += ms; for (const r of relojes.filter(x => x.en <= ahora)) { relojes = relojes.filter(x => x !== r); r.f(); } };
  const evento = k => oyentes[k] && oyentes[k]();
  return { hv, hp, hc, llamadas, pasa,
    carga: () => carga.forEach(f => f()),
    ve: (...v) => mira && mira(v.map(x => ({ isIntersecting: x }))), // sin video no hay observador
    // Simula que el video empezó a correr y cuántos segundos lleva bajados por delante.
    corre: (estado, adelante = 0) => { hv.readyState = estado; hv.adelante = adelante; evento('playing'); evento('progress'); },
    gira: v => { mq.matches = v; cambios.forEach(f => f()); } };
};

test('portada en video: Estilo Internacional sale con video, póster por orientación y botón para pausar', () => {
  const h = pagina({ fotos: true });
  assert.match(h, /<section class="hero con-video">/);
  assert.match(h, /<video class="hero-video" muted loop playsinline preload="none"[^>]* aria-hidden="true"[^>]*data-vertical="\/img\/portada-ei-movil\.mp4\?v=\d+" data-ancha="\/img\/portada-ei\.mp4\?v=\d+"><\/video>/);
  assert.ok(!/<video[^>]*\sautoplay/.test(h), 'el script decide si se reproduce (menos movimiento, ahorro de datos, red lenta)');
  assert.match(h, /<picture><source media="\(max-aspect-ratio: 1\/1\)" srcset="\/img\/portada-ei-movil\.jpg\?v=\d+" width="720" height="1280"><img class="hero-photo" src="\/img\/portada-ei\.jpg\?v=\d+"[^>]*fetchpriority="high"[^>]*width="1600" height="900"><\/picture>/);
  assert.match(h, /<link rel="preload" as="image" href="\/img\/portada-ei\.jpg\?v=\d+" fetchpriority="high" media="\(min-aspect-ratio: 1001\/1000\)">/, 'precarga del póster ancho solo en pantallas anchas');
  assert.match(h, /<link rel="preload" as="image" href="\/img\/portada-ei-movil\.jpg\?v=\d+" fetchpriority="high" media="\(max-aspect-ratio: 1\/1\)">/, 'precarga del póster vertical solo en pantallas verticales');
  assert.ok(h.includes('<span class="hero-caption">FOTO REAL DE NUESTRO LOCAL / BARBERÍA PRUEBA</span>'), 'mientras no corre el video, lo que se ve es la foto');
  assert.ok(h.includes('<button class="hero-pausa" type="button" hidden>Pausar video</button>'));
  assert.match(h, /<meta property="og:image" content="http:\/\/x\/img\/portada-ei\.jpg\?v=\d+">/, 'el póster nítido también es la imagen al compartir');
  // Los cuatro archivos llevan la misma versión, para que un cambio no quede escondido en la caché de 7 días.
  assert.equal(new Set(h.match(/portada-ei(?:-movil)?\.(?:jpg|mp4)\?v=\d+/g).map(u => u.split('?')[1])).size, 1);
});

test('portada en video: con portada subida por el dueño, o sin fotos reales, no hay video', () => {
  const subida = pagina({ fotos: true }, { portada: 7 });
  assert.ok(!subida.includes('<video') && !subida.includes('hero-pausa') && !subida.includes('con-video') && !subida.includes('portada-ei'));
  assert.ok(subida.includes('<img class="hero-photo" src="/i/7"') && subida.includes('FOTO REAL DE NUESTRO LOCAL'));
  assert.ok(subida.includes('<link rel="preload" as="image" href="/i/7" fetchpriority="high">'));
  const sin = pagina();
  assert.ok(!sin.includes('<video') && !sin.includes('<picture>') && sin.includes('/img/tema/portada.jpg') && sin.includes('IMAGEN ILUSTRATIVA'));
});

test('portada en video: espera a la carga y a que la portada se vea, y aparece solo cuando ya no se va a cortar', () => {
  const h = pagina({ fotos: true });
  const ancha = h.match(/data-ancha="([^"]+)"/)[1], vertical = h.match(/data-vertical="([^"]+)"/)[1];
  // Antes del load no hace nada: no compite con la foto ni con las fuentes.
  const c = portadaVideo(h, { cargada: false });
  c.ve(true); c.pasa(300);
  assert.deepEqual(c.llamadas, []); assert.equal(c.hv.src, '', 'antes del load ni siquiera observa la portada');
  c.carga(); c.ve(true); c.pasa(300); assert.equal(c.hv.src, ancha, 'tras el load y con la portada en pantalla, el video ancho');

  const a = portadaVideo(h);
  assert.equal(a.hv.muted, true, 'sin sonido para que el navegador deje reproducirlo solo');
  a.ve(true); assert.equal(a.hv.src, '', 'espera 0.3 s en pantalla antes de bajar nada');
  a.pasa(300); assert.equal(a.hv.src, ancha); assert.deepEqual(a.llamadas, ['play']);
  a.corre(3, 2); assert.ok(!a.hv.clases.has('on'), 'con poco búfer sigue la foto');
  assert.equal(a.hp.hidden, true); assert.match(a.hc.textContent, /^FOTO REAL/);
  a.corre(3, 4.5); assert.ok(a.hv.clases.has('on'), 'con 4 s bajados por delante aparece el video');
  assert.equal(a.hp.hidden, false); assert.match(a.hc.textContent, /^VIDEO REAL DE NUESTRO LOCAL/);
  a.ve(false); assert.equal(a.llamadas.at(-1), 'pause', 'fuera de pantalla se pausa');
  assert.equal(a.hv.src, ancha, 'si ya se vio, se queda el archivo para seguir al volver');
  a.ve(true); a.pasa(300); assert.equal(a.llamadas.at(-1), 'play');
  // Varias entradas en un mismo aviso: cuenta la última (el estado actual).
  a.ve(false, true); a.pasa(300); assert.equal(a.hv.paused, false);

  // El navegador avisa que ya puede seguir sin cortes.
  const b = portadaVideo(h); b.ve(true); b.pasa(300); b.corre(4); assert.ok(b.hv.clases.has('on'));
  assert.equal(portadaVideo(h, { vertical: true }).hv.dataset.vertical, vertical);
});

test('portada en video: el botón pausa de verdad, y si la portada sale de pantalla antes de verse deja de bajar el video', () => {
  const h = pagina({ fotos: true });
  const a = portadaVideo(h); a.ve(true); a.pasa(300); a.corre(4);
  a.hp.onclick();
  assert.equal(a.hp.textContent, 'Reproducir video'); assert.equal(a.hv.paused, true);
  const n = a.llamadas.length; a.ve(false); a.ve(true); a.pasa(300);
  assert.deepEqual(a.llamadas.slice(n), [], 'si el visitante lo pausó, volver a verlo no lo reproduce');
  a.hp.onclick(); assert.equal(a.hp.textContent, 'Pausar video'); assert.equal(a.hv.paused, false);

  // Pausado por el visitante antes de mostrarse: los datos que lleguen no lo destapan.
  const q = portadaVideo(h); q.ve(true); q.pasa(300); q.hp.onclick(); q.corre(4, 6);
  assert.ok(!q.hv.clases.has('on'), 'pausado no aparece');

  // Abre en un ancla (#ubicacion): el salto suave pasa por la portada menos de 0.3 s y no se baja nada.
  const ancla = portadaVideo(h); ancla.ve(true); ancla.pasa(150); ancla.ve(false); ancla.pasa(1000);
  assert.equal(ancla.hv.src, ''); assert.deepEqual(ancla.llamadas, ['pause']);
  // Se veía, empezó a bajar y salió de pantalla antes de mostrarse: suelta el archivo y lo vuelve a pedir al regresar.
  const sale = portadaVideo(h); sale.ve(true); sale.pasa(300); sale.corre(3, 1); sale.ve(false);
  assert.equal(sale.hv.getAttribute('src'), null); assert.equal(sale.llamadas.at(-1), 'load', 'se corta la descarga');
  sale.ve(true); sale.pasa(300); assert.ok(sale.hv.src.includes('portada-ei.mp4')); assert.equal(sale.llamadas.at(-1), 'play');
  // Red que no alcanza: a los 10 s sin poder verse bien, se rinde y se queda la foto.
  const lenta = portadaVideo(h); lenta.ve(true); lenta.pasa(300); lenta.corre(3, 1); lenta.pasa(10000);
  assert.equal(lenta.hv.getAttribute('src'), null); assert.ok(!lenta.hv.clases.has('on'));
  lenta.ve(false); lenta.ve(true); lenta.pasa(300); assert.equal(lenta.hv.getAttribute('src'), null, 'ya no lo vuelve a intentar');
});

test('portada en video: al girar cambia de video, vuelve la foto mientras carga y sigue reproduciendo', () => {
  const h = pagina({ fotos: true });
  const ancha = h.match(/data-ancha="([^"]+)"/)[1], vertical = h.match(/data-vertical="([^"]+)"/)[1];
  const a = portadaVideo(h); a.ve(true); a.pasa(300); a.corre(4);
  assert.ok(a.hv.clases.has('on')); assert.match(a.hc.textContent, /^VIDEO REAL/);
  const n = a.llamadas.length; a.gira(true);
  assert.equal(a.hv.src, vertical); assert.deepEqual(a.llamadas.slice(n), ['play'], 'el video nuevo se reproduce');
  assert.ok(!a.hv.clases.has('on')); assert.equal(a.hp.hidden, true); assert.match(a.hc.textContent, /^FOTO REAL/, 'mientras carga se ve la foto y lo dice');
  a.corre(4); assert.ok(a.hv.clases.has('on')); assert.match(a.hc.textContent, /^VIDEO REAL/);
  const m = a.llamadas.length; a.gira(true); assert.equal(a.llamadas.length, m, 'misma orientación: no recarga');
  // Pausado por el visitante: al girar cambia el archivo, no lo reproduce y el botón sigue para reanudar.
  a.hp.onclick(); const k = a.llamadas.length; a.gira(false);
  assert.equal(a.hv.src, ancha); assert.deepEqual(a.llamadas.slice(k), []); assert.equal(a.hp.hidden, false);
  // Fuera de pantalla y sin archivo: girar no baja nada; al volver, elige el de la orientación actual.
  const f = portadaVideo(h); f.gira(true); assert.equal(f.hv.src, '');
  f.ve(true); f.pasa(300); assert.equal(f.hv.src, vertical);
  assert.deepEqual(portadaVideo(h, { io: false }).llamadas, ['play'], 'sin IntersectionObserver se reproduce de una vez');
});

test('portada en video: sin video si el visitante pide menos movimiento, ahorro de datos o su red es lenta', () => {
  const h = pagina({ fotos: true });
  for (const pide of [{ reducido: true }, { ahorro: true }, { red: '3g' }, { red: '2g' }, { red: 'slow-2g' }, { red: '4g', downlink: 0.8 }]) {
    const b = portadaVideo(h, pide);
    b.carga(); b.ve(true); b.pasa(300);
    assert.equal(b.hv.src, '', 'sin video: ' + JSON.stringify(pide)); assert.deepEqual(b.llamadas, []);
    assert.equal(b.hp.hidden, true); assert.match(b.hc.textContent, /^FOTO REAL/);
  }
  for (const downlink of [1.2, 10]) {
    const r = portadaVideo(h, { red: '4g', downlink }); r.ve(true); r.pasa(300);
    assert.ok(r.hv.src.includes('portada-ei.mp4'), `con ${downlink} Mbps lo intenta (si no alcanza, se rinde a los 10 s)`);
  }
});

test('portada en video: el service worker no toca los videos y el botón queda arriba (siempre en la primera pantalla)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const salta = sw.indexOf("if (r.destination === 'video' || r.headers.has('range')) return;");
  assert.ok(salta > 0 && salta < sw.indexOf('e.respondWith'), 'video y peticiones Range van directo a la red');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'tema-ei.css'), 'utf8');
  const regla = css.match(/\n\.hero-pausa \{([^}]*)\}/)[1];
  assert.match(regla, /top:\s*24px/); assert.ok(!/bottom:/.test(regla), 'no abajo: el hero puede ser más alto que la ventana');
});

test('portada en video: los archivos existen, pesan poco y el MP4 empieza a reproducirse sin bajarse completo', () => {
  const img = path.join(__dirname, '..', 'public', 'img');
  for (const f of ['portada-ei.mp4', 'portada-ei-movil.mp4']) {
    const b = fs.readFileSync(path.join(img, f));
    assert.ok(b.length < 4 * 1024 * 1024, `${f} pesa ${(b.length / 1048576).toFixed(1)} MB`);
    assert.equal(b.toString('latin1', 4, 8), 'ftyp', f + ' es MP4');
    const moov = b.indexOf('moov', 0, 'latin1'), mdat = b.indexOf('mdat', 0, 'latin1');
    assert.ok(moov > 0 && moov < mdat, f + ': el índice (moov) va antes de los datos (faststart)');
  }
  for (const f of ['portada-ei.jpg', 'portada-ei-movil.jpg']) assert.ok(fs.statSync(path.join(img, f)).size < 300 * 1024, f);
});

test('portada en video: el servidor entrega el video por partes (Range), como lo piden Safari y Chrome', { skip: sinBase }, async () => {
  const r = await fetch(base + '/img/portada-ei.mp4?v=1', { headers: { Range: 'bytes=0-1023' } });
  assert.equal(r.status, 206);
  assert.match(r.headers.get('content-type'), /video\/mp4/);
  assert.equal((await r.arrayBuffer()).byteLength, 1024);
  for (const u of ['/img/portada-ei-movil.mp4', '/img/portada-ei.jpg', '/img/portada-ei-movil.jpg']) assert.equal((await fetch(base + u)).status, 200, u);
  const h = await (await fetch(base + '/estilo-internacional')).text();
  assert.ok(h.includes('<video class="hero-video"'), 'Estilo Internacional ya muestra el video');
});
