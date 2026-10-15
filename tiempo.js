// Agenda llena (fase 5): huecos de los próximos días, patrón histórico de ocupación,
// promos relámpago para llenar horas concretas y alertas de inasistencias.
// "Libre" sigue exactamente la misma regla que la agenda del cliente (/horarios y POST /citas en server.js):
// horas de hora_ini a hora_fin, días en 'cierra', bloqueos (hora NULL = día completo), citas no canceladas
// y, en el día de hoy, solo horas posteriores a la hora actual de Mérida.
// Los recordatorios NO se mandan aquí: se cuentan con crm_envios y se envían desde la bandeja del CRM.
module.exports = (app, api, d) => {
  // todas, cerrado, bars, ahoraH y vigente vienen de server.js: son las mismas que usa la agenda del cliente.
  const { pool, auth, wrap, HOY, limita, todas, cerrado, bars, ahoraH, vigente } = d;
  const Q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const ORDEN = [1, 2, 3, 4, 5, 6, 0]; // la semana empieza en lunes
  const dow = f => new Date(f + 'T12:00').getDay();
  const fechaMas = (f, k) => { const x = new Date(f + 'T12:00'); x.setDate(x.getDate() + k); return x.toLocaleDateString('en-CA'); };
  const fLarga = f => new Date(f + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const h12 = h => { const x = +h.slice(0, 2); return `${x % 12 || 12}:${h.slice(3, 5)} ${x < 12 ? 'a. m.' : 'p. m.'}`; };
  const punto = t => t.replace(/m\.\./g, 'm.'); // "p. m." + punto final no debe quedar "p. m.."
  const entero =(v, def, min, max) => { const x = parseInt(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
  const pct = (a, b) => (b ? Math.round(a / b * 100) : null);

  // Mapa de ocupación de un rango de fechas: { fecha: { barbero: { todo: bool, citas: Set, bloq: Set } } }
  const ocupacion = async (n, desde, hasta, estados) => {
    const [cit, blq] = await Promise.all([
      Q(`SELECT fecha::text AS fecha, barbero, hora, estado FROM citas WHERE negocio_id=$1 AND fecha BETWEEN $2 AND $3 AND ${estados || "estado<>'cancelada'"}`, [n.id, desde, hasta]),
      Q('SELECT fecha::text AS fecha, barbero, hora FROM bloqueos WHERE negocio_id=$1 AND fecha BETWEEN $2 AND $3', [n.id, desde, hasta])]);
    const M = {}, celda = (f, b) => ((M[f] = M[f] || {})[b] = M[f][b] || { todo: false, citas: new Set(), bloq: new Set(), estados: {} });
    for (const c of cit) { const x = celda(c.fecha, c.barbero); x.citas.add(c.hora); x.estados[c.hora] = c.estado; }
    for (const b of blq) { const x = celda(b.fecha, b.barbero); if (b.hora === null) x.todo = true; else x.bloq.add(b.hora); }
    return M;
  };
  // Un barbero está libre a una hora si no hay cita viva ni bloqueo (igual que ocupadas() en server.js).
  const libreEn = (M, f, b, h) => { const x = (M[f] || {})[b]; return !x || (!x.todo && !x.citas.has(h) && !x.bloq.has(h)); };

  // ---- 1. Huecos de los próximos días
  api.get('/admin/tiempo/huecos', auth, wrap(async (q, s) => {
    const n = q.neg, B = bars(n), H = todas(n), hoy = HOY(), ya = ahoraH(), N = entero(q.query.dias, 7, 1, 14), hasta = fechaMas(hoy, N - 1);
    const M = await ocupacion(n, hoy, hasta);
    const dias = [];
    for (let k = 0; k < N; k++) {
      const f = fechaMas(hoy, k), cierra = cerrado(n, f), dia = { fecha: f, dia: DIAS[dow(f)], cerrado: cierra, capacidad: 0, ocupadas: 0, ocupacion: null, libres: 0, huecos: [] };
      if (!cierra) {
        for (const h of H) {
          const libresB = [];
          for (const b of B) {
            const x = (M[f] || {})[b], bloq = x && (x.todo || x.bloq.has(h));
            if (bloq) continue; // el barbero no trabaja esa hora: no cuenta como capacidad
            dia.capacidad++;
            if (x && x.citas.has(h)) dia.ocupadas++; else libresB.push(b);
          }
          if (libresB.length && !(f === hoy && +h.slice(0, 2) <= ya)) { dia.huecos.push({ hora: h, libres: libresB.length, barberos: libresB }); dia.libres += libresB.length; }
        }
        dia.ocupacion = pct(dia.ocupadas, dia.capacidad);
      }
      dias.push(dia);
    }
    s.json({ abierto: vigente(n), barberos: B.length, horario: { ini: H[0], fin: H[H.length - 1] }, hoy, dias, totalLibres: dias.reduce((a, x) => a + x.libres, 0) });
  }));

  // ---- 2. Patrón histórico: día de la semana × hora
  api.get('/admin/tiempo/patron', auth, wrap(async (q, s) => {
    const n = q.neg, B = bars(n), H = todas(n), hoy = HOY(), sem = entero(q.query.semanas, 8, 1, 26), desde = fechaMas(hoy, -7 * sem), hasta = fechaMas(hoy, -1);
    const M = await ocupacion(n, desde, hasta, "estado IN ('completada','no_llego')");
    const C = {}, cel = (w, h) => ((C[w] = C[w] || {})[h] = C[w][h] || { cap: 0, n: 0, faltas: 0 });
    for (let f = desde; f <= hasta; f = fechaMas(f, 1)) {
      if (cerrado(n, f)) continue;
      const w = dow(f);
      for (const h of H) for (const b of B) {
        const x = (M[f] || {})[b];
        if (x && (x.todo || x.bloq.has(h))) continue;
        const c = cel(w, h); c.cap++;
        if (x && x.citas.has(h)) { c.n++; if (x.estados[h] === 'no_llego') c.faltas++; }
      }
    }
    const pend = (await Q("SELECT COUNT(*)::int n FROM citas WHERE negocio_id=$1 AND fecha BETWEEN $2 AND $3 AND estado='pendiente'", [n.id, desde, hasta]))[0].n;
    let capT = 0, nT = 0, fT = 0;
    const filas = ORDEN.map(w => {
      const cerr = (n.cierra || '').split(',').includes(String(w)), horas = H.map(h => { const c = (C[w] || {})[h] || { cap: 0, n: 0, faltas: 0 }; return { hora: h, cap: c.cap, citas: c.n, faltas: c.faltas, ocupacion: c.cap ? Math.min(100, pct(c.n, c.cap)) : null }; });
      const cap = horas.reduce((a, x) => a + x.cap, 0), ci = horas.reduce((a, x) => a + x.citas, 0), fa = horas.reduce((a, x) => a + x.faltas, 0);
      capT += cap; nT += ci; fT += fa;
      return { dow: w, dia: DIAS[w], cerrado: cerr, citas: ci, faltas: fa, ocupacion: cap ? Math.min(100, pct(ci, cap)) : null, inasistencia: ci ? pct(fa, ci) : null, horas };
    });
    // Horas muertas: las celdas con capacidad y la ocupación más baja (menos de 25 %).
    const muertas = filas.flatMap(r => r.horas.filter(x => x.cap && x.ocupacion < 25).map(x => ({ dia: r.dia, dow: r.dow, hora: x.hora, ocupacion: x.ocupacion })))
      .sort((a, b) => a.ocupacion - b.ocupacion || ORDEN.indexOf(a.dow) - ORDEN.indexOf(b.dow) || a.hora.localeCompare(b.hora)).slice(0, 8);
    s.json({ semanas: sem, desde, hasta, horas: H, dias: filas, ocupacion: pct(nT, capT), citas: nT, faltas: fT, inasistencia: nT ? pct(fT, nT) : null, muertas, sinCerrar: pend });
  }));

  // ---- 3. Promo relámpago para horas concretas
  api.post('/admin/tiempo/relampago', auth, wrap(async (q, s) => {
    const n = q.neg, B = bars(n), H = todas(n), hoy = HOY(), fecha = String(q.body.fecha || ''), desc = Number(q.body.descuento || 0);
    const horas = [...new Set((Array.isArray(q.body.horas) ? q.body.horas : [q.body.horas]).map(x => String(x || '')))].sort();
    if (limita('tr' + n.id, 30, 6e5)) return s.status(429).json({ error: 'Espera unos minutos antes de armar más promociones.' });
    // fechaMas(f, 0) === f descarta fechas que no existen (2026-02-31), que JS "recorre" y PostgreSQL rechaza con error 500.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha + 'T12:00')) || fechaMas(fecha, 0) !== fecha) return s.status(400).json({ error: 'Elige una fecha válida' });
    if (fecha < hoy) return s.status(400).json({ error: 'Esa fecha ya pasó. Elige hoy o un día próximo.' });
    if (fecha > fechaMas(hoy, 30)) return s.status(400).json({ error: 'La promo relámpago es para los próximos días (máximo 30).' });
    if (!horas.length || horas.length > 12 || horas.some(h => !H.includes(h))) return s.status(400).json({ error: 'Elige de 1 a 12 horas dentro de tu horario' });
    if (!(Number.isInteger(desc) && desc >= 0 && desc <= 90)) return s.status(400).json({ error: 'El descuento debe ser un número entero de 0 a 90 %' });
    if (fecha === hoy && horas.some(h => +h.slice(0, 2) <= ahoraH())) return s.status(400).json({ error: 'Alguna de esas horas de hoy ya pasó. Quítala y vuelve a intentar.' });
    if (!vigente(n)) return s.status(403).json({ error: 'Tu cuenta está vencida o suspendida: tus clientes no pueden agendar ahora.' });
    if (cerrado(n, fecha)) return s.status(409).json({ error: 'Ese día no abres. Elige otro día.' });
    const M = await ocupacion(n, fecha, fecha), lib = horas.map(h => ({ hora: h, libres: B.filter(b => libreEn(M, fecha, b, h)).length }));
    const llenas = lib.filter(x => !x.libres).map(x => x.hora);
    if (llenas.length) return s.status(409).json({ error: punto(`Ya no hay lugar en ${llenas.length === 1 ? 'este horario' : 'estos horarios'}: ${llenas.map(h12).join(', ')}. Quíta${llenas.length === 1 ? 'lo' : 'los'} de la promo.`), ocupadas: llenas });
    const enlace = (process.env.PUBLIC_URL || `${q.protocol}://${q.get('host')}`).replace(/\/$/, '') + '/' + encodeURIComponent(n.slug) + '/agenda?fecha=' + fecha; // la agenda abre directo en ese día
    const cuando = fecha === hoy ? 'hoy' : fecha === fechaMas(hoy, 1) ? 'mañana' : 'el ' + fLarga(fecha);
    const lista = lib.map(x => h12(x.hora)), unir = L => L.length > 1 ? L.slice(0, -1).join(', ') + ' y ' + L[L.length - 1] : L[0];
    const lugares = lib.reduce((a, x) => a + x.libres, 0);
    const gancho = desc ? `${desc} % de descuento` : 'lugares libres';
    const ala = lista.length === 1 && lista[0].startsWith('1:') ? 'a la' : 'a las';
    const texto = punto(`⚡ Promo relámpago en ${n.nombre}: ${gancho} ${cuando} ${ala} ${unir(lista)}. ${lugares === 1 ? 'Solo queda 1 lugar' : `Solo ${lugares} lugares`}, el primero que agende se lo queda. Aparta aquí: ${enlace}`);
    s.json({ fecha, cuando, descuento: desc, horas: lib, lugares, enlace, texto,
      titulo: `Promo relámpago ${fecha.slice(8)}/${fecha.slice(5, 7)}`.slice(0, 80),
      textoCampana: `¡Hola! ${texto}`, // sin {nombre}: si el CRM no tiene el nombre quedaría "Hola ."
      compartir: 'https://wa.me/?text=' + encodeURIComponent(texto) });
  }));

  // ---- 4. Anti-inasistencias
  api.get('/admin/tiempo/inasistencias', auth, wrap(async (q, s) => {
    const n = q.neg, hoy = HOY(), man = fechaMas(hoy, 1), desde = fechaMas(hoy, -90), TEL = "right(regexp_replace(COALESCE(telefono,''),'\\D','','g'),10)";
    const [cli, cit] = await Promise.all([
      Q(`SELECT ${TEL} AS tel, (array_agg(cliente ORDER BY fecha DESC, id DESC))[1] AS nombre,
          COUNT(*) FILTER (WHERE estado='no_llego' AND fecha<=$3)::int AS faltas, COUNT(*) FILTER (WHERE estado='completada' AND fecha<=$3)::int AS visitas,
          (MAX(fecha) FILTER (WHERE estado='no_llego' AND fecha<=$3))::text AS ultima, (MIN(fecha) FILTER (WHERE estado='pendiente' AND fecha>=$3))::text AS proxima
        FROM citas WHERE negocio_id=$1 AND fecha>=$2 AND length(regexp_replace(telefono,'\\D','','g'))>=10
        GROUP BY 1 HAVING COUNT(*) FILTER (WHERE estado='no_llego' AND fecha<=$3) >= 2 ORDER BY 3 DESC, 5 DESC LIMIT 50`, [n.id, desde, hoy]),
      Q(`SELECT id, cliente, ${TEL} AS tel, hora, barbero, servicio FROM citas WHERE negocio_id=$1 AND fecha=$2 AND estado='pendiente' ORDER BY hora, id`, [n.id, man])]);
    // Envíos que registra el CRM (crm.js marca cada recordatorio como tipo 'recordatorio', ref 'cita:<id>').
    // Los clientes que pidieron no recibir avisos (crm_clientes.avisos=false) nunca salen en la bandeja del CRM: no cuentan como "sin enviar".
    let env = [], fuera = [];
    if (cit.length) {
      try {
        [env, fuera] = await Promise.all([
          Q("SELECT ref, canal FROM crm_envios WHERE negocio_id=$1 AND tipo='recordatorio' AND ref = ANY($2)", [n.id, cit.map(c => 'cita:' + c.id)]),
          Q('SELECT telefono FROM crm_clientes WHERE negocio_id=$1 AND avisos=false AND telefono = ANY($2)', [n.id, cit.map(c => c.tel)])]);
      } catch (e) { if (e.code !== '42P01') throw e; } // si el CRM aún no crea sus tablas, no hay envíos
    }
    const E = new Map(env.map(x => [x.ref, x.canal])), F = new Map(cli.map(c => [c.tel, c.faltas])), NO = new Set(fuera.map(x => x.telefono));
    const citas = cit.map(c => ({ hora: c.hora, cliente: c.cliente, barbero: c.barbero, servicio: c.servicio, telefono: c.tel.length === 10,
      recordatorio: E.has('cita:' + c.id) ? (E.get('cita:' + c.id) === 'omitido' ? 'omitido' : 'enviado') : NO.has(c.tel) ? 'sin_avisos' : 'pendiente', faltas: F.get(c.tel) || 0 }));
    const con = citas.filter(c => c.telefono);
    s.json({ clientes: cli, crm: '/' + n.slug + '/crm',
      manana: { fecha: man, total: citas.length, conTelefono: con.length, enviados: con.filter(c => c.recordatorio === 'enviado').length,
        omitidos: con.filter(c => c.recordatorio === 'omitido').length, sinAvisos: con.filter(c => c.recordatorio === 'sin_avisos').length, sinEnviar: con.filter(c => c.recordatorio === 'pendiente').length,
        riesgo: citas.filter(c => c.faltas >= 2), citas } });
  }));
};
