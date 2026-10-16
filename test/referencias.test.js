// Referencias de estilo editables desde el panel (paquetes.js) y cómo las dibuja el tema Estilo Internacional (tema-ei.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
const slugA = 'rfa-' + sufijo, slugB = 'rfb-' + sufijo, slugC = 'rfc-' + sufijo;
const ip = k => `10.77.${Math.floor(Math.random() * 200) + 1}.${k}`;
let base, parar, pool, cookieA, cookieB, cookieC;

const llama = (slug, cookie, ruta, cuerpo) => fetch(`${base}/api/${slug}${ruta}`, cuerpo === undefined ? { headers: { Cookie: cookie || '' } }
  : { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
const A = (ruta, cuerpo) => llama(slugA, cookieA, ruta, cuerpo);
const lista = async (slug = slugA, cookie = cookieA) => (await (await llama(slug, cookie, '/admin/referencias')).json()).referencias;
const crea = async (cuerpo, slug = slugA, cookie = cookieA) => { const r = await llama(slug, cookie, '/admin/referencia', cuerpo); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).id; };
// Un "JPG" mínimo: lo que valida el servidor son los bytes mágicos FF D8 FF y el tamaño.
const jpg = (n = 2000) => { const b = Buffer.alloc(n, 7); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; return 'data:image/jpeg;base64,' + b.toString('base64'); };
const espera = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  if (sinBase) return;
  ({ base, parar } = await arranca());
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  cookieA = await registra(base, slugA, ip(1));
  cookieB = await registra(base, slugB, ip(2));
  cookieC = await registra(base, slugC, ip(3));
});
after(async () => { if (parar) parar(); if (pool) await pool.end(); });

test('sin sesión da 401 y un barbero recibe 403', { skip: sinBase }, async () => {
  assert.equal((await llama(slugA, '', '/admin/referencias')).status, 401);
  assert.equal((await llama(slugA, '', '/admin/referencia', { nombre: 'X' })).status, 401);
  assert.equal((await llama(slugA, '', '/admin/referencias/orden', { ids: [1] })).status, 401);
  assert.equal((await llama(slugA, '', '/admin/referencia/foto', { id: 1, data: jpg() })).status, 401);
  assert.equal((await llama(slugA, '', '/admin/referencia/borrar', { id: 1 })).status, 401);
  assert.equal((await llama(slugA, cookieB, '/admin/referencias')).status, 401, 'la sesión de otra barbería no sirve aquí');

  const t = await (await A('/admin/equipo', { nombre: 'Barbero', email: `b-${slugA}@ejemplo.com`, rol: 'barbero', barbero: 'Barbero 1' })).json();
  assert.ok(t.temporal, 'se creó la cuenta del barbero');
  const e = await llama(slugA, '', '/cuenta/entrar', { email: `b-${slugA}@ejemplo.com`, password: t.temporal });
  const cb = e.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await llama(slugA, cb, '/admin/referencias')).status, 403);
  assert.equal((await llama(slugA, cb, '/admin/referencia', { nombre: 'Del barbero' })).status, 403);
  assert.equal((await llama(slugA, cb, '/admin/referencia/foto', { id: 1, data: jpg() })).status, 403);
  assert.deepEqual(await lista(), [], 'el barbero no creó nada');
});

test('crear, editar, listar y borrar referencias', { skip: sinBase }, async () => {
  assert.equal((await A('/admin/referencia', { nombre: '   ', descripcion: 'sin nombre' })).status, 400);
  const r1 = await crea({ nombre: 'Degradado bajo', descripcion: 'Discreto y limpio.', ia: true });
  const r2 = await crea({ nombre: 'Taper', descripcion: 'Patillas y nuca.', etiqueta: 'Tendencia' });
  const r3 = await crea({ nombre: 'Clásico', descripcion: 'x'.repeat(400) });
  let L = await lista();
  assert.deepEqual(L.map(r => r.id), [r1, r2, r3], 'en el orden en que se crearon');
  assert.equal(L[0].ia, true);
  assert.equal(L[0].etiqueta, null);
  assert.equal(L[1].etiqueta, 'Tendencia');
  assert.equal(L[1].ia, false);
  assert.equal(L[2].descripcion.length, 160, 'la descripción se recorta');

  assert.equal((await A('/admin/referencia', { id: r2, nombre: 'Taper bajo', descripcion: 'Nuevo texto', etiqueta: '', ia: true })).status, 200);
  L = await lista();
  const t = L.find(r => r.id === r2);
  assert.deepEqual([t.nombre, t.descripcion, t.etiqueta, t.ia], ['Taper bajo', 'Nuevo texto', null, true]);
  assert.equal((await A('/admin/referencia', { id: 999999999, nombre: 'Fantasma' })).status, 404);
  assert.equal((await A('/admin/referencia', { id: 'abc', nombre: 'Fantasma' })).status, 404);

  // Una referencia no es un servicio: no estorba al crear un paquete con el mismo nombre y no aparece en la agenda.
  assert.equal((await A('/admin/paquete', { nombre: 'Clásico', precio: 150, incluye: 'Corte' })).status, 200);
  const est = await (await llama(slugA, '', '/estilos')).json();
  assert.ok(!est.some(e => e.tipo === 'referencia'), 'las referencias no se reservan');

  assert.equal((await A('/admin/referencia/borrar', { id: r3 })).status, 200);
  assert.equal((await A('/admin/referencia/borrar', { id: r3 })).status, 404, 'ya no existe');
  assert.deepEqual((await lista()).map(r => r.id), [r1, r2]);
});

test('reordenar: solo con la lista completa de referencias propias', { skip: sinBase }, async () => {
  const r3 = await crea({ nombre: 'Texturizado', descripcion: 'Movimiento arriba.' });
  const ids = (await lista()).map(r => r.id);
  assert.equal(ids.length, 3);
  const nuevo = [ids[2], ids[0], ids[1]];
  assert.equal((await A('/admin/referencias/orden', { ids: nuevo })).status, 200);
  assert.deepEqual((await lista()).map(r => r.id), nuevo);
  assert.equal((await A('/admin/referencias/orden', { ids: [ids[0], ids[1]] })).status, 400, 'falta una');
  assert.equal((await A('/admin/referencias/orden', { ids: [ids[0], ids[0], ids[1]] })).status, 400, 'repetidas');
  assert.equal((await A('/admin/referencias/orden', { ids: 'nada' })).status, 400);
  const ajena = await crea({ nombre: 'De B' }, slugB, cookieB);
  assert.equal((await A('/admin/referencias/orden', { ids: [ids[0], ids[1], ajena] })).status, 400, 'no acepta ids de otra barbería');
  assert.deepEqual((await lista()).map(r => r.id), nuevo, 'el orden no cambió');
  // Una nueva va al final.
  const r4 = await crea({ nombre: 'Mohicano' });
  assert.equal((await lista()).at(-1).id, r4);
  await A('/admin/referencia/borrar', { id: r4 });
  assert.ok(r3);
});

test('foto: JPG válido, reemplazo, formato inválido y demasiado pesada', { skip: sinBase }, async () => {
  const id = (await lista())[0].id;
  const r = await A('/admin/referencia/foto', { id, data: jpg(3000) });
  assert.equal(r.status, 200);
  const { img } = await r.json();
  assert.ok(img);
  const f = await fetch(`${base}/i/${img}`);
  assert.equal(f.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await f.arrayBuffer()).length, 3000);
  assert.equal((await lista()).find(x => x.id === id).img, img);

  const r2 = await (await A('/admin/referencia/foto', { id, data: jpg(4000) })).json();
  assert.ok(r2.img && r2.img !== img, 'la foto nueva tiene otro id (evita la caché)');
  assert.equal((await fetch(`${base}/i/${img}`)).status, 404, 'la foto anterior se borró');
  assert.equal((await pool.query("SELECT COUNT(*)::int c FROM imagenes WHERE tipo='servicio' AND ref=$1", [String(id)])).rows[0].c, 1);

  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000', 'hex').toString('base64');
  assert.equal((await A('/admin/referencia/foto', { id, data: png })).status, 400, 'solo JPG');
  const falso = 'data:image/jpeg;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64');
  assert.equal((await A('/admin/referencia/foto', { id, data: falso })).status, 400, 'los bytes no son de un JPG');
  assert.equal((await A('/admin/referencia/foto', { id, data: 'hola' })).status, 400);
  const pesada = await A('/admin/referencia/foto', { id, data: jpg(760 * 1024) });
  assert.equal(pesada.status, 400, 'más de 750 KB');
  assert.match((await pesada.json()).error, /pesada/);
  const enorme = await A('/admin/referencia/foto', { id, data: jpg(1100 * 1024) });
  assert.notEqual(enorme.status, 200, 'un cuerpo de más de 1 MB no pasa');
  assert.equal((await lista()).find(x => x.id === id).img, r2.img, 'la foto buena sigue ahí');
  assert.equal((await A('/admin/referencia/foto', { id: 999999999, data: jpg() })).status, 404);

  assert.equal((await A('/admin/referencia/foto/borrar', { id })).status, 200);
  assert.equal((await lista()).find(x => x.id === id).img, null);
  await A('/admin/referencia/foto', { id, data: jpg(2500) });
  const conFoto = (await lista()).find(x => x.id === id).img;
  await A('/admin/referencia/borrar', { id });
  assert.equal((await fetch(`${base}/i/${conFoto}`)).status, 404, 'al borrar la referencia se borra su foto');
});

test('aislamiento: otra barbería no ve ni toca las referencias ajenas', { skip: sinBase }, async () => {
  const deA = await crea({ nombre: 'Solo de A', descripcion: 'privada' });
  const LB = await lista(slugB, cookieB);
  assert.ok(!LB.some(r => r.id === deA || r.nombre === 'Solo de A'));
  assert.equal((await llama(slugB, cookieB, '/admin/referencia', { id: deA, nombre: 'Robada' })).status, 404);
  assert.equal((await llama(slugB, cookieB, '/admin/referencia/borrar', { id: deA })).status, 404);
  assert.equal((await llama(slugB, cookieB, '/admin/referencia/foto', { id: deA, data: jpg() })).status, 404);
  assert.equal((await llama(slugB, cookieB, '/admin/referencia/foto/borrar', { id: deA })).status, 404);
  const a = (await lista()).find(r => r.id === deA);
  assert.equal(a.nombre, 'Solo de A');
  // Un paquete no se puede editar ni borrar como referencia.
  const pq = (await (await llama(slugA, '', '/paquetes')).json()).paquetes[0];
  assert.equal((await A('/admin/referencia/borrar', { id: pq.id })).status, 404);
  assert.equal((await A('/admin/referencia', { id: pq.id, nombre: 'No' })).status, 404);
});

test('límite de 24 referencias por barbería', { skip: sinBase }, async () => {
  for (let k = 0; k < 24; k++) await crea({ nombre: 'Estilo ' + k }, slugC, cookieC);
  const r = await llama(slugC, cookieC, '/admin/referencia', { nombre: 'Una más' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /24/);
  assert.equal((await lista(slugC, cookieC)).length, 24);
});

test('la página pública refleja orden, etiquetas, IA y escapa el HTML', { skip: sinBase }, async () => {
  assert.equal((await llama(slugB, cookieB, '/admin/tema', { tema: 'ei' })).status, 200);
  for (const r of await lista(slugB, cookieB)) await llama(slugB, cookieB, '/admin/referencia/borrar', { id: r.id });
  let h = await (await fetch(`${base}/${slugB}`)).text();
  assert.ok(!h.includes('id="estilos"'), 'sin referencias no hay sección');
  assert.ok(!h.includes('href="#estilos"'), 'ni enlace en el menú');

  const mala = await crea({ nombre: '<script>alert(1)</script>', descripcion: '<img src=x onerror=alert(2)> & "comillas"', etiqueta: 'Nuevo <b>' }, slugB, cookieB);
  const ia = await crea({ nombre: 'Degradado IA', descripcion: 'Hecha con IA', ia: true }, slugB, cookieB);
  await llama(slugB, cookieB, '/admin/referencia/foto', { id: ia, data: jpg() });
  h = await (await fetch(`${base}/${slugB}`)).text();
  assert.ok(h.includes('id="estilos"'));
  assert.ok(!h.includes('<script>alert(1)</script>') && !h.includes('<img src=x') && !h.includes('Nuevo <b>'), 'nada de HTML inyectado');
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(h.includes('&lt;img src=x onerror=alert(2)&gt; &amp; &quot;comillas&quot;'));
  assert.ok(h.includes('NUEVO &lt;B&gt;'), 'la etiqueta sale en mayúsculas y escapada');
  assert.ok(h.includes('REFERENCIA GENERADA CON IA'), 'la marcada lleva la leyenda de IA');
  assert.equal((h.match(/GENERADA CON IA/g) || []).length, 1, 'solo la marcada');
  assert.ok(h.includes('Las imágenes marcadas como generadas con IA no son trabajos'), 'aviso para una galería mixta');
  assert.ok(h.indexOf('data-s="' + mala + '"') < h.indexOf('data-s="' + ia + '"'), 'en el orden elegido');

  await llama(slugB, cookieB, '/admin/referencias/orden', { ids: [ia, mala] });
  await llama(slugB, cookieB, '/admin/referencia', { id: mala, nombre: 'Clásico', descripcion: 'Natural', etiqueta: '', ia: false });
  h = await (await fetch(`${base}/${slugB}`)).text();
  assert.ok(h.indexOf('data-s="' + ia + '"') < h.indexOf('data-s="' + mala + '"'), 'el nuevo orden se ve en la página');
  assert.ok(h.includes('REFERENCIA DE ESTILO') && h.includes('<h3>Clásico</h3>'), 'los cambios se ven al instante');

  await llama(slugB, cookieB, '/admin/referencia/borrar', { id: mala });
  h = await (await fetch(`${base}/${slugB}`)).text();
  assert.ok(h.includes('Estas imágenes son referencias generadas con IA'), 'si todas son de IA, el aviso es general');
  assert.match(h, /<img src="\/i\/\d+" alt="Referencia de degradado ia"/);
});

test('una etiqueta que menciona IA no marca la foto como de IA; los filtros solo salen con 2 a 8 referencias', { skip: sinBase }, async () => {
  // slugC tiene 24 referencias sin marca de IA (prueba del límite).
  assert.equal((await llama(slugC, cookieC, '/admin/tema', { tema: 'ei' })).status, 200);
  const [r0] = await lista(slugC, cookieC);
  assert.equal((await llama(slugC, cookieC, '/admin/referencia', { id: r0.id, nombre: 'Foto real', descripcion: 'Hecha en el local', etiqueta: 'Foto real, sin IA', ia: false })).status, 200);
  let h = await (await fetch(`${base}/${slugC}`)).text();
  assert.ok(h.includes('FOTO REAL, SIN IA'), 'la etiqueta se muestra tal cual');
  assert.ok(!/generadas? con IA/i.test(h), 'la página no dice que sean imágenes de IA');
  assert.ok(h.includes('Referencias para inspirarte.'));
  assert.ok(!h.includes('class="filters"'), 'con 24 referencias no hay una fila de 25 botones de filtro');
  // Marcada como IA y con etiqueta propia: se agrega la leyenda.
  await llama(slugC, cookieC, '/admin/referencia', { id: r0.id, nombre: 'Foto real', descripcion: 'x', etiqueta: 'Tendencia', ia: true });
  h = await (await fetch(`${base}/${slugC}`)).text();
  assert.ok(h.includes('TENDENCIA · GENERADA CON IA'));
  assert.ok(h.includes('Las imágenes marcadas como generadas con IA no son trabajos'));
  // slugB tiene una sola referencia: filtrar no sirve de nada.
  assert.equal((await lista(slugB, cookieB)).length, 1);
  assert.ok(!(await (await fetch(`${base}/${slugB}`)).text()).includes('class="filters"'));
});

test('dos subidas de foto a la vez no dan error 500 ni dejan dos fotos', { skip: sinBase }, async () => {
  const id = await crea({ nombre: 'Carrera ' + sufijo });
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const rs = await Promise.all([0, 1, 2, 3].map(k => A('/admin/referencia/foto', { id, data: jpg(5000 + k) })));
    for (const r of rs) assert.ok([200, 409].includes(r.status), 'estado ' + r.status);
    assert.ok(rs.some(r => r.status === 200));
    assert.equal((await pool.query("SELECT COUNT(*)::int c FROM imagenes WHERE tipo='servicio' AND ref=$1", [String(id)])).rows[0].c, 1);
  }
  await A('/admin/referencia/borrar', { id });
});

test('Estilo Internacional conserva sus 6 referencias sin duplicarse y la etiqueta vieja se migra al reiniciar', { skip: sinBase }, async () => {
  const ei = (await pool.query("SELECT id FROM negocios WHERE slug='estilo-internacional'")).rows[0];
  // Dato con el formato anterior (la leyenda de IA escrita en la etiqueta), insertado directo en la base.
  const negB = (await pool.query('SELECT id FROM negocios WHERE slug=$1', [slugB])).rows[0].id;
  const vieja = (await pool.query("INSERT INTO estilos(negocio_id,nombre,tipo,precio,descripcion,etiqueta,ia,orden) VALUES($1,'Vieja','referencia',0,'De antes','Referencia generada con IA',false,9) RETURNING id", [negB])).rows[0].id;

  const antes = ei && (await pool.query("SELECT e.id,e.nombre,e.descripcion,e.ia,i.id AS img FROM estilos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='servicio' AND i.ref=e.id::text WHERE e.negocio_id=$1 AND e.tipo='referencia' ORDER BY e.orden,e.id", [ei.id])).rows;
  const otro = await arranca(); // un reinicio: vuelve a correr la siembra y la migración
  try {
    let v;
    for (let k = 0; k < 40; k++) { v = (await pool.query('SELECT ia,etiqueta FROM estilos WHERE id=$1', [vieja])).rows[0]; if (v.ia) break; await espera(250); }
    assert.deepEqual(v, { ia: true, etiqueta: null }, 'la etiqueta vieja de IA pasa a ser la marca');
    const hB = await (await fetch(`${otro.base}/${slugB}`)).text();
    assert.equal((hB.match(/REFERENCIA GENERADA CON IA/g) || []).length, 2, 'se sigue viendo igual en la página');

    if (!ei) return; // sin Estilo Internacional en esta base no hay más que revisar
    const despues = (await pool.query("SELECT e.id,e.nombre,e.descripcion,e.ia,i.id AS img FROM estilos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='servicio' AND i.ref=e.id::text WHERE e.negocio_id=$1 AND e.tipo='referencia' ORDER BY e.orden,e.id", [ei.id])).rows;
    assert.deepEqual(despues, antes, 'el reinicio no duplica ni cambia nada');
    assert.equal(despues.length, 6);
    assert.deepEqual(despues.map(r => r.nombre), ['Degradado bajo', 'Degradado medio', 'Degradado alto', 'Taper', 'Clásico', 'Texturizado']);
    assert.ok(despues.every(r => r.ia && r.img), 'todas marcadas como IA y con foto');
    const h = await (await fetch(`${otro.base}/estilo-internacional`)).text();
    assert.equal((h.match(/<span class="eyebrow">REFERENCIA GENERADA CON IA<\/span>/g) || []).length, 6);
    assert.ok(h.includes('Estas imágenes son referencias generadas con IA. No son trabajos realizados por nuestra barbería.'));
    assert.ok(h.includes('data-cap="Degradado bajo · Referencia generada con IA"'));
  } finally { otro.parar(); }
});
