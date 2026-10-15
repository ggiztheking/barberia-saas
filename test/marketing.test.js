// Marketing con IA: plantillas sin clave, IA simulada con cuota mensual, y paso a publicaciones.
// La API de Anthropic se simula con un servidor local; nunca se llama a la real.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
const visto = [];
let ia, sinIA, conIA, modo = 'ok', cookieSin, cookieCon, slugSin, slugCon;

const RESP_OK = { titulo: 'Promos de prueba', piezas: [{ titulo: 'Martes de descuento', texto: 'Hola {nombre}, este martes 10 % menos.' }, { titulo: 'Trae un amigo', texto: 'Dos cortes, un descuento.' }] };

before(async () => {
  if (sinBase) return;
  ia = await new Promise(ok => {
    const s = http.createServer((q, r) => {
      let b = ''; q.on('data', c => { b += c; });
      q.on('end', () => {
        visto.push({ url: q.url, clave: q.headers['x-api-key'], version: q.headers['anthropic-version'], cuerpo: JSON.parse(b || '{}') });
        if (modo === 'falla') { r.writeHead(500, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ error: { message: 'caído' } })); }
        const texto = modo === 'suelto' ? 'Ideas sin formato: promociona el martes.' : 'Aquí va:\n' + JSON.stringify(RESP_OK);
        r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ content: [{ type: 'text', text: texto }] }));
      });
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
  sinIA = await arranca({ ANTHROPIC_API_KEY: '' });
  conIA = await arranca({ ANTHROPIC_API_KEY: 'sk-ant-falsa', ANTHROPIC_API_URL: `http://127.0.0.1:${ia.address().port}`, IA_CUOTA_PRUEBA: '3' });
  slugSin = 'mk-' + sufijo; slugCon = 'mi-' + sufijo;
  cookieSin = await registra(sinIA.base, slugSin);
  cookieCon = await registra(conIA.base, slugCon);
});
after(() => { for (const x of [sinIA, conIA]) if (x && x.parar) x.parar(); if (ia) ia.close(); });

const llama = (srv, slug, cookie, ruta, cuerpo) => fetch(`${srv.base}/api/${slug}/admin/marketing/${ruta}`, cuerpo === undefined ? { headers: { Cookie: cookie } }
  : { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(cuerpo) });

test('sin clave de IA entrega plantillas con los datos del negocio y no gasta cuota', { skip: sinBase }, async () => {
  const e = await (await llama(sinIA, slugSin, cookieSin, 'estado')).json();
  assert.equal(e.ia, false);
  assert.equal(e.tipos.length, 6);
  for (const tipo of e.tipos.map(t => t.id)) {
    const r = await llama(sinIA, slugSin, cookieSin, 'generar', { tipo });
    assert.equal(r.status, 200, tipo);
    const j = await r.json();
    assert.equal(j.origen, 'plantilla');
    assert.ok(j.piezas.length >= 3 && j.piezas.every(p => p.texto), tipo);
  }
  assert.equal((await (await llama(sinIA, slugSin, cookieSin, 'estado')).json()).usados, 0);
  assert.equal((await llama(sinIA, slugSin, cookieSin, 'generar', { tipo: 'inventado' })).status, 400);
});

test('solo el dueño con sesión puede usar el asistente', { skip: sinBase }, async () => {
  assert.equal((await llama(sinIA, slugSin, '', 'estado')).status, 401);
  assert.equal((await llama(sinIA, slugSin, '', 'generar', { tipo: 'promos' })).status, 401);
  assert.equal((await llama(sinIA, slugSin, cookieCon, 'estado')).status, 401, 'la sesión de otra barbería no sirve aquí');
});

test('con clave: llama a Claude con los datos reales, guarda la idea y respeta la cuota mensual', { skip: sinBase }, async () => {
  const r = await llama(conIA, slugCon, cookieCon, 'generar', { tipo: 'promos', nota: 'Quiero llenar los martes' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.origen, 'ia');
  assert.equal(j.titulo, 'Promos de prueba');
  assert.equal(j.piezas.length, 2, 'el JSON viene envuelto en texto y aun así se entiende');
  assert.equal(j.usados, 1);
  const llamada = visto[visto.length - 1];
  assert.equal(llamada.url, '/v1/messages');
  assert.equal(llamada.clave, 'sk-ant-falsa');
  assert.ok(llamada.version);
  assert.equal(llamada.cuerpo.model, 'claude-sonnet-5-5');
  assert.ok(llamada.cuerpo.max_tokens <= 4000, 'tope de tokens para controlar costo');
  const pedido = llamada.cuerpo.messages[0].content;
  assert.ok(pedido.includes('Barbería ' + slugCon), 'incluye el nombre real del negocio');
  assert.ok(pedido.includes('Quiero llenar los martes'));
  assert.ok(!pedido.includes('clave-segura-123') && !pedido.includes('sk-ant'), 'nunca manda contraseñas ni claves');

  modo = 'suelto';
  const s = await (await llama(conIA, slugCon, cookieCon, 'generar', { tipo: 'redes' })).json();
  assert.equal(s.origen, 'ia');
  assert.deepEqual(s.piezas.map(p => p.texto), ['Ideas sin formato: promociona el martes.'], 'si no viene JSON, se conserva el texto');

  modo = 'ok';
  assert.equal((await (await llama(conIA, slugCon, cookieCon, 'generar', { tipo: 'semana' })).json()).usados, 3);
  const tope = await llama(conIA, slugCon, cookieCon, 'generar', { tipo: 'semana' });
  assert.equal(tope.status, 429, 'la cuota de la prueba (3) se acabó');
  assert.match((await tope.json()).error, /3 ideas/);
  const antes = visto.length;
  await llama(conIA, slugCon, cookieCon, 'generar', { tipo: 'semana' });
  assert.equal(visto.length, antes, 'sin cuota no se llama a la IA');
});

test('si la IA falla se entrega una plantilla y no se descuenta de la cuota', { skip: sinBase }, async () => {
  const slug = 'mf-' + sufijo, cookie = await registra(conIA.base, slug);
  modo = 'falla';
  const j = await (await llama(conIA, slug, cookie, 'generar', { tipo: 'promos' })).json();
  modo = 'ok';
  assert.equal(j.origen, 'plantilla');
  assert.ok(j.aviso);
  assert.equal(j.usados, 0);
});

test('una idea se guarda, se programa como publicación y se borra', { skip: sinBase }, async () => {
  const { id } = await (await llama(sinIA, slugSin, cookieSin, 'generar', { tipo: 'redes' })).json();
  const lista = await (await llama(sinIA, slugSin, cookieSin, 'ideas')).json();
  assert.ok(lista.some(x => x.id === id));
  const cuando = new Date(Date.now() + 864e5).toISOString();
  assert.equal((await llama(sinIA, slugSin, cookieSin, 'programar', { id, pieza: 99, cuando })).status, 404);
  assert.equal((await llama(sinIA, slugSin, cookieSin, 'programar', { id, pieza: 0, cuando: 'mañana' })).status, 400);
  const ok = await llama(sinIA, slugSin, cookieSin, 'programar', { id, pieza: 0, cuando });
  assert.equal(ok.status, 200);
  const pubId = (await ok.json()).id;
  const pubs = await (await fetch(`${sinIA.base}/api/${slugSin}/crm/publicaciones`, { headers: { Cookie: cookieSin } })).json();
  const p = pubs.lista.find(x => x.id === pubId);
  assert.ok(p && p.texto.includes('Somos'), 'la pieza aparece en Contenido del CRM');
  assert.equal(p.redes, 'facebook');

  const otra = await registra(sinIA.base, 'ot-' + sufijo);
  await fetch(`${sinIA.base}/api/ot-${sufijo}/admin/marketing/idea/borrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: otra }, body: JSON.stringify({ id }) });
  assert.ok((await (await llama(sinIA, slugSin, cookieSin, 'ideas')).json()).some(x => x.id === id), 'otra barbería no puede borrar tus ideas');
  await llama(sinIA, slugSin, cookieSin, 'idea/borrar', { id });
  assert.ok(!(await (await llama(sinIA, slugSin, cookieSin, 'ideas')).json()).some(x => x.id === id));
});
