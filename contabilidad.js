// Contabilidad (fase 3): estado de resultados del mes para el contador, comparativo contra el mes anterior,
// punto de equilibrio, proyección de cierre e ISR orientativo de RESICO. Se construye encima de Finanzas:
// lee citas, movimientos, fijos y perfiles.comision sin cambiar su esquema (este módulo no crea tablas).
//
// Reglas del cálculo:
// - Ingresos = citas completadas del mes (servicios) + movimientos tipo 'ingreso' (otras ventas).
// - Comisiones por barbero = lo que le toca según su porcentaje (devengada). Si en el mes se le pagó más
//   (gasto 'Sueldos y comisiones' con barbero), cuenta lo pagado. Esos pagos NO se restan otra vez como gasto.
// - Gastos de operación = movimientos tipo 'gasto' (sin los pagos a barberos de arriba). La inversión no afecta la utilidad.
// - Utilidad de operación = ingresos − comisiones − gastos. Margen = utilidad / ingresos.
// - Las fechas de citas y movimientos ya son días de Mérida (tipo DATE): el mes va del día 1 al día 1 del mes siguiente, sin horas.
module.exports = (app, api, d) => {
  const { pool, auth, wrap, HOY } = d;
  const Q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const PAGO_BARBERO = "categoria='Sueldos y comisiones' AND barbero IS NOT NULL";

  const datosMes = async (n, mes) => {
    const desde = mes + '-01', hasta = sumaMes(mes, 1) + '-01', id = n.id;
    const [serv, mov, com] = await Promise.all([
      Q("SELECT barbero, COUNT(*)::int cortes, COALESCE(SUM(precio),0)::float total FROM citas WHERE negocio_id=$1 AND estado='completada' AND fecha>=$2 AND fecha<$3 GROUP BY barbero", [id, desde, hasta]),
      Q(`SELECT tipo, categoria, barbero, (${PAGO_BARBERO}) AS pago_barbero, (fijo_id IS NOT NULL) AS fijo, SUM(monto)::float total
         FROM movimientos WHERE negocio_id=$1 AND fecha>=$2 AND fecha<$3 GROUP BY 1,2,3,4,5`, [id, desde, hasta]),
      Q('SELECT barbero, COALESCE(comision,0)::float comision FROM perfiles WHERE negocio_id=$1', [id])]);
    const pct = Object.fromEntries(com.map(x => [x.barbero, x.comision]));
    const lista = [...new Set([...barberosDe(n), ...serv.map(x => x.barbero), ...mov.filter(x => x.pago_barbero).map(x => x.barbero)])];
    const barberos = lista.map(b => {
      const v = serv.find(x => x.barbero === b) || { cortes: 0, total: 0 }, p = pct[b] || 0;
      const devengada = r2(v.total * p / 100), pagado = r2(suma(mov.filter(x => x.pago_barbero && x.barbero === b)));
      return { barbero: b, cortes: v.cortes, ventas: r2(v.total), pct: p, devengada, pagado, costo: Math.max(devengada, pagado) };
    }).filter(b => b.cortes || b.pagado || barberosDe(n).includes(b.barbero));
    const agrupa = filas => Object.entries(filas.reduce((a, x) => ({ ...a, [x.categoria]: (a[x.categoria] || 0) + x.total }), {}))
      .map(([categoria, total]) => ({ categoria, total: r2(total) })).sort((a, b) => b.total - a.total);
    const gastosOp = mov.filter(x => x.tipo === 'gasto' && !x.pago_barbero);
    const servicios = r2(suma(serv)), cortes = serv.reduce((a, x) => a + x.cortes, 0), otras = agrupa(mov.filter(x => x.tipo === 'ingreso'));
    const otrasVentas = r2(suma(otras)), ingresos = r2(servicios + otrasVentas);
    const comisiones = r2(barberos.reduce((a, b) => a + b.costo, 0)), devengadas = r2(barberos.reduce((a, b) => a + b.devengada, 0));
    const gastos = r2(suma(gastosOp)), utilidad = r2(ingresos - comisiones - gastos);
    return { mes, desde, hasta, servicios, cortes, otras, otrasVentas, ingresos, barberos, comisiones, devengadas,
      pagadas: r2(barberos.reduce((a, b) => a + b.pagado, 0)), categorias: agrupa(gastosOp), gastos,
      fijosRegistrados: r2(suma(gastosOp.filter(x => x.fijo))), inversion: r2(suma(mov.filter(x => x.tipo === 'inversion'))),
      utilidad, margen: pct2(utilidad, ingresos), ops: gastosOp };
  };

  const reporte = async (n, mes) => {
    const hoy = HOY(), ant = sumaMes(mes, -1);
    const [a, p, fj, ac] = await Promise.all([datosMes(n, mes), datosMes(n, ant), Q('SELECT categoria, SUM(monto)::float t FROM fijos WHERE negocio_id=$1 GROUP BY categoria', [n.id]),
      // Ingresos del año antes de este mes: el RESICO deja de aplicar cuando el acumulado del año pasa de 3.5 millones
      Q(`SELECT (SELECT COALESCE(SUM(precio),0) FROM citas WHERE negocio_id=$1 AND estado='completada' AND fecha>=$2 AND fecha<$3)::float
        + (SELECT COALESCE(SUM(monto),0) FROM movimientos WHERE negocio_id=$1 AND tipo='ingreso' AND fecha>=$2 AND fecha<$3)::float AS t`, [n.id, mes.slice(0, 4) + '-01-01', mes + '-01'])]);
    const diasTrabajo = laborables(n, mes), fijosPlantilla = r2(fj.reduce((x, f) => x + f.t, 0)), catsFijos = new Set(fj.map(f => f.categoria));
    // ---- Punto de equilibrio: cortes que pagan los gastos fijos con el ticket promedio y la comisión promedio
    let ticket = a.cortes ? a.servicios / a.cortes : null, baseTicket = 'mes';
    if (!a.cortes) {
      const h = (await Q("SELECT COUNT(*)::int c, COALESCE(SUM(precio),0)::float t FROM citas WHERE negocio_id=$1 AND estado='completada' AND fecha<$2 AND fecha>=($2::date - 90)", [n.id, a.hasta]))[0];
      if (h.c) { ticket = h.t / h.c; baseTicket = '90 días'; }
    }
    const pcts = a.barberos.map(b => b.pct), comPct = a.servicios ? a.devengadas / a.servicios : pcts.length ? pcts.reduce((x, y) => x + y, 0) / pcts.length / 100 : 0;
    const costosFijos = fijosPlantilla || a.gastos, origen = fijosPlantilla ? 'gastos fijos' : 'gastos del mes';
    const margenCorte = ticket === null ? null : r2(ticket * (1 - comPct));
    let cortesMes = null, mensaje = '';
    if (!costosFijos) mensaje = 'Registra tus gastos fijos (renta, luz, internet) para calcular cuántos cortes necesitas.';
    else if (ticket === null) mensaje = 'Aún no hay cortes completados para calcular tu ticket promedio.';
    else if (!(margenCorte > 0)) mensaje = 'Con las comisiones actuales cada corte no deja margen: revisa precios o porcentajes.';
    else cortesMes = Math.ceil(r2(costosFijos / margenCorte));
    const equilibrio = { costos_fijos: r2(costosFijos), origen, ticket_promedio: ticket === null ? null : r2(ticket), base_ticket: ticket === null ? null : baseTicket,
      comision_promedio: r2(comPct * 100), margen_por_corte: margenCorte, cortes_mes: cortesMes, dias_trabajo: diasTrabajo,
      cortes_dia: cortesMes !== null && diasTrabajo ? Math.round(cortesMes / diasTrabajo * 10) / 10 : null,
      cortes_actuales: a.cortes, avance: cortesMes ? Math.min(999, Math.round(a.cortes / cortesMes * 100)) : null, mensaje };
    // ---- Proyección de cierre (solo el mes en curso): el ritmo por día de trabajo transcurrido se extiende al resto del mes
    let proyeccion = null;
    if (mes === hoy.slice(0, 7)) {
      const dia = +hoy.slice(8), trans = laborables(n, mes, dia), total = diasTrabajo || diasMes(mes);
      const factor = trans ? total / trans : diasMes(mes) / dia;
      const ingresos = r2(a.ingresos * factor), comisiones = r2(Math.max(a.comisiones, a.devengadas * factor));
      // Lo fijo (ligado a un gasto fijo o de una categoría que tienes como gasto fijo, aunque se haya capturado a mano) no se
      // multiplica por el ritmo: cuenta una vez, al menos lo de tu plantilla. Solo lo variable se extiende al resto del mes.
      const fijoMes = r2(suma(a.ops.filter(x => x.fijo || catsFijos.has(x.categoria))));
      const gastos = r2((a.gastos - fijoMes) * factor + Math.max(fijosPlantilla, fijoMes)), utilidad = r2(ingresos - comisiones - gastos);
      proyeccion = { dia, dias_trabajo_transcurridos: trans, dias_trabajo: diasTrabajo, factor: Math.round(factor * 1000) / 1000,
        cortes: Math.round(a.cortes * factor), ingresos, comisiones, gastos, utilidad, margen: pct2(utilidad, ingresos) };
    }
    const cmp = (x, y) => ({ actual: x, anterior: y, diferencia: r2(x - y), pct: pct2(r2(x - y), Math.abs(y)) });
    return {
      negocio: n.nombre, slug: n.slug, mes, mes_anterior: ant, en_curso: mes === hoy.slice(0, 7),
      periodo: { desde: a.desde, hasta: ultimoDia(mes), dias_trabajo: diasTrabajo },
      ingresos: { servicios: a.servicios, cortes: a.cortes, otras_ventas: a.otrasVentas, otras: a.otras, total: a.ingresos },
      comisiones: { total: a.comisiones, devengadas: a.devengadas, pagadas: a.pagadas, barberos: a.barberos },
      gastos: { total: a.gastos, categorias: a.categorias, fijos_registrados: a.fijosRegistrados, fijos_plantilla: fijosPlantilla },
      inversion: a.inversion, utilidad: a.utilidad, margen: a.margen,
      anterior: { ingresos: p.ingresos, servicios: p.servicios, otras_ventas: p.otrasVentas, comisiones: p.comisiones, gastos: p.gastos, utilidad: p.utilidad, margen: p.margen, cortes: p.cortes },
      comparativo: { ingresos: cmp(a.ingresos, p.ingresos), comisiones: cmp(a.comisiones, p.comisiones), gastos: cmp(a.gastos, p.gastos),
        utilidad: cmp(a.utilidad, p.utilidad), cortes: cmp(a.cortes, p.cortes),
        margen: { actual: a.margen, anterior: p.margen, puntos: a.margen === null || p.margen === null ? null : r2(a.margen - p.margen) } },
      equilibrio, proyeccion, isr: isrResico(a.ingresos, ac[0].t),
      notas: ['Las comisiones son lo que le toca a cada barbero según su porcentaje; si se le pagó más, cuenta lo pagado. Esos pagos no se restan dos veces como gasto.',
        'La inversión (mobiliario, equipo, remodelación) no se resta de la utilidad de operación.'] };
  };

  const mesDe = (q, s) => {
    const m = q.query.mes === undefined || q.query.mes === '' ? HOY().slice(0, 7) : String(q.query.mes);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || m < '2000-01' || m > '2100-12') { s.status(400).json({ error: 'El mes debe tener el formato AAAA-MM' }); return null; }
    return m;
  };

  api.get('/admin/contabilidad/reporte', auth, wrap(async (q, s) => {
    const mes = mesDe(q, s);
    if (mes) s.json(await reporte(q.neg, mes));
  }));

  api.get('/admin/contabilidad/export', auth, wrap(async (q, s) => {
    const mes = mesDe(q, s);
    if (!mes) return;
    const r = await reporte(q.neg, mes), c = r.comparativo, filas = [];
    const f = (sec, concepto, v, cp) => filas.push([sec, concepto, v, ...(cp ? [cp.anterior, cp.diferencia, cp.pct === null ? '' : cp.pct + '%'] : ['', '', ''])]);
    f('Ingresos', `Servicios (${r.ingresos.cortes} cortes completados)`, r.ingresos.servicios);
    r.ingresos.otras.forEach(x => f('Ingresos', 'Otras ventas: ' + x.categoria, x.total));
    f('Ingresos', 'Total de ingresos', r.ingresos.total, c.ingresos);
    r.comisiones.barberos.forEach(b => f('Comisiones', `${b.barbero} (${b.pct}% de ${b.ventas.toFixed(2)})`, b.costo));
    f('Comisiones', 'Total de comisiones', r.comisiones.total, c.comisiones);
    r.gastos.categorias.forEach(x => f('Gastos de operación', x.categoria, x.total));
    f('Gastos de operación', 'Total de gastos', r.gastos.total, c.gastos);
    f('Resultado', 'Utilidad de operación', r.utilidad, c.utilidad);
    f('Resultado', 'Margen de operación (%)', r.margen === null ? '' : r.margen, c.margen.puntos === null ? null : { anterior: c.margen.anterior, diferencia: c.margen.puntos, pct: null });
    f('Informativo', 'Inversión del mes (no afecta la utilidad)', r.inversion);
    f('Informativo', 'Cortes completados', r.ingresos.cortes, c.cortes);
    const e = r.equilibrio;
    f('Punto de equilibrio', 'Costos fijos (' + e.origen + ')', e.costos_fijos);
    f('Punto de equilibrio', 'Ticket promedio', e.ticket_promedio ?? '');
    f('Punto de equilibrio', 'Comisión promedio (%)', e.comision_promedio);
    f('Punto de equilibrio', 'Cortes necesarios al mes', e.cortes_mes ?? '');
    f('Punto de equilibrio', `Cortes por día de trabajo (${e.dias_trabajo} días)`, e.cortes_dia ?? '');
    if (r.proyeccion) {
      f('Proyección de cierre', 'Ingresos', r.proyeccion.ingresos);
      f('Proyección de cierre', 'Utilidad de operación', r.proyeccion.utilidad);
    }
    f('ISR estimado (RESICO)', 'Base: ingresos cobrados del mes', r.isr.base);
    f('ISR estimado (RESICO)', 'Tasa aplicable (%)', r.isr.tasa ?? '');
    f('ISR estimado (RESICO)', 'ISR mensual estimado', r.isr.isr ?? '');
    f('ISR estimado (RESICO)', 'Base sin IVA, si tus precios incluyen IVA (16 %)', r.isr.base_sin_iva);
    f('ISR estimado (RESICO)', 'ISR estimado con la base sin IVA', r.isr.isr_sin_iva ?? '');
    f('ISR estimado (RESICO)', 'Ingresos acumulados del año (límite 3.5 millones)', r.isr.acumulado_anual);
    f('ISR estimado (RESICO)', r.isr.nota, '');
    f('Aviso', r.isr.aviso, '');
    const cel = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?%?$/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const titulo = [[`Estado de resultados de ${r.negocio}`, `${r.periodo.desde} a ${r.periodo.hasta}`], [], ['Sección', 'Concepto', 'Este mes', 'Mes anterior', 'Diferencia', 'Diferencia %']];
    const nombre = `contabilidad-${String(r.slug).replace(/[^a-z0-9-]/g, '')}-${mes}.csv`;
    s.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${nombre}"`)
      .send('﻿' + [...titulo, ...filas].map(x => x.map(cel).join(',')).join('\r\n'));
  }));
};

// ---- Utilidades puras (se exportan para probarlas sin servidor)
// A centavos, redondeando la mitad hacia afuera (1.005 → 1.01, −2.675 → −2.68) sin errores de punto flotante.
const r2 = v => { const n = Number(v) || 0; if (Math.abs(n) < 5e-7) return 0; return Math.sign(n) * Number(Math.round(Number(Math.abs(n) + 'e2')) + 'e-2'); };
const suma = filas => filas.reduce((a, x) => a + Number(x.total || 0), 0);
const pct2 = (x, base) => (base ? r2(x * 100 / base) : null);
const sumaMes = (mes, n) => { const [y, m] = mes.split('-').map(Number), t = y * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); };
const diasMes = mes => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const ultimoDia = mes => mes + '-' + String(diasMes(mes)).padStart(2, '0');
const barberosDe = n => String(n.barberos || '').split(',').map(x => x.trim()).filter(Boolean);
// Días que abre la barbería en el mes (negocios.cierra guarda los días de la semana cerrados, 0 = domingo), hasta el día 'tope'.
const laborables = (n, mes, tope) => {
  const [y, m] = mes.split('-').map(Number), cierra = String(n.cierra || '').split(',').filter(x => x !== '');
  let k = 0;
  for (let dia = 1; dia <= (tope || diasMes(mes)); dia++) if (!cierra.includes(String(new Date(Date.UTC(y, m - 1, dia)).getUTCDay()))) k++;
  return k;
};

// ISR orientativo del Régimen Simplificado de Confianza (RESICO) para personas físicas: tasa fija sobre los ingresos
// efectivamente cobrados del mes, sin IVA y sin deducciones. Tabla mensual del artículo 113-E de la LISR.
// Fuente verificada: Ley del Impuesto sobre la Renta, texto vigente de la Cámara de Diputados (última reforma DOF 01-04-2024),
// https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf (art. 113-E, "TABLA MENSUAL"); publicada también por el SAT en
// https://www.sat.gob.mx/articulo/58780/articulo-113-e
//   Hasta    25,000.00 → 1.00 %      Hasta   208,333.33 → 2.00 %
//   Hasta    50,000.00 → 1.10 %      Hasta 3,500,000.00 → 2.50 %  (así lo dice la ley; 291,666.67 al mes ya es el ritmo
//   Hasta    83,333.33 → 1.50 %       del límite anual de 3.5 millones del régimen, por eso se avisa a partir de ahí)
// El mismo artículo dice que la base son los ingresos "efectivamente cobrados, sin incluir el impuesto al valor agregado" y
// amparados por CFDI, y que el RESICO deja de aplicar a partir del mes siguiente a que los ingresos del año excedan 3.5 millones
// "en cualquier momento del año" (acumulado, no solo un mes). Por eso se informa también la base sin IVA y el acumulado del año.
const TRAMOS = [[25000, 1], [50000, 1.1], [83333.33, 1.5], [208333.33, 2], [3500000, 2.5]];
const LIMITE_ANUAL = 3500000, RITMO_MENSUAL = 291666.67, IVA = 0.16;
const AVISO = 'Es una estimación orientativa del ISR mensual de RESICO para persona física: no sustituye a un contador. '
  + 'La ley lo calcula sobre lo efectivamente cobrado y facturado (CFDI), sin IVA; aquí se usa todo lo cobrado que registraste en el mes. '
  + 'El IVA y otros regímenes (por ejemplo, persona moral o actividad empresarial) no se calculan.';
const tasaDe = base => (TRAMOS.find(([lim]) => base <= lim) || [])[1] ?? null;
const isrDe = (base, tasa) => Math.floor((Math.round(base * 100) * Math.round(tasa * 100) + 5000) / 10000) / 100; // centavos × puntos base, en enteros
const isrResico = (ingresos, previo = 0) => {
  const base = r2(Math.max(0, Number(ingresos) || 0)), antes = r2(Math.max(0, Number(previo) || 0)), acumulado = r2(antes + base);
  const sinIva = r2(base / (1 + IVA)), tSin = tasaDe(sinIva), t = tasaDe(base);
  const comun = { regimen: 'RESICO persona física', base, acumulado_anual: acumulado, base_sin_iva: sinIva, aviso: AVISO };
  if (t === null || antes > LIMITE_ANUAL) return { ...comun, tasa: null, isr: null, tasa_sin_iva: null, isr_sin_iva: null, fuera: true, excede_ritmo: true,
    nota: antes > LIMITE_ANUAL ? 'Tus ingresos del año ya pasaron de 3.5 millones antes de este mes: ya no aplica el RESICO. Consulta a tu contador.'
      : 'Con estos ingresos ya no aplica el RESICO (límite de 3.5 millones al año). Consulta a tu contador.' };
  const rebasa = acumulado > LIMITE_ANUAL, excede = rebasa || base > RITMO_MENSUAL;
  return { ...comun, tasa: t, isr: isrDe(base, t), tasa_sin_iva: tSin, isr_sin_iva: isrDe(sinIva, tSin), fuera: false, excede_ritmo: excede,
    nota: rebasa ? 'Con este mes tus ingresos del año pasan de 3.5 millones: a partir del mes siguiente ya no aplica el RESICO. Consulta a tu contador.'
      : excede ? 'A este ritmo superarías el límite anual de 3.5 millones del RESICO. Consulta a tu contador.'
      : 'El pago mensual se presenta a más tardar el día 17 del mes siguiente.' };
};
module.exports.isrResico = isrResico;
module.exports.util = { r2, sumaMes, diasMes, laborables, LIMITE_ANUAL };
