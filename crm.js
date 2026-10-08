// CRM de la barbería: clientes, avisos del día, campañas, contenido y conexiones.
// Funciona sin conectar nada (envío asistido por WhatsApp y publicación manual);
// cuando se agregan accesos de Meta en "Conexiones", envía y publica solo.
module.exports = (app, api, d) => {
  const { pool, auth, wrap, HOY, bars, tel10, limita } = d;
  const GRAPH = 'https://graph.facebook.com/' + (process.env.GRAPH_VERSION || 'v21.0');
  const Q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const fechaMas = (f, n) => { const x = new Date(f + 'T12:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
  const base = q => `${q.protocol}://${q.get('host')}`;
  const fLarga = f => new Date(f + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS crm_clientes (negocio_id INT NOT NULL, telefono TEXT NOT NULL, nombre TEXT, notas TEXT, etiquetas TEXT DEFAULT '', cumple TEXT,
      avisos BOOLEAN DEFAULT true, fuente TEXT, creado TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (negocio_id, telefono))`);
    await pool.query('CREATE TABLE IF NOT EXISTS crm_envios (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, telefono TEXT NOT NULL, tipo TEXT NOT NULL, ref TEXT, canal TEXT, creado TIMESTAMPTZ DEFAULT now())');
    await pool.query('CREATE INDEX IF NOT EXISTS crm_envios_ix ON crm_envios(negocio_id, tipo, telefono)');
    await pool.query('CREATE TABLE IF NOT EXISTS crm_plantillas (negocio_id INT NOT NULL, tipo TEXT NOT NULL, texto TEXT NOT NULL, PRIMARY KEY (negocio_id, tipo))');
    await pool.query('CREATE TABLE IF NOT EXISTS crm_campanas (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, titulo TEXT NOT NULL, texto TEXT NOT NULL, segmento TEXT, creado TIMESTAMPTZ DEFAULT now())');
    await pool.query("CREATE TABLE IF NOT EXISTS crm_cola (id SERIAL PRIMARY KEY, campana_id INT NOT NULL, negocio_id INT NOT NULL, telefono TEXT NOT NULL, nombre TEXT, estado TEXT DEFAULT 'pendiente', enviado TIMESTAMPTZ)");
    await pool.query(`CREATE TABLE IF NOT EXISTS publicaciones (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, texto TEXT NOT NULL, img INT, cuando TIMESTAMPTZ NOT NULL, redes TEXT NOT NULL,
      estado TEXT DEFAULT 'programada', detalle TEXT, creado TIMESTAMPTZ DEFAULT now())`);
    await pool.query('CREATE TABLE IF NOT EXISTS integraciones (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, tipo TEXT NOT NULL, nombre TEXT, datos JSONB NOT NULL, activo BOOLEAN DEFAULT true, creado TIMESTAMPTZ DEFAULT now())');
    await pool.query('ALTER TABLE negocios ADD COLUMN IF NOT EXISTS resena TEXT');
  })().catch(console.error);

  const PLANT = {
    recordatorio: 'Hola {nombre}, te esperamos mañana {fecha} a las {hora} con {barbero} en {negocio}. Si necesitas cambiar tu cita: {agenda}',
    gracias: 'Gracias por venir a {negocio}, {nombre}. ¿Nos ayudas con una reseña? Te toma un minuto y nos ayuda muchísimo: {resena}',
    extranamos: 'Hola {nombre}, hace tiempo no te vemos en {negocio}. ¿Te apartamos un lugar esta semana? Agenda aquí: {agenda}',
    cumple: '¡Feliz cumpleaños, {nombre}! De parte de todo el equipo de {negocio}, que tengas un gran día. Cuando quieras tu corte de cumpleaños, agenda aquí: {agenda}',
    bienvenida: 'Hola {nombre}, gracias por tu interés en {negocio}. Agenda tu primera cita en un minuto aquí: {agenda}' };
  const TIT = { recordatorio: 'Recordatorio de cita', gracias: 'Gracias y reseña', extranamos: 'Te extrañamos', cumple: 'Cumpleaños', bienvenida: 'Bienvenida', campana: 'Campaña' };
  const plantillas = async n => { const r = await Q('SELECT tipo,texto FROM crm_plantillas WHERE negocio_id=$1', [n.id]); return { ...PLANT, ...Object.fromEntries(r.map(x => [x.tipo, x.texto])) }; };
  const pinta = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => v[k] != null && v[k] !== '' ? v[k] : (k === 'resena' ? v.agenda : ''));

  // Clientes = quienes han agendado (por WhatsApp) + los que agregues a mano.
  const clientes = async (n) => {
    const hoy = HOY(), [cit, man] = await Promise.all([
      Q(`SELECT right(regexp_replace(telefono,'\\D','','g'),10) AS tel, (array_agg(cliente ORDER BY fecha DESC, id DESC))[1] AS nombre,
        COUNT(*) FILTER (WHERE estado='completada')::int AS visitas, COALESCE(SUM(precio) FILTER (WHERE estado='completada'),0)::float AS gastado,
        (MAX(fecha) FILTER (WHERE estado='completada'))::text AS ultima, (MIN(fecha) FILTER (WHERE estado='pendiente' AND fecha>=$2))::text AS proxima,
        MIN(fecha)::text AS primera, COUNT(*) FILTER (WHERE estado='no_llego')::int AS faltas
        FROM citas WHERE negocio_id=$1 AND length(regexp_replace(telefono,'\\D','','g'))>=10 GROUP BY 1`, [n.id, hoy]),
      Q('SELECT telefono AS tel,nombre,notas,etiquetas,cumple,avisos,fuente,creado::date::text AS creado FROM crm_clientes WHERE negocio_id=$1', [n.id])]);
    const M = new Map(cit.map(c => [c.tel, { ...c, notas: '', etiquetas: '', cumple: '', avisos: true, fuente: '' }]));
    for (const x of man) { const c = M.get(x.tel); if (c) Object.assign(c, { notas: x.notas || '', etiquetas: x.etiquetas || '', cumple: x.cumple || '', avisos: x.avisos !== false, fuente: x.fuente || '', nombre: x.nombre || c.nombre });
      else M.set(x.tel, { tel: x.tel, nombre: x.nombre || 'Sin nombre', visitas: 0, gastado: 0, ultima: null, proxima: null, primera: x.creado, faltas: 0, notas: x.notas || '', etiquetas: x.etiquetas || '', cumple: x.cumple || '', avisos: x.avisos !== false, fuente: x.fuente || '' }); }
    const L = [...M.values()], dias = f => f ? Math.floor((new Date(hoy + 'T12:00') - new Date(f + 'T12:00')) / 864e5) : null;
    const top = L.filter(c => c.visitas >= 3).map(c => c.gastado).sort((a, b) => b - a), corte = top.length ? top[Math.max(0, Math.ceil(top.length * .1) - 1)] : Infinity, mesHoy = hoy.slice(5, 7);
    for (const c of L) {
      const d = dias(c.ultima), g = [];
      if (!c.visitas && !c.proxima) g.push('prospecto');
      if (c.visitas <= 1 && dias(c.primera) !== null && dias(c.primera) <= 30) g.push('nuevo');
      if (c.visitas >= 3) g.push('frecuente');
      if (c.visitas >= 3 && c.gastado >= corte) g.push('vip');
      if (d !== null && d >= 30 && d < 90 && !c.proxima) g.push('riesgo');
      if (d !== null && d >= 90 && !c.proxima) g.push('perdido');
      if (c.cumple && c.cumple.slice(0, 2) === mesHoy) g.push('cumple');
      c.dias = d; c.grupos = g;
    }
    return L.sort((a, b) => (b.ultima || b.primera || '').localeCompare(a.ultima || a.primera || ''));
  };

  // ---- WhatsApp, Facebook e Instagram (se activan al conectar)
  const cuentas = async (n, tipo) => Q('SELECT id,tipo,nombre,datos FROM integraciones WHERE negocio_id=$1 AND activo AND ($2::text IS NULL OR tipo=$2) ORDER BY id', [n.id, tipo || null]);
  const graph = async (ruta, token, body) => {
    const r = await fetch(GRAPH + ruta, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) } : { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error((j.error && j.error.message) || 'Error ' + r.status);
    return j;
  };
  const mandaWA = async (cta, tel, texto) => graph(`/${cta.datos.phone_id}/messages`, cta.datos.token, { messaging_product: 'whatsapp', to: '52' + tel, type: 'text', text: { body: texto.slice(0, 4000) } });
  const publica = async (cta, p, imgUrl) => {
    if (cta.tipo === 'facebook') return imgUrl ? graph(`/${cta.datos.page_id}/photos`, cta.datos.token, { url: imgUrl, caption: p.texto }) : graph(`/${cta.datos.page_id}/feed`, cta.datos.token, { message: p.texto });
    if (!imgUrl) throw new Error('Instagram necesita una foto');
    const c = await graph(`/${cta.datos.ig_id}/media`, cta.datos.token, { image_url: imgUrl, caption: p.texto });
    return graph(`/${cta.datos.ig_id}/media_publish`, cta.datos.token, { creation_id: c.id });
  };
  const BASE = process.env.PUBLIC_URL || '';
  const procesa = async () => {
    const L = await Q("UPDATE publicaciones SET estado='procesando' WHERE id IN (SELECT id FROM publicaciones WHERE estado='programada' AND cuando<=now() LIMIT 10) RETURNING *", []);
    for (const p of L) {
      const n = { id: p.negocio_id }, ctas = (await cuentas(n)).filter(c => p.redes.split(',').includes(c.tipo));
      if (!ctas.length || !BASE) { await pool.query("UPDATE publicaciones SET estado='lista' WHERE id=$1", [p.id]); continue; }
      const res = [];
      for (const c of ctas) { try { await publica(c, p, p.img ? `${BASE}/i/${p.img}` : null); res.push(`${c.nombre || c.tipo}: publicada`); } catch (e) { res.push(`${c.nombre || c.tipo}: ${e.message}`); } }
      const ok = res.every(x => x.endsWith('publicada'));
      await pool.query('UPDATE publicaciones SET estado=$1,detalle=$2 WHERE id=$3', [ok ? 'publicada' : 'error', res.join(' · ').slice(0, 500), p.id]);
    }
  };
  setInterval(() => procesa().catch(e => console.error('publicaciones:', e.message)), 60e3).unref();

  // ---- Inicio
  api.get('/crm/inicio', auth, wrap(async (q, s) => {
    const n = q.neg, L = await clientes(n), hoy = HOY(), b = await bandeja(q);
    const [pubs, conx] = await Promise.all([
      Q("SELECT COUNT(*) FILTER (WHERE estado IN ('programada','lista') AND cuando < $2::date + 1)::int hoy, COUNT(*) FILTER (WHERE estado='programada')::int prog, COUNT(*) FILTER (WHERE estado='lista')::int listas FROM publicaciones WHERE negocio_id=$1", [n.id, hoy]),
      Q('SELECT tipo,COUNT(*)::int c FROM integraciones WHERE negocio_id=$1 AND activo GROUP BY tipo', [n.id])]);
    const g = k => L.filter(c => c.grupos.includes(k)).length, conVis = L.filter(c => c.visitas > 0);
    s.json({ negocio: n.nombre, clientes: L.length, grupos: { nuevo: g('nuevo'), frecuente: g('frecuente'), vip: g('vip'), riesgo: g('riesgo'), perdido: g('perdido'), cumple: g('cumple'), prospecto: g('prospecto') },
      regresan: conVis.length ? Math.round(conVis.filter(c => c.visitas >= 2).length / conVis.length * 100) : 0,
      avisos: b.length, porTipo: b.reduce((a, x) => (a[x.tipo] = (a[x.tipo] || 0) + 1, a), {}), publicaciones: pubs[0], conexiones: Object.fromEntries(conx.map(x => [x.tipo, x.c])) });
  }));

  // ---- Clientes
  api.get('/crm/clientes', auth, wrap(async (q, s) => s.json(await clientes(q.neg))));
  api.get('/crm/cliente/:tel', auth, wrap(async (q, s) => {
    const tel = tel10(q.params.tel), c = (await clientes(q.neg)).find(x => x.tel === tel);
    if (!c) return s.status(404).json({ error: 'No encontramos ese cliente' });
    const [hist, env] = await Promise.all([
      Q("SELECT fecha::text AS fecha,hora,servicio,barbero,precio::float AS precio,estado FROM citas WHERE negocio_id=$1 AND right(regexp_replace(telefono,'\\D','','g'),10)=$2 ORDER BY fecha DESC,hora DESC LIMIT 40", [q.neg.id, tel]),
      Q('SELECT tipo,canal,creado FROM crm_envios WHERE negocio_id=$1 AND telefono=$2 ORDER BY creado DESC LIMIT 20', [q.neg.id, tel])]);
    s.json({ ...c, historial: hist, envios: env });
  }));
  api.post('/crm/cliente', auth, wrap(async (q, s) => {
    const b = q.body, tel = tel10(b.telefono), t = (k, l) => String(b[k] ?? '').trim().slice(0, l);
    if (tel.length !== 10) return s.status(400).json({ error: 'Escribe un WhatsApp de 10 dígitos' });
    const cumple = t('cumple', 5);
    if (cumple && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(cumple)) return s.status(400).json({ error: 'Cumpleaños no válido' });
    const et = t('etiquetas', 200).split(',').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 10).join(',');
    await pool.query(`INSERT INTO crm_clientes(negocio_id,telefono,nombre,notas,etiquetas,cumple,avisos,fuente) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (negocio_id,telefono) DO UPDATE SET nombre=COALESCE(NULLIF($3,''),crm_clientes.nombre),notas=$4,etiquetas=$5,cumple=$6,avisos=$7,fuente=COALESCE(NULLIF($8,''),crm_clientes.fuente)`,
      [q.neg.id, tel, t('nombre', 80), t('notas', 1000), et, cumple || null, b.avisos !== false, t('fuente', 40)]);
    s.json({ ok: true, tel });
  }));

  // ---- Avisos del día (sugeridos + campañas)
  const bandeja = async q => {
    const n = q.neg, hoy = HOY(), man = fechaMas(hoy, 1), ayer = fechaMas(hoy, -1), P = await plantillas(n), L = await clientes(n), C = new Map(L.map(c => [c.tel, c]));
    const v0 = { negocio: n.nombre, agenda: `${base(q)}/${n.slug}/agenda`, resena: n.resena || '' }, fuera = new Set(L.filter(c => !c.avisos).map(c => c.tel)), items = [];
    const env = await Q("SELECT tipo,telefono,ref,creado FROM crm_envios WHERE negocio_id=$1 AND creado > now() - interval '400 days'", [n.id]);
    const ya = (tipo, ref) => env.some(e => e.tipo === tipo && e.ref === ref), reciente = (tipo, tel, dd) => env.some(e => e.tipo === tipo && e.telefono === tel && (Date.now() - new Date(e.creado)) < dd * 864e5);
    const add = (tipo, tel, ref, v, det) => { if (fuera.has(tel) || ya(tipo, ref)) return; const nom = (v.nombre || '').trim().split(' ')[0]; items.push({ tipo, titulo: TIT[tipo], tel, ref, nombre: v.nombre, detalle: det, texto: pinta(P[tipo], { ...v0, ...v, nombre: nom }) }); };
    const cit = await Q("SELECT id,cliente,right(regexp_replace(telefono,'\\D','','g'),10) AS tel,fecha::text AS fecha,hora,barbero,servicio,estado FROM citas WHERE negocio_id=$1 AND ((estado='pendiente' AND fecha=$2) OR (estado='completada' AND fecha BETWEEN $3 AND $4)) AND length(regexp_replace(telefono,'\\D','','g'))>=10 ORDER BY fecha,hora", [n.id, man, ayer, hoy]);
    for (const c of cit) {
      if (c.estado === 'pendiente') add('recordatorio', c.tel, 'cita:' + c.id, { nombre: c.cliente, fecha: fLarga(c.fecha), hora: c.hora, barbero: c.barbero }, `Mañana ${c.hora} · ${c.servicio} con ${c.barbero}`);
      else add('gracias', c.tel, 'cita:' + c.id, { nombre: c.cliente }, `Vino ${c.fecha === hoy ? 'hoy' : 'ayer'} · ${c.servicio}`);
    }
    for (const c of L) {
      if (c.grupos.includes('riesgo') && !reciente('extranamos', c.tel, 30)) add('extranamos', c.tel, 'x:' + c.tel + ':' + hoy.slice(0, 7), c, `Hace ${c.dias} días de su última visita`);
      if (c.cumple === hoy.slice(5)) add('cumple', c.tel, 'c:' + c.tel + ':' + hoy.slice(0, 4), c, 'Cumple años hoy');
      if (c.grupos.includes('prospecto') && !reciente('bienvenida', c.tel, 3650)) add('bienvenida', c.tel, 'b:' + c.tel, c, c.fuente ? 'Llegó por ' + c.fuente : 'Cliente nuevo');
    }
    const cola = await Q("SELECT k.id,k.telefono AS tel,k.nombre,m.titulo,m.texto FROM crm_cola k JOIN crm_campanas m ON m.id=k.campana_id WHERE k.negocio_id=$1 AND k.estado='pendiente' ORDER BY k.id LIMIT 300", [n.id]);
    for (const k of cola) if (!fuera.has(k.tel)) items.push({ tipo: 'campana', titulo: 'Campaña: ' + k.titulo, tel: k.tel, ref: 'k:' + k.id, nombre: k.nombre, detalle: (C.get(k.tel) || {}).visitas ? `${C.get(k.tel).visitas} visitas` : '', texto: pinta(k.texto, { ...v0, nombre: (k.nombre || '').split(' ')[0] }) });
    return items;
  };
  api.get('/crm/bandeja', auth, wrap(async (q, s) => s.json({ items: await bandeja(q), whatsapp: (await cuentas(q.neg, 'whatsapp')).length > 0 })));
  const marca = async (q, it, canal) => {
    const tel = tel10(it.tel), ref = String(it.ref || '').slice(0, 80);
    await pool.query('INSERT INTO crm_envios(negocio_id,telefono,tipo,ref,canal) VALUES($1,$2,$3,$4,$5)', [q.neg.id, tel, String(it.tipo).slice(0, 20), ref, canal]);
    if (ref.startsWith('k:')) await pool.query("UPDATE crm_cola SET estado=$1,enviado=now() WHERE id=$2 AND negocio_id=$3", [canal === 'omitido' ? 'omitido' : 'enviado', parseInt(ref.slice(2)) || 0, q.neg.id]);
  };
  api.post('/crm/marcar', auth, wrap(async (q, s) => { await marca(q, q.body, q.body.omitir ? 'omitido' : 'manual'); s.json({ ok: true }); }));
  api.post('/crm/enviar', auth, wrap(async (q, s) => {
    const [cta] = await cuentas(q.neg, 'whatsapp');
    if (!cta) return s.status(400).json({ error: 'Conecta WhatsApp en "Conexiones" para enviar automático' });
    const L = (await bandeja(q)).filter(x => !q.body.tipo || x.tipo === q.body.tipo).slice(0, 100), r = { enviados: 0, errores: [] };
    for (const it of L) { try { await mandaWA(cta, it.tel, it.texto); await marca(q, it, 'api'); r.enviados++; } catch (e) { r.errores.push(`${it.nombre}: ${e.message}`); } }
    s.json(r);
  }));
  api.get('/crm/plantillas', auth, wrap(async (q, s) => { const P = await plantillas(q.neg); s.json({ plantillas: Object.keys(PLANT).map(k => ({ tipo: k, titulo: TIT[k], texto: P[k], base: PLANT[k] })), resena: q.neg.resena || '' }); }));
  api.post('/crm/plantilla', auth, wrap(async (q, s) => {
    const t = q.body.tipo, x = String(q.body.texto || '').trim().slice(0, 1000);
    if (!PLANT[t]) return s.status(400).json({ error: 'Plantilla no válida' });
    if (!x || x === PLANT[t]) await pool.query('DELETE FROM crm_plantillas WHERE negocio_id=$1 AND tipo=$2', [q.neg.id, t]);
    else await pool.query('INSERT INTO crm_plantillas(negocio_id,tipo,texto) VALUES($1,$2,$3) ON CONFLICT (negocio_id,tipo) DO UPDATE SET texto=$3', [q.neg.id, t, x]);
    s.json({ ok: true });
  }));
  api.post('/crm/resena', auth, wrap(async (q, s) => {
    const u = String(q.body.url || '').trim().slice(0, 300);
    if (u && !/^https:\/\//.test(u)) return s.status(400).json({ error: 'Pega el enlace completo (empieza con https://)' });
    await pool.query('UPDATE negocios SET resena=$1 WHERE id=$2', [u || null, q.neg.id]); s.json({ ok: true });
  }));
  api.post('/crm/campana', auth, wrap(async (q, s) => {
    const titulo = String(q.body.titulo || '').trim().slice(0, 80), texto = String(q.body.texto || '').trim().slice(0, 1000), seg = String(q.body.segmento || 'todos');
    if (!titulo || !texto) return s.status(400).json({ error: 'Escribe el nombre y el mensaje de la campaña' });
    const L = (await clientes(q.neg)).filter(c => c.avisos && (seg === 'todos' || c.grupos.includes(seg) || (seg.startsWith('#') && c.etiquetas.split(',').includes(seg.slice(1)))));
    if (!L.length) return s.status(400).json({ error: 'No hay clientes en ese grupo' });
    if (L.length > 500) return s.status(400).json({ error: 'Máximo 500 clientes por campaña' });
    const m = await pool.query('INSERT INTO crm_campanas(negocio_id,titulo,texto,segmento) VALUES($1,$2,$3,$4) RETURNING id', [q.neg.id, titulo, texto, seg]);
    for (const c of L) await pool.query('INSERT INTO crm_cola(campana_id,negocio_id,telefono,nombre) VALUES($1,$2,$3,$4)', [m.rows[0].id, q.neg.id, c.tel, c.nombre]);
    s.json({ id: m.rows[0].id, total: L.length });
  }));
  api.get('/crm/campanas', auth, wrap(async (q, s) => s.json(await Q(`SELECT m.id,m.titulo,m.segmento,m.creado,COUNT(k.*)::int total,COUNT(k.*) FILTER (WHERE k.estado='enviado')::int enviados,COUNT(k.*) FILTER (WHERE k.estado='pendiente')::int pendientes
    FROM crm_campanas m LEFT JOIN crm_cola k ON k.campana_id=m.id WHERE m.negocio_id=$1 GROUP BY m.id ORDER BY m.id DESC LIMIT 20`, [q.neg.id]))));
  api.post('/crm/campana/cerrar', auth, wrap(async (q, s) => { await pool.query("UPDATE crm_cola SET estado='omitido' WHERE campana_id=$1 AND negocio_id=$2 AND estado='pendiente'", [q.body.id, q.neg.id]); s.json({ ok: true }); }));

  // ---- Contenido para redes
  api.get('/crm/publicaciones', auth, wrap(async (q, s) => s.json({
    lista: await Q("SELECT id,texto,img,cuando,redes,estado,detalle FROM publicaciones WHERE negocio_id=$1 AND (estado<>'publicada' OR cuando > now() - interval '30 days') ORDER BY cuando DESC LIMIT 60", [q.neg.id]),
    cuentas: (await cuentas(q.neg)).filter(c => c.tipo !== 'whatsapp').map(c => ({ tipo: c.tipo, nombre: c.nombre })), automatico: !!BASE })));
  api.post('/crm/publicacion', auth, wrap(async (q, s) => {
    const b = q.body, texto = String(b.texto || '').trim().slice(0, 2200), redes = (Array.isArray(b.redes) ? b.redes : []).filter(x => ['facebook', 'instagram'].includes(x));
    const cuando = new Date(b.cuando), img = b.img ? parseInt(b.img) : null;
    if (!texto || !redes.length || isNaN(cuando)) return s.status(400).json({ error: 'Escribe el texto, elige al menos una red y la fecha' });
    if (img && !(await Q('SELECT 1 FROM imagenes WHERE id=$1 AND negocio_id=$2', [img, q.neg.id])).length) return s.status(400).json({ error: 'Foto no válida' });
    if (redes.includes('instagram') && !img) return s.status(400).json({ error: 'Instagram necesita una foto' });
    if (b.id) { await pool.query("UPDATE publicaciones SET texto=$1,img=$2,cuando=$3,redes=$4,estado='programada',detalle=NULL WHERE id=$5 AND negocio_id=$6 AND estado<>'publicada'", [texto, img, cuando, redes.join(','), b.id, q.neg.id]); return s.json({ id: b.id }); }
    s.json({ id: (await pool.query('INSERT INTO publicaciones(negocio_id,texto,img,cuando,redes) VALUES($1,$2,$3,$4,$5) RETURNING id', [q.neg.id, texto, img, cuando, redes.join(',')])).rows[0].id });
  }));
  api.post('/crm/publicacion/foto', auth, wrap(async (q, s) => {
    const m = /^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(q.body.data || ''));
    if (!m) return s.status(400).json({ error: 'La foto debe ser JPG' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.subarray(0, 3).toString('hex') !== 'ffd8ff' || buf.length > 900 * 1024) return s.status(400).json({ error: 'Foto no válida o muy pesada' });
    const ref = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
    s.json({ id: (await pool.query("INSERT INTO imagenes(negocio_id,tipo,ref,mime,data) VALUES($1,'post',$2,'image/jpeg',$3) RETURNING id", [q.neg.id, ref, buf])).rows[0].id });
  }));
  api.post('/crm/publicacion/estado', auth, wrap(async (q, s) => {
    const e = q.body.estado;
    if (e === 'borrar') await pool.query('DELETE FROM publicaciones WHERE id=$1 AND negocio_id=$2', [q.body.id, q.neg.id]);
    else if (['publicada', 'lista'].includes(e)) await pool.query('UPDATE publicaciones SET estado=$1 WHERE id=$2 AND negocio_id=$3', [e, q.body.id, q.neg.id]);
    else return s.status(400).json({ error: 'Estado no válido' });
    s.json({ ok: true });
  }));

  // ---- Conexiones (los accesos nunca se devuelven completos)
  const CAMPOS = { whatsapp: ['phone_id', 'token'], facebook: ['page_id', 'token'], instagram: ['ig_id', 'token'] };
  api.get('/crm/conexiones', auth, wrap(async (q, s) => s.json((await Q('SELECT id,tipo,nombre,datos,activo FROM integraciones WHERE negocio_id=$1 ORDER BY tipo,id', [q.neg.id]))
    .map(c => ({ id: c.id, tipo: c.tipo, nombre: c.nombre, activo: c.activo, cuenta: c.datos.phone_id || c.datos.page_id || c.datos.ig_id, token: '••••' + String(c.datos.token || '').slice(-4) })))));
  api.post('/crm/conexion', auth, wrap(async (q, s) => {
    const t = q.body.tipo, F = CAMPOS[t];
    if (!F) return s.status(400).json({ error: 'Tipo de conexión no válido' });
    const datos = Object.fromEntries(F.map(k => [k, String(q.body[k] || '').trim()]));
    if (F.some(k => !datos[k]) || !/^\d{5,25}$/.test(datos[F[0]])) return s.status(400).json({ error: 'Llena el identificador (solo números) y el token de acceso' });
    let nombre = String(q.body.nombre || '').trim().slice(0, 60);
    try { const r = await graph('/' + datos[F[0]] + '?fields=' + (t === 'whatsapp' ? 'display_phone_number,verified_name' : t === 'instagram' ? 'username' : 'name'), datos.token); nombre = nombre || r.name || r.username || r.verified_name || r.display_phone_number || ''; }
    catch (e) { return s.status(400).json({ error: 'Meta rechazó los datos: ' + e.message }); }
    await pool.query('INSERT INTO integraciones(negocio_id,tipo,nombre,datos) VALUES($1,$2,$3,$4)', [q.neg.id, t, nombre || t, datos]);
    s.json({ ok: true, nombre });
  }));
  api.post('/crm/conexion/borrar', auth, wrap(async (q, s) => { await pool.query('DELETE FROM integraciones WHERE id=$1 AND negocio_id=$2', [q.body.id, q.neg.id]); s.json({ ok: true }); }));

  // ---- La app
  const existe = async (q, s, n) => { try { (await Q('SELECT 1 FROM negocios WHERE slug=$1', [q.params.slug])).length ? n() : s.status(404).send('Negocio no encontrado'); } catch (e) { s.status(500).send('Error'); } };
  app.get('/:slug/crm', existe, (q, s) => s.sendFile('app-crm.html', { root: __dirname + '/public' }));
  app.get('/:slug/crm.json', existe, (q, s) => s.type('application/manifest+json').json({ id: `/${q.params.slug}/crm`, name: 'CRM de la barbería', short_name: 'CRM', start_url: `/${q.params.slug}/crm`, scope: `/${q.params.slug}/crm`,
    display: 'standalone', orientation: 'portrait', background_color: '#0b0d12', theme_color: '#0b0d12', lang: 'es', icons: [{ src: '/icon-crm.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }, { src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] }));
};
