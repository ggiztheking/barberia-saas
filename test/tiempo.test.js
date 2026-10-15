// Agenda llena: huecos con la misma regla que la agenda del cliente, patrón histórico,
// promo relámpago e inasistencias. Los datos se siembran directo en la base (citas pasadas, bloqueos, envíos del CRM).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
let srv, pool, cookie, cookieOtro, slug, slugOtro, neg;
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const ahoraH = () => +new Date().toLocaleString('en-US', { timeZone: 'America/Merida', hour: '2-digit', hourCycle: 'h23' });
const mas = (f, k) => { const x = new Date(f + 'T12:00'); x.setDate(x.getDate() + k); return x.toLocaleDateString('en-CA'); };
const dow = f => new Date(f + 'T12:00').getDay();
const HORAS = Array.from({ length: 10 }, (_, k) => String(10 + k).padStart(2, '0') + ':00');
const get = (ruta, c = cookie, s = slug) => fetch(`${srv.base}/api/${s}${ruta}`, { headers: { Cookie: c || '' } });
const post = (ruta, cuerpo, c = cookie, s = slug) => fetch(`${srv.base}/api/${s}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c || '' }, body: JSON.stringify(cuerpo) });
let hoy, D1, D2, D3, idRecordado;

before(async () => {
  if (sinBase) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  srv = await arranca({ PUBLIC_URL: 'https://agenda.ejemplo.mx/' });
  slug = 'tq-' + sufijo; slugOtro = 'tr-' + sufijo;
  cookie = await registra(srv.base, slug);
  cookieOtro = await registra(srv.base, slugOtro);
  hoy = HOY(); D1 = mas(hoy, 1); D2 = mas(hoy, 2); D3 = mas(hoy, 3);
  neg = (await pool.query("UPDATE negocios SET barberos='Ana,Beto',hora_ini=10,hora_fin=19,cierra=$2 WHERE slug=$1 RETURNING id", [slug, String(dow(D3))])).rows[0].id;
  const cita = (f, b, h, estado, tel = '9990001111', cliente = 'Cliente') => pool.query(
    'INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,$2,$3,$4,$5,$6,$7,200,$8,$9) RETURNING id',
    [neg, cliente, tel, b, 'Corte', f, h, estado, 't' + Math.random().toString(36).slice(2, 12)]).then(r => r.rows[0].id);
  // Mañana (D1): 11:00 lleno con los dos; 12:00 solo Ana; 13:00 cancelada (libre); 14:00 Ana ocupada y Beto en descanso.
  await cita(D1, 'Ana', '11:00', 'pendiente', '9990001111', 'Faltista Uno');
  idRecordado = await cita(D1, 'Beto', '11:00', 'pendiente', '9990002222', 'Cumplido');
  await cita(D1, 'Ana', '12:00', 'pendiente', '9990003333', 'Otro');
  await cita(D1, 'Beto', '13:00', 'cancelada', '9990004444');
  await cita(D1, 'Ana', '14:00', 'pendiente', '', 'Sin teléfono');
  await cita(D1, 'Ana', '09:00', 'pendiente', '9990005555'); // fuera de horario: no cuenta
  await pool.query("INSERT INTO bloqueos(negocio_id,barbero,fecha,hora,motivo) VALUES($1,'Beto',$2,'14:00','Comida'),($1,'Ana',$3,NULL,'Día libre')", [neg, D1, D2]);
  // Historial para el patrón (hace 7 días, mismo día de la semana que hoy).
  const P1 = mas(hoy, -7);
  await cita(P1, 'Ana', '10:00', 'completada', '9990006666');
  await cita(P1, 'Beto', '10:00', 'no_llego', '9990007777');
  await cita(P1, 'Ana', '11:00', 'completada', '9990006666');
  await cita(P1, 'Ana', '12:00', 'pendiente', '9990006666'); // sin cerrar: no cuenta como ocupación
  await cita(P1, 'Beto', '13:00', 'cancelada', '9990006666');
  // Inasistencias: el faltista tiene 2 en 90 días (fuera de la ventana de 8 semanas del patrón); otro tiene una vieja de hace 100 días.
  await cita(mas(hoy, -60), 'Ana', '15:00', 'no_llego', '9990001111', 'Faltista Uno');
  await cita(mas(hoy, -70), 'Ana', '15:00', 'no_llego', '999 000 1111', 'Faltista Uno');
  await cita(mas(hoy, -80), 'Beto', '15:00', 'no_llego', '9990008888', 'Una sola falta');
  await cita(mas(hoy, -85), 'Beto', '16:00', 'no_llego', '9990009999', 'Falta vieja');
  await cita(mas(hoy, -100), 'Beto', '16:00', 'no_llego', '9990009999', 'Falta vieja');
  // El CRM ya mandó el recordatorio de una de las citas de mañana.
  await pool.query("INSERT INTO crm_envios(negocio_id,telefono,tipo,ref,canal) VALUES($1,'9990002222','recordatorio',$2,'manual')", [neg, 'cita:' + idRecordado]);
});
after(async () => { if (srv) srv.parar(); if (pool) await pool.end(); });

test('sin sesión, con sesión de otra barbería o como barbero: no hay acceso', { skip: sinBase }, async () => {
  for (const r of ['/admin/tiempo/huecos', '/admin/tiempo/patron', '/admin/tiempo/inasistencias']) {
    assert.equal((await get(r, '')).status, 401, r);
    assert.equal((await get(r, cookieOtro)).status, 401, 'la sesión de otra barbería no sirve aquí: ' + r);
  }
  assert.equal((await post('/admin/tiempo/relampago', { fecha: D1, horas: ['12:00'] }, '')).status, 401);
  const t = await (await post('/admin/equipo', { nombre: 'Ana', email: `ana-${sufijo}@ejemplo.com`, rol: 'barbero', barbero: 'Ana' })).json();
  const e = await post('/cuenta/entrar', { email: `ana-${sufijo}@ejemplo.com`, password: t.temporal }, '');
  const cb = e.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await get('/admin/tiempo/huecos', cb)).status, 403, 'un barbero no ve la optimización del negocio');
});

test('huecos respetan horario, día cerrado, bloqueos y citas', { skip: sinBase }, async () => {
  const r = await get('/admin/tiempo/huecos?dias=7');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.dias.length, 7);
  assert.equal(j.barberos, 2);
  assert.equal(j.abierto, true);
  const d1 = j.dias.find(x => x.fecha === D1), d2 = j.dias.find(x => x.fecha === D2), d3 = j.dias.find(x => x.fecha === D3);
  const h = (d, hora) => d.huecos.find(x => x.hora === hora);
  assert.equal(h(d1, '11:00'), undefined, '11:00 está llena con los dos barberos');
  assert.deepEqual(h(d1, '12:00').barberos, ['Beto']);
  assert.equal(h(d1, '13:00').libres, 2, 'la cita cancelada no ocupa');
  assert.equal(h(d1, '14:00'), undefined, 'Ana ocupada y Beto en descanso');
  assert.equal(h(d1, '09:00'), undefined, 'fuera del horario no hay huecos');
  assert.deepEqual(d1.huecos.map(x => x.hora), HORAS.filter(x => !['11:00', '14:00'].includes(x)));
  assert.equal(d1.capacidad, 19, '10 horas × 2 barberos menos el descanso de Beto');
  assert.equal(d1.ocupadas, 4);
  assert.equal(d1.ocupacion, 21);
  assert.equal(d1.libres, 15);
  assert.ok(d2.huecos.every(x => x.libres === 1 && x.barberos[0] === 'Beto'), 'Ana tiene el día bloqueado');
  assert.equal(d2.capacidad, 10);
  assert.equal(d2.ocupacion, 0);
  assert.equal(d3.cerrado, true);
  assert.deepEqual(d3.huecos, []);
  assert.equal(d3.ocupacion, null);
  assert.equal((await (await get('/admin/tiempo/huecos?dias=99')).json()).dias.length, 14, 'máximo 14 días');
});

test('las horas pasadas de hoy no aparecen como huecos', { skip: sinBase }, async () => {
  const j = await (await get('/admin/tiempo/huecos?dias=1')).json(), ya = ahoraH();
  assert.equal(j.dias[0].fecha, hoy);
  assert.ok(j.dias[0].huecos.every(x => +x.hora.slice(0, 2) > ya), 'solo horas posteriores a la actual');
  if (dow(hoy) !== dow(D3)) assert.equal(j.dias[0].huecos.length, HORAS.filter(x => +x.slice(0, 2) > ya).length);
});

test('lo que se muestra libre es exactamente lo que el cliente puede reservar', { skip: sinBase }, async () => {
  const j = await (await get('/admin/tiempo/huecos?dias=7')).json();
  for (const d of j.dias.slice(1)) {
    const llenas = await (await fetch(`${srv.base}/api/${slug}/horarios?fecha=${d.fecha}&barbero=cualquiera`)).json();
    assert.deepEqual(d.huecos.map(x => x.hora), HORAS.filter(x => !llenas.includes(x)), d.fecha);
  }
});

test('patrón histórico por día de la semana y hora, con inasistencia', { skip: sinBase }, async () => {
  const r = await get('/admin/tiempo/patron?semanas=8');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.semanas, 8);
  assert.deepEqual(j.horas, HORAS);
  assert.equal(j.dias.length, 7);
  assert.equal(j.dias[0].dia, 'lunes', 'la semana empieza en lunes');
  const fila = j.dias.find(x => x.dow === dow(hoy)), c10 = fila.horas.find(x => x.hora === '10:00');
  assert.equal(c10.cap, 16, '2 barberos × 8 semanas');
  assert.equal(c10.citas, 2);
  assert.equal(c10.faltas, 1);
  assert.equal(c10.ocupacion, 13);
  assert.equal(fila.citas, 3, 'completadas + no llegó; pendientes y canceladas no cuentan');
  assert.equal(fila.inasistencia, 33);
  assert.equal(j.citas, 3);
  assert.equal(j.faltas, 1);
  assert.equal(j.inasistencia, 33);
  assert.equal(j.sinCerrar, 1, 'avisa de citas pasadas que nadie marcó');
  const cerr = j.dias.find(x => x.dow === dow(D3));
  assert.equal(cerr.cerrado, true);
  assert.equal(cerr.ocupacion, null);
  assert.ok(j.muertas.length > 0 && j.muertas.every(x => x.ocupacion < 25));
});

test('promo relámpago: texto con enlace público y horas libres', { skip: sinBase }, async () => {
  const r = await post('/admin/tiempo/relampago', { fecha: D1, horas: ['13:00', '12:00'], descuento: 20 });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.enlace, `https://agenda.ejemplo.mx/${slug}/agenda?fecha=${D1}`, 'usa PUBLIC_URL sin doble diagonal y abre la agenda en el día de la promo');
  assert.deepEqual(j.horas, [{ hora: '12:00', libres: 1 }, { hora: '13:00', libres: 2 }]);
  assert.equal(j.lugares, 3);
  assert.ok(j.texto.includes('20 %') && j.texto.includes('mañana') && j.texto.includes(j.enlace), j.texto);
  assert.ok(j.texto.includes('12:00 p. m. y 1:00 p. m.'), j.texto);
  assert.ok(!j.texto.includes('m..'), 'sin puntos dobles');
  assert.ok(j.textoCampana.startsWith('¡Hola! ') && !j.textoCampana.includes('{nombre}'), 'sin {nombre}: si el CRM no tiene el nombre quedaría "Hola ."');
  assert.ok(j.compartir.startsWith('https://wa.me/?text='));
  // "Mandar como campaña" usa el endpoint existente del CRM.
  const c = await post('/crm/campana', { titulo: j.titulo, texto: j.textoCampana, segmento: 'todos' });
  assert.equal(c.status, 200);
  assert.ok((await c.json()).total >= 1);
});

test('promo relámpago rechaza horas ocupadas, fechas pasadas y datos inválidos', { skip: sinBase }, async () => {
  const ocup = await post('/admin/tiempo/relampago', { fecha: D1, horas: ['11:00', '12:00'], descuento: 10 });
  assert.equal(ocup.status, 409);
  assert.deepEqual((await ocup.json()).ocupadas, ['11:00']);
  assert.equal((await post('/admin/tiempo/relampago', { fecha: D1, horas: ['14:00'], descuento: 10 })).status, 409, 'bloqueo + cita');
  assert.equal((await post('/admin/tiempo/relampago', { fecha: mas(hoy, -1), horas: ['12:00'], descuento: 10 })).status, 400, 'fecha pasada');
  assert.equal((await post('/admin/tiempo/relampago', { fecha: D3, horas: ['12:00'], descuento: 10 })).status, 409, 'día cerrado');
  assert.equal((await post('/admin/tiempo/relampago', { fecha: D1, horas: ['08:00'], descuento: 10 })).status, 400, 'fuera de horario');
  assert.equal((await post('/admin/tiempo/relampago', { fecha: D1, horas: [], descuento: 10 })).status, 400);
  assert.equal((await post('/admin/tiempo/relampago', { fecha: D1, horas: ['12:00'], descuento: 95 })).status, 400);
  assert.equal((await post('/admin/tiempo/relampago', { fecha: 'mañana', horas: ['12:00'] })).status, 400);
  if (ahoraH() >= 10 && dow(hoy) !== dow(D3)) assert.equal((await post('/admin/tiempo/relampago', { fecha: hoy, horas: ['10:00'] })).status, 400, 'hora de hoy que ya pasó');
  const sin = await post('/admin/tiempo/relampago', { fecha: D2, horas: ['12:00'], descuento: 0 });
  assert.equal(sin.status, 200);
  assert.ok((await sin.json()).texto.includes('lugares libres'), 'sin descuento también arma el texto');
});

test('inasistencias: clientes con 2 o más faltas y recordatorios de mañana', { skip: sinBase }, async () => {
  const j = await (await get('/admin/tiempo/inasistencias')).json();
  assert.deepEqual(j.clientes.map(c => [c.tel, c.faltas]), [['9990001111', 2]], 'solo cuenta faltas de los últimos 90 días y une teléfonos con espacios');
  assert.equal(j.clientes[0].proxima, D1);
  assert.equal(j.crm, `/${slug}/crm`);
  assert.equal(j.manana.fecha, D1);
  assert.equal(j.manana.total, 5, 'incluye la cita fuera de horario, que también es real');
  assert.equal(j.manana.conTelefono, 4);
  assert.equal(j.manana.enviados, 1, 'el CRM ya registró un recordatorio');
  assert.equal(j.manana.sinEnviar, 3);
  assert.deepEqual(j.manana.riesgo.map(c => c.cliente), ['Faltista Uno']);
});

test('inasistencias: cita sin teléfono (NULL) y cliente que no quiere avisos', { skip: sinBase }, async () => {
  // Antes una cita con telefono NULL tiraba el endpoint (500) y quien pidió no recibir avisos contaba como "sin enviar".
  await pool.query("INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'Sin dato',NULL,'Beto','Corte',$2,'16:00',200,'pendiente',$3)", [neg, D1, 'n' + sufijo]);
  await pool.query("INSERT INTO crm_clientes(negocio_id,telefono,nombre,avisos) VALUES($1,'9990003333','Otro',false) ON CONFLICT (negocio_id,telefono) DO UPDATE SET avisos=false", [neg]);
  const r = await get('/admin/tiempo/inasistencias');
  assert.equal(r.status, 200);
  const m = (await r.json()).manana;
  assert.equal(m.total, 6);
  assert.equal(m.conTelefono, 4);
  assert.equal(m.sinAvisos, 1, 'el CRM nunca le manda recordatorio');
  assert.equal(m.sinEnviar, 2, 'coincide con lo que muestra la bandeja del CRM');
  const b = await (await get('/crm/bandeja')).json();
  assert.equal(b.items.filter(x => x.tipo === 'recordatorio').length, m.sinEnviar);
});

test('promo relámpago rechaza fechas que no existen sin error del servidor', { skip: sinBase }, async () => {
  // JS convierte 2026-11-31 en 1 de diciembre y PostgreSQL la rechaza: dentro de la ventana de 30 días daba 500.
  // Se revisa el mensaje para que la prueba no dependa del día en que corre.
  const fechas = [hoy.slice(0, 8) + '31', ...[1, 2].map(k => { const x = new Date(hoy + 'T12:00'); x.setDate(1); x.setMonth(x.getMonth() + k); return x.toLocaleDateString('en-CA').slice(0, 8) + '31'; }), hoy.slice(0, 5) + '02-30']
    .filter(f => isNaN(new Date(f + 'T12:00')) || new Date(f + 'T12:00').toLocaleDateString('en-CA') !== f);
  assert.ok(fechas.length >= 2);
  for (const fecha of fechas) {
    const r = await post('/admin/tiempo/relampago', { fecha, horas: ['12:00'], descuento: 10 });
    assert.equal(r.status, 400, fecha);
    assert.equal((await r.json()).error, 'Elige una fecha válida', fecha);
  }
});

test('cada barbería ve solo sus datos', { skip: sinBase }, async () => {
  const j = await (await get('/admin/tiempo/huecos?dias=2', cookieOtro, slugOtro)).json();
  const d1 = j.dias.find(x => x.fecha === D1);
  assert.equal(j.barberos, 1);
  assert.equal(d1.ocupadas, 0);
  assert.ok(d1.huecos.some(x => x.hora === '11:00'));
  const i = await (await get('/admin/tiempo/inasistencias', cookieOtro, slugOtro)).json();
  assert.deepEqual(i.clientes, []);
  assert.equal(i.manana.total, 0);
  const p = await (await get('/admin/tiempo/patron', cookieOtro, slugOtro)).json();
  assert.equal(p.citas, 0);
});
