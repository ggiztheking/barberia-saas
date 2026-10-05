const express = require('express'), { Pool } = require('pg'), crypto = require('crypto');
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((q, s, n) => { s.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' }); n(); });
app.use('/img', express.static('public/img', { maxAge: '7d' }));
app.use(express.static('public', { maxAge: 0, etag: true }));
app.get('/health', (q, s) => s.send('ok'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const wrap = f => (q, s) => f(q, s).catch(e => { console.error(e); s.status(500).json({ error: 'Error del servidor' }); });
const hits = new Map();
setInterval(() => hits.clear(), 3600e3).unref();
const limita = (k, max, ms) => { const n = Date.now(), a = (hits.get(k) || []).filter(t => n - t < ms); a.push(n); hits.set(k, a); return a.length > max; };
const hashPass = (p, salt) => crypto.scryptSync(String(p), salt, 32).toString('hex');
const okPass = (n, p) => !!(n.salt && typeof p === 'string' && crypto.timingSafeEqual(Buffer.from(hashPass(p, n.salt), 'hex'), Buffer.from(n.hash, 'hex')));
const wa = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 10 ? '52' + d : d; };
const vigente = n => n.activo !== false && (!n.vence || new Date(n.vence) >= new Date());
const todas = n => Array.from({ length: n.hora_fin - n.hora_ini + 1 }, (_, k) => String(n.hora_ini + k).padStart(2, '0') + ':00');
const cerrado = (n, f) => (n.cierra || '').split(',').includes(String(new Date(f + 'T12:00').getDay()));
const avisa = (n, d) => {
  const u = process.env.MAKE_WEBHOOK_URL, tel = wa(n.avisos || n.whatsapp);
  if (!u || !tel) return;
  const f = new Date(d.fecha + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const txt = d.evento === 'cita_cancelada'
    ? `Cita cancelada en ${n.nombre}: ${d.cliente} · ${d.servicio} con ${d.barbero} · ${f} a las ${d.hora}.`
    : `Nueva cita en ${n.nombre}: ${d.cliente} · ${d.servicio} con ${d.barbero} · ${f} a las ${d.hora} · $${Number(d.precio)}. WhatsApp del cliente: ${d.telefono}`;
  fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, negocio: n.nombre, slug: n.slug, avisar_a: tel, mensaje: txt }) }).catch(e => console.error('make:', e.message));
};
const bars = n => n.barberos.split(',').map(x => x.trim()).filter(Boolean);
const SEED = [
 ['Taper clásico','clásico','Laterales degradados suaves y largo natural arriba.',200],['Corte a tijera','clásico','Todo el corte con tijera, acabado natural.',200],
 ['Pompadour','clásico','Volumen al frente peinado hacia atrás.',200],['Raya lateral','clásico','El corte formal de siempre, con raya marcada.',200],
 ['Corte militar','clásico','Corto y parejo, fácil de mantener.',200],['Low fade','nuevo','Degradado bajo que arranca sobre la oreja.',200],
 ['Mid fade','nuevo','Degradado medio, el más pedido.',200],['Burst fade','nuevo','Degradado curvo alrededor de la oreja.',200],
 ['Textured crop','nuevo','Corto con textura arriba y flequillo.',200],['Mullet moderno','nuevo','Corto a los lados, largo atrás.',200],
 ['Corte y barba','servicio','Corte a elegir más perfilado de barba con navaja.',350],['Barba con navaja','servicio','Toalla caliente, navaja y aceite.',130]];
const PROD = [['Pomada mate','Fijación fuerte sin brillo.',180],['Cera con brillo','Acabado clásico y peinado pulido.',180],
 ['Aceite para barba','Suaviza e hidrata.',160],['Shampoo para barba','Limpieza diaria.',140],['Spray texturizante','Volumen y textura.',170]];
const seed = async id => {
  for (const r of SEED) await pool.query('INSERT INTO estilos(nombre,tipo,descripcion,precio,negocio_id) VALUES($1,$2,$3,$4,$5)', [...r, id]);
  for (const r of PROD) await pool.query('INSERT INTO productos(nombre,descripcion,precio,negocio_id) VALUES($1,$2,$3,$4)', [...r, id]);
};
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS negocios (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, whatsapp TEXT, direccion TEXT, maps TEXT,
    barberos TEXT NOT NULL DEFAULT 'Barbero 1', hora_ini INT DEFAULT 10, hora_fin INT DEFAULT 19, fotos BOOLEAN DEFAULT false, plan TEXT DEFAULT 'prueba', salt TEXT, hash TEXT, creado TIMESTAMPTZ DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS citas (id SERIAL PRIMARY KEY, cliente TEXT NOT NULL, telefono TEXT, barbero TEXT NOT NULL, servicio TEXT NOT NULL,
    fecha DATE NOT NULL, hora TEXT NOT NULL, precio NUMERIC DEFAULT 0, estado TEXT DEFAULT 'pendiente')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS estilos (id SERIAL PRIMARY KEY, nombre TEXT, tipo TEXT, descripcion TEXT, precio NUMERIC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS productos (id SERIAL PRIMARY KEY, nombre TEXT, descripcion TEXT, precio NUMERIC)`);
  await pool.query('ALTER TABLE citas ADD COLUMN IF NOT EXISTS codigo TEXT');
  for (const t of ['citas', 'estilos', 'productos']) await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS negocio_id INT`);
  await pool.query('ALTER TABLE negocios ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true');
  await pool.query('ALTER TABLE negocios ADD COLUMN IF NOT EXISTS vence TIMESTAMPTZ');
  await pool.query("ALTER TABLE negocios ADD COLUMN IF NOT EXISTS cierra TEXT DEFAULT ''");
  await pool.query('ALTER TABLE negocios ADD COLUMN IF NOT EXISTS avisos TEXT');
  await pool.query('CREATE TABLE IF NOT EXISTS bloqueos (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, barbero TEXT NOT NULL, fecha DATE NOT NULL, hora TEXT, motivo TEXT)');
  let o = (await pool.query("SELECT id FROM negocios WHERE slug='onyx'")).rows[0];
  if (!o) {
    const salt = crypto.randomBytes(8).toString('hex');
    o = (await pool.query("INSERT INTO negocios(slug,nombre,whatsapp,direccion,maps,barberos,fotos,salt,hash) VALUES('onyx','Onyx Barbería','529623295413','Fracc. Los Héroes, Mérida, Yucatán','https://maps.app.goo.gl/NpfSt23Eorm4wgd37',$1,true,$2,$3) RETURNING id",
      [process.env.BARBEROS || 'Pedro,GGTHEBARBER', salt, hashPass(process.env.ADMIN_PASS || crypto.randomBytes(9).toString('hex'), salt)])).rows[0];
  }
  await pool.query("UPDATE negocios SET plan='pro' WHERE slug='onyx' AND plan='prueba'");
  for (const t of ['citas', 'estilos', 'productos']) await pool.query(`UPDATE ${t} SET negocio_id=$1 WHERE negocio_id IS NULL`, [o.id]);
  if (!(await pool.query('SELECT 1 FROM estilos WHERE negocio_id=$1', [o.id])).rowCount) await seed(o.id);
  await pool.query('DROP INDEX IF EXISTS citas_slot');
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS citas_slot2 ON citas(negocio_id,barbero,fecha,hora) WHERE estado<>'cancelada'");
})().catch(console.error);

const SUPER = process.env.SUPER_PASS || '';
const superAuth = (q, s, n) => {
  const k = 's' + q.ip, p = q.get('x-super') || '';
  if ((hits.get(k) || []).filter(t => Date.now() - t < 6e5).length >= 8) return s.status(429).json({ error: 'Demasiados intentos' });
  if (SUPER && p.length === SUPER.length && crypto.timingSafeEqual(Buffer.from(p), Buffer.from(SUPER))) return n();
  limita(k, 99, 6e5); s.status(401).json({ error: 'Acceso denegado' });
};
app.get('/api/super/negocios', superAuth, wrap(async (q, s) => s.json((await pool.query(
  'SELECT n.id,n.slug,n.nombre,n.whatsapp,n.plan,n.activo,n.vence,n.creado,(SELECT COUNT(*)::int FROM citas c WHERE c.negocio_id=n.id) AS citas FROM negocios n ORDER BY n.id')).rows)));
app.get('/api/super/insights', superAuth, wrap(async (q, s) => {
  const hoy = HOY(), d = new Date(hoy + 'T12:00'); d.setDate(d.getDate() - 6);
  const h7 = d.toLocaleDateString('en-CA'), Q = (sql, p = []) => pool.query(sql, p).then(r => r.rows);
  const [sem, act, c7, porVencer, inact, tot] = await Promise.all([
    Q("SELECT to_char(date_trunc('week',creado),'YYYY-MM-DD') semana, COUNT(*)::int n FROM negocios GROUP BY 1 ORDER BY 1 DESC LIMIT 8"),
    Q('SELECT COUNT(DISTINCT negocio_id)::int n FROM citas WHERE fecha>=$1 AND fecha<=$2', [h7, hoy]),
    Q("SELECT COUNT(*)::int n, COALESCE(SUM(precio) FILTER (WHERE estado='completada'),0)::float ingresos FROM citas WHERE fecha>=$1 AND fecha<=$2", [h7, hoy]),
    Q("SELECT id,slug,nombre,vence FROM negocios WHERE plan='prueba' AND activo AND vence BETWEEN now() AND now()+interval '3 days' ORDER BY vence"),
    Q("SELECT id,slug,nombre FROM negocios n WHERE creado < now()-interval '2 days' AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.negocio_id=n.id) ORDER BY id"),
    Q("SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE plan<>'prueba')::int pago, COUNT(*) FILTER (WHERE plan='prueba' AND vence<now())::int vencidas FROM negocios")]);
  s.json({ semanas: sem.reverse(), activas7: act[0].n, citas7: c7[0].n, ingresos7: c7[0].ingresos, porVencer, inactivas: inact, ...tot[0] });
}));
app.post('/api/super/negocio/:id', superAuth, wrap(async (q, s) => {
  const mas = "GREATEST(COALESCE(vence,now()),now())", A = {
    pagar_basico: `plan='basico',activo=true,vence=${mas}+interval '30 days'`, pagar_pro: `plan='pro',activo=true,vence=${mas}+interval '30 days'`,
    extender: `vence=${mas}+interval '14 days'`, suspender: 'activo=false', activar: 'activo=true' }[q.body.accion];
  if (!A) return s.status(400).json({ error: 'Acción no válida' });
  await pool.query(`UPDATE negocios SET ${A} WHERE id=$1`, [q.params.id]);
  s.json({ ok: true });
}));
const RES = ['api', 'registro', 'img', 'health', 'admin', 'agenda', 'super', 'manifest'];
app.post('/api/registro', wrap(async (q, s) => {
  if (limita('r' + q.ip, 5, 3600e3)) return s.status(429).json({ error: 'Demasiados registros. Intenta más tarde.' });
  const nombre = String(q.body.nombre || '').trim().slice(0, 60), slug = String(q.body.slug || '').toLowerCase(), pw = String(q.body.password || '');
  if (!nombre || !/^[a-z0-9-]{3,30}$/.test(slug) || RES.includes(slug) || pw.length < 8)
    return s.status(400).json({ error: 'Revisa el nombre, el enlace (3 a 30 letras, números o guiones) y la contraseña (mínimo 8 caracteres)' });
  const salt = crypto.randomBytes(8).toString('hex');
  try {
    const r = await pool.query("INSERT INTO negocios(slug,nombre,whatsapp,salt,hash,vence) VALUES($1,$2,$3,$4,$5,now()+interval '14 days') RETURNING id", [slug, nombre, wa(q.body.whatsapp) || null, salt, hashPass(pw, salt)]);
    await seed(r.rows[0].id);
    s.json({ slug });
  } catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese enlace ya está en uso. Prueba otro.' }); throw x; }
}));

const api = express.Router({ mergeParams: true });
app.use('/api/:slug', async (q, s, n) => {
  try {
    const r = await pool.query('SELECT * FROM negocios WHERE slug=$1', [q.params.slug]);
    if (!r.rowCount) return s.status(404).json({ error: 'Negocio no encontrado' });
    q.neg = r.rows[0]; n();
  } catch (e) { s.status(500).json({ error: 'Error del servidor' }); }
}, api);
const auth = (q, s, n) => {
  const k = 'a' + q.ip + q.params.slug;
  if ((hits.get(k) || []).filter(t => Date.now() - t < 6e5).length >= 8) return s.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' });
  if (okPass(q.neg, q.get('x-admin'))) return n();
  limita(k, 99, 6e5); s.status(401).json({ error: 'Contraseña incorrecta' });
};
api.get('/info', (q, s) => { const n = q.neg; s.json({ nombre: n.nombre, direccion: n.direccion, whatsapp: n.whatsapp, maps: n.maps, barberos: bars(n), fotos: n.fotos, abierto: vigente(n), hora_ini: n.hora_ini, hora_fin: n.hora_fin }); });
api.get('/estilos', wrap(async (q, s) => s.json((await pool.query('SELECT id,nombre,tipo,descripcion,precio FROM estilos WHERE negocio_id=$1 ORDER BY id', [q.neg.id])).rows)));
api.get('/productos', wrap(async (q, s) => s.json((await pool.query('SELECT id,nombre,descripcion,precio FROM productos WHERE negocio_id=$1 ORDER BY id', [q.neg.id])).rows)));
api.get('/horarios', wrap(async (q, s) => {
  const { fecha, barbero } = q.query, n = q.neg;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return s.json([]);
  if (cerrado(n, fecha)) return s.json(todas(n));
  const r = await pool.query("SELECT hora FROM citas WHERE negocio_id=$1 AND fecha=$2 AND barbero=$3 AND estado<>'cancelada'", [n.id, fecha, barbero]);
  const b = await pool.query('SELECT hora FROM bloqueos WHERE negocio_id=$1 AND fecha=$2 AND barbero=$3', [n.id, fecha, barbero]);
  s.json(b.rows.some(x => x.hora === null) ? todas(n) : [...r.rows, ...b.rows].map(x => x.hora));
}));
api.post('/citas', wrap(async (q, s) => {
  if (limita('c' + q.ip, 10, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  if (!vigente(q.neg)) return s.status(403).json({ error: 'Esta barbería no está recibiendo citas por ahora.' });
  const n = q.neg, { cliente, telefono, barbero, servicio, fecha, hora } = q.body, h = +String(hora).slice(0, 2);
  if (!cliente || !telefono || !bars(n).includes(barbero) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora) || h < n.hora_ini || h > n.hora_fin)
    return s.status(400).json({ error: 'Revisa los datos de tu cita' });
  if (fecha < HOY()) return s.status(400).json({ error: 'Elige una fecha de hoy en adelante' });
  const e = await pool.query('SELECT precio FROM estilos WHERE nombre=$1 AND negocio_id=$2', [servicio, n.id]);
  if (!e.rowCount) return s.status(400).json({ error: 'Servicio no válido' });
  if (cerrado(n, fecha) || (await pool.query('SELECT 1 FROM bloqueos WHERE negocio_id=$1 AND fecha=$2 AND barbero=$3 AND (hora IS NULL OR hora=$4)', [n.id, fecha, barbero, hora])).rowCount)
    return s.status(409).json({ error: 'Ese horario no está disponible. Elige otro.' });
  try {
    const r = await pool.query('INSERT INTO citas(cliente,telefono,barbero,servicio,fecha,hora,precio,codigo,negocio_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING codigo,precio',
      [String(cliente).slice(0, 80), String(telefono).slice(0, 20), barbero, servicio, fecha, hora, e.rows[0].precio, crypto.randomBytes(6).toString('hex'), n.id]);
    avisa(n, { evento: 'nueva_cita', cliente: String(cliente).slice(0, 80), telefono: String(telefono).slice(0, 20), barbero, servicio, fecha, hora, precio: Number(r.rows[0].precio) });
    s.json(r.rows[0]);
  } catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese horario ya se ocupó. Elige otro.' }); throw x; }
}));
api.post('/mis-citas', wrap(async (q, s) => {
  const c = (Array.isArray(q.body.codigos) ? q.body.codigos : []).filter(x => typeof x === 'string').slice(0, 20);
  s.json((await pool.query('SELECT codigo,servicio,barbero,fecha::text AS fecha,hora,precio,estado FROM citas WHERE negocio_id=$1 AND codigo = ANY($2) AND fecha >= $3 ORDER BY fecha,hora', [q.neg.id, c, HOY()])).rows);
}));
api.post('/cancelar', wrap(async (q, s) => {
  const r = await pool.query("UPDATE citas SET estado='cancelada' WHERE negocio_id=$1 AND codigo=$2 AND estado='pendiente' RETURNING cliente,telefono,servicio,barbero,fecha::text AS fecha,hora,precio", [q.neg.id, String(q.body.codigo)]);
  if (!r.rowCount) return s.status(404).json({ error: 'No se pudo cancelar esa cita' });
  avisa(q.neg, { evento: 'cita_cancelada', ...r.rows[0], precio: Number(r.rows[0].precio) });
  s.json({ ok: true });
}));
api.get('/admin/citas', auth, wrap(async (q, s) => s.json((await pool.query('SELECT * FROM citas WHERE negocio_id=$1 AND fecha=$2 ORDER BY hora', [q.neg.id, q.query.fecha])).rows)));
api.patch('/admin/citas/:id', auth, wrap(async (q, s) => s.json((await pool.query('UPDATE citas SET estado=$1 WHERE id=$2 AND negocio_id=$3 RETURNING *', [q.body.estado, q.params.id, q.neg.id])).rows[0] || {})));
api.get('/admin/corte', auth, wrap(async (q, s) => s.json((await pool.query(
  "SELECT barbero, COUNT(*)::int cortes, COALESCE(SUM(precio),0)::float total FROM citas WHERE negocio_id=$1 AND fecha=$2 AND estado='completada' GROUP BY barbero", [q.neg.id, q.query.fecha])).rows)));
api.get('/admin/catalogo', auth, wrap(async (q, s) => s.json({
  estilos: (await pool.query('SELECT id,nombre,precio FROM estilos WHERE negocio_id=$1 ORDER BY id', [q.neg.id])).rows,
  productos: (await pool.query('SELECT id,nombre,precio FROM productos WHERE negocio_id=$1 ORDER BY id', [q.neg.id])).rows })));
api.patch('/admin/precio', auth, wrap(async (q, s) => {
  const { tabla, id, precio } = q.body;
  if (!['estilos', 'productos'].includes(tabla) || !(precio >= 0 && precio <= 100000)) return s.status(400).json({ error: 'Dato no válido' });
  s.json((await pool.query(`UPDATE ${tabla} SET precio=$1 WHERE id=$2 AND negocio_id=$3 RETURNING id`, [precio, id, q.neg.id])).rows[0] || {});
}));
api.get('/admin/insights', auth, wrap(async (q, s) => {
  const dias = q.query.dias === '30' ? 30 : 7, hasta = HOY(), d = new Date(hasta + 'T12:00'); d.setDate(d.getDate() - (dias - 1));
  const desde = d.toLocaleDateString('en-CA'), id = q.neg.id, P = [id, desde, hasta];
  const W = 'negocio_id=$1 AND fecha BETWEEN $2 AND $3', C = W + " AND estado='completada'", Q = (sql, p = P) => pool.query(sql, p).then(r => r.rows);
  const [dia, est, srv, bar, hor, cli, pend, vieja] = await Promise.all([
    Q(`SELECT fecha::text f, COUNT(*)::int cortes, COALESCE(SUM(precio),0)::float ingresos FROM citas WHERE ${C} GROUP BY fecha`),
    Q(`SELECT estado, COUNT(*)::int n FROM citas WHERE ${W} GROUP BY estado`),
    Q(`SELECT servicio, COUNT(*)::int n, COALESCE(SUM(precio),0)::float ingresos FROM citas WHERE ${C} GROUP BY servicio ORDER BY n DESC LIMIT 5`),
    Q(`SELECT barbero, COUNT(*)::int n, COALESCE(SUM(precio),0)::float ingresos FROM citas WHERE ${C} GROUP BY barbero ORDER BY ingresos DESC`),
    Q(`SELECT hora, COUNT(*)::int n FROM citas WHERE ${W} AND estado<>'cancelada' GROUP BY hora ORDER BY hora`),
    Q(`SELECT COUNT(DISTINCT telefono)::int total, COUNT(DISTINCT telefono) FILTER (WHERE telefono IN (SELECT telefono FROM citas WHERE negocio_id=$1 AND fecha<$2 AND estado='completada'))::int recurrentes FROM citas WHERE ${C}`),
    Q("SELECT COUNT(*)::int n FROM citas WHERE negocio_id=$1 AND fecha>=$2 AND estado='pendiente'", [id, hasta]),
    Q("SELECT COUNT(*)::int n FROM citas WHERE negocio_id=$1 AND fecha<$2 AND estado='pendiente'", [id, hasta])]);
  s.json({ dias, porDia: dia, estados: Object.fromEntries(est.map(x => [x.estado, x.n])), servicios: srv, barberos: bar, horas: hor, clientes: cli[0], porAtender: pend[0].n, sinCerrar: vieja[0].n });
}));
api.post('/admin/cita', auth, wrap(async (q, s) => {
  const n = q.neg, { cliente, telefono, barbero, servicio, fecha, hora, atendida } = q.body;
  if (!String(cliente || '').trim() || !bars(n).includes(barbero) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return s.status(400).json({ error: 'Revisa el nombre, el barbero y la hora' });
  const e = await pool.query('SELECT precio FROM estilos WHERE nombre=$1 AND negocio_id=$2', [servicio, n.id]);
  if (!e.rowCount) return s.status(400).json({ error: 'Servicio no válido' });
  try {
    await pool.query('INSERT INTO citas(cliente,telefono,barbero,servicio,fecha,hora,precio,codigo,estado,negocio_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [String(cliente).trim().slice(0, 80), String(telefono || '').slice(0, 20), barbero, servicio, fecha, hora, e.rows[0].precio, crypto.randomBytes(6).toString('hex'), atendida ? 'completada' : 'pendiente', n.id]);
    s.json({ ok: true });
  } catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese barbero ya tiene una cita a esa hora' }); throw x; }
}));
api.get('/admin/bloqueos', auth, wrap(async (q, s) => s.json((await pool.query('SELECT id,barbero,fecha::text AS fecha,hora,motivo FROM bloqueos WHERE negocio_id=$1 AND fecha>=$2 ORDER BY fecha,barbero,hora', [q.neg.id, HOY()])).rows)));
api.post('/admin/bloqueo', auth, wrap(async (q, s) => {
  const n = q.neg, { barbero, fecha, hora, motivo } = q.body, lista = barbero === 'todos' ? bars(n) : [barbero];
  if (!lista.every(b => bars(n).includes(b)) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || (hora && !/^\d{2}:\d{2}$/.test(hora))) return s.status(400).json({ error: 'Revisa los datos' });
  for (const b of lista) await pool.query('INSERT INTO bloqueos(negocio_id,barbero,fecha,hora,motivo) VALUES($1,$2,$3,$4,$5)', [n.id, b, fecha, hora || null, String(motivo || '').slice(0, 60)]);
  s.json({ ok: true });
}));
api.post('/admin/bloqueo/borrar', auth, wrap(async (q, s) => { await pool.query('DELETE FROM bloqueos WHERE id=$1 AND negocio_id=$2', [q.body.id, q.neg.id]); s.json({ ok: true }); }));
api.get('/admin/clientes', auth, wrap(async (q, s) => s.json((await pool.query(
  `SELECT regexp_replace(telefono,'\\D','','g') AS tel, (array_agg(cliente ORDER BY fecha DESC, id DESC))[1] AS nombre,
   COUNT(*) FILTER (WHERE estado='completada')::int AS visitas, COALESCE(SUM(precio) FILTER (WHERE estado='completada'),0)::float AS gastado,
   (MAX(fecha) FILTER (WHERE estado='completada'))::text AS ultima, (MIN(fecha) FILTER (WHERE estado='pendiente' AND fecha>=$2))::text AS proxima
   FROM citas WHERE negocio_id=$1 AND regexp_replace(telefono,'\\D','','g')<>'' GROUP BY 1 ORDER BY MAX(fecha) DESC LIMIT 300`, [q.neg.id, HOY()])).rows)));
api.get('/admin/ajustes', auth, (q, s) => { const { nombre, whatsapp, direccion, maps, barberos, hora_ini, hora_fin, plan, vence, cierra, avisos } = q.neg; s.json({ nombre, whatsapp, direccion, maps, barberos, hora_ini, hora_fin, cierra, avisos, plan, vence, abierto: vigente(q.neg) }); });
api.patch('/admin/ajustes', auth, wrap(async (q, s) => {
  const b = q.body, n = q.neg, v = k => String(b[k] !== undefined ? b[k] : (n[k] ?? '')).trim();
  const lista = v('barberos').split(',').map(x => x.trim().slice(0, 30)).filter(Boolean), lim = n.plan === 'pro' ? 8 : 3, barberos = lista.join(','), ini = +v('hora_ini'), fin = +v('hora_fin'), maps = v('maps'), cierra = v('cierra'), avisos = wa(v('avisos')) || null;
  if (lista.length > lim) return s.status(400).json({ error: `Tu plan permite hasta ${lim} barberos` });
  if (!v('nombre') || !barberos || !(ini >= 0 && fin <= 23 && ini < fin) || (maps && !/^https?:\/\//.test(maps)) || !/^([0-6](,[0-6])*)?$/.test(cierra)) return s.status(400).json({ error: 'Revisa los datos' });
  await pool.query('UPDATE negocios SET nombre=$1,whatsapp=$2,direccion=$3,maps=$4,barberos=$5,hora_ini=$6,hora_fin=$7,cierra=$8,avisos=$9 WHERE id=$10',
    [v('nombre').slice(0, 60), wa(v('whatsapp')) || null, v('direccion').slice(0, 120), maps, barberos, ini, fin, cierra, avisos, n.id]);
  s.json({ ok: true });
}));

api.post('/admin/item', auth, wrap(async (q, s) => {
  const { tabla, tipo, descripcion, precio } = q.body, nm = String(q.body.nombre || '').trim().slice(0, 60);
  if (!['estilos', 'productos'].includes(tabla) || !nm || !(precio >= 0 && precio <= 100000)) return s.status(400).json({ error: 'Escribe el nombre y un precio válido' });
  if ((await pool.query(`SELECT COUNT(*)::int n FROM ${tabla} WHERE negocio_id=$1`, [q.neg.id])).rows[0].n >= 40) return s.status(400).json({ error: 'Llegaste al límite de 40 elementos' });
  const d = String(descripcion || '').slice(0, 120);
  if (tabla === 'estilos') await pool.query('INSERT INTO estilos(nombre,tipo,descripcion,precio,negocio_id) VALUES($1,$2,$3,$4,$5)', [nm, ['clásico', 'nuevo', 'servicio'].includes(tipo) ? tipo : 'servicio', d, precio, q.neg.id]);
  else await pool.query('INSERT INTO productos(nombre,descripcion,precio,negocio_id) VALUES($1,$2,$3,$4)', [nm, d, precio, q.neg.id]);
  s.json({ ok: true });
}));
api.post('/admin/borrar', auth, wrap(async (q, s) => {
  if (!['estilos', 'productos'].includes(q.body.tabla)) return s.status(400).json({ error: 'Dato no válido' });
  await pool.query(`DELETE FROM ${q.body.tabla} WHERE id=$1 AND negocio_id=$2`, [q.body.id, q.neg.id]);
  s.json({ ok: true });
}));

const existe = async (q, s, n) => {
  try { (await pool.query('SELECT 1 FROM negocios WHERE slug=$1', [q.params.slug])).rowCount ? n() : s.status(404).send('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/s.css><main style="text-align:center;padding-top:20vh"><h1>No encontramos esta barbería</h1><p>Revisa el enlace o crea la tuya.</p><a class=btn href=/registro>Crear mi barbería</a></main>'); }
  catch (e) { s.status(500).send('Error del servidor'); }
};
const page = f => (q, s) => s.sendFile(f, { root: __dirname + '/public' });
app.get('/', page('saas.html'));
app.get('/registro', page('registro.html'));
app.get('/super', page('app-super.html'));
app.get('/agenda.html', (q, s) => s.redirect(301, '/onyx/agenda'));
app.get('/admin.html', (q, s) => s.redirect(301, '/onyx/admin'));
app.get('/:slug', existe, page('negocio.html'));
app.get('/:slug/agenda', existe, page('app-agenda.html'));
app.get('/:slug/admin', existe, page('app-admin.html'));
app.get('/:slug/cartel', existe, page('cartel.html'));
app.get('/:slug/manifest.json', existe, (q, s) => s.json({ name: 'Agenda de barbería', short_name: 'Barbería', start_url: `/${q.params.slug}/agenda`, display: 'standalone',
  background_color: '#07090f', theme_color: '#07090f', lang: 'es', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }));
app.listen(process.env.PORT || 3000);
