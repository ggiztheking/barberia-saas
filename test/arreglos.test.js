// Arreglos de la revisión: límite de barberos en la prueba gratis, fotos de productos y eventos, WhatsApp de 10 dígitos,
// primeros pasos del panel, renombrar barberos sin romper sus cuentas ni sus citas, robots.txt y vista previa de /registro.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
const PUBLICA = 'https://www.agendabarberias.xyz';
const ERR_TEL = 'Escribe los 10 dígitos de tu WhatsApp.';
let srv, pool;
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const mas = (f, k) => { const x = new Date(f + 'T12:00'); x.setDate(x.getDate() + k); return x.toLocaleDateString('en-CA'); };
// Cada petición sale de una IP distinta: registro (5/h), citas (10/h) y entradas tienen límite por IP.
let ipN = 0;
const ip = () => `10.91.${Math.floor(++ipN / 250)}.${ipN % 250 + 1}`;
const llama = (metodo, slug, ruta, cuerpo, cookie = '') => fetch(`${srv.base}/api/${slug}${ruta}`, {
  method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': ip() }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
const get = (slug, ruta, cookie) => llama('GET', slug, ruta, undefined, cookie);
const post = (slug, ruta, cuerpo, cookie) => llama('POST', slug, ruta, cuerpo, cookie);
const patch = (slug, ruta, cuerpo, cookie) => llama('PATCH', slug, ruta, cuerpo, cookie);
const json = async r => r.json();
const galleta = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const alta = (cuerpo) => fetch(srv.base + '/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
  body: JSON.stringify({ dueno: 'Dueño', password: 'clave-segura-123', ...cuerpo, email: `${cuerpo.slug}@ejemplo.com`, nombre: 'Barbería ' + cuerpo.slug }) });
const negocio = async slug => (await pool.query('SELECT * FROM negocios WHERE slug=$1', [slug])).rows[0];
// PNG de 1x1: pasa la revisión de firma de /admin/imagen y /admin/trabajo.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const HTML_ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-admin.html'), 'utf8');

before(async () => {
  if (sinBase) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  srv = await arranca({ PUBLIC_URL: PUBLICA });
});
after(async () => { if (srv) srv.parar(); if (pool) await pool.end(); });

test('la prueba gratis permite hasta 8 barberos; el Básico, 3', { skip: sinBase }, async () => {
  const slug = 'lb-' + sufijo, c = await registra(srv.base, slug, ip());
  assert.equal((await negocio(slug)).plan, 'prueba');
  const r = await patch(slug, '/admin/ajustes', { barberos: 'Ana, Beto, Caro, Dani' }, c);
  assert.equal(r.status, 200, 'una barbería recién registrada guarda 4 barberos');
  assert.equal((await json(await get(slug, '/admin/ajustes', c))).barberos, 'Ana,Beto,Caro,Dani');
  assert.equal((await patch(slug, '/admin/ajustes', { barberos: 'A,B,C,D,E,F,G,H' }, c)).status, 200, 'hasta 8 en la prueba');
  const nueve = await patch(slug, '/admin/ajustes', { barberos: 'A,B,C,D,E,F,G,H,I' }, c);
  assert.equal(nueve.status, 400);
  assert.match((await json(nueve)).error, /8 barberos/);
  await pool.query("UPDATE negocios SET plan='basico' WHERE slug=$1", [slug]);
  const b4 = await patch(slug, '/admin/ajustes', { barberos: 'Ana,Beto,Caro,Dani' }, c);
  assert.equal(b4.status, 400, 'el Básico sigue en 3');
  assert.match((await json(b4)).error, /3 barberos/);
  assert.equal((await patch(slug, '/admin/ajustes', { barberos: 'Ana,Beto,Caro' }, c)).status, 200);
  await pool.query("UPDATE negocios SET plan='pro' WHERE slug=$1", [slug]);
  assert.equal((await patch(slug, '/admin/ajustes', { barberos: 'A,B,C,D,E,F,G,H' }, c)).status, 200, 'el Pro permite 8');
});

test('el panel tiene medida para cada tipo de foto que acepta el servidor (producto y evento incluidos)', { skip: sinBase }, async () => {
  const obj = /const R=\{([^}]*)\}\[tipo\](\|\|\[\d+,\d+\])?/.exec(HTML_ADMIN);
  assert.ok(obj, 'sube() define las medidas en const R={...}[tipo]');
  const medidas = new Set([...obj[1].matchAll(/(\w+):\[\d+,\d+\]/g)].map(m => m[1]));
  assert.ok(obj[2], 'hay una medida por defecto para cualquier otro tipo');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const tipos = JSON.parse(/if \(!(\[[^\]]+\])\.includes\(tipo\)\) return s\.status\(400\)\.json\(\{ error: 'Tipo de foto no válido'/.exec(server)[1].replace(/'/g, '"'));
  for (const t of tipos) assert.ok(medidas.has(t), `falta la medida de "${t}" en el panel`);
  // Los tipos que el panel manda a sube(): literales y el de Servicios y productos.
  const usados = new Set([...HTML_ADMIN.matchAll(/sube\(this,'(\w+)'/g)].map(m => m[1]));
  if (HTML_ADMIN.includes("t==='estilos'?'servicio':'producto'")) { usados.add('servicio'); usados.add('producto'); }
  for (const t of usados) assert.ok(medidas.has(t), `el panel sube fotos "${t}" sin medida`);
  assert.ok(usados.has('evento') && usados.has('producto'));
  // Y el servidor guarda la de un producto y la de un evento.
  const slug = 'fo-' + sufijo, c = await registra(srv.base, slug, ip());
  const prod = (await json(await get(slug, '/admin/catalogo', c))).productos[0];
  assert.equal((await post(slug, '/admin/imagen', { tipo: 'producto', ref: String(prod.id), data: PNG }, c)).status, 200);
  const ev = await json(await post(slug, '/admin/evento', { titulo: 'Noche de fades', fecha: mas(HOY(), 5) }, c));
  assert.equal((await post(slug, '/admin/imagen', { tipo: 'evento', ref: String(ev.id), data: PNG }, c)).status, 200);
});

test('POST /citas exige un WhatsApp de 10 dígitos y lo guarda limpio; el panel y los clientes con cuenta siguen igual', { skip: sinBase }, async () => {
  const slug = 'tc-' + sufijo, c = await registra(srv.base, slug, ip()), n = await negocio(slug), D1 = mas(HOY(), 1);
  const cita = (telefono, hora, cookie) => post(slug, '/citas', { cliente: 'Cliente', telefono, barbero: 'Barbero 1', servicio: 'Mid fade', fecha: D1, hora }, cookie);
  for (const t of ['12345', '99912345678', '', undefined]) {
    const r = await cita(t, '11:00');
    assert.equal(r.status, 400, JSON.stringify(t));
    assert.equal((await json(r)).error, ERR_TEL);
  }
  assert.equal((await cita('+52 1 999 123 4567', '11:00')).status, 200, '+52 1 se acepta');
  assert.equal((await cita('52 999 765 4321', '12:00')).status, 200, '52 se acepta');
  assert.equal((await cita('(999) 111-2233', '13:00')).status, 200);
  const tels = (await pool.query('SELECT hora,telefono FROM citas WHERE negocio_id=$1 ORDER BY hora', [n.id])).rows;
  assert.deepEqual(tels, [{ hora: '11:00', telefono: '9991234567' }, { hora: '12:00', telefono: '9997654321' }, { hora: '13:00', telefono: '9991112233' }]);
  // Cliente con cuenta: su WhatsApp ya es de 10 dígitos y la cita se liga a su cuenta.
  const k = await post(slug, '/cliente/registro', { nombre: 'Con cuenta', telefono: '999 888 7766', password: 'secreta-1' });
  assert.equal(k.status, 200);
  assert.equal((await cita('999 888 7766', '14:00', galleta(k))).status, 200);
  assert.ok((await pool.query("SELECT cuenta_id FROM citas WHERE negocio_id=$1 AND hora='14:00'", [n.id])).rows[0].cuenta_id);
  // El dueño desde el panel puede seguir anotando sin WhatsApp (quien llega sin cita).
  assert.equal((await post(slug, '/admin/cita', { cliente: 'Sin cita', telefono: '', barbero: 'Barbero 1', servicio: 'Mid fade', fecha: D1, hora: '15:00' }, c)).status, 200);
});

test('/api/registro: el WhatsApp del dueño, si se escribe, debe tener 10 dígitos', { skip: sinBase }, async () => {
  const malo = await alta({ slug: 'rw1-' + sufijo, whatsapp: '999 123 45' });
  assert.equal(malo.status, 400);
  assert.equal((await json(malo)).error, ERR_TEL);
  assert.equal(await negocio('rw1-' + sufijo), undefined, 'no se creó la barbería');
  assert.equal((await alta({ slug: 'rw2-' + sufijo, whatsapp: '+52 1 999 123 4567' })).status, 200);
  assert.equal((await negocio('rw2-' + sufijo)).whatsapp, '529991234567');
  assert.equal((await alta({ slug: 'rw3-' + sufijo, whatsapp: '999 123 4567' })).status, 200);
  assert.equal((await negocio('rw3-' + sufijo)).whatsapp, '529991234567');
  assert.equal((await alta({ slug: 'rw4-' + sufijo })).status, 200, 'sin WhatsApp sigue siendo válido');
  assert.equal((await negocio('rw4-' + sufijo)).whatsapp, null);
  // El formulario revisa lo mismo antes de enviar (un error de dedo no gasta un intento de registro).
  const reg = fs.readFileSync(path.join(__dirname, '..', 'public', 'registro.html'), 'utf8');
  assert.ok(reg.includes(ERR_TEL));
});

test('primeros pasos: servicios de ejemplo y nombres de barberos van primero y se marcan con los datos', { skip: sinBase }, async () => {
  const slug = 'pp-' + sufijo, c = await registra(srv.base, slug, ip());
  const a = await json(await get(slug, '/admin/ajustes', c));
  assert.equal(a.servicios_ejemplo, true, 'recién registrada, el catálogo es el de ejemplo');
  assert.equal(a.barberos, 'Barbero 1');
  const cat = await json(await get(slug, '/admin/catalogo', c));
  assert.equal((await patch(slug, '/admin/precio', { tabla: 'estilos', id: cat.estilos[0].id, precio: 250 }, c)).status, 200);
  assert.equal((await json(await get(slug, '/admin/ajustes', c))).servicios_ejemplo, false, 'al cambiar un precio deja de ser de ejemplo');
  // Quitar o agregar también cuenta.
  const slug2 = 'pq-' + sufijo, c2 = await registra(srv.base, slug2, ip());
  assert.equal((await post(slug2, '/admin/item', { tabla: 'estilos', nombre: 'Corte infantil', tipo: 'servicio', precio: 150 }, c2)).status, 200);
  assert.equal((await json(await get(slug2, '/admin/ajustes', c2))).servicios_ejemplo, false);
  // En el panel: los dos pasos nuevos van antes que la portada y se pueden marcar a mano.
  const i1 = HTML_ADMIN.indexOf("['Revisa tus servicios y precios (vienen de ejemplo)'"), i2 = HTML_ADMIN.indexOf("['Pon el nombre de tus barberos'"), i3 = HTML_ADMIN.indexOf("['Sube la portada de tu página'");
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, 'orden de los pasos');
  assert.match(HTML_ADMIN.slice(i1, i3), /a\.servicios_ejemplo===false/);
  assert.match(HTML_ADMIN.slice(i1, i3), /ve\('ajustes','#cat'\)/);
  assert.match(HTML_ADMIN, /function marcaPaso\(k\)\{try\{localStorage\[k\+N\]='1'\}catch\(e\)\{\}pasos\(\)\}/);
});

test('renombrar a un barbero en Ajustes mueve su cuenta, sus citas próximas y lo que depende de su nombre', { skip: sinBase }, async () => {
  const slug = 'rn-' + sufijo, slugO = 'ro-' + sufijo, c = await registra(srv.base, slug, ip());
  await registra(srv.base, slugO, ip());
  const n = await negocio(slug), o = await negocio(slugO), hoy = HOY(), D1 = mas(hoy, 1), AYER = mas(hoy, -1);
  // Cuenta del barbero "Barbero 1"
  const eq = await json(await post(slug, '/admin/equipo', { nombre: 'Uno', email: `uno-${sufijo}@ejemplo.com`, rol: 'barbero', barbero: 'Barbero 1' }, c));
  const e = await post(slug, '/cuenta/entrar', { email: `uno-${sufijo}@ejemplo.com`, password: eq.temporal });
  assert.equal(e.status, 200);
  const cb = galleta(e);
  // Lo que depende del nombre
  assert.equal((await post(slug, '/citas', { cliente: 'Futuro', telefono: '9991234567', barbero: 'Barbero 1', servicio: 'Mid fade', fecha: D1, hora: '11:00' })).status, 200);
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'Pasado','9990000001','Barbero 1','Corte',$2,'10:00',200,'completada',$3)", [n.id, AYER, 'rnp' + sufijo]);
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'Otra barbería','9990000002','Barbero 1','Corte',$2,'11:00',200,'pendiente',$3)", [o.id, D1, 'rno' + sufijo]);
  await pool.query("INSERT INTO usuarios(negocio_id,nombre,email,salt,hash,rol,barbero) VALUES($1,'Ajeno',$2,'x','x','barbero','Barbero 1')", [o.id, `ajeno-${sufijo}@ejemplo.com`]);
  assert.equal((await post(slug, '/admin/bloqueo', { barbero: 'Barbero 1', fecha: D1, hora: '15:00', motivo: 'Comida' }, c)).status, 200);
  assert.equal((await post(slug, '/admin/perfil', { barbero: 'Barbero 1', especialidad: 'Fades' }, c)).status, 200);
  assert.equal((await post(slug, '/admin/comision', { barbero: 'Barbero 1', comision: 40 }, c)).status, 200);
  assert.equal((await post(slug, '/admin/imagen', { tipo: 'barbero', ref: 'Barbero 1', data: PNG }, c)).status, 200);
  assert.equal((await post(slug, '/admin/trabajo', { data: PNG, barbero: 'Barbero 1' }, c)).status, 200);

  const r = await patch(slug, '/admin/ajustes', { barberos: 'Juan' }, c);
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).renombrados, [{ de: 'Barbero 1', a: 'Juan' }]);

  const uno = (sql, p) => pool.query(sql, p).then(x => x.rows);
  assert.deepEqual(await uno('SELECT barbero FROM usuarios WHERE negocio_id=$1 AND rol=$2', [n.id, 'barbero']), [{ barbero: 'Juan' }]);
  assert.deepEqual(await uno('SELECT cliente,barbero FROM citas WHERE negocio_id=$1 ORDER BY fecha', [n.id]), [{ cliente: 'Pasado', barbero: 'Barbero 1' }, { cliente: 'Futuro', barbero: 'Juan' }], 'las pasadas se quedan como historial');
  assert.deepEqual(await uno('SELECT barbero FROM bloqueos WHERE negocio_id=$1', [n.id]), [{ barbero: 'Juan' }]);
  assert.deepEqual(await uno('SELECT barbero,especialidad,comision::float AS comision FROM perfiles WHERE negocio_id=$1', [n.id]), [{ barbero: 'Juan', especialidad: 'Fades', comision: 40 }]);
  assert.deepEqual(await uno("SELECT ref FROM imagenes WHERE negocio_id=$1 AND tipo='barbero'", [n.id]), [{ ref: 'Juan' }]);
  assert.deepEqual(await uno('SELECT barbero FROM trabajos WHERE negocio_id=$1', [n.id]), [{ barbero: 'Juan' }]);
  // La otra barbería no se toca
  assert.deepEqual(await uno('SELECT barbero FROM citas WHERE negocio_id=$1', [o.id]), [{ barbero: 'Barbero 1' }]);
  assert.deepEqual(await uno('SELECT barbero FROM usuarios WHERE negocio_id=$1 AND rol=$2', [o.id, 'barbero']), [{ barbero: 'Barbero 1' }]);

  // El barbero sigue trabajando con su misma sesión: ve su cita y puede anotar (antes daba 400 "Revisa el nombre, el barbero y la hora").
  assert.equal((await json(await get(slug, '/admin/me', cb))).barbero, 'Juan');
  assert.deepEqual((await json(await get(slug, '/admin/citas?fecha=' + D1, cb))).map(x => x.cliente), ['Futuro']);
  const nueva = await post(slug, '/admin/cita', { cliente: 'Walk-in', telefono: '', servicio: 'Mid fade', fecha: D1, hora: '16:00' }, cb);
  assert.equal(nueva.status, 200, JSON.stringify(await nueva.clone().json()));
  assert.ok((await json(await get(slug, '/info'))).fotos_barberos.Juan, 'la foto sigue en la página');
  assert.ok((await json(await get(slug, '/horarios?fecha=' + D1 + '&barbero=Juan'))).includes('15:00'), 'el bloqueo sigue apartando su hora');
});

test('agregar, quitar o reordenar barberos no renombra; un renombre que choca no deja nada a medias', { skip: sinBase }, async () => {
  const slug = 'ro2-' + sufijo, c = await registra(srv.base, slug, ip()), n = await negocio(slug), D1 = mas(HOY(), 1);
  const guarda = async barberos => { const r = await patch(slug, '/admin/ajustes', { barberos }, c); return { status: r.status, ...(await json(r)) }; };
  assert.deepEqual((await guarda('Ana,Beto')).renombrados, [], 'de 1 a 2 barberos es un alta');
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'De Ana','9990000003','Ana','Corte',$2,'11:00',200,'pendiente',$3)", [n.id, D1, 'ra' + sufijo]);
  const deAna = async () => (await pool.query("SELECT barbero FROM citas WHERE negocio_id=$1 AND cliente='De Ana'", [n.id])).rows[0].barbero;
  assert.deepEqual((await guarda('Beto,Ana')).renombrados, [], 'cambiar el orden');
  assert.equal(await deAna(), 'Ana');
  assert.deepEqual((await guarda('Beto,Ana,Caro')).renombrados, [], 'agregar');
  assert.deepEqual((await guarda('Ana,Caro')).renombrados, [], 'quitar');
  assert.equal(await deAna(), 'Ana');
  assert.deepEqual((await guarda('Xe,Xe')).renombrados, [], 'con nombres repetidos no se adivina quién es quién');
  assert.deepEqual((await guarda('Ana,Caro')).renombrados, []);
  assert.equal(await deAna(), 'Ana');
  // Una cita próxima a nombre de "Zoe" (alguien que ya no está) en el mismo horario que la de Ana: renombrar Ana → Zoe choca.
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'De Zoe','9990000004','Zoe','Corte',$2,'11:00',200,'pendiente',$3)", [n.id, D1, 'rz' + sufijo]);
  const choca = await guarda('Zoe,Caro');
  assert.equal(choca.status, 409);
  assert.ok(choca.error);
  assert.equal((await negocio(slug)).barberos, 'Ana,Caro', 'no se guardó la lista');
  assert.equal(await deAna(), 'Ana', 'ni se movió la cita');
  // Sin choque, el renombre por posición sí aplica.
  const ok = await guarda('Ana,Carlos');
  assert.deepEqual(ok.renombrados, [{ de: 'Caro', a: 'Carlos' }]);
  assert.equal((await negocio(slug)).barberos, 'Ana,Carlos');
});

test('robots.txt trae la línea Sitemap y /registro tiene descripción y vista previa para redes', { skip: sinBase }, async () => {
  const r = await fetch(srv.base + '/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/plain/);
  const t = await r.text();
  assert.ok(t.includes('Disallow: /api/'), 'conserva las reglas de public/robots.txt');
  assert.ok(t.includes(`Sitemap: ${PUBLICA}/sitemap.xml`), t);
  assert.equal(t.match(/^Sitemap:/gm).length, 1);
  const h = await (await fetch(srv.base + '/registro')).text();
  for (const p of [/<meta name="description" content="[^"]{50,}">/, /<meta property="og:title" content="[^"]+">/, /<meta property="og:description" content="[^"]+">/, /<meta property="og:type" content="website">/])
    assert.match(h, p);
  const img = /<meta property="og:image" content="https:\/\/www\.agendabarberias\.xyz\/(img\/landing\/[\w-]+\.jpg)">/.exec(h);
  assert.ok(img, 'og:image con URL absoluta del dominio');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', img[1])), 'la imagen existe en public/img/landing');
});
