// Agenda con citas cada 30 minutos: negocios.intervalo (60 por defecto o 30) y abre_min (0 o 30, p. ej. abrir 9:30).
// Con intervalo 60 y sin minutos de apertura todo queda igual que antes (horas completas).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
let srv, pool, s60, s30, c60, c30, cBarbero;
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const mas = (f, k) => { const x = new Date(f + 'T12:00'); x.setDate(x.getDate() + k); return x.toLocaleDateString('en-CA'); };
const ahoraM = () => { const [h, m] = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Merida', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':'); return (+h % 24) * 60 + +m; };
const aMin = h => +h.slice(0, 2) * 60 + +h.slice(3, 5);
// Cada reserva sale de una IP distinta: POST /citas admite 10 por hora por IP.
let ipN = 0;
const ip = () => `10.77.${Math.floor(++ipN / 250)}.${ipN % 250 + 1}`;
const get = (s, ruta, c = '') => fetch(`${srv.base}/api/${s}${ruta}`, { headers: { Cookie: c } });
const post = (s, ruta, cuerpo, c = '') => fetch(`${srv.base}/api/${s}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c, 'X-Forwarded-For': ip() }, body: JSON.stringify(cuerpo) });
const json = async r => r.json();
const reserva = (s, fecha, hora, barbero = 'Ana') => post(s, '/citas', { cliente: 'Cliente', telefono: '9991234567', barbero, servicio: 'Mid fade', fecha, hora });
const ocupadas = (s, fecha, barbero = 'Ana') => get(s, `/horarios?fecha=${fecha}&barbero=${encodeURIComponent(barbero)}`).then(json);
let hoy, D1, D2, D3;

before(async () => {
  if (sinBase) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  srv = await arranca();
  s60 = 'ag60-' + sufijo; s30 = 'ag30-' + sufijo;
  c60 = await registra(srv.base, s60, '10.66.0.1');
  c30 = await registra(srv.base, s30, '10.66.0.2');
  hoy = HOY(); D1 = mas(hoy, 1); D2 = mas(hoy, 2); D3 = mas(hoy, 3);
  await pool.query("UPDATE negocios SET barberos='Ana,Beto',hora_ini=10,hora_fin=19,cierra='' WHERE slug=$1", [s60]);
  await pool.query("UPDATE negocios SET barberos='Ana,Beto',hora_ini=9,hora_fin=19,cierra='' WHERE slug=$1", [s30]);
  // Una cuenta de barbero (Beto) en la barbería de 30 min, para comprobar que no puede cambiar la configuración.
  const eq = await json(await post(s30, '/admin/equipo', { nombre: 'Beto', email: `beto-${sufijo}@ejemplo.com`, rol: 'barbero', barbero: 'Beto' }, c30));
  const r = await post(s30, '/cuenta/entrar', { email: `beto-${sufijo}@ejemplo.com`, password: eq.temporal });
  assert.equal(r.status, 200);
  cBarbero = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});
after(async () => { if (srv) srv.parar(); if (pool) await pool.end(); });

test('intervalo 60 por defecto: horas completas como siempre', { skip: sinBase }, async () => {
  const i = await json(await get(s60, '/info'));
  assert.equal(i.intervalo, 60);
  assert.equal(i.abre_min, 0);
  assert.deepEqual(i.horas, Array.from({ length: 10 }, (_, k) => String(10 + k).padStart(2, '0') + ':00'));
  assert.equal(i.termina, '20:00');
  assert.equal(i.hora_ini, 10, 'los campos de antes siguen ahí');
  assert.deepEqual(await ocupadas(s60, D1), []);
  assert.equal((await reserva(s60, D1, '10:30')).status, 400, 'con citas cada hora no hay 10:30');
  assert.equal((await reserva(s60, D1, '09:00')).status, 400, 'antes de abrir');
  assert.equal((await reserva(s60, D1, '20:00')).status, 400, 'después de la última cita');
  const ok = await reserva(s60, D1, '10:00');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ocupadas(s60, D1), ['10:00']);
  assert.equal((await reserva(s60, D1, '10:00')).status, 409, 'la misma hora ya está ocupada');
  const cual = await json(await reserva(s60, D1, '10:00', 'cualquiera'));
  assert.equal(cual.barbero, 'Beto', '"cualquiera" toma al barbero libre');
  assert.deepEqual(await ocupadas(s60, D1, 'cualquiera'), ['10:00']);
  const ac = await json(await get(s60, '/admin/ajustes', c60));
  assert.equal(ac.intervalo, 60);
  assert.equal(ac.horas.length, 10);
});

test('patrón: un "no llegó" no se pierde si alguien más cae en el mismo espacio', { skip: sinBase }, async () => {
  const neg = (await pool.query('SELECT id FROM negocios WHERE slug=$1', [s60])).rows[0].id, f = mas(hoy, -3);
  // Primero el que no llegó (10:00) y luego un cliente sin cita registrado a las 10:20: los dos caen en el espacio de las 10:00.
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'Falta','9990000003','Ana','Corte',$2,'10:00',200,'no_llego',$3)", [neg, f, 'p1' + sufijo]);
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'Llegó','9990000004','Ana','Corte',$2,'10:20',200,'completada',$3)", [neg, f, 'p2' + sufijo]);
  const pat = await json(await get(s60, '/admin/tiempo/patron?semanas=1', c60));
  const celda = pat.dias.find(r => r.dow === new Date(f + 'T12:00').getDay()).horas.find(x => x.hora === '10:00');
  assert.equal(celda.citas, 1);
  assert.equal(celda.faltas, 1, 'la inasistencia de las 10:00 sigue contando');
});

test('la configuración es solo del dueño y valida los valores', { skip: sinBase }, async () => {
  assert.equal((await post(s30, '/admin/agenda/config', { intervalo: 30 })).status, 401, 'sin sesión');
  assert.equal((await post(s30, '/admin/agenda/config', { intervalo: 30 }, cBarbero)).status, 403, 'un barbero no puede');
  assert.equal((await get(s30, '/admin/agenda/config', cBarbero)).status, 403);
  assert.equal((await post(s30, '/admin/agenda/config', { intervalo: 30 }, c60)).status, 401, 'la sesión de otra barbería no sirve aquí');
  for (const malo of [{ intervalo: 45 }, { intervalo: 15 }, { intervalo: '30 min' }, { abre_min: 15 }, { abre_min: 60 }, { intervalo: 30, abre_min: -30 }, { intervalo: null }]) {
    const r = await post(s30, '/admin/agenda/config', malo, c30);
    assert.equal(r.status, 400, JSON.stringify(malo));
    assert.match((await json(r)).error, /cada hora o cada 30 minutos/);
  }
  const cfg = await json(await get(s30, '/admin/agenda/config', c30));
  assert.equal(cfg.intervalo, 60, 'nada cambió con los valores malos');
  assert.equal(cfg.abre_min, 0);
});

test('intervalo 30: espacios cada media hora de 9:00 a 19:30', { skip: sinBase }, async () => {
  const r = await post(s30, '/admin/agenda/config', { intervalo: 30, abre_min: 0 }, c30);
  assert.equal(r.status, 200);
  const j = await json(r);
  assert.equal(j.intervalo, 30);
  assert.equal(j.horas.length, 22);
  assert.deepEqual(j.horas.slice(0, 4), ['09:00', '09:30', '10:00', '10:30']);
  assert.equal(j.horas.at(-1), '19:30', 'la última cita sigue siendo dentro de la hora 19');
  assert.equal(j.termina, '20:00');
  assert.deepEqual((await json(await get(s30, '/info'))).horas, j.horas, 'la agenda del cliente recibe los mismos espacios');
  assert.equal((await reserva(s30, D1, '09:30')).status, 200);
  assert.equal((await reserva(s30, D1, '19:30')).status, 200);
  assert.deepEqual(await ocupadas(s30, D1), ['09:30', '19:30']);
});

test('abrir a la media hora: Estilo Internacional puede ofrecer 9:30', { skip: sinBase }, async () => {
  let j = await json(await post(s30, '/admin/agenda/config', { intervalo: 60, abre_min: 30 }, c30));
  assert.deepEqual(j.horas, ['09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30', '17:30', '18:30', '19:30']);
  assert.equal(j.termina, '20:30');
  assert.equal((await reserva(s30, D2, '10:00')).status, 400, 'cada hora a la media: 10:00 no es un horario');
  j = await json(await post(s30, '/admin/agenda/config', { intervalo: 30, abre_min: 30 }, c30));
  assert.equal(j.horas[0], '09:30');
  assert.equal(j.horas[1], '10:00');
  assert.equal(j.horas.at(-1), '19:30');
  assert.equal(j.horas.length, 21);
  assert.equal((await reserva(s30, D2, '09:00')).status, 400, 'antes de abrir a las 9:30');
  assert.equal((await reserva(s30, D2, '09:30')).status, 200);
  const p = await json(await get(s30, '/proximo?barbero=Ana'));
  assert.ok(p.length > 0 && p.every(x => j.horas.includes(x.hora)), 'lo antes posible usa los mismos espacios');
});

test('no se puede reservar una media hora ocupada, fuera de horario ni pasada', { skip: sinBase }, async () => {
  assert.equal((await reserva(s30, D2, '09:30')).status, 409, 'la media hora ya tiene cita');
  assert.equal((await reserva(s30, D2, '10:00')).status, 200, 'la media hora siguiente sí está libre');
  for (const h of ['08:30', '20:00', '09:15', '9:30', '10:45', '24:00', 'x'])
    assert.equal((await reserva(s30, D2, h)).status, 400, h);
  assert.equal((await post(s30, '/citas', { cliente: 'C', telefono: '9991234567', barbero: 'Ana', servicio: 'Mid fade', fecha: D2, hora: 930 })).status, 400, 'la hora debe ser texto');
  const ayer = await reserva(s30, mas(hoy, -1), '10:00');
  assert.equal(ayer.status, 400);
  assert.match((await json(ayer)).error, /ya pasó/);
  const H = (await json(await get(s30, '/info'))).horas, ya = ahoraM(), pasada = H.filter(h => aMin(h) <= ya).at(-1), libre = H.find(h => aMin(h) > ya);
  if (pasada) assert.equal((await reserva(s30, hoy, pasada, 'Beto')).status, 400, 'un espacio de hoy que ya empezó');
  if (libre && aMin(libre) - ya > 2) assert.equal((await reserva(s30, hoy, libre, 'Beto')).status, 200, 'el siguiente espacio de hoy sí se puede');
});

test('bloqueo por hora: tapa solo ese espacio de media hora', { skip: sinBase }, async () => {
  assert.equal((await post(s30, '/admin/bloqueo', { barbero: 'Ana', fecha: D3, hora: '12:30', motivo: 'Comida' }, c30)).status, 200);
  assert.deepEqual(await ocupadas(s30, D3), ['12:30']);
  assert.equal((await reserva(s30, D3, '12:30')).status, 409);
  assert.equal((await reserva(s30, D3, '12:00')).status, 200);
  assert.equal((await reserva(s30, D3, '13:00')).status, 200);
  assert.equal((await reserva(s30, D3, '12:30', 'Beto')).status, 200, 'el otro barbero sí trabaja a esa hora');
  assert.equal((await reserva(s30, D3, '14:00', 'cualquiera')).status, 200);
  assert.equal((await post(s30, '/admin/bloqueo', { barbero: 'Beto', fecha: D3, hora: '', motivo: 'Día libre' }, c30)).status, 200);
  assert.equal((await ocupadas(s30, D3, 'Beto')).length, 21, 'bloqueo de todo el día');
});

test('una cita a otra hora ocupa el espacio que la contiene; las de antes siguen valiendo', { skip: sinBase }, async () => {
  const neg = (await pool.query('SELECT id FROM negocios WHERE slug=$1', [s30])).rows[0].id, D4 = mas(hoy, 4);
  // Cita registrada a mano "ahora" (11:10) y una vieja de cuando la agenda era por hora (15:00).
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'A','9990000001','Ana','Corte',$2,'11:10',200,'pendiente',$3),($1,'B','9990000002','Ana','Corte',$2,'15:00',200,'pendiente',$4)", [neg, D4, 'a1' + sufijo, 'a2' + sufijo]);
  assert.deepEqual(await ocupadas(s30, D4), ['11:00', '15:00']);
  assert.equal((await reserva(s30, D4, '11:00')).status, 409, '11:10 cae en el espacio de las 11:00');
  assert.equal((await reserva(s30, D4, '11:30')).status, 200);
  assert.equal((await reserva(s30, D4, '15:00')).status, 409);
  // Panel: cita a mano en media hora y choque dentro del mismo espacio.
  const nueva = (hora, atendida, barbero = 'Ana') => post(s30, '/admin/cita', { cliente: 'Walk-in', telefono: '', barbero, servicio: 'Mid fade', fecha: D4, hora, atendida }, c30);
  assert.equal((await nueva('16:30')).status, 200);
  assert.equal((await nueva('16:30')).status, 409, 'misma media hora');
  assert.equal((await nueva('16:40')).status, 409, '16:40 cae en el espacio de 16:30');
  assert.equal((await nueva('16:45', true)).status, 200, 'registrar a alguien ya atendido no se frena');
  assert.equal((await nueva('17:00')).status, 200);
  const dia = await json(await get(s30, `/admin/citas?fecha=${D4}`, c30));
  assert.deepEqual(dia.filter(c => c.barbero === 'Ana').map(c => c.hora), ['11:10', '11:30', '15:00', '16:30', '16:45', '17:00']);
  // Si el dueño vuelve a citas cada hora, la cita de las 15:00 sigue en su lugar.
  await post(s30, '/admin/agenda/config', { intervalo: 60, abre_min: 0 }, c30);
  assert.ok((await ocupadas(s30, D4)).includes('15:00'));
  await post(s30, '/admin/agenda/config', { intervalo: 30, abre_min: 30 }, c30);
});

test('reprogramar a una media hora', { skip: sinBase }, async () => {
  const D5 = mas(hoy, 5), r = await json(await reserva(s30, D5, '10:30'));
  assert.equal((await post(s30, '/reprogramar', { codigo: r.codigo, fecha: D5, hora: '10:45' })).status, 400);
  assert.equal((await post(s30, '/reprogramar', { codigo: r.codigo, fecha: D5, hora: '13:30' })).status, 200);
  assert.deepEqual(await ocupadas(s30, D5), ['13:30']);
});

test('Agenda llena usa los mismos espacios de media hora', { skip: sinBase }, async () => {
  const j = await json(await get(s30, '/admin/tiempo/huecos?dias=5', c30)), H = (await json(await get(s30, '/info'))).horas;
  assert.equal(j.horario.ini, '09:30');
  assert.equal(j.horario.fin, '19:30');
  for (const d of j.dias.slice(1)) {
    const llenas = await ocupadas(s30, d.fecha, 'cualquiera');
    assert.deepEqual(d.huecos.map(x => x.hora), H.filter(x => !llenas.includes(x)), d.fecha);
  }
  const ya = ahoraM();
  assert.ok(j.dias[0].huecos.every(x => aMin(x.hora) > ya), 'hoy solo espacios que aún no empiezan');
  const d4 = j.dias.find(x => x.fecha === mas(hoy, 4)), h = k => d4.huecos.find(x => x.hora === k);
  assert.deepEqual(h('11:00').barberos, ['Beto'], 'la cita de las 11:10 ocupa a Ana a las 11:00');
  const pat = await json(await get(s30, '/admin/tiempo/patron?semanas=2', c30));
  assert.deepEqual(pat.horas, H);
  const ok = await post(s30, '/admin/tiempo/relampago', { fecha: D1, horas: ['10:30', '11:00'], descuento: 10 }, c30);
  assert.equal(ok.status, 200);
  assert.match((await json(ok)).texto, /10:30 a\. m\./);
  assert.equal((await post(s30, '/admin/tiempo/relampago', { fecha: D1, horas: ['10:15'] }, c30)).status, 400, 'fuera de los espacios');
  const pas = H.filter(x => aMin(x) <= ya).at(-1);
  if (pas) assert.equal((await post(s30, '/admin/tiempo/relampago', { fecha: hoy, horas: [pas] }, c30)).status, 400, 'media hora de hoy que ya pasó');
});
