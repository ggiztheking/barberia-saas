// Tema "urbano" (tema-urbano.js): el dueño lo elige en el panel y su página sale en negro y dorado, con sus fotos de
// trabajos al frente, sin imágenes de IA, con HTML escapado y las mismas reglas de horario que el tema "ei".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { arranca, registra } = require('./helpers');
const dibuja = require('../tema-urbano');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
let base, parar, pool;
const sufijo = Date.now().toString(36);
const ld = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

// Datos mínimos para dibujar la página sin base de datos.
const datos = (o = {}) => ({ n: { slug: 'yk', nombre: 'YakinStyle', whatsapp: '529995502242', direccion: 'Mérida, Yucatán', lema: 'Diseños que hablan.', acerca: '', hora_ini: 10, hora_fin: 20, intervalo: 30, abre_min: 0, cierra: '0', ...o.n },
  base: 'https://ejemplo.mx', paquetes: [{ id: 7, nombre: 'Fade + diseño', precio: 220, etiqueta: '', incluye: ['Fade', 'Diseño'] }], extras: [], referencias: [],
  trabajos: Array.from({ length: o.fotos ?? 0 }, (_, i) => ({ img: 100 + i, servicio: '', barbero: '' })), preguntas: [], portada: o.portada ?? null, abierto: true,
  whatsappUrl: 'https://wa.me/529995502242?text=Hola', equipo: [], lealtad: null });
const fotos = h => (h.match(/class="tile"/g) || []).length;

before(async () => {
  if (sinBase) return;
  ({ base, parar } = await arranca());
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
after(async () => { if (parar) parar(); if (pool) await pool.end(); });

test('el muro de trabajos siempre queda completo: 5, 9 o 13 fotos (con menos de 5, todas)', () => {
  for (const [hay, salen] of [[0, 0], [3, 3], [4, 4], [5, 5], [8, 5], [9, 9], [10, 9], [12, 9], [13, 13], [20, 13]])
    assert.equal(fotos(dibuja(datos({ fotos: hay }))), salen, `${hay} fotos`);
});

test('portada: la que subió el dueño; si no hay, su trabajo más reciente; si tampoco, sin imagen rota', () => {
  assert.match(dibuja(datos({ portada: 55, fotos: 3 })), /class="hero-img" src="\/i\/55"/);
  assert.match(dibuja(datos({ fotos: 3 })), /class="hero-img" src="\/i\/100"/);
  const sin = dibuja(datos());
  assert.ok(!sin.includes('hero-img') && sin.includes('hero sin-foto'));
});

test('sin imágenes de IA ni del tema Estilo Internacional, y los textos del dueño van escapados', () => {
  const mal = '<img src=x onerror=alert(1)>"\'';
  const h = dibuja(datos({ n: { nombre: mal, lema: mal, direccion: mal, zonas: mal, instagram: mal }, fotos: 5 }));
  assert.ok(!h.includes('<img src=x'), 'HTML del dueño escapado');
  assert.ok(!/generad[ao] con IA|\/img\/tema\/|logo-ei|portada-ei/i.test(h));
  assert.doesNotThrow(() => ld(h));
});

test('el dueño elige "Urbano" en el panel y su página cambia; las demás no', { skip: sinBase }, async () => {
  const slug = 'urb-' + sufijo, cookie = await registra(base, slug, '10.4.0.1');
  const cambia = tema => fetch(`${base}/api/${slug}/admin/tema`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ tema }) });
  const lista = await (await fetch(`${base}/api/${slug}/admin/tema`, { headers: { Cookie: cookie } })).json();
  assert.ok(lista.temas.some(t => t.id === 'urbano'), 'aparece en la lista de diseños');
  assert.equal((await cambia('urbano')).status, 200);
  await pool.query("UPDATE negocios SET lema='Diseños que hablan. Fades que se notan.', hora_ini=10, hora_fin=19, horario_texto=NULL WHERE slug=$1", [slug]);
  const h = await (await fetch(`${base}/${slug}`)).text();
  assert.ok(h.includes('/tema-urbano.css?v=') && !h.includes('/tema-ei.css'));
  assert.match(h, /<h1>Diseños que hablan\.<br><em>Fades que se notan\.<\/em><\/h1>/);
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1, 'un solo h1');
  assert.ok(h.includes(`<link rel="canonical" href="${base}/${slug}">`));
  assert.ok(h.includes(`href="/${slug}/agenda"`), 'lleva a la agenda real');
  assert.ok(ld(h).some(x => x['@type'] === 'BarberShop'));
  assert.ok(!(await (await fetch(base + '/estilo-internacional')).text()).includes('/tema-urbano.css'), 'Estilo Internacional no cambia');
  assert.equal((await cambia('oscuro')).status, 200);
  assert.ok(!(await (await fetch(`${base}/${slug}`)).text()).includes('/tema-urbano.css'));
});
