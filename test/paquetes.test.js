// Paquetes, extras y reservas con extras. El precio siempre lo calcula el servidor.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
let base, parar, cookie, slug;
const sufijo = Date.now().toString(36);
const json = async (r) => r.json();
const get = ruta => fetch(`${base}/api/${slug}${ruta}`, { headers: { Cookie: cookie || '' } });
const post = (ruta, cuerpo, c = cookie) => fetch(`${base}/api/${slug}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c || '' }, body: JSON.stringify(cuerpo) });
const manana = () => { const d = new Date(Date.now() + 864e5 * 2); return d.toLocaleDateString('en-CA'); };

before(async () => {
  if (sinBase) return;
  ({ base, parar } = await arranca());
  slug = 'pq-' + sufijo;
  cookie = await registra(base, slug);
});
after(() => { if (parar) parar(); });

test('Estilo Internacional trae sus 4 paquetes, 3 extras y 6 referencias sembrados', { skip: sinBase }, async () => {
  const r = await (await fetch(`${base}/api/estilo-internacional/paquetes`)).json();
  assert.deepEqual(r.paquetes.map(p => [p.nombre, p.precio, p.lavado]), [['Elige tu corte', 200, false], ['Corte Fresco', 280, true], ['Corte y barba', 350, false], ['VIP Diamante', 450, true]]);
  const vip = r.paquetes.find(p => p.nombre === 'VIP Diamante');
  assert.deepEqual(vip.incluye, ['Cualquier corte', 'Arreglo de barba', 'Lavado', 'Peinado', 'Toalla caliente']);
  assert.deepEqual(r.extras.map(e => [e.nombre, e.precio, e.lavado]), [['Cejas', 40, false], ['Lavado', 50, true], ['Masaje relajante de cuero cabelludo', 60, false]]);
  const est = await (await fetch(`${base}/api/estilo-internacional/estilos`)).json();
  assert.ok(est.every(e => e.tipo !== 'referencia'), 'las referencias no se pueden reservar');
  assert.equal(est[0].tipo, 'paquete', 'los paquetes salen primero en la agenda');
  const unico = new Set(est.map(e => e.nombre));
  assert.equal(unico.size, est.length, 'sin nombres repetidos');
});

test('una barbería nueva no recibe el catálogo de Estilo Internacional', { skip: sinBase }, async () => {
  const r = await json(await get('/paquetes'));
  assert.deepEqual(r, { paquetes: [], extras: [] });
});

test('el dueño crea, edita y borra paquetes y extras', { skip: sinBase }, async () => {
  assert.equal((await post('/admin/paquete', { nombre: 'Malo + trampa', precio: 100, incluye: 'Corte' })).status, 400, 'no admite el signo +');
  assert.equal((await post('/admin/paquete', { nombre: 'Sin precio', precio: -5, incluye: 'Corte' })).status, 400);
  const c = await post('/admin/paquete', { nombre: 'Doble', precio: 300, etiqueta: 'dos en uno', incluye: ['Corte', 'Barba'], lavado: true });
  assert.equal(c.status, 200);
  const { id } = await c.json();
  assert.equal((await post('/admin/paquete', { nombre: 'Doble', precio: 1, incluye: 'x' })).status, 409, 'nombre repetido');
  assert.equal((await post('/admin/paquete', { id, nombre: 'Doble', precio: 320, etiqueta: 'dos en uno', incluye: 'Corte\nBarba', lavado: true })).status, 200);
  const e = await (await post('/admin/extra', { nombre: 'Cejas', precio: 40 })).json();
  const l = await (await post('/admin/extra', { nombre: 'Lavado', precio: 50, lavado: true })).json();
  const r = await json(await get('/paquetes'));
  assert.equal(r.paquetes[0].precio, 320);
  assert.equal(r.paquetes[0].etiqueta, 'DOS EN UNO');
  assert.equal(r.extras.length, 2);
  assert.ok(e.id && l.id);
});

test('solo el dueño de la barbería puede editar su catálogo', { skip: sinBase }, async () => {
  assert.equal((await post('/admin/paquete', { nombre: 'Intruso', precio: 1, incluye: 'x' }, '')).status, 401);
  const otro = await registra(base, 'ot-' + sufijo);
  assert.equal((await post('/admin/extra/borrar', { id: 1 }, otro)).status, 401, 'la sesión de otra barbería no sirve aquí');
});

test('reservar con extras: el servidor calcula precio y nombre', { skip: sinBase }, async () => {
  const { paquetes, extras } = await json(await get('/paquetes'));
  const doble = paquetes.find(p => p.nombre === 'Doble'), cejas = extras.find(e => e.nombre === 'Cejas'), lavado = extras.find(e => e.nombre === 'Lavado');
  const reserva = (extrasIds, hora) => post('/citas', { cliente: 'Cliente', telefono: '9991234567', barbero: 'Barbero 1', servicio: 'Doble', fecha: manana(), hora, extras: extrasIds });
  const a = await reserva([cejas.id, lavado.id, 99999999], '11:00');
  assert.equal(a.status, 200);
  assert.equal(Number((await a.json()).precio), 360, '320 + cejas 40; el lavado ya viene incluido y el extra inexistente se ignora');
  const b = await reserva([], '12:00');
  assert.equal(Number((await b.json()).precio), 320);
  const dia = await json(await get(`/admin/citas?fecha=${manana()}`));
  assert.ok(dia.some(c => c.servicio === 'Doble + Cejas' && Number(c.precio) === 360), 'el barbero ve los extras en el nombre del servicio');
  const mala = await post('/citas', { cliente: 'Cliente', telefono: '9991234567', barbero: 'Barbero 1', servicio: 'Doble + Cejas', fecha: manana(), hora: '13:00' });
  assert.equal(mala.status, 400, 'no se puede inventar un servicio con el separador');
  assert.equal(doble.nombre, 'Doble');
});

test('las estadísticas agrupan por servicio base, sin fragmentar por extras', { skip: sinBase }, async () => {
  // Las estadísticas solo cuentan citas completadas de hoy hacia atrás, y la API no deja reservar en el pasado:
  // por eso se insertan directo en la base, tal como las dejaría el barbero al marcarlas como completadas.
  const { Pool } = require('pg'), pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const neg = (await pool.query('SELECT id FROM negocios WHERE slug=$1', [slug])).rows[0].id, hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
    for (const [serv, precio, hora] of [['Doble', 320, '09:00'], ['Doble + Cejas', 360, '10:00'], ['Doble + Cejas + Masaje', 420, '11:00']])
      await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'Cliente','9990000000','Barbero 1',$2,$3,$4,$5,'completada',$6)", [neg, serv, hoy, hora, precio, 'x' + hora + sufijo]);
    const ins = await json(await get('/admin/insights?dias=7'));
    assert.deepEqual(ins.servicios.map(x => [x.servicio, x.n, x.ingresos]), [['Doble', 3, 1100]], 'las tres citas cuentan como "Doble" y suman todos sus ingresos');
    const lista = await json(await get('/estilos'));
    assert.equal(lista.find(e => e.nombre === 'Doble').pop, 5, 'la popularidad agrupa por servicio base: 3 de hoy + las 2 reservas próximas de la prueba anterior');
  } finally { await pool.end(); }
});
