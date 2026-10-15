// Contabilidad: estado de resultados con datos sembrados, comparativo, punto de equilibrio, ISR de RESICO,
// CSV para el contador y aislamiento entre barberías.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca, registra } = require('./helpers');
const { isrResico, util } = require('../contabilidad');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
let base, parar, cookie, slug, cookieOtra, slugOtra;
const get = (ruta, c = cookie, s = slug) => fetch(`${base}/api/${s}${ruta}`, { headers: { Cookie: c || '' } });
const post = (ruta, cuerpo) => fetch(`${base}/api/${slug}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(cuerpo) });
const ok = async r => { assert.equal(r.status, 200, await r.clone().text()); return r.json(); };

before(async () => {
  if (sinBase) return;
  ({ base, parar } = await arranca());
  slug = 'ct-' + sufijo; slugOtra = 'cx-' + sufijo;
  cookie = await registra(base, slug);
  cookieOtra = await registra(base, slugOtra);
  // Las citas completadas del pasado no se pueden crear por la API: se insertan directo, como en paquetes.test.js.
  const { Pool } = require('pg'), pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const neg = (await pool.query("UPDATE negocios SET barberos='Ana,Beto', cierra='0,1' WHERE slug=$1 RETURNING id", [slug])).rows[0].id;
    const cita = (barbero, fecha, hora, precio, estado = 'completada') => pool.query(
      "INSERT INTO citas(negocio_id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado,codigo) VALUES($1,'Cliente','9990000000',$2,'Corte',$3,$4,$5,$6,$7)",
      [neg, barbero, fecha, hora, precio, estado, 'c' + fecha + hora + barbero + sufijo]);
    for (const [b, f, h, p, e] of [
      ['Ana', '2025-03-03', '10:00', 250], ['Ana', '2025-03-15', '11:00', 250], ['Ana', '2025-03-31', '18:00', 300],
      ['Beto', '2025-03-01', '10:00', 200], ['Beto', '2025-03-20', '12:00', 200.5],
      ['Beto', '2025-03-21', '12:00', 999, 'pendiente'], ['Ana', '2025-03-22', '12:00', 500, 'cancelada'], ['Ana', '2025-03-23', '12:00', 700, 'no_llego'],
      ['Ana', '2025-04-01', '10:00', 1000], // ya es abril: no cuenta en marzo
      ['Ana', '2025-02-28', '19:00', 400]]) // último día de febrero: cuenta en el mes anterior
      await cita(b, f, h, p, e);
    // Una cita completada hoy para la proyección del mes en curso
    await cita('Ana', new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' }), '09:00', 300);
  } finally { await pool.end(); }
  // Comisiones, gastos fijos y movimientos por la API de Finanzas
  await ok(await post('/admin/comision', { barbero: 'Ana', comision: 40 }));
  await ok(await post('/admin/comision', { barbero: 'Beto', comision: 50 }));
  await ok(await post('/admin/fijo', { concepto: 'Renta del local', monto: 3000, dia: 1, categoria: 'Renta' }));
  await ok(await post('/admin/fijo', { concepto: 'Internet', monto: 500, dia: 5, categoria: 'Internet y teléfono' }));
  const renta = (await ok(await get('/admin/finanzas?mes=2025-03'))).fijos.find(f => f.concepto === 'Renta del local');
  for (const m of [
    { tipo: 'ingreso', categoria: 'Venta de productos', monto: 180, fecha: '2025-03-10' },
    { tipo: 'gasto', categoria: 'Renta', monto: 3000, fecha: '2025-03-01', fijo_id: renta.id },
    { tipo: 'gasto', categoria: 'Luz y agua', monto: 450.75, fecha: '2025-03-12' },
    { tipo: 'gasto', categoria: 'Productos e insumos', monto: 300, fecha: '2025-03-31' },
    { tipo: 'gasto', categoria: 'Sueldos y comisiones', monto: 300, fecha: '2025-03-31', barbero: 'Ana' }, // menos de lo que le toca (320)
    { tipo: 'gasto', categoria: 'Sueldos y comisiones', monto: 250, fecha: '2025-03-31', barbero: 'Beto' }, // más de lo que le toca (200.25)
    { tipo: 'inversion', categoria: 'Mobiliario', monto: 5000, fecha: '2025-03-05' },
    { tipo: 'gasto', categoria: 'Renta', monto: 3000, fecha: '2025-04-01' },
    { tipo: 'gasto', categoria: 'Renta', monto: 2500, fecha: '2025-02-15' }])
    await ok(await post('/admin/movimiento', m));
});
after(() => { if (parar) parar(); });

test('utilidades: meses, días y redondeo a centavos', () => {
  assert.equal(util.sumaMes('2025-01', -1), '2024-12');
  assert.equal(util.sumaMes('2024-12', 1), '2025-01');
  assert.equal(util.diasMes('2024-02'), 29);
  assert.equal(util.diasMes('2025-02'), 28);
  assert.equal(util.laborables({ cierra: '0,1' }, '2025-03'), 21, 'marzo 2025 sin domingos ni lunes');
  assert.equal(util.laborables({ cierra: '' }, '2025-03', 10), 10);
  assert.equal(util.r2(1.005), 1.01);
  assert.equal(util.r2(-2.675), -2.68);
  assert.equal(util.r2(0.1 + 0.2), 0.3);
});

test('ISR de RESICO por tramo, incluidos los límites exactos', () => {
  const t = v => { const r = isrResico(v); return [r.tasa, r.isr]; };
  assert.deepEqual(t(0), [1, 0]);
  assert.deepEqual(t(1380.5), [1, 13.81]);
  assert.deepEqual(t(25000), [1, 250], 'el límite del primer tramo todavía es 1 %');
  assert.deepEqual(t(25000.01), [1.1, 275]);
  assert.deepEqual(t(50000), [1.1, 550]);
  assert.deepEqual(t(50000.01), [1.5, 750]);
  assert.deepEqual(t(83333.33), [1.5, 1250]);
  assert.deepEqual(t(83333.34), [2, 1666.67]);
  assert.deepEqual(t(208333.33), [2, 4166.67]);
  assert.deepEqual(t(208333.34), [2.5, 5208.33]);
  assert.equal(isrResico(291666.67).excede_ritmo, false);
  assert.equal(isrResico(300000).excede_ritmo, true, 'avisa que a ese ritmo se pasa del límite anual');
  const fuera = isrResico(3500000.01);
  assert.equal(fuera.fuera, true);
  assert.equal(fuera.isr, null);
  assert.match(isrResico(1000).aviso, /no sustituye a un contador/);
  assert.match(isrResico(1000).aviso, /IVA/);
});

test('ISR: la ley usa la base sin IVA y el límite de 3.5 millones es acumulado del año', () => {
  // 29,000 con IVA incluido = 25,000 sin IVA: con IVA cae en el tramo de 1.10 %, sin IVA en el de 1.00 %
  const r = isrResico(29000);
  assert.deepEqual([r.tasa, r.isr, r.base_sin_iva, r.tasa_sin_iva, r.isr_sin_iva], [1.1, 319, 25000, 1, 250]);
  assert.equal(r.acumulado_anual, 29000);
  // Un mes normal que hace pasar el acumulado del año de 3.5 millones: todavía paga RESICO, pero avisa
  const rebasa = isrResico(100000, 3450000);
  assert.equal(rebasa.fuera, false);
  assert.equal(rebasa.excede_ritmo, true);
  assert.equal(rebasa.acumulado_anual, 3550000);
  assert.match(rebasa.nota, /mes siguiente/);
  // Si el año ya había pasado el límite antes de este mes, ya no aplica aunque el mes sea chico
  const fuera = isrResico(1000, 3500000.01);
  assert.equal(fuera.fuera, true);
  assert.equal(fuera.isr, null);
  assert.equal(isrResico(1000, 3500000).fuera, false, 'justo en el límite todavía aplica');
});

test('estado de resultados exacto con datos sembrados', { skip: sinBase }, async () => {
  const r = await ok(await get('/admin/contabilidad/reporte?mes=2025-03'));
  assert.equal(r.mes, '2025-03');
  assert.equal(r.mes_anterior, '2025-02');
  assert.deepEqual(r.periodo, { desde: '2025-03-01', hasta: '2025-03-31', dias_trabajo: 21 });
  assert.equal(r.ingresos.servicios, 1200.5, 'solo citas completadas del 1 al 31 de marzo');
  assert.equal(r.ingresos.cortes, 5);
  assert.deepEqual(r.ingresos.otras, [{ categoria: 'Venta de productos', total: 180 }]);
  assert.equal(r.ingresos.total, 1380.5);
  const ana = r.comisiones.barberos.find(b => b.barbero === 'Ana'), beto = r.comisiones.barberos.find(b => b.barbero === 'Beto');
  assert.deepEqual([ana.cortes, ana.ventas, ana.pct, ana.devengada, ana.pagado, ana.costo], [3, 800, 40, 320, 300, 320]);
  assert.deepEqual([beto.cortes, beto.ventas, beto.pct, beto.devengada, beto.pagado, beto.costo], [2, 400.5, 50, 200.25, 250, 250]);
  assert.equal(r.comisiones.total, 570);
  assert.equal(r.comisiones.devengadas, 520.25);
  assert.deepEqual(r.gastos.categorias, [{ categoria: 'Renta', total: 3000 }, { categoria: 'Luz y agua', total: 450.75 }, { categoria: 'Productos e insumos', total: 300 }],
    'los pagos a barberos no se restan dos veces');
  assert.equal(r.gastos.total, 3750.75);
  assert.equal(r.gastos.fijos_registrados, 3000);
  assert.equal(r.inversion, 5000);
  assert.equal(r.utilidad, -2940.25, '1380.50 − 570 − 3750.75');
  assert.equal(r.margen, -212.98);
  assert.equal(r.proyeccion, null, 'un mes cerrado no lleva proyección');
  assert.equal(r.isr.base, 1380.5);
  assert.equal(r.isr.tasa, 1);
  assert.equal(r.isr.isr, 13.81);
  assert.match(r.isr.aviso, /no sustituye a un contador/);
  assert.equal(r.isr.base_sin_iva, 1190.09, '1380.50 / 1.16');
  assert.equal(r.isr.isr_sin_iva, 11.9);
  assert.equal(r.isr.acumulado_anual, 1780.5, 'febrero (400) + marzo (1380.50); la cita de abril no cuenta');
  assert.equal((await ok(await get('/admin/contabilidad/reporte?mes=2025-01'))).isr.acumulado_anual, 0, 'el acumulado empieza cada enero');
});

test('comparativo contra el mes anterior, con la frontera del último día de febrero', { skip: sinBase }, async () => {
  const r = await ok(await get('/admin/contabilidad/reporte?mes=2025-03'));
  assert.deepEqual(r.anterior, { ingresos: 400, servicios: 400, otras_ventas: 0, comisiones: 160, gastos: 2500, utilidad: -2260, margen: -565, cortes: 1 });
  assert.deepEqual(r.comparativo.ingresos, { actual: 1380.5, anterior: 400, diferencia: 980.5, pct: 245.13 });
  assert.deepEqual(r.comparativo.utilidad, { actual: -2940.25, anterior: -2260, diferencia: -680.25, pct: -30.1 });
  assert.deepEqual(r.comparativo.gastos, { actual: 3750.75, anterior: 2500, diferencia: 1250.75, pct: 50.03 });
  assert.deepEqual(r.comparativo.cortes, { actual: 5, anterior: 1, diferencia: 4, pct: 400 });
  assert.equal(r.comparativo.margen.puntos, 352.02);
  const abr = await ok(await get('/admin/contabilidad/reporte?mes=2025-04'));
  assert.equal(abr.ingresos.servicios, 1000, 'la cita del 1 de abril cuenta en abril');
  assert.equal(abr.anterior.utilidad, -2940.25);
});

test('punto de equilibrio con ticket y comisión promedio', { skip: sinBase }, async () => {
  const e = (await ok(await get('/admin/contabilidad/reporte?mes=2025-03'))).equilibrio;
  assert.equal(e.costos_fijos, 3500, 'renta 3000 + internet 500');
  assert.equal(e.origen, 'gastos fijos');
  assert.equal(e.ticket_promedio, 240.1);
  assert.equal(e.comision_promedio, 43.34);
  assert.equal(e.margen_por_corte, 136.05);
  assert.equal(e.cortes_mes, 26, '3500 / 136.05 = 25.7, se redondea hacia arriba');
  assert.equal(e.dias_trabajo, 21);
  assert.equal(e.cortes_dia, 1.2);
  assert.equal(e.avance, 19);
  // Un mes sin cortes usa el ticket de los 90 días anteriores
  const may = (await ok(await get('/admin/contabilidad/reporte?mes=2025-05'))).equilibrio;
  assert.equal(may.base_ticket, '90 días');
  assert.equal(may.ticket_promedio, 400.1, 'del 3 de marzo al 31 de mayo: (250 + 250 + 300 + 200.50 + 1000) / 5');
  assert.equal(may.comision_promedio, 45, 'sin ventas en el mes, promedio simple de los porcentajes');
});

test('proyección de cierre del mes en curso', { skip: sinBase }, async () => {
  // La renta capturada a mano (sin ligarla al gasto fijo) no se multiplica por el ritmo ni se suma dos veces con la plantilla
  await ok(await post('/admin/movimiento', { tipo: 'gasto', categoria: 'Renta', monto: 3000 }));
  const r = await ok(await get('/admin/contabilidad/reporte'));
  assert.equal(r.proyeccion.gastos, 3500, 'renta 3000 ya pagada + internet 500 de la plantilla, sin gastos variables');
  assert.equal(r.en_curso, true);
  const p = r.proyeccion;
  assert.ok(p, 'el mes en curso trae proyección');
  assert.ok(p.factor >= 1);
  assert.ok(p.ingresos >= r.ingresos.total);
  assert.ok(p.gastos >= 3500, 'al menos los gastos fijos completos');
  assert.equal(p.utilidad, Math.round((p.ingresos - p.comisiones - p.gastos) * 100) / 100);
});

test('un mes sin datos no truena y el mes mal escrito se rechaza', { skip: sinBase }, async () => {
  const r = await ok(await get('/admin/contabilidad/reporte?mes=2019-07', cookieOtra, slugOtra));
  assert.equal(r.ingresos.total, 0);
  assert.equal(r.utilidad, 0);
  assert.equal(r.margen, null);
  assert.equal(r.comparativo.ingresos.pct, null);
  assert.equal(r.equilibrio.cortes_mes, null);
  assert.ok(r.equilibrio.mensaje);
  assert.equal(r.isr.isr, 0);
  for (const m of ['2025-13', '25-03', 'marzo', '2025-3'])
    assert.equal((await get('/admin/contabilidad/reporte?mes=' + m)).status, 400, m);
});

test('CSV para el contador con BOM, encabezados y nombre con slug y mes', { skip: sinBase }, async () => {
  const r = await get('/admin/contabilidad/export?mes=2025-03');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), new RegExp(`filename="contabilidad-${slug}-2025-03\\.csv"`));
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 con BOM para Excel');
  const txt = new TextDecoder().decode(bytes.slice(3)), lineas = txt.split('\r\n');
  assert.equal(lineas[2], '"Sección","Concepto","Este mes","Mes anterior","Diferencia","Diferencia %"');
  assert.ok(lineas.includes('"Ingresos","Total de ingresos","1380.5","400","980.5","245.13%"'));
  assert.ok(lineas.includes('"Resultado","Utilidad de operación","-2940.25","-2260","-680.25","-30.1%"'));
  assert.ok(lineas.includes('"Gastos de operación","Luz y agua","450.75","","",""'));
  assert.ok(lineas.includes('"ISR estimado (RESICO)","ISR mensual estimado","13.81","","",""'));
  assert.ok(lineas.includes('"ISR estimado (RESICO)","Ingresos acumulados del año (límite 3.5 millones)","1780.5","","",""'));
  assert.ok(txt.includes('no sustituye a un contador'));
});

test('aislamiento: otra barbería no ve tus números y sin sesión no hay acceso', { skip: sinBase }, async () => {
  assert.equal((await get('/admin/contabilidad/reporte?mes=2025-03', '')).status, 401);
  assert.equal((await get('/admin/contabilidad/export?mes=2025-03', '')).status, 401);
  assert.equal((await get('/admin/contabilidad/reporte?mes=2025-03', cookieOtra)).status, 401, 'la sesión de otra barbería no sirve aquí');
  assert.equal((await get('/admin/contabilidad/export?mes=2025-03', cookieOtra)).status, 401);
  const otra = await ok(await get('/admin/contabilidad/reporte?mes=2025-03', cookieOtra, slugOtra));
  assert.equal(otra.ingresos.total, 0);
  assert.equal(otra.gastos.total, 0);
  assert.equal(otra.equilibrio.costos_fijos, 0);
  assert.ok(!otra.comisiones.barberos.some(b => b.barbero === 'Ana'));
  // Un barbero del equipo tampoco ve la contabilidad del dueño
  const email = `ana-${sufijo}@ejemplo.com`, { temporal } = await ok(await post('/admin/equipo', { nombre: 'Ana', email, rol: 'barbero', barbero: 'Ana' }));
  const e = await fetch(`${base}/api/${slug}/cuenta/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: temporal }) });
  const cBarbero = e.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await get('/admin/contabilidad/reporte?mes=2025-03', cBarbero)).status, 403);
  assert.equal((await get('/admin/contabilidad/export?mes=2025-03', cBarbero)).status, 403);
});
