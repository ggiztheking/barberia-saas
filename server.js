const fs = require('fs');
const path = require('path');
const express = require('express'), { Pool } = require('pg'), crypto = require('crypto');
const { normalizePhone, validateSlug, isValidDateString, isValidHour, normalizeBarberList, sanitizeText } = require('./lib/validation');

const loadEnv = () => {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
};

loadEnv();

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((q, s, n) => { s.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' }); n(); });
app.use('/img', express.static('public/img', { maxAge: '7d' }));
app.use(express.static('public', { maxAge: 0, etag: true }));
app.get('/health', (q, s) => s.send('ok'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const wrap = f => (q, s, n) => Promise.resolve(f(q, s, n)).catch(e => {
  console.error(e);
  s.status(500).json({ error: 'Error del servidor' });
});
const hits = new Map();
setInterval(() => hits.clear(), 3600e3).unref();
const limita = (k, max, ms) => { const n = Date.now(), a = (hits.get(k) || []).filter(t => n - t < ms); a.push(n); hits.set(k, a); return a.length > max; };
const hashPass = (p, salt) => crypto.scryptSync(String(p), salt, 32).toString('hex');
const okPass = (n, p) => !!(n.salt && typeof p === 'string' && crypto.timingSafeEqual(Buffer.from(hashPass(p, n.salt), 'hex'), Buffer.from(n.hash, 'hex')));
const wa = v => normalizePhone(v);
const bars = n => normalizeBarberList(n && n.barberos ? n.barberos : '');
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
    barberos TEXT NOT NULL DEFAULT 'Barbero 1', hora_ini INT DEFAULT 10, hora_fin INT DEFAULT 19, fotos BOOLEAN DEFAULT false, plan TEXT DEFAULT 'prueba', salt TEXT, hash TEXT, creado TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS citas (id SERIAL PRIMARY KEY, cliente TEXT NOT NULL, telefono TEXT, barbero TEXT NOT NULL, servicio TEXT NOT NULL,
    fecha DATE NOT NULL, hora TEXT NOT NULL, precio NUMERIC DEFAULT 0, estado TEXT DEFAULT 'pendiente', codigo TEXT) `);
  await pool.query(`CREATE TABLE IF NOT EXISTS estilos (id SERIAL PRIMARY KEY, nombre TEXT, tipo TEXT, descripcion TEXT, precio NUMERIC) `);
  await pool.query(`CREATE TABLE IF NOT EXISTS productos (id SERIAL PRIMARY KEY, nombre TEXT, descripcion TEXT, precio NUMERIC) `);
  await pool.query('ALTER TABLE citas ADD COLUMN IF NOT EXISTS codigo TEXT');
  for (const t of ['citas', 'estilos', 'productos']) await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS negocio_id INT`);
  let o = (await pool.query("SELECT id FROM negocios WHERE slug='onyx'")).rows[0];
  if (!o) {
    const salt = crypto.randomBytes(8).toString('hex');
    o = (await pool.query("INSERT INTO negocios(slug,nombre,whatsapp,direccion,maps,barberos,fotos,salt,hash) VALUES('onyx','Onyx Barbería','529623295413','Fracc. Los Héroes, Mérida, Yucatán','https://maps.google.com/?q=Fracc.%20Los%20H%C3%A9roes%20M%C3%A9rida','Pedro,GGTHEBARBER',false,$1,$2) RETURNING id", [salt, hashPass(process.env.ADMIN_PASS || crypto.randomBytes(9).toString('hex'), salt)])).rows[0];
  }
  for (const t of ['citas', 'estilos', 'productos']) await pool.query(`UPDATE ${t} SET negocio_id=$1 WHERE negocio_id IS NULL`, [o.id]);
  if (!(await pool.query('SELECT 1 FROM estilos WHERE negocio_id=$1', [o.id])).rowCount) await seed(o.id);
  await pool.query('DROP INDEX IF EXISTS citas_slot');
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS citas_slot2 ON citas(negocio_id,barbero,fecha,hora) WHERE estado<>'cancelada'");
})().catch(console.error);

const RES = ['api', 'registro', 'img', 'health', 'admin', 'agenda', 'super', 'manifest'];
app.post('/api/registro', wrap(async (q, s) => {
  if (limita('r' + q.ip, 5, 3600e3)) return s.status(429).json({ error: 'Demasiados registros. Intenta más tarde.' });
  const nombre = sanitizeText(q.body.nombre, 60);
  const slug = String(q.body.slug || '').trim().toLowerCase();
  const pw = String(q.body.password || '');
  if (!nombre || !validateSlug(slug) || RES.includes(slug) || pw.length < 8)
    return s.status(400).json({ error: 'Revisa el nombre, el enlace (3 a 30 letras, números o guiones) y la contraseña (mínimo 8 caracteres)' });
  const salt = crypto.randomBytes(8).toString('hex');
  try {
    const r = await pool.query('INSERT INTO negocios(slug,nombre,whatsapp,salt,hash) VALUES($1,$2,$3,$4,$5) RETURNING id', [slug, nombre, wa(q.body.whatsapp) || null, salt, hashPass(pw, salt)]);
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
api.get('/info', (q, s) => { const n = q.neg; s.json({ nombre: n.nombre, direccion: n.direccion, whatsapp: n.whatsapp, maps: n.maps, barberos: bars(n), fotos: n.fotos, hora_ini: n.hora_ini, hora_fin: n.hora_fin }); });
api.get('/estilos', wrap(async (q, s) => s.json((await pool.query('SELECT id,nombre,tipo,descripcion,precio FROM estilos WHERE negocio_id=$1 ORDER BY id', [q.neg.id])).rows)));
api.get('/productos', wrap(async (q, s) => s.json((await pool.query('SELECT id,nombre,descripcion,precio FROM productos WHERE negocio_id=$1 ORDER BY id', [q.neg.id])).rows)));
api.get('/horarios', wrap(async (q, s) => {
  const r = await pool.query("SELECT hora FROM citas WHERE negocio_id=$1 AND fecha=$2 AND barbero=$3 AND estado<>'cancelada'", [q.neg.id, q.query.fecha, q.query.barbero]);
  s.json(r.rows.map(x => x.hora));
}));
api.post('/citas', wrap(async (q, s) => {
  if (limita('c' + q.ip, 10, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  const n = q.neg, { cliente, telefono, barbero, servicio, fecha, hora } = q.body, h = +String(hora).slice(0, 2);
  if (!cliente || !telefono || !bars(n).includes(barbero) || !isValidDateString(fecha) || !isValidHour(hora) || h < n.hora_ini || h > n.hora_fin)
    return s.status(400).json({ error: 'Revisa los datos de tu cita' });
  if (fecha < HOY()) return s.status(400).json({ error: 'Elige una fecha de hoy en adelante' });
  const e = await pool.query('SELECT precio FROM estilos WHERE nombre=$1 AND negocio_id=$2', [servicio, n.id]);
  if (!e.rowCount) return s.status(400).json({ error: 'Servicio no válido' });
  try {
    const r = await pool.query('INSERT INTO citas(cliente,telefono,barbero,servicio,fecha,hora,precio,codigo,negocio_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING codigo,precio',
      [String(cliente).slice(0, 80), String(telefono).slice(0, 20), barbero, servicio, fecha, hora, e.rows[0].precio, crypto.randomBytes(6).toString('hex'), n.id]);
    s.json(r.rows[0]);
  } catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese horario ya se ocupó. Elige otro.' }); throw x; }
}));
api.post('/mis-citas', wrap(async (q, s) => {
  const c = (Array.isArray(q.body.codigos) ? q.body.codigos : []).filter(x => typeof x === 'string').slice(0, 20);
  s.json((await pool.query('SELECT codigo,servicio,barbero,fecha::text AS fecha,hora,precio,estado FROM citas WHERE negocio_id=$1 AND codigo = ANY($2) AND fecha >= $3 ORDER BY fecha,hora', [q.neg.id, c, HOY()])).rows);
}));
api.post('/cancelar', wrap(async (q, s) => {
  const r = await pool.query("UPDATE citas SET estado='cancelada' WHERE negocio_id=$1 AND codigo=$2 AND estado='pendiente' RETURNING id", [q.neg.id, String(q.body.codigo)]);
  r.rowCount ? s.json({ ok: true }) : s.status(404).json({ error: 'No se pudo cancelar esa cita' });
}));
api.get('/admin/citas', auth, wrap(async (q, s) => s.json((await pool.query('SELECT * FROM citas WHERE negocio_id=$1 AND fecha=$2 ORDER BY hora', [q.neg.id, q.query.fecha])).rows)));
const estadosValidos = new Set(['pendiente', 'confirmada', 'completada', 'cancelada']);
api.patch('/admin/citas/:id', auth, wrap(async (q, s) => {
  const estado = String(q.body.estado || '').trim().toLowerCase();
  if (!estadosValidos.has(estado)) return s.status(400).json({ error: 'Estado no válido' });
  s.json((await pool.query('UPDATE citas SET estado=$1 WHERE id=$2 AND negocio_id=$3 RETURNING *', [estado, q.params.id, q.neg.id])).rows[0] || {});
}));
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
api.get('/admin/ajustes', auth, (q, s) => { const { nombre, whatsapp, direccion, maps, barberos, hora_ini, hora_fin } = q.neg; s.json({ nombre, whatsapp, direccion, maps, barberos, hora_ini, hora_fin }); });
api.patch('/admin/ajustes', auth, wrap(async (q, s) => {
  const b = q.body, n = q.neg, v = k => String(b[k] !== undefined ? b[k] : (n[k] ?? '')).trim();
  const lista = normalizeBarberList(v('barberos')), lim = n.plan === 'pro' ? 8 : 3, barberos = lista.join(','), ini = +v('hora_ini'), fin = +v('hora_fin'), maps = v('maps');
  if (lista.length > lim) return s.status(400).json({ error: `Tu plan permite hasta ${lim} barberos` });
  if (!v('nombre') || !barberos || !(ini >= 0 && fin <= 23 && ini < fin) || (maps && !/^https?:\/\//.test(maps))) return s.status(400).json({ error: 'Revisa los datos' });
  await pool.query('UPDATE negocios SET nombre=$1,whatsapp=$2,direccion=$3,maps=$4,barberos=$5,hora_ini=$6,hora_fin=$7 WHERE id=$8',
    [v('nombre').slice(0, 60), wa(v('whatsapp')) || null, v('direccion').slice(0, 120), maps, barberos, ini, fin, n.id]);
  s.json({ ok: true });
}));

const existe = async (q, s, n) => {
  try { (await pool.query('SELECT 1 FROM negocios WHERE slug=$1', [q.params.slug])).rowCount ? n() : s.status(404).send('Negocio no encontrado'); }
  catch (e) { s.status(500).send('Error del servidor'); }
};
const page = f => (q, s) => s.sendFile(f, { root: __dirname + '/public' });
app.get('/', page('saas.html'));
app.get('/registro', page('registro.html'));
app.get('/agenda.html', (q, s) => s.redirect(301, '/onyx/agenda'));
app.get('/admin.html', (q, s) => s.redirect(301, '/onyx/admin'));
app.get('/:slug', existe, page('negocio.html'));
app.get('/:slug/agenda', existe, page('app-agenda.html'));
app.get('/:slug/admin', existe, page('app-admin.html'));
app.get('/:slug/manifest.json', existe, (q, s) => s.json({ name: 'Agenda de barbería', short_name: 'Barbería', start_url: `/${q.params.slug}/agenda`, display: 'standalone',
  background_color: '#07090f', theme_color: '#07090f', lang: 'es', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }));

app.use((err, q, s, n) => {
  console.error(err);
  if (s.headersSent) return n(err);
  s.status(500).json({ error: 'Error del servidor' });
});

if (require.main === module) {
  app.listen(process.env.PORT || 3000);
}

module.exports = { app, pool };
