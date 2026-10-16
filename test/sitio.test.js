// Páginas del propio SaaS: términos, aviso de privacidad, soporte y aceptación en el registro.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
let base, parar, sin, pararSin;

before(async () => {
  if (sinBase) return;
  ({ base, parar } = await arranca({ PRECIO_BASICO: '399', PRECIO_PRO: '899', SOPORTE_WHATSAPP: '999 111 2233', SOPORTE_CORREO: 'soporte@ejemplo.mx', SAAS_TITULAR: 'Juan <b>Pérez</b>', SAAS_DOMICILIO: 'Calle 60, Mérida' }));
  ({ base: sin, parar: pararSin } = await arranca({ SOPORTE_WHATSAPP: '', SOPORTE_CORREO: '', SAAS_TITULAR: '', SAAS_DOMICILIO: '' }));
});
after(() => { if (parar) parar(); if (pararSin) pararSin(); });

const texto = async u => (await fetch(u)).text();

test('términos: precios que se cobran, cobro mensual, cancelación sin reembolso y contacto', { skip: sinBase }, async () => {
  const r = await fetch(base + '/terminos');
  assert.equal(r.status, 200);
  const t = await r.text();
  for (const x of ['$399 MXN al mes', '$899 MXN al mes', 'Mercado Pago', 'cobro automático', 'Lo pagado no se reembolsa', 'pestaña <b>Plan</b>', 'https://wa.me/529991112233', 'soporte@ejemplo.mx', 'Calle 60, Mérida'])
    assert.ok(t.includes(x), 'falta: ' + x);
  assert.ok(t.includes('Juan &lt;b&gt;Pérez&lt;/b&gt;') && !t.includes('<b>Pérez</b>'), 'el titular se escapa');
});

test('aviso de privacidad del SaaS: responsable, datos, proveedores y derechos ARCO', { skip: sinBase }, async () => {
  const t = await texto(base + '/privacidad');
  for (const x of ['Ley Federal de Protección de Datos Personales', 'contraseña que se guarda cifrada', 'Railway', 'Mercado Pago', 'ARCO', 'encargados', 'Calle 60, Mérida'])
    assert.ok(t.includes(x), 'falta: ' + x);
});

test('sin datos configurados las páginas no quedan vacías ni con marcadores', { skip: sinBase }, async () => {
  const t = await texto(sin + '/terminos');
  assert.ok(t.includes('el titular del servicio Agenda de Barberías') && t.includes('Mérida, Yucatán, México'));
  assert.ok(t.includes('los medios de contacto publicados en la página principal') && !t.includes('wa.me'));
  const l = await texto(sin + '/');
  assert.ok(!l.includes('__') && !l.includes('Soporte por WhatsApp'), 'sin WhatsApp no aparece el enlace de soporte');
});

test('la página comercial enlaza términos, privacidad y soporte; el registro pide aceptarlos', { skip: sinBase }, async () => {
  const l = await texto(base + '/');
  assert.ok(l.includes('href="/terminos"') && l.includes('href="/privacidad"') && l.includes('Soporte por WhatsApp') && !l.includes('__SOPORTE__'));
  assert.ok(!l.includes('coordinamos tu pago'), 'ya no dice que el pago se coordina a mano');
  const reg = await texto(base + '/registro');
  assert.ok(reg.includes('id="ok"') && reg.includes('acepta:true'));
  const sm = await texto(base + '/sitemap.xml');
  assert.ok(sm.includes('/terminos</loc>') && sm.includes('/privacidad</loc>'));
});

test('el registro guarda cuándo se aceptaron los términos y no permite slugs reservados', { skip: sinBase }, async () => {
  const alta = (slug, acepta, ip) => fetch(base + '/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ nombre: 'Barbería ' + slug, slug, dueno: 'Dueño', email: slug + '@ejemplo.com', password: 'clave-segura-123', whatsapp: '9991234567', acepta }) });
  assert.equal((await alta('terminos', true, '10.1.0.1')).status, 400);
  assert.equal((await alta('privacidad', true, '10.1.0.2')).status, 400);
  assert.equal((await alta('ta-' + sufijo, true, '10.1.0.3')).status, 200);
  assert.equal((await alta('tn-' + sufijo, undefined, '10.1.0.4')).status, 200);
  const { Pool } = require('pg'), pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = (await pool.query('SELECT slug, terminos FROM negocios WHERE slug = ANY($1)', [['ta-' + sufijo, 'tn-' + sufijo]])).rows;
    assert.ok(r.find(x => x.slug === 'ta-' + sufijo).terminos, 'guarda la fecha de aceptación');
    assert.equal(r.find(x => x.slug === 'tn-' + sufijo).terminos, null);
  } finally { await pool.end(); }
});

test('con dominio propio, el dominio de Railway redirige al propio (salvo API, avisos, health e imágenes)', { skip: sinBase }, async () => {
  const { base: b, parar: p } = await arranca({ PUBLIC_URL: 'https://www.ejemplo.xyz' });
  const pide = (ruta, host, metodo = 'GET') => new Promise((ok, mal) => {
    const u = new URL(b + ruta), r = require('node:http').request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo, headers: { Host: host } }, res => { res.resume(); ok({ status: res.statusCode, location: res.headers.location }); });
    r.on('error', mal); r.end();
  });
  try {
    const r = await pide('/estilo-internacional?x=1', 'app-production-53c5.up.railway.app');
    assert.equal(r.status, 301);
    assert.equal(r.location, 'https://www.ejemplo.xyz/estilo-internacional?x=1', 'conserva la ruta y los parámetros');
    for (const ruta of ['/health', '/api/estilo-internacional/info', '/i/1']) assert.notEqual((await pide(ruta, 'app-production-53c5.up.railway.app')).status, 301, ruta);
    assert.notEqual((await pide('/webhooks/mercadopago', 'app-production-53c5.up.railway.app', 'POST')).status, 301, 'los avisos de pago no se redirigen');
    assert.equal((await pide('/terminos', 'www.ejemplo.xyz')).status, 200, 'el dominio propio se sirve normal');
    assert.equal((await pide('/terminos', '127.0.0.1')).status, 200, 'otros hosts (local) no se redirigen');
  } finally { p(); }
});
