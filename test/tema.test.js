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
