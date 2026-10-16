// Programa de lealtad (tarjeta de sellos): configuración, conteo de visitas, canje de premios, consulta pública y aislamiento.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
let srv, pool, cookieA, cookieB, cookieC, slugA, slugB, slugC, negA, negB, negC;

// Fecha de Mérida de hace n días (n negativo = futuro).
const dia = n => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const HOY = () => dia(0);
const llama = (slug, cookie, ruta, cuerpo, extra = {}) => fetch(`${srv.base}/api/${slug}${ruta}`, cuerpo === undefined ? { headers: { Cookie: cookie || '', ...extra } }
  : { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie || '', ...extra }, body: JSON.stringify(cuerpo) });
const A = (ruta, cuerpo) => llama(slugA, cookieA, ruta, cuerpo);
const B = (ruta, cuerpo) => llama(slugB, cookieB, ruta, cuerpo);
const ok = async r => { const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j; };
let n = 0;
const siembra = (neg, telefono, cliente, fecha, estado = 'completada') => pool.query(
  "INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,$2,$3,'Barbero 1','Corte',$4,'10:00',150,$5,$6)",
  [neg, cliente, telefono, fecha, estado, 'le' + sufijo + (n++)]);

const T1 = '9991110001', T2 = '9992220002', T4 = '9994440004', T5 = '9995550005';

before(async () => {
  if (sinBase) return;
  // PUBLIC_URL con diagonal final, como podría quedar escrita en Railway: los enlaces no deben salir con "//".
  srv = await arranca({ PUBLIC_URL: 'http://127.0.0.1/' });
  slugA = 'le-' + sufijo; slugB = 'lf-' + sufijo; slugC = 'lg-' + sufijo;
  cookieA = await registra(srv.base, slugA, '10.77.0.1');
  cookieB = await registra(srv.base, slugB, '10.77.0.2');
  cookieC = await registra(srv.base, slugC, '10.77.0.3');
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query('SELECT id, slug FROM negocios WHERE slug = ANY($1)', [[slugA, slugB, slugC]]);
  negA = r.rows.find(x => x.slug === slugA).id; negB = r.rows.find(x => x.slug === slugB).id;
  negC = r.rows.find(x => x.slug === slugC).id;

  // A: T1 con varios formatos de teléfono; solo cuentan las completadas desde el inicio del programa (hace 30 días).
  await siembra(negA, T1, 'Juan Viejo', dia(40));                  // antes del inicio: no cuenta
  await siembra(negA, '999 111 0001', 'Juan', dia(20));
  await siembra(negA, '+52 999 111 0001', 'Juan', dia(10));
  await siembra(negA, '529991110001', 'Juan Pérez', dia(5));
  await siembra(negA, T1, 'Juan Pérez', dia(4), 'no_llego');
  await siembra(negA, T1, 'Juan Pérez', dia(6), 'cancelada');
  await siembra(negA, T1, 'Juan Pérez', dia(-2), 'pendiente');
  await siembra(negA, '999-222-0002', 'Pedro', dia(8));
  await siembra(negA, T2, 'Pedro', dia(9), 'no_llego');
  await siembra(negA, '12345', 'Sin teléfono', dia(7));            // teléfono incompleto: no entra al programa
  for (const d of [25, 18, 12, 2]) await siembra(negA, T4, 'Luis', dia(d));
  await siembra(negA, T5, 'Memo', dia(45)); await siembra(negA, T5, 'Memo', dia(35));
  // B: el mismo teléfono T1 con sus propias visitas, que no deben mezclarse con A.
  for (const d of [3, 4, 5, 6, 7]) await siembra(negB, T1, 'Cliente de B', dia(d));
});
after(async () => { if (srv) srv.parar(); if (pool) await pool.end(); });

test('la configuración empieza apagada y valida visitas, premio y fecha de inicio', { skip: sinBase }, async () => {
  const c = await ok(await A('/admin/lealtad/config'));
  assert.equal(c.activo, false); assert.equal(c.cada, 10); assert.equal(c.premio, ''); assert.equal(c.desde, null);
  assert.deepEqual(await ok(await llama(slugA, '', `/lealtad?tel=${T1}`)), { activo: false }, 'sin programa activo no da datos');
  for (const malo of [{ cada: 2, premio: 'x' }, { cada: 21, premio: 'x' }, { cada: 3.5, premio: 'x' }, { cada: 'diez', premio: 'x' },
    { activo: true, cada: 5, premio: '   ' }, { activo: true, cada: 5, premio: 'x'.repeat(121) },
    { activo: true, cada: 5, premio: 'Corte', desde: dia(-3) }, { activo: true, cada: 5, premio: 'Corte', desde: '2026-02-30' }, { activo: true, cada: 5, premio: 'Corte', desde: 'ayer' }]) {
    assert.equal((await A('/admin/lealtad/config', malo)).status, 400, JSON.stringify(malo));
  }
  const g = await ok(await A('/admin/lealtad/config', { activo: true, cada: 3, premio: '  Corte   gratis ', desde: dia(30) }));
  assert.deepEqual([g.activo, g.cada, g.premio, g.desde], [true, 3, 'Corte gratis', dia(30)]);
  const sinFecha = await ok(await B('/admin/lealtad/config', { activo: false, cada: 5 }));
  assert.equal(sinFecha.desde, HOY(), 'sin fecha de inicio empieza hoy');
});

test('cuenta solo citas completadas desde el inicio, con teléfono normalizado y en orden de cercanía al premio', { skip: sinBase }, async () => {
  const r = await ok(await A('/admin/lealtad/clientes'));
  const por = Object.fromEntries(r.clientes.map(c => [c.tel, c]));
  assert.equal(por[T1].visitas, 3, 'tres completadas desde el inicio, sin contar no_llego, cancelada, pendiente ni la anterior al inicio');
  assert.equal(por[T1].faltan, 0); assert.equal(por[T1].listo, true);
  assert.equal(por[T1].nombre, 'Juan Pérez', 'usa el nombre de su cita más reciente');
  assert.equal(por[T2].visitas, 1); assert.equal(por[T2].faltan, 2); assert.equal(por[T2].listo, false);
  assert.equal(por[T4].visitas, 4);
  assert.ok(!por[T5], 'sus visitas son anteriores al inicio del programa');
  assert.ok(!r.clientes.some(c => c.tel.length !== 10), 'los teléfonos incompletos no entran');
  assert.deepEqual(r.clientes.map(c => c.tel), [T4, T1, T2], 'primero los listos para premio (más visitas primero), luego los que están más cerca');
  assert.equal(r.resumen.listos, 2);
  assert.ok(por[T2].wa.startsWith('https://wa.me/52' + T2 + '?text='));
  const txt2 = decodeURIComponent(por[T2].wa.split('?text=')[1]);
  assert.ok(txt2.includes('te faltan 2 visitas para tu premio') && txt2.includes('Corte gratis') && txt2.includes(`/${slugA}/agenda`), txt2);
  assert.ok(decodeURIComponent(por[T1].wa.split('?text=')[1]).includes('¡ya ganaste tu premio'));
  assert.ok(txt2.includes(`http://127.0.0.1/${slugA}/agenda`) && !txt2.includes('//' + slugA), 'el enlace a la agenda no lleva "//" aunque PUBLIC_URL termine en diagonal');
});

test('el endpoint público solo devuelve el avance de ese teléfono, sin nombres', { skip: sinBase }, async () => {
  const r = await llama(slugA, '', '/lealtad?tel=' + encodeURIComponent('+52 999 111 0001'));
  const txt = await r.text();
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(txt), { activo: true, cada: 3, premio: 'Corte gratis', visitas: 3, faltan: 0 });
  assert.ok(!txt.includes('Juan') && !txt.includes('Pedro') && !txt.includes(T2), 'sin nombres ni datos de otros clientes');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await ok(await llama(slugA, '', `/lealtad?tel=${T2}`)), { activo: true, cada: 3, premio: 'Corte gratis', visitas: 1, faltan: 2 });
  assert.deepEqual(await ok(await llama(slugA, '', '/lealtad?tel=9990009999')), { activo: true, cada: 3, premio: 'Corte gratis', visitas: 0, faltan: 3 });
  assert.equal((await llama(slugA, '', '/lealtad?tel=123')).status, 400);
  assert.equal((await llama(slugA, '', '/lealtad')).status, 400);
  assert.equal((await llama('no-existe-' + sufijo, '', `/lealtad?tel=${T1}`)).status, 404);
});

test('el canje exige las visitas completas, se registra y reinicia el conteo', { skip: sinBase }, async () => {
  const falta = await A('/admin/lealtad/canje', { telefono: T2 });
  assert.equal(falta.status, 400);
  assert.match((await falta.json()).error, /le faltan 2 visitas/);
  assert.equal((await A('/admin/lealtad/canje', { telefono: '123' })).status, 400);
  assert.equal((await A('/admin/lealtad/canje', { telefono: '9990009999' })).status, 400, 'sin visitas no hay premio');
  const c = await ok(await A('/admin/lealtad/canje', { telefono: '+52 999 111 0001', nota: '  Corte gratis entregado ' }));
  assert.equal(c.fecha, HOY()); assert.equal(c.visitas, 0); assert.equal(c.faltan, 3);
  assert.equal((await A('/admin/lealtad/canje', { telefono: T1 })).status, 400, 'no se puede canjear dos veces con las mismas visitas');
  const p = await ok(await llama(slugA, '', `/lealtad?tel=${T1}`));
  assert.equal(p.visitas, 0); assert.equal(p.faltan, 3);
  const r = await ok(await A('/admin/lealtad/clientes'));
  const j = r.clientes.find(x => x.tel === T1);
  assert.equal(j.visitas, 0); assert.equal(j.canjes, 1); assert.equal(j.listo, false);
  assert.deepEqual(j.ultimos, [{ fecha: HOY(), nota: 'Corte gratis entregado' }]);
  assert.equal(r.resumen.canjes, 1);
  assert.equal(r.clientes[r.clientes.length - 1].tel, T1, 'recién canjeado: es quien está más lejos del premio');

  // Un canje anterior (hace 15 días) deja contar solo las visitas posteriores a él.
  await pool.query('INSERT INTO lealtad_canjes (negocio_id, telefono, fecha, nota) VALUES ($1,$2,$3,$4)', [negA, T4, dia(15), 'Antes']);
  const t4 = (await ok(await A('/admin/lealtad/clientes'))).clientes.find(x => x.tel === T4);
  assert.equal(t4.visitas, 2); assert.equal(t4.faltan, 1); assert.equal(t4.canjes, 1);
});

test('cambiar la fecha de inicio recalcula y apagar el programa bloquea el canje', { skip: sinBase }, async () => {
  await ok(await A('/admin/lealtad/config', { desde: dia(50) }));
  const c = await ok(await A('/admin/lealtad/config'));
  assert.deepEqual([c.activo, c.cada, c.premio, c.desde], [true, 3, 'Corte gratis', dia(50)], 'lo que no se manda se conserva');
  const t5 = (await ok(await A('/admin/lealtad/clientes'))).clientes.find(x => x.tel === T5);
  assert.equal(t5.visitas, 2);
  await ok(await A('/admin/lealtad/config', { activo: false }));
  assert.deepEqual(await ok(await llama(slugA, '', `/lealtad?tel=${T4}`)), { activo: false });
  const apagado = await ok(await A('/admin/lealtad/clientes'));
  assert.ok(apagado.clientes.length > 0, 'el dueño sigue viendo el avance');
  assert.ok(apagado.clientes.every(c => c.wa === null), 'con el programa apagado no se sugiere mandar mensajes de un premio que no existe');
  for (const d of [1, 3]) await siembra(negA, T2, 'Pedro', dia(d));
  const r = await A('/admin/lealtad/canje', { telefono: T2 });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /activa el programa/);
  await ok(await A('/admin/lealtad/config', { activo: true }));
  await ok(await A('/admin/lealtad/canje', { telefono: T2 }));
});

test('cada barbería ve solo sus clientes y sus premios', { skip: sinBase }, async () => {
  await ok(await B('/admin/lealtad/config', { activo: true, cada: 5, premio: 'Barba gratis', desde: dia(20) }));
  const r = await ok(await B('/admin/lealtad/clientes'));
  assert.deepEqual(r.clientes.map(c => [c.tel, c.nombre, c.visitas, c.canjes]), [[T1, 'Cliente de B', 5, 0]], 'el canje de A no afecta a B');
  assert.ok(!JSON.stringify(r).includes('Juan') && !JSON.stringify(r).includes(T2));
  assert.deepEqual(await ok(await llama(slugB, '', `/lealtad?tel=${T4}`)), { activo: true, cada: 5, premio: 'Barba gratis', visitas: 0, faltan: 5 });
  assert.equal((await B('/admin/lealtad/canje', { telefono: T4 })).status, 400, 'las visitas de A no cuentan en B');
  assert.equal((await llama(slugB, cookieA, '/admin/lealtad/clientes')).status, 401, 'la sesión de A no sirve en B');
  assert.equal((await llama(slugB, cookieA, '/admin/lealtad/canje', { telefono: T1 })).status, 401);
  await ok(await B('/admin/lealtad/canje', { telefono: T1 }));
  const a = (await ok(await A('/admin/lealtad/clientes'))).clientes.find(x => x.tel === T1);
  assert.equal(a.canjes, 1, 'el canje de B no aparece en A');
});

test('sin configurar, la vista previa cuenta desde hoy (la fecha que tomará al activarse), no todo el historial', { skip: sinBase }, async () => {
  const C = ruta => llama(slugC, cookieC, ruta);
  for (const d of [40, 20, 10, 5, 2]) await siembra(negC, T1, 'Cliente de C', dia(d));
  await siembra(negC, T2, 'Hoy', HOY());
  const r = await ok(await C('/admin/lealtad/clientes'));
  assert.equal(r.config.desde, null);
  assert.deepEqual(r.clientes.map(c => [c.tel, c.visitas, c.listo, c.wa]), [[T2, 1, false, null]], 'el historial anterior no aparece como "premio listo"');
  assert.deepEqual(r.resumen, { clientes: 1, listos: 0, canjes: 0 });
  // Al activarlo sin fecha queda desde hoy: lo que se vio en la vista previa es lo que cuenta.
  await ok(await llama(slugC, cookieC, '/admin/lealtad/config', { activo: true, cada: 5, premio: 'Corte gratis' }));
  const a = await ok(await C('/admin/lealtad/clientes'));
  assert.deepEqual(a.clientes.map(c => [c.tel, c.visitas]), [[T2, 1]]);
  assert.ok(a.clientes[0].wa.startsWith('https://wa.me/52' + T2));
});

test('sin sesión 401, un barbero 403 y la consulta pública tiene límite', { skip: sinBase }, async () => {
  for (const [ruta, cuerpo] of [['/admin/lealtad/config'], ['/admin/lealtad/config', { cada: 5 }], ['/admin/lealtad/clientes'], ['/admin/lealtad/canje', { telefono: T1 }]]) {
    assert.equal((await llama(slugA, '', ruta, cuerpo)).status, 401, ruta);
  }
  const { temporal } = await ok(await A('/admin/equipo', { nombre: 'Barbero', email: `b-${slugA}@ejemplo.com`, rol: 'barbero', barbero: 'Barbero 1' }));
  const ent = await llama(slugA, '', '/cuenta/entrar', { email: `b-${slugA}@ejemplo.com`, password: temporal });
  assert.equal(ent.status, 200);
  const cb = ent.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  for (const [ruta, cuerpo] of [['/admin/lealtad/config'], ['/admin/lealtad/config', { activo: false }], ['/admin/lealtad/clientes'], ['/admin/lealtad/canje', { telefono: T4 }]]) {
    assert.equal((await llama(slugA, cb, ruta, cuerpo)).status, 403, ruta);
  }
  assert.equal((await ok(await A('/admin/lealtad/config'))).activo, true, 'el barbero no pudo apagarlo');
  const ip = { 'X-Forwarded-For': '10.77.9.9' };
  let ultimo;
  for (let k = 0; k < 31; k++) ultimo = await llama(slugA, '', `/lealtad?tel=${T1}`, undefined, ip);
  assert.equal(ultimo.status, 429);
  assert.equal((await llama(slugA, '', `/lealtad?tel=${T1}`, undefined, { 'X-Forwarded-For': '10.77.9.10' })).status, 200, 'otra IP sigue pudiendo');
});
