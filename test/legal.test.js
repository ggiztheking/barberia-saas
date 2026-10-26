// Marco legal: checklist con progreso, documentos imprimibles con datos escapados y página pública del aviso de privacidad.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
const MALO = '<script>alert(1)</script>';
let srv, cookieA, cookieB, slugA, slugB;

const llama = (slug, cookie, ruta, cuerpo) => fetch(`${srv.base}/api/${slug}/admin/legal/${ruta}`, cuerpo === undefined ? { headers: { Cookie: cookie } }
  : { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(cuerpo) });
const pasos = async (slug, cookie) => (await llama(slug, cookie, 'pasos')).json();
const todos = d => d.grupos.flatMap(g => g.pasos);

before(async () => {
  if (sinBase) return;
  srv = await arranca();
  slugA = 'lg-' + sufijo; slugB = 'lh-' + sufijo;
  // La barbería A se registra con un nombre malicioso para comprobar que todo se escapa.
  const r = await fetch(srv.base + '/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: MALO, slug: slugA, dueno: 'Dueño', email: `${slugA}@ejemplo.com`, password: 'clave-segura-123', whatsapp: '9991234567' }) });
  assert.equal(r.status, 200);
  cookieA = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  cookieB = await registra(srv.base, slugB);
});
after(() => { if (srv) srv.parar(); });

test('el checklist trae los pasos agrupados, con fuente oficial o null, y progreso en cero', { skip: sinBase }, async () => {
  const d = await pasos(slugA, cookieA);
  assert.match(d.aviso, /no es asesoría legal/);
  assert.deepEqual(d.grupos.map(g => g.id), ['sat', 'municipio', 'salud', 'trabajo', 'datos']);
  const L = todos(d);
  assert.equal(d.total, L.length);
  assert.ok(L.length >= 12);
  assert.equal(new Set(L.map(p => p.id)).size, L.length, 'ids únicos');
  for (const p of L) {
    assert.ok(p.titulo && p.porque && p.necesitas && p.donde, p.id);
    assert.ok(p.fuente === null || /^https:\/\/[^/]*\.gob\.mx\//.test(p.fuente), 'fuente oficial o null: ' + p.id);
    assert.equal(p.hecho, false);
  }
  for (const id of ['sat-rfc', 'sat-regimen', 'sat-efirma', 'sat-cfdi', 'mid-licencia', 'mid-uso-suelo', 'mid-anuncio', 'mid-proteccion-civil', 'trab-imss', 'trab-relacion', 'datos-aviso'])
    assert.ok(L.some(p => p.id === id), 'falta el paso ' + id);
  assert.equal(d.progreso, 0);
  assert.equal(d.hechos, 0);
  assert.equal(d.privacidad, `/${slugA}/privacidad`);
  assert.deepEqual(d.docs.map(x => x.tipo), ['aviso-integral', 'aviso-simplificado', 'contrato', 'reglamento']);
  assert.ok(d.faltan.includes('direccion') && d.faltan.includes('titular'));
});

test('marcar y desmarcar un paso actualiza el progreso y conserva la nota', { skip: sinBase }, async () => {
  const total = (await pasos(slugA, cookieA)).total;
  let r = await llama(slugA, cookieA, 'paso', { paso: 'sat-rfc', hecho: true, nota: 'Constancia descargada <b>' });
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.hechos, 1);
  assert.equal(j.progreso, Math.round(100 / total));
  r = await llama(slugA, cookieA, 'paso', { paso: 'mid-licencia', hecho: true });
  assert.equal((await r.json()).hechos, 2);
  let d = await pasos(slugA, cookieA), p = todos(d).find(x => x.id === 'sat-rfc');
  assert.equal(p.hecho, true);
  assert.equal(p.nota, 'Constancia descargada <b>', 'la nota se guarda tal cual; el panel la escapa al dibujar');
  assert.equal(d.progreso, Math.round(200 / total));

  j = await (await llama(slugA, cookieA, 'paso', { paso: 'sat-rfc', hecho: false })).json();
  assert.equal(j.hechos, 1);
  d = await pasos(slugA, cookieA); p = todos(d).find(x => x.id === 'sat-rfc');
  assert.equal(p.hecho, false);
  assert.equal(p.nota, 'Constancia descargada <b>', 'desmarcar sin mandar nota no la borra');
  await llama(slugA, cookieA, 'paso', { paso: 'mid-licencia', hecho: false, nota: '' });
  assert.equal((await pasos(slugA, cookieA)).progreso, 0);
});

test('guardar solo la nota no desmarca un paso hecho', { skip: sinBase }, async () => {
  await llama(slugA, cookieA, 'paso', { paso: 'sat-cfdi', hecho: true });
  const r = await llama(slugA, cookieA, 'paso', { paso: 'sat-cfdi', nota: 'Factura global mensual' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).hecho, true);
  const p = todos(await pasos(slugA, cookieA)).find(x => x.id === 'sat-cfdi');
  assert.equal(p.hecho, true);
  assert.equal(p.nota, 'Factura global mensual');
  await llama(slugA, cookieA, 'paso', { paso: 'sat-cfdi', hecho: false, nota: '' });
  assert.equal((await pasos(slugA, cookieA)).progreso, 0);
});

test('el correo de privacidad se valida', { skip: sinBase }, async () => {
  for (const correo of ['no-es-correo', 'a@b.c<script>', 'x"@y.com']) {
    const r = await llama(slugB, cookieB, 'datos', { correo });
    assert.equal(r.status, 400, correo);
  }
  assert.equal((await pasos(slugB, cookieB)).correo, '');
});

test('sin correo ni WhatsApp, el aviso público remite al local en vez de dejar el medio vacío', { skip: sinBase }, async () => {
  const slugC = 'li-' + sufijo;
  const r = await fetch(srv.base + '/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Sin contacto', slug: slugC, dueno: 'Dueño', email: `${slugC}@ejemplo.com`, password: 'clave-segura-123' }) });
  assert.equal(r.status, 200);
  const cookieC = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.ok((await pasos(slugC, cookieC)).faltan.includes('contacto'));
  const h = await (await fetch(`${srv.base}/${slugC}/privacidad`)).text();
  assert.ok(h.includes('en persona en nuestra barbería'));
  assert.ok(!h.includes('<mark>'));
  const doc = await (await llama(slugC, cookieC, 'doc/aviso-integral')).text();
  assert.ok(doc.includes('<mark>'), 'en el panel el documento marca lo que falta');
});

test('un paso inexistente se rechaza con 400', { skip: sinBase }, async () => {
  for (const cuerpo of [{ paso: 'inventado', hecho: true }, { hecho: true }, { paso: '__proto__', hecho: true }]) {
    const r = await llama(slugA, cookieA, 'paso', cuerpo);
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
    assert.ok((await r.json()).error);
  }
});

test('los documentos llevan los datos del negocio escapados', { skip: sinBase }, async () => {
  const aj = await fetch(`${srv.base}/api/${slugA}/admin/ajustes`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ direccion: 'Calle 60 <img src=x onerror=alert(2)>', correo: `avisos-${slugA}@ejemplo.com` }) });
  assert.equal(aj.status, 200);
  assert.equal((await llama(slugA, cookieA, 'datos', { titular: 'Juan "Pérez" <b>' })).status, 200);
  assert.equal((await llama(slugA, cookieA, 'datos', { correo: `${slugA}@ejemplo.com` })).status, 200);
  await fetch(`${srv.base}/api/${slugA}/admin/comision`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA }, body: JSON.stringify({ barbero: 'Barbero 1', comision: 40 }) });
  const d = await pasos(slugA, cookieA);
  assert.deepEqual(d.faltan, []);
  assert.equal(d.titular, 'Juan "Pérez" <b>', 'guardar solo el correo no borra al titular');
  assert.equal(d.correo, `${slugA}@ejemplo.com`);
  assert.deepEqual(d.barberos, ['Barbero 1']);

  for (const tipo of ['aviso-integral', 'aviso-simplificado', 'contrato', 'reglamento']) {
    const r = await llama(slugA, cookieA, 'doc/' + tipo);
    assert.equal(r.status, 200, tipo);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const h = await r.text();
    assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'nombre escapado en ' + tipo);
    assert.ok(!h.includes('<script'), 'sin etiquetas script en ' + tipo);
    assert.ok(!h.includes('<img src=x'), 'dirección escapada en ' + tipo);
    assert.ok(h.includes('&lt;img src=x onerror=alert(2)&gt;'), 'la dirección aparece en ' + tipo);
    assert.match(h, /<title>[^<]+<\/title>/);
    assert.match(h, /no es asesoría legal/);
    assert.match(h, /noindex/);
    assert.match(h, /print\(\)/, 'botón para imprimir o guardar como PDF');
    if (tipo !== 'reglamento') assert.ok(h.includes('Juan &quot;Pérez&quot; &lt;b&gt;'), 'titular escapado en ' + tipo);
    assert.ok(!h.includes(`avisos-${slugA}@`), 'el correo privado para avisos de citas no se publica en ' + tipo);
    if (tipo.startsWith('aviso')) {
      assert.ok(h.includes(`${slugA}@ejemplo.com`) && h.includes('999 123 4567'), 'correo de privacidad y WhatsApp del negocio');
      assert.ok(h.includes(`/${slugA}/privacidad`), 'enlace al aviso integral');
    }
  }
  const integral = await (await llama(slugA, cookieA, 'doc/aviso-integral')).text();
  for (const t of ['WhatsApp', 'contraseña', 'cumpleaños', 'Secretaría Anticorrupción y Buen Gobierno', '20 días hábiles', 'No quiero promociones'])
    assert.ok(integral.includes(t), 'el aviso integral menciona: ' + t);
  assert.ok(!/INAI/.test(integral), 'no remite al INAI, que ya no existe');

  const c = await (await llama(slugA, cookieA, 'doc/contrato?barbero=' + encodeURIComponent('Barbero 1'))).text();
  assert.ok(c.includes('Barbero 1') && c.includes('40 %'), 'el contrato se llena con el barbero y su comisión');
  assert.match(c, /subordinad/);
  const otro = await (await llama(slugA, cookieA, 'doc/contrato?barbero=' + encodeURIComponent('<b>Intruso</b>'))).text();
  assert.ok(!otro.includes('Intruso'), 'un barbero que no está en la lista no se imprime');
  assert.equal((await llama(slugA, cookieA, 'doc/inventado')).status, 404);
});

test('la página pública del aviso de privacidad existe, es indexable y da 404 si el negocio no existe', { skip: sinBase }, async () => {
  const r = await fetch(`${srv.base}/${slugA}/privacidad`);
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /<title>Aviso de privacidad · &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
  assert.match(h, /<meta name="robots" content="index, follow">/);
  assert.ok(h.includes(`href="/${slugA}"`), 'enlace de regreso a la página del negocio');
  assert.ok(!h.includes('<script') && !h.includes('<img src=x'));
  assert.ok(!h.includes('<mark>'), 'la página pública no muestra marcas de pendiente');
  assert.ok(!h.includes(`avisos-${slugA}@`), 'la página pública no expone el correo de avisos de citas');
  assert.ok(h.includes('Aviso de privacidad simplificado') && h.includes('Aviso de privacidad integral'));
  assert.equal((await fetch(`${srv.base}/no-existe-${sufijo}/privacidad`)).status, 404);
  const b = await fetch(`${srv.base}/${slugB}/privacidad`);
  assert.equal(b.status, 200);
  assert.ok((await b.text()).includes('Barbería ' + slugB));
});

test('sin sesión da 401, cada barbería ve solo lo suyo y los barberos no entran', { skip: sinBase }, async () => {
  assert.equal((await llama(slugA, '', 'pasos')).status, 401);
  assert.equal((await llama(slugA, '', 'paso', { paso: 'sat-rfc', hecho: true })).status, 401);
  assert.equal((await llama(slugA, '', 'doc/aviso-integral')).status, 401);
  assert.equal((await llama(slugA, cookieB, 'pasos')).status, 401, 'la sesión de otra barbería no sirve aquí');

  await llama(slugB, cookieB, 'paso', { paso: 'datos-aviso', hecho: true, nota: 'nota de B' });
  const a = todos(await pasos(slugA, cookieA)).find(p => p.id === 'datos-aviso');
  assert.equal(a.hecho, false, 'el avance de B no aparece en A');
  assert.equal(a.nota, '');
  assert.equal((await pasos(slugB, cookieB)).hechos, 1);
  const docB = await (await llama(slugB, cookieB, 'doc/aviso-integral')).text();
  assert.ok(!docB.includes('Juan &quot;Pérez&quot;') && docB.includes('Barbería ' + slugB), 'el documento de B no trae datos de A');

  const eq = await fetch(`${srv.base}/api/${slugA}/admin/equipo`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ nombre: 'Barbero', email: `b-${slugA}@ejemplo.com`, rol: 'barbero', barbero: 'Barbero 1' }) });
  const { temporal } = await eq.json();
  const ent = await fetch(`${srv.base}/api/${slugA}/cuenta/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `b-${slugA}@ejemplo.com`, password: temporal }) });
  const cb = ent.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await llama(slugA, cb, 'pasos')).status, 403, 'un barbero no ve la pestaña legal');
});

test('el aviso dice cómo se agenda para un menor y, solo si el dueño lo activa, que un asistente con IA contesta el WhatsApp', { skip: sinBase }, async () => {
  const publico = async () => (await fetch(`${srv.base}/${slugB}/privacidad`)).text();
  let h = await publico();
  assert.match(h, /menor de 18 años, la agenda su madre, padre o tutor/);
  assert.match(h, /das ese consentimiento como su madre, padre o tutor/);
  assert.ok(!h.includes('inteligencia artificial'), 'sin asistente no se menciona la IA');

  const r = await llama(slugB, cookieB, 'datos', { asistente: 'Oxion AI <b>' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).asistente, 'Oxion AI <b>');
  const d = await pasos(slugB, cookieB);
  assert.equal(d.asistente, 'Oxion AI <b>');
  assert.equal(d.correo, '', 'guardar el asistente no toca el correo');
  h = await publico();
  assert.match(h, /Si nos escribes por WhatsApp:/);
  assert.match(h, /asistente automático con inteligencia artificial/);
  assert.ok(h.includes('(<b>Oxion AI &lt;b&gt;</b>)'), 'proveedor escapado en el aviso integral');
  assert.ok(h.includes('se procesan con su proveedor (Oxion AI &lt;b&gt;) solo para responderte'), 'y en el simplificado');
  assert.match(h, /pídelo en el mismo chat/);
  const doc = await (await llama(slugB, cookieB, 'doc/aviso-integral')).text();
  assert.match(doc, /asistente automático con inteligencia artificial/);

  assert.equal((await llama(slugB, cookieB, 'datos', { asistente: '' })).status, 200);
  assert.ok(!(await publico()).includes('inteligencia artificial'), 'al quitarlo, el aviso deja de mencionarlo');
  assert.equal((await llama(slugA, cookieB, 'datos', { asistente: 'X' })).status, 401, 'no se puede cambiar el aviso de otra barbería');
});
