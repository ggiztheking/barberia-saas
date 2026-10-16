// Programa de lealtad: tarjeta de sellos digital. Cada cita "completada" de un cliente (por su WhatsApp, 10 dígitos)
// cuenta como un sello desde la fecha de inicio del programa y desde su último premio canjeado. Al juntar "cada" visitas
// el cliente gana el premio; el dueño lo registra y el conteo vuelve a empezar.
module.exports = (app, api, d) => {
  const { pool, auth, wrap, HOY, limita, listo } = d;
  const Q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const MIN = 3, MAX = 20, POR_DEFECTO = 10;

  (listo || Promise.resolve()).then(async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS lealtad_config (negocio_id INT PRIMARY KEY, activo BOOLEAN NOT NULL DEFAULT false,
      cada INT NOT NULL DEFAULT 10, premio TEXT NOT NULL DEFAULT '', desde DATE, actualizado TIMESTAMPTZ DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS lealtad_canjes (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, telefono TEXT NOT NULL,
      fecha DATE NOT NULL, nota TEXT, visitas INT, creado TIMESTAMPTZ DEFAULT now())`);
    await pool.query('CREATE INDEX IF NOT EXISTS lealtad_canjes_ix ON lealtad_canjes(negocio_id, telefono, fecha)');
  }).catch(console.error);

  // Teléfono normalizado igual que en crm.js: solo dígitos y los últimos 10 (quita el 52 o +52 de México).
  const tel10 = v => { const x = String(v ?? '').replace(/\D/g, ''); return x.length >= 10 ? x.slice(-10) : ''; };
  const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(f) && new Date(f + 'T12:00:00Z').toISOString().slice(0, 10) === f;
  const TEL_SQL = "right(regexp_replace(COALESCE(telefono,''),'\\D','','g'),10)";

  const config = async n => {
    const [c] = await Q('SELECT activo, cada, premio, desde::text AS desde FROM lealtad_config WHERE negocio_id=$1', [n.id]);
    return c ? { activo: c.activo, cada: c.cada, premio: c.premio || '', desde: c.desde } : { activo: false, cada: POR_DEFECTO, premio: '', desde: null };
  };

  // Visitas que cuentan para el premio de un teléfono: citas completadas desde el inicio del programa y después del último canje.
  const visitasDe = async (cx, n, cfg, tel) => {
    const [r] = await cx.query(`SELECT COUNT(*)::int AS n FROM citas WHERE negocio_id=$1 AND estado='completada' AND ${TEL_SQL}=$2
      AND ($3::date IS NULL OR fecha >= $3::date)
      AND fecha > COALESCE((SELECT MAX(fecha) FROM lealtad_canjes WHERE negocio_id=$1 AND telefono=$2), '-infinity'::date)`, [n.id, tel, cfg.desde]).then(r => r.rows);
    return r.n;
  };

  // Sin la diagonal final de PUBLIC_URL, para no armar enlaces con "//" (igual que en billing.js y tiempo.js).
  const urlBase = q => (process.env.PUBLIC_URL || `${q.protocol}://${q.get('host')}`).replace(/\/$/, '');
  const plural = (k, uno, varios) => k === 1 ? uno : varios;
  // Enlace de WhatsApp con el mensaje sugerido según el avance del cliente. Con el programa apagado no hay mensaje:
  // no se le promete al cliente un premio que no existe.
  const whatsapp = (q, c, cfg) => {
    if (!cfg.activo || !cfg.premio) return null;
    const hola = c.nombre ? `Hola ${c.nombre}` : 'Hola', agenda = `${urlBase(q)}/${encodeURIComponent(q.neg.slug)}/agenda`;
    const t = c.faltan <= 0
      ? `${hola}, ¡ya ganaste tu premio en ${q.neg.nombre}! Tu premio: ${cfg.premio}. Te lo damos en tu próxima visita. Agenda aquí: ${agenda}`
      : `${hola}, llevas ${c.visitas} de ${cfg.cada} visitas en ${q.neg.nombre}: ${plural(c.faltan, 'te falta 1 visita', `te faltan ${c.faltan} visitas`)} para tu premio (${cfg.premio}). Agenda aquí: ${agenda}`;
    return 'https://wa.me/52' + c.tel + '?text=' + encodeURIComponent(t);
  };

  // ---- Configuración (solo el dueño: las rutas /admin/lealtad no están en la lista de rutas de barberos)
  api.get('/admin/lealtad/config', auth, wrap(async (q, s) => s.json({ ...(await config(q.neg)), min: MIN, max: MAX, hoy: HOY() })));

  api.post('/admin/lealtad/config', auth, wrap(async (q, s) => {
    const b = q.body || {}, ant = await config(q.neg), hoy = HOY();
    const activo = b.activo === undefined ? ant.activo : b.activo === true;
    const cada = b.cada === undefined ? ant.cada : Number(b.cada);
    if (!Number.isInteger(cada) || cada < MIN || cada > MAX) return s.status(400).json({ error: `Las visitas para el premio deben ser un número entero entre ${MIN} y ${MAX}` });
    const premio = (b.premio === undefined ? ant.premio : String(b.premio ?? '')).trim().replace(/\s+/g, ' ');
    if (premio.length > 120) return s.status(400).json({ error: 'Describe el premio en máximo 120 caracteres' });
    if (activo && !premio) return s.status(400).json({ error: 'Escribe cuál es el premio (por ejemplo: un corte gratis)' });
    let desde = b.desde === undefined || b.desde === null || b.desde === '' ? (ant.desde || hoy) : String(b.desde);
    if (!esFecha(desde)) return s.status(400).json({ error: 'La fecha de inicio no es válida' });
    if (desde > hoy) return s.status(400).json({ error: 'La fecha de inicio no puede ser futura' });
    await pool.query(`INSERT INTO lealtad_config (negocio_id, activo, cada, premio, desde) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (negocio_id) DO UPDATE SET activo=$2, cada=$3, premio=$4, desde=$5, actualizado=now()`, [q.neg.id, activo, cada, premio, desde]);
    s.json({ ok: true, ...(await config(q.neg)) });
  }));

  // ---- Progreso de cada cliente, de quien está más cerca del premio a quien está más lejos
  api.get('/admin/lealtad/clientes', auth, wrap(async (q, s) => {
    const cfg = await config(q.neg), n = q.neg;
    // Si el programa nunca se ha configurado no hay fecha de inicio: se cuenta desde hoy, que es la fecha que tomará al
    // activarlo. Así la vista previa no muestra "premio listo" con todo el historial para luego bajar a cero.
    const desde = cfg.desde || HOY();
    const [filas, canjes] = await Promise.all([
      Q(`WITH k AS (SELECT telefono, MAX(fecha) AS ult, COUNT(*)::int AS total FROM lealtad_canjes WHERE negocio_id=$1 GROUP BY telefono),
        c AS (SELECT ${TEL_SQL} AS tel, cliente, fecha, estado, id FROM citas
          WHERE negocio_id=$1 AND length(regexp_replace(COALESCE(telefono,''),'\\D','','g')) >= 10)
        SELECT c.tel, (array_agg(c.cliente ORDER BY c.fecha DESC, c.id DESC))[1] AS nombre,
          COUNT(*) FILTER (WHERE c.estado='completada' AND ($2::date IS NULL OR c.fecha >= $2::date) AND (k.ult IS NULL OR c.fecha > k.ult))::int AS visitas,
          (MAX(c.fecha) FILTER (WHERE c.estado='completada'))::text AS ultima, COALESCE(MAX(k.total),0)::int AS canjes
        FROM c LEFT JOIN k ON k.telefono=c.tel GROUP BY c.tel`, [n.id, desde]),
      Q(`SELECT telefono, fecha::text AS fecha, nota FROM (SELECT telefono, fecha, nota, id,
          row_number() OVER (PARTITION BY telefono ORDER BY fecha DESC, id DESC) AS k FROM lealtad_canjes WHERE negocio_id=$1) x WHERE k <= 3 ORDER BY fecha DESC, id DESC`, [n.id])]);
    const ult = new Map();
    for (const x of canjes) { if (!ult.has(x.telefono)) ult.set(x.telefono, []); ult.get(x.telefono).push({ fecha: x.fecha, nota: x.nota || '' }); }
    const L = filas.filter(c => c.visitas > 0 || c.canjes > 0).map(c => {
      const faltan = Math.max(0, cfg.cada - c.visitas), r = { tel: c.tel, nombre: c.nombre || '', visitas: c.visitas, faltan, listo: faltan === 0,
        ultima: c.ultima, canjes: c.canjes, ultimos: ult.get(c.tel) || [] };
      r.wa = whatsapp(q, r, cfg);
      return r;
    }).sort((a, b) => a.faltan - b.faltan || b.visitas - a.visitas || (b.ultima || '').localeCompare(a.ultima || ''));
    s.json({ config: cfg, resumen: { clientes: L.length, listos: L.filter(c => c.listo).length, canjes: L.reduce((t, c) => t + c.canjes, 0) }, clientes: L.slice(0, 500) });
  }));

  // ---- Registrar el premio entregado: solo si ya juntó las visitas. Reinicia su conteo.
  api.post('/admin/lealtad/canje', auth, wrap(async (q, s) => {
    const tel = tel10(q.body && q.body.telefono), nota = String((q.body && q.body.nota) ?? '').trim().slice(0, 200);
    if (!tel) return s.status(400).json({ error: 'Teléfono inválido: deben ser 10 dígitos' });
    const cfg = await config(q.neg);
    if (!cfg.activo) return s.status(400).json({ error: 'Primero activa el programa de lealtad' });
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      // Candado por barbería y teléfono: dos clics seguidos no registran el premio dos veces.
      await cx.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [q.neg.id, 'lealtad:' + tel]);
      const visitas = await visitasDe(cx, q.neg, cfg, tel);
      if (visitas < cfg.cada) {
        await cx.query('ROLLBACK');
        const f = cfg.cada - visitas;
        return s.status(400).json({ error: `Aún no gana el premio: ${f === 1 ? 'le falta 1 visita' : `le faltan ${f} visitas`}`, visitas, faltan: f });
      }
      const [r] = (await cx.query('INSERT INTO lealtad_canjes (negocio_id, telefono, fecha, nota, visitas) VALUES ($1,$2,$3,$4,$5) RETURNING id, fecha::text AS fecha',
        [q.neg.id, tel, HOY(), nota || null, visitas])).rows;
      await cx.query('COMMIT');
      s.json({ ok: true, id: r.id, fecha: r.fecha, visitas: 0, faltan: cfg.cada });
    } catch (e) { await cx.query('ROLLBACK').catch(() => {}); throw e; }
    finally { cx.release(); }
  }));

  // ---- Público: avance de un teléfono, sin nombres ni datos de nadie más (para mostrarlo en la agenda más adelante).
  api.get('/lealtad', wrap(async (q, s) => {
    s.set('Cache-Control', 'no-store');
    if (limita('le' + q.ip, 30, 6e5)) return s.status(429).json({ error: 'Demasiadas consultas. Espera unos minutos.' });
    const cfg = await config(q.neg);
    if (!cfg.activo) return s.json({ activo: false });
    const tel = tel10(q.query.tel);
    if (!tel) return s.status(400).json({ error: 'Teléfono inválido: deben ser 10 dígitos' });
    const visitas = await visitasDe(pool, q.neg, cfg, tel);
    s.json({ activo: true, cada: cfg.cada, premio: cfg.premio, visitas, faltan: Math.max(0, cfg.cada - visitas) });
  }));
};
