const express = require('express'), { Pool } = require('pg'), crypto = require('crypto');
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((q, s, n) => { s.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN', 'Strict-Transport-Security': 'max-age=15552000', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' }); n(); });
app.use('/img', express.static('public/img', { maxAge: '7d' }));
app.use(express.static('public', { maxAge: 0, etag: true }));
const fs = require('fs');
app.get('/health', (q, s) => s.send('ok'));
app.get('/i/:id', async (q, s) => {
  if (!/^\d{1,10}$/.test(q.params.id)) return s.sendStatus(404);
  try {
    const r = await pool.query('SELECT mime,data FROM imagenes WHERE id=$1', [q.params.id]);
    if (!r.rowCount) return s.sendStatus(404);
    s.set({ 'Content-Type': r.rows[0].mime, 'Cache-Control': 'public, max-age=31536000, immutable' }).send(r.rows[0].data);
  } catch (e) { s.sendStatus(500); }
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const wrap = f => (q, s) => f(q, s).catch(e => { console.error(e); s.status(500).json({ error: 'Error del servidor' }); });
const hits = new Map();
setInterval(() => hits.clear(), 3600e3).unref();
const limita = (k, max, ms) => { const n = Date.now(), a = (hits.get(k) || []).filter(t => n - t < ms); a.push(n); hits.set(k, a); return a.length > max; };
const hashPass = (p, salt) => crypto.scryptSync(String(p), salt, 32).toString('hex');
const okPass = (n, p) => !!(n.salt && typeof p === 'string' && crypto.timingSafeEqual(Buffer.from(hashPass(p, n.salt), 'hex'), Buffer.from(n.hash, 'hex')));
// ---- Cuentas y sesiones propias (sin servicios externos)
const galletas = q => Object.fromEntries((q.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; }));
const tokHash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const nomCookie = (tipo, slug) => (tipo === 'staff' ? 'st_' : 'cl_') + slug;
const nuevoSalt = () => crypto.randomBytes(16).toString('hex');
const okHash = (p, salt, hash) => !!(salt && hash && typeof p === 'string' && p.length <= 200 && crypto.timingSafeEqual(Buffer.from(hashPass(p, salt), 'hex'), Buffer.from(hash, 'hex')));
const temporal = () => Array.from(crypto.randomBytes(8), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const tel10 = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 12 && d.startsWith('52') ? d.slice(2) : d; };
const correoOk = v => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(v || ''));
const ponSesion = async (q, s, tipo, ref, negId, slug) => {
  const t = crypto.randomBytes(32).toString('base64url');
  await pool.query("INSERT INTO sesiones(token,tipo,ref_id,negocio_id,expira) VALUES($1,$2,$3,$4,now()+interval '30 days')", [tokHash(t), tipo, ref, negId]);
  s.cookie(nomCookie(tipo, slug), t, { httpOnly: true, secure: q.secure, sameSite: 'lax', maxAge: 30 * 864e5, path: '/' });
};
const leeSesion = async (q, tipo) => {
  const t = galletas(q)[nomCookie(tipo, q.params.slug)];
  if (!t || t.length > 80) return null;
  const r = await pool.query('SELECT ref_id FROM sesiones WHERE token=$1 AND tipo=$2 AND negocio_id=$3 AND expira>now()', [tokHash(t), tipo, q.neg.id]);
  return r.rowCount ? r.rows[0].ref_id : null;
};
const cierraSesion = async (q, s, tipo) => {
  const t = galletas(q)[nomCookie(tipo, q.params.slug)];
  if (t) await pool.query('DELETE FROM sesiones WHERE token=$1', [tokHash(t)]);
  s.clearCookie(nomCookie(tipo, q.params.slug), { path: '/' });
};
setInterval(() => pool.query('DELETE FROM sesiones WHERE expira<now()').catch(() => {}), 3600e3).unref();
const wa = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 10 ? '52' + d : d; };
const vigente = n => n.activo !== false && (!n.vence || new Date(n.vence) >= new Date());
const todas = n => Array.from({ length: n.hora_fin - n.hora_ini + 1 }, (_, k) => String(n.hora_ini + k).padStart(2, '0') + ':00');
const cerrado = (n, f) => (n.cierra || '').split(',').includes(String(new Date(f + 'T12:00').getDay()));
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avisa = (n, d) => {
  const u = process.env.MAKE_WEBHOOK_URL, k = process.env.RESEND_API_KEY, tel = wa(n.avisos || n.whatsapp), correo = n.correo || '', directo = !!(k && correo);
  if (!directo && (!u || (!tel && !correo))) return;
  const f = new Date(d.fecha + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }), cancel = d.evento === 'cita_cancelada', mueve = d.evento === 'cita_reprogramada';
  const txt = mueve ? `Cita reprogramada en ${n.nombre}: ${d.cliente} · ${d.servicio} con ${d.barbero} · ahora ${f} a las ${d.hora} (antes ${d.antes}).` : cancel
    ? `Cita cancelada en ${n.nombre}: ${d.cliente} · ${d.servicio} con ${d.barbero} · ${f} a las ${d.hora}.`
    : `Nueva cita en ${n.nombre}: ${d.cliente} · ${d.servicio} con ${d.barbero} · ${f} a las ${d.hora} · $${Number(d.precio)}. WhatsApp del cliente: ${d.telefono}`;
  const asunto = ((mueve ? 'Cita reprogramada: ' : cancel ? 'Cita cancelada: ' : 'Nueva cita: ') + d.cliente + ' · ' + f + ' ' + d.hora).replace(/[\r\n]+/g, ' ').slice(0, 150);
  if (directo) {
    const html = `<p><strong>${esc(mueve ? 'Cita reprogramada' : cancel ? 'Cita cancelada' : 'Nueva cita')} en ${esc(n.nombre)}</strong></p>${mueve ? `<p>Antes: ${esc(d.antes)}</p>` : ''}<p>Cliente: ${esc(d.cliente)}<br>WhatsApp: ${esc(d.telefono)}<br>Servicio: ${esc(d.servicio)} con ${esc(d.barbero)}<br>Fecha: ${esc(f)} a las ${esc(d.hora)}<br>Precio: $${Number(d.precio)} MXN</p><p>Agenda de ${esc(n.nombre)}</p>`;
    fetch(process.env.RESEND_URL || 'https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Avisos de citas <onboarding@resend.dev>', to: [correo], subject: asunto, html }) })
      .then(async r => { if (!r.ok) console.error('resend', r.status, (await r.text()).slice(0, 200)); }).catch(e => console.error('resend:', e.message));
  }
  if (u && (tel || (correo && !directo)))
    fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, negocio: n.nombre, slug: n.slug, avisar_a: tel, avisar_correo: directo ? '' : correo, asunto, mensaje: txt }) }).catch(e => console.error('make:', e.message));
};
const ahoraH = () => +new Date().toLocaleString('en-US', { timeZone: 'America/Merida', hour: '2-digit', hourCycle: 'h23' });
const ocupadas = async (n, fecha, barbero) => {
  if (cerrado(n, fecha)) return new Set(todas(n));
  const r = await pool.query("SELECT hora FROM citas WHERE negocio_id=$1 AND fecha=$2 AND barbero=$3 AND estado<>'cancelada'", [n.id, fecha, barbero]);
  const b = await pool.query('SELECT hora FROM bloqueos WHERE negocio_id=$1 AND fecha=$2 AND barbero=$3', [n.id, fecha, barbero]);
  return b.rows.some(x => x.hora === null) ? new Set(todas(n)) : new Set([...r.rows, ...b.rows].map(x => x.hora));
};
const elige = async (n, fecha, hora) => { for (const b of bars(n)) if (!(await ocupadas(n, fecha, b)).has(hora)) return b; return null; };
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
const PREG = [
 ['¿Necesito crear una cuenta para agendar?', 'No. Basta con tu nombre y tu WhatsApp. Si creas una cuenta, ves tus citas e historial desde cualquier celular.'],
 ['¿Cómo cambio o cancelo mi cita?', 'En la agenda, entra a "Mi cuenta": ahí puedes cambiar el horario o cancelar en un toque.'],
 ['¿Puedo elegir a mi barbero?', 'Sí. Eliges a tu barbero al agendar y solo ves sus horarios libres. También puedes elegir "Cualquiera" y te asignamos al primero disponible.'],
 ['¿Qué pasa si llego tarde?', 'Te esperamos unos minutos. Si vas a llegar tarde, escríbenos por WhatsApp para ver si alcanzamos a atenderte o movemos tu cita.'],
 ['¿Cómo puedo pagar?', 'Pagas en la barbería al terminar tu servicio.']];
const seedPreg = async id => { for (const [k, [p, r]] of PREG.entries()) await pool.query('INSERT INTO preguntas(negocio_id,pregunta,respuesta,orden) VALUES($1,$2,$3,$4)', [id, p, r, k]); };
const seed = async id => {
  for (const r of SEED) await pool.query('INSERT INTO estilos(nombre,tipo,descripcion,precio,negocio_id) VALUES($1,$2,$3,$4,$5)', [...r, id]);
  for (const r of PROD) await pool.query('INSERT INTO productos(nombre,descripcion,precio,negocio_id) VALUES($1,$2,$3,$4)', [...r, id]);
  await seedPreg(id);
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
  await pool.query('ALTER TABLE negocios ADD COLUMN IF NOT EXISTS correo TEXT');
  await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, nombre TEXT NOT NULL, email TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'dueno', barbero TEXT, activo BOOLEAN DEFAULT true, creado TIMESTAMPTZ DEFAULT now())`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email ON usuarios(negocio_id, lower(email))');
  await pool.query(`CREATE TABLE IF NOT EXISTS cuentas (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, nombre TEXT NOT NULL, telefono TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, creado TIMESTAMPTZ DEFAULT now())`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS cuentas_tel ON cuentas(negocio_id, telefono)');
  await pool.query('CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, tipo TEXT NOT NULL, ref_id INT NOT NULL, negocio_id INT NOT NULL, expira TIMESTAMPTZ NOT NULL, creado TIMESTAMPTZ DEFAULT now())');
  await pool.query('CREATE INDEX IF NOT EXISTS sesiones_ref ON sesiones(tipo, ref_id)');
  await pool.query('ALTER TABLE citas ADD COLUMN IF NOT EXISTS cuenta_id INT');
  await pool.query('CREATE TABLE IF NOT EXISTS imagenes (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, tipo TEXT NOT NULL, ref TEXT NOT NULL, mime TEXT NOT NULL, data BYTEA NOT NULL, creado TIMESTAMPTZ DEFAULT now())');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS imagenes_ref ON imagenes(negocio_id, tipo, ref)');
  for (const c of ['lema', 'acerca', 'estacionamiento', 'zonas', 'instagram']) await pool.query(`ALTER TABLE negocios ADD COLUMN IF NOT EXISTS ${c} TEXT`);
  await pool.query('CREATE TABLE IF NOT EXISTS perfiles (negocio_id INT NOT NULL, barbero TEXT NOT NULL, especialidad TEXT, bio TEXT, instagram TEXT, PRIMARY KEY (negocio_id, barbero))');
  await pool.query('CREATE TABLE IF NOT EXISTS eventos (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, titulo TEXT NOT NULL, fecha DATE NOT NULL, hora TEXT, descripcion TEXT, cupo INT, creado TIMESTAMPTZ DEFAULT now())');
  await pool.query('CREATE TABLE IF NOT EXISTS asistentes (evento_id INT NOT NULL, nombre TEXT NOT NULL, telefono TEXT NOT NULL, creado TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (evento_id, telefono))');
  await pool.query('CREATE TABLE IF NOT EXISTS preguntas (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, pregunta TEXT NOT NULL, respuesta TEXT NOT NULL, orden INT DEFAULT 0)');
  await pool.query('ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS comision NUMERIC DEFAULT 0');
  await pool.query(`CREATE TABLE IF NOT EXISTS movimientos (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, tipo TEXT NOT NULL, categoria TEXT NOT NULL, concepto TEXT NOT NULL, monto NUMERIC(12,2) NOT NULL,
    fecha DATE NOT NULL, metodo TEXT, nota TEXT, barbero TEXT, fijo_id INT, usuario_id INT, creado TIMESTAMPTZ DEFAULT now())`);
  await pool.query('CREATE INDEX IF NOT EXISTS movimientos_fecha ON movimientos(negocio_id, fecha)');
  await pool.query('CREATE TABLE IF NOT EXISTS fijos (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, concepto TEXT NOT NULL, categoria TEXT NOT NULL, monto NUMERIC(12,2) NOT NULL, dia INT DEFAULT 1)');
  for (const r of (await pool.query('SELECT id FROM negocios n WHERE NOT EXISTS (SELECT 1 FROM preguntas p WHERE p.negocio_id=n.id)')).rows) await seedPreg(r.id);
  await pool.query('CREATE TABLE IF NOT EXISTS bloqueos (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, barbero TEXT NOT NULL, fecha DATE NOT NULL, hora TEXT, motivo TEXT)');
  let o = (await pool.query("SELECT id FROM negocios WHERE slug='onyx'")).rows[0];
  if (!o) {
    const salt = crypto.randomBytes(8).toString('hex');
    o = (await pool.query("INSERT INTO negocios(slug,nombre,whatsapp,direccion,maps,barberos,fotos,salt,hash) VALUES('onyx','Estilo Internacional','529623295413','Fracc. Los Héroes, Mérida, Yucatán','https://maps.app.goo.gl/NpfSt23Eorm4wgd37',$1,true,$2,$3) RETURNING id",
      [process.env.BARBEROS || 'Pedro,GGTHEBARBER', salt, hashPass(process.env.ADMIN_PASS || crypto.randomBytes(9).toString('hex'), salt)])).rows[0];
  }
  await pool.query("UPDATE negocios SET plan='pro' WHERE slug='onyx' AND plan='prueba'");
  await pool.query("UPDATE negocios SET nombre='Estilo Internacional' WHERE slug='onyx' AND nombre='Onyx Barbería'");
  await pool.query('CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)');
  if (process.env.CORREO_ONYX) {
    const c = (await pool.query("SELECT v FROM config WHERE k='correo_onyx'")).rows[0];
    if (!c || c.v !== process.env.CORREO_ONYX) {
      await pool.query("UPDATE negocios SET correo=$1 WHERE slug='onyx'", [process.env.CORREO_ONYX]);
      await pool.query("INSERT INTO config(k,v) VALUES('correo_onyx',$1) ON CONFLICT (k) DO UPDATE SET v=$1", [process.env.CORREO_ONYX]);
    }
  }
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
  if (q.body.accion === 'reset_dueno') {
    const u = (await pool.query("SELECT id,email FROM usuarios WHERE negocio_id=$1 AND rol='dueno' AND activo ORDER BY id LIMIT 1", [q.params.id])).rows[0];
    if (!u) return s.status(404).json({ error: 'Esta barbería aún no crea su cuenta. Que entre con la contraseña del panel.' });
    const t = temporal(), sa = nuevoSalt();
    await pool.query('UPDATE usuarios SET salt=$1,hash=$2 WHERE id=$3', [sa, hashPass(t, sa), u.id]);
    await pool.query("DELETE FROM sesiones WHERE tipo='staff' AND ref_id=$1", [u.id]);
    return s.json({ email: u.email, temporal: t });
  }
  const mas = "GREATEST(COALESCE(vence,now()),now())", A = {
    pagar_basico: `plan='basico',activo=true,vence=${mas}+interval '30 days'`, pagar_pro: `plan='pro',activo=true,vence=${mas}+interval '30 days'`,
    extender: `vence=${mas}+interval '14 days'`, suspender: 'activo=false', activar: 'activo=true' }[q.body.accion];
  if (!A) return s.status(400).json({ error: 'Acción no válida' });
  await pool.query(`UPDATE negocios SET ${A} WHERE id=$1`, [q.params.id]);
  s.json({ ok: true });
}));
const RES = ['api', 'registro', 'img', 'i', 'health', 'admin', 'agenda', 'super', 'manifest', 'entrar', 'sitemap.xml', 'robots.txt'];
app.post('/api/registro', wrap(async (q, s) => {
  if (limita('r' + q.ip, 5, 3600e3)) return s.status(429).json({ error: 'Demasiados registros. Intenta más tarde.' });
  const nombre = String(q.body.nombre || '').trim().slice(0, 60), slug = String(q.body.slug || '').toLowerCase(), pw = String(q.body.password || '');
  const dueno = String(q.body.dueno || '').trim().slice(0, 60), email = String(q.body.email || '').trim().toLowerCase().slice(0, 120);
  if (!nombre || !/^[a-z0-9-]{3,30}$/.test(slug) || RES.includes(slug) || pw.length < 8 || pw.length > 200)
    return s.status(400).json({ error: 'Revisa el nombre, el enlace (3 a 30 letras, números o guiones) y la contraseña (mínimo 8 caracteres)' });
  if (!dueno || !correoOk(email)) return s.status(400).json({ error: 'Escribe tu nombre y un correo válido para tu cuenta' });
  const salt = crypto.randomBytes(8).toString('hex');
  try {
    const r = await pool.query("INSERT INTO negocios(slug,nombre,whatsapp,salt,hash,vence) VALUES($1,$2,$3,$4,$5,now()+interval '14 days') RETURNING id", [slug, nombre, wa(q.body.whatsapp) || null, salt, hashPass(pw, salt)]);
    await seed(r.rows[0].id);
    const us = nuevoSalt(), u = await pool.query("INSERT INTO usuarios(negocio_id,nombre,email,salt,hash,rol) VALUES($1,$2,$3,$4,$5,'dueno') RETURNING id", [r.rows[0].id, dueno, email, us, hashPass(pw, us)]);
    await ponSesion(q, s, 'staff', u.rows[0].id, r.rows[0].id, slug);
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
api.use((q, s, n) => {
  if (q.method === 'GET' || q.method === 'HEAD') return n();
  const o = q.get('origin');
  if (o) { try { if (new URL(o).host !== q.get('host')) return s.status(403).json({ error: 'Origen no permitido' }); } catch (e) { return s.status(403).json({ error: 'Origen no permitido' }); } }
  n();
});
// El barbero solo ve y toca lo suyo; el resto del panel es del dueño.
const BARB_OK = /^\/admin\/(citas|cita|corte|bloqueos|bloqueo|me|salir|mi-clave|perfil)(\/|$)/;
const mio = q => (q.user && q.user.rol === 'barbero' ? q.user.barbero : null);
const auth = async (q, s, n) => {
  try {
    const id = await leeSesion(q, 'staff');
    const u = id && (await pool.query('SELECT id,nombre,email,rol,barbero FROM usuarios WHERE id=$1 AND negocio_id=$2 AND activo', [id, q.neg.id])).rows[0];
    if (!u) return s.status(401).json({ error: 'Inicia sesión para continuar', sesion: false });
    q.user = u;
    if (u.rol !== 'dueno' && !BARB_OK.test(q.path)) return s.status(403).json({ error: 'Solo el dueño puede hacer esto' });
    n();
  } catch (e) { console.error(e); s.status(500).json({ error: 'Error del servidor' }); }
};
const cuentaCli = async q => { const id = await leeSesion(q, 'cliente'); return id && (await pool.query('SELECT id,nombre,telefono FROM cuentas WHERE id=$1 AND negocio_id=$2', [id, q.neg.id])).rows[0]; };
const limLogin = (q, s) => { if (limita('l' + q.ip + q.params.slug, 10, 6e5)) { s.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' }); return true; } return false; };

// ---- Equipo: entrar, configurar la primera cuenta, salir
api.get('/cuenta/estado', wrap(async (q, s) => s.json({ configurado: (await pool.query('SELECT 1 FROM usuarios WHERE negocio_id=$1 LIMIT 1', [q.neg.id])).rowCount > 0 })));
api.post('/cuenta/entrar', wrap(async (q, s) => {
  if (limLogin(q, s)) return;
  const email = String(q.body.email || '').trim().toLowerCase(), u = (await pool.query('SELECT id,salt,hash,rol FROM usuarios WHERE negocio_id=$1 AND lower(email)=$2 AND activo', [q.neg.id, email])).rows[0];
  if (!u || !okHash(String(q.body.password || ''), u.salt, u.hash)) return s.status(401).json({ error: 'Correo o contraseña incorrectos' });
  await ponSesion(q, s, 'staff', u.id, q.neg.id, q.params.slug);
  s.json({ rol: u.rol });
}));
api.post('/cuenta/configurar', wrap(async (q, s) => {
  if (limLogin(q, s)) return;
  if ((await pool.query('SELECT 1 FROM usuarios WHERE negocio_id=$1 LIMIT 1', [q.neg.id])).rowCount) return s.status(409).json({ error: 'Esta barbería ya tiene cuenta. Inicia sesión.' });
  if (!okPass(q.neg, String(q.body.clave || ''))) return s.status(401).json({ error: 'La contraseña actual del panel no es correcta' });
  const nombre = String(q.body.nombre || '').trim().slice(0, 60), email = String(q.body.email || '').trim().toLowerCase().slice(0, 120), pw = String(q.body.password || '');
  if (!nombre || !correoOk(email) || pw.length < 8 || pw.length > 200) return s.status(400).json({ error: 'Escribe tu nombre, un correo válido y una contraseña de al menos 8 caracteres' });
  const sa = nuevoSalt(), u = await pool.query("INSERT INTO usuarios(negocio_id,nombre,email,salt,hash,rol) VALUES($1,$2,$3,$4,$5,'dueno') RETURNING id", [q.neg.id, nombre, email, sa, hashPass(pw, sa)]);
  await ponSesion(q, s, 'staff', u.rows[0].id, q.neg.id, q.params.slug);
  s.json({ ok: true });
}));
api.get('/admin/me', auth, (q, s) => s.json({ ...q.user, negocio: q.neg.nombre }));
api.post('/admin/salir', auth, wrap(async (q, s) => { await cierraSesion(q, s, 'staff'); s.json({ ok: true }); }));
api.post('/admin/mi-clave', auth, wrap(async (q, s) => {
  const u = (await pool.query('SELECT salt,hash FROM usuarios WHERE id=$1', [q.user.id])).rows[0], nueva = String(q.body.nueva || '');
  if (!okHash(String(q.body.actual || ''), u.salt, u.hash)) return s.status(400).json({ error: 'Tu contraseña actual no es correcta' });
  if (nueva.length < 8 || nueva.length > 200) return s.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  const sa = nuevoSalt(), t = galletas(q)[nomCookie('staff', q.params.slug)];
  await pool.query('UPDATE usuarios SET salt=$1,hash=$2 WHERE id=$3', [sa, hashPass(nueva, sa), q.user.id]);
  await pool.query("DELETE FROM sesiones WHERE tipo='staff' AND ref_id=$1 AND token<>$2", [q.user.id, tokHash(t || '')]);
  s.json({ ok: true });
}));
api.get('/admin/equipo', auth, wrap(async (q, s) => s.json((await pool.query('SELECT id,nombre,email,rol,barbero,activo FROM usuarios WHERE negocio_id=$1 ORDER BY rol DESC, id', [q.neg.id])).rows)));
api.post('/admin/equipo', auth, wrap(async (q, s) => {
  const n = q.neg, nombre = String(q.body.nombre || '').trim().slice(0, 60), email = String(q.body.email || '').trim().toLowerCase().slice(0, 120), rol = q.body.rol === 'dueno' ? 'dueno' : 'barbero', barbero = rol === 'barbero' ? String(q.body.barbero || '') : null;
  if (!nombre || !correoOk(email)) return s.status(400).json({ error: 'Escribe el nombre y un correo válido' });
  if (rol === 'barbero' && !bars(n).includes(barbero)) return s.status(400).json({ error: 'Elige qué barbero de tu lista es esta persona' });
  if ((await pool.query('SELECT COUNT(*)::int c FROM usuarios WHERE negocio_id=$1', [n.id])).rows[0].c >= 20) return s.status(400).json({ error: 'Llegaste al límite de 20 cuentas' });
  const t = temporal(), sa = nuevoSalt();
  try { await pool.query('INSERT INTO usuarios(negocio_id,nombre,email,salt,hash,rol,barbero) VALUES($1,$2,$3,$4,$5,$6,$7)', [n.id, nombre, email, sa, hashPass(t, sa), rol, barbero]); }
  catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ya existe una cuenta con ese correo' }); throw x; }
  s.json({ temporal: t });
}));
api.post('/admin/equipo/:id', auth, wrap(async (q, s) => {
  const u = (await pool.query('SELECT id,rol,activo FROM usuarios WHERE id=$1 AND negocio_id=$2', [q.params.id, q.neg.id])).rows[0], a = q.body.accion;
  if (!u) return s.status(404).json({ error: 'No encontramos esa cuenta' });
  if (u.id === q.user.id && a !== 'reset') return s.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  if (a === 'reset') {
    const t = temporal(), sa = nuevoSalt();
    await pool.query('UPDATE usuarios SET salt=$1,hash=$2 WHERE id=$3', [sa, hashPass(t, sa), u.id]);
    if (u.id !== q.user.id) await pool.query("DELETE FROM sesiones WHERE tipo='staff' AND ref_id=$1", [u.id]);
    return s.json({ temporal: t });
  }
  if (a !== 'desactivar' && a !== 'activar') return s.status(400).json({ error: 'Acción no válida' });
  await pool.query('UPDATE usuarios SET activo=$1 WHERE id=$2', [a === 'activar', u.id]);
  if (a === 'desactivar') await pool.query("DELETE FROM sesiones WHERE tipo='staff' AND ref_id=$1", [u.id]);
  s.json({ ok: true });
}));

// ---- Contenido de la página
api.post('/admin/perfil', auth, wrap(async (q, s) => {
  const b = mio(q) || String(q.body.barbero || '');
  if (!bars(q.neg).includes(b)) return s.status(400).json({ error: 'Ese barbero no está en tu lista' });
  const t = (k, l) => String(q.body[k] || '').trim().slice(0, l), ig = t('instagram', 40).replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  await pool.query('INSERT INTO perfiles(negocio_id,barbero,especialidad,bio,instagram) VALUES($1,$2,$3,$4,$5) ON CONFLICT (negocio_id,barbero) DO UPDATE SET especialidad=$3,bio=$4,instagram=$5', [q.neg.id, b, t('especialidad', 80), t('bio', 400), ig]);
  s.json({ ok: true });
}));
api.get('/admin/perfil', auth, wrap(async (q, s) => s.json((await pool.query('SELECT barbero,especialidad,bio,instagram FROM perfiles WHERE negocio_id=$1 AND ($2::text IS NULL OR barbero=$2)', [q.neg.id, mio(q)])).rows)));
api.get('/admin/eventos', auth, wrap(async (q, s) => {
  const ev = (await pool.query("SELECT e.id,e.titulo,e.fecha::text AS fecha,e.hora,e.descripcion,e.cupo,i.id AS img FROM eventos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='evento' AND i.ref=e.id::text WHERE e.negocio_id=$1 AND e.fecha>=($2::date - 30) ORDER BY e.fecha DESC", [q.neg.id, HOY()])).rows;
  const as = ev.length ? (await pool.query('SELECT evento_id,nombre,telefono FROM asistentes WHERE evento_id=ANY($1) ORDER BY creado', [ev.map(e => e.id)])).rows : [];
  s.json(ev.map(e => ({ ...e, asistentes: as.filter(a => a.evento_id === e.id).map(({ nombre, telefono }) => ({ nombre, telefono })) })));
}));
api.post('/admin/evento', auth, wrap(async (q, s) => {
  const t = (k, l) => String(q.body[k] || '').trim().slice(0, l), titulo = t('titulo', 100), fecha = t('fecha', 10), hora = t('hora', 5), cupo = parseInt(q.body.cupo) || null;
  if (!titulo || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || (hora && !/^\d{2}:\d{2}$/.test(hora))) return s.status(400).json({ error: 'Escribe el título y la fecha del evento' });
  if (cupo !== null && (cupo < 1 || cupo > 5000)) return s.status(400).json({ error: 'El cupo debe ser un número entre 1 y 5000' });
  if (q.body.id) {
    const r = await pool.query('UPDATE eventos SET titulo=$1,fecha=$2,hora=$3,descripcion=$4,cupo=$5 WHERE id=$6 AND negocio_id=$7 RETURNING id', [titulo, fecha, hora || null, t('descripcion', 800), cupo, q.body.id, q.neg.id]);
    return r.rowCount ? s.json({ id: r.rows[0].id }) : s.status(404).json({ error: 'No encontramos ese evento' });
  }
  if ((await pool.query('SELECT COUNT(*)::int c FROM eventos WHERE negocio_id=$1 AND fecha>=$2', [q.neg.id, HOY()])).rows[0].c >= 20) return s.status(400).json({ error: 'Llegaste al límite de 20 eventos próximos' });
  s.json({ id: (await pool.query('INSERT INTO eventos(negocio_id,titulo,fecha,hora,descripcion,cupo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [q.neg.id, titulo, fecha, hora || null, t('descripcion', 800), cupo])).rows[0].id });
}));
api.post('/admin/evento/borrar', auth, wrap(async (q, s) => {
  const r = await pool.query('DELETE FROM eventos WHERE id=$1 AND negocio_id=$2 RETURNING id', [q.body.id, q.neg.id]);
  if (r.rowCount) { await pool.query('DELETE FROM asistentes WHERE evento_id=$1', [q.body.id]); await pool.query("DELETE FROM imagenes WHERE negocio_id=$1 AND tipo='evento' AND ref=$2", [q.neg.id, String(q.body.id)]); }
  s.json({ ok: true });
}));
api.get('/admin/preguntas', auth, wrap(async (q, s) => s.json((await pool.query('SELECT id,pregunta,respuesta FROM preguntas WHERE negocio_id=$1 ORDER BY orden,id', [q.neg.id])).rows)));
api.post('/admin/pregunta', auth, wrap(async (q, s) => {
  const p = String(q.body.pregunta || '').trim().slice(0, 200), r = String(q.body.respuesta || '').trim().slice(0, 1000);
  if (!p || !r) return s.status(400).json({ error: 'Escribe la pregunta y la respuesta' });
  if (q.body.id) { await pool.query('UPDATE preguntas SET pregunta=$1,respuesta=$2 WHERE id=$3 AND negocio_id=$4', [p, r, q.body.id, q.neg.id]); return s.json({ ok: true }); }
  if ((await pool.query('SELECT COUNT(*)::int c FROM preguntas WHERE negocio_id=$1', [q.neg.id])).rows[0].c >= 30) return s.status(400).json({ error: 'Llegaste al límite de 30 preguntas' });
  await pool.query('INSERT INTO preguntas(negocio_id,pregunta,respuesta,orden) VALUES($1,$2,$3,(SELECT COALESCE(MAX(orden),0)+1 FROM preguntas WHERE negocio_id=$1))', [q.neg.id, p, r]);
  s.json({ ok: true });
}));
api.post('/admin/pregunta/borrar', auth, wrap(async (q, s) => { await pool.query('DELETE FROM preguntas WHERE id=$1 AND negocio_id=$2', [q.body.id, q.neg.id]); s.json({ ok: true }); }));

// ---- Finanzas: gastos, inversión, otras ventas, gastos fijos y comisiones
const CATS = {
  gasto: ['Renta', 'Luz y agua', 'Internet y teléfono', 'Productos e insumos', 'Sueldos y comisiones', 'Publicidad', 'Mantenimiento', 'Impuestos', 'Otros gastos'],
  inversion: ['Mobiliario', 'Equipo y herramientas', 'Remodelación', 'Capacitación', 'Otra inversión'],
  ingreso: ['Venta de productos', 'Otro ingreso'] };
const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];
const rangoMes = m => { const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')), mes = ok ? m : HOY().slice(0, 7); return { mes, desde: mes + '-01' }; };
api.get('/admin/finanzas', auth, wrap(async (q, s) => {
  const { mes, desde } = rangoMes(q.query.mes), id = q.neg.id, Q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const H = "($2::date + interval '1 month')";
  const [serv, mov, porCat, fijos, tot, serie, com] = await Promise.all([
    Q(`SELECT barbero, COUNT(*)::int cortes, COALESCE(SUM(precio),0)::float total FROM citas WHERE negocio_id=$1 AND estado='completada' AND fecha>=$2 AND fecha<${H} GROUP BY barbero`, [id, desde]),
    Q(`SELECT id,tipo,categoria,concepto,monto::float AS monto,fecha::text AS fecha,metodo,nota,barbero,fijo_id FROM movimientos WHERE negocio_id=$1 AND fecha>=$2 AND fecha<${H} ORDER BY fecha DESC, id DESC`, [id, desde]),
    Q(`SELECT tipo,categoria,SUM(monto)::float total FROM movimientos WHERE negocio_id=$1 AND fecha>=$2 AND fecha<${H} GROUP BY tipo,categoria ORDER BY total DESC`, [id, desde]),
    Q('SELECT id,concepto,categoria,monto::float AS monto,dia FROM fijos WHERE negocio_id=$1 ORDER BY dia,id', [id]),
    Q(`SELECT (SELECT COALESCE(SUM(monto),0) FROM movimientos WHERE negocio_id=$1 AND tipo='inversion')::float inversion,
      ((SELECT COALESCE(SUM(precio),0) FROM citas WHERE negocio_id=$1 AND estado='completada') + (SELECT COALESCE(SUM(monto),0) FROM movimientos WHERE negocio_id=$1 AND tipo='ingreso')
       - (SELECT COALESCE(SUM(monto),0) FROM movimientos WHERE negocio_id=$1 AND tipo='gasto'))::float utilidad`, [id]),
    Q(`WITH m AS (SELECT generate_series(date_trunc('month',$2::date) - interval '5 months', date_trunc('month',$2::date), interval '1 month')::date AS mes)
      SELECT to_char(m.mes,'YYYY-MM') mes,
       (SELECT COALESCE(SUM(precio),0) FROM citas c WHERE c.negocio_id=$1 AND c.estado='completada' AND c.fecha>=m.mes AND c.fecha<m.mes+interval '1 month')::float
       + (SELECT COALESCE(SUM(monto),0) FROM movimientos v WHERE v.negocio_id=$1 AND v.tipo='ingreso' AND v.fecha>=m.mes AND v.fecha<m.mes+interval '1 month')::float AS ingresos,
       (SELECT COALESCE(SUM(monto),0) FROM movimientos v WHERE v.negocio_id=$1 AND v.tipo='gasto' AND v.fecha>=m.mes AND v.fecha<m.mes+interval '1 month')::float AS gastos
      FROM m ORDER BY m.mes`, [id, desde]),
    Q('SELECT barbero, comision::float FROM perfiles WHERE negocio_id=$1', [id])]);
  const C = Object.fromEntries(com.map(x => [x.barbero, x.comision || 0])), suma = t => mov.filter(x => x.tipo === t).reduce((a, x) => a + x.monto, 0);
  const servicios = serv.reduce((a, x) => a + x.total, 0), extras = suma('ingreso'), gastos = suma('gasto'), inversion = suma('inversion');
  s.json({ mes, categorias: CATS, metodos: METODOS, servicios, extras, gastos, inversion, utilidad: servicios + extras - gastos,
    barberos: bars(q.neg).map(b => { const v = serv.find(x => x.barbero === b) || { cortes: 0, total: 0 }, pct = C[b] || 0, debe = Math.round(v.total * pct) / 100;
      return { barbero: b, cortes: v.cortes, total: v.total, comision: pct, debe, pagado: mov.filter(x => x.tipo === 'gasto' && x.barbero === b).reduce((a, x) => a + x.monto, 0) }; }),
    porCategoria: porCat, movimientos: mov, fijos: fijos.map(f => ({ ...f, registrado: mov.some(x => x.fijo_id === f.id) })), historico: tot[0], serie });
}));
api.post('/admin/movimiento', auth, wrap(async (q, s) => {
  const b = q.body, tipo = b.tipo, monto = Math.round(Number(b.monto) * 100) / 100, fecha = String(b.fecha || HOY());
  if (!CATS[tipo]) return s.status(400).json({ error: 'Tipo no válido' });
  if (!(monto > 0 && monto < 10000000)) return s.status(400).json({ error: 'Escribe un monto mayor a cero' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return s.status(400).json({ error: 'Fecha no válida' });
  const categoria = CATS[tipo].includes(b.categoria) ? b.categoria : CATS[tipo].at(-1), barbero = b.barbero && bars(q.neg).includes(b.barbero) ? b.barbero : null;
  const fijo = b.fijo_id ? (await pool.query('SELECT id FROM fijos WHERE id=$1 AND negocio_id=$2', [b.fijo_id, q.neg.id])).rows[0] : null;
  const r = await pool.query('INSERT INTO movimientos(negocio_id,tipo,categoria,concepto,monto,fecha,metodo,nota,barbero,fijo_id,usuario_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
    [q.neg.id, tipo, categoria, String(b.concepto || categoria).trim().slice(0, 120), monto, fecha, METODOS.includes(b.metodo) ? b.metodo : 'Efectivo', String(b.nota || '').slice(0, 300), barbero, fijo ? fijo.id : null, q.user.id]);
  s.json({ id: r.rows[0].id });
}));
api.post('/admin/movimiento/borrar', auth, wrap(async (q, s) => { await pool.query('DELETE FROM movimientos WHERE id=$1 AND negocio_id=$2', [q.body.id, q.neg.id]); s.json({ ok: true }); }));
api.post('/admin/fijo', auth, wrap(async (q, s) => {
  const b = q.body, concepto = String(b.concepto || '').trim().slice(0, 120), monto = Math.round(Number(b.monto) * 100) / 100, dia = parseInt(b.dia) || 1;
  if (!concepto || !(monto > 0) || dia < 1 || dia > 31) return s.status(400).json({ error: 'Escribe el concepto, el monto y el día del mes (1 a 31)' });
  const cat = CATS.gasto.includes(b.categoria) ? b.categoria : 'Otros gastos';
  if (b.id) await pool.query('UPDATE fijos SET concepto=$1,categoria=$2,monto=$3,dia=$4 WHERE id=$5 AND negocio_id=$6', [concepto, cat, monto, dia, b.id, q.neg.id]);
  else {
    if ((await pool.query('SELECT COUNT(*)::int c FROM fijos WHERE negocio_id=$1', [q.neg.id])).rows[0].c >= 30) return s.status(400).json({ error: 'Llegaste al límite de 30 gastos fijos' });
    await pool.query('INSERT INTO fijos(negocio_id,concepto,categoria,monto,dia) VALUES($1,$2,$3,$4,$5)', [q.neg.id, concepto, cat, monto, dia]);
  }
  s.json({ ok: true });
}));
api.post('/admin/fijo/borrar', auth, wrap(async (q, s) => { await pool.query('DELETE FROM fijos WHERE id=$1 AND negocio_id=$2', [q.body.id, q.neg.id]); s.json({ ok: true }); }));
api.post('/admin/comision', auth, wrap(async (q, s) => {
  const b = String(q.body.barbero || ''), c = Number(q.body.comision);
  if (!bars(q.neg).includes(b) || !(c >= 0 && c <= 100)) return s.status(400).json({ error: 'La comisión debe ser un porcentaje de 0 a 100' });
  await pool.query('INSERT INTO perfiles(negocio_id,barbero,comision) VALUES($1,$2,$3) ON CONFLICT (negocio_id,barbero) DO UPDATE SET comision=$3', [q.neg.id, b, c]);
  s.json({ ok: true });
}));
api.get('/admin/finanzas/export', auth, wrap(async (q, s) => {
  const { mes, desde } = rangoMes(q.query.mes);
  const r = (await pool.query("SELECT fecha::text AS fecha,tipo,categoria,concepto,monto,metodo,barbero,nota FROM movimientos WHERE negocio_id=$1 AND fecha>=$2 AND fecha<($2::date + interval '1 month') ORDER BY fecha,id", [q.neg.id, desde])).rows;
  const cel = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; }, T = { gasto: 'Gasto', inversion: 'Inversión', ingreso: 'Ingreso' };
  s.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="finanzas-${mes}.csv"`)
    .send('﻿' + [['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Monto', 'Método', 'Barbero', 'Nota'], ...r.map(x => [x.fecha, T[x.tipo], x.categoria, x.concepto, Number(x.monto), x.metodo, x.barbero || '', x.nota || ''])].map(f => f.map(cel).join(',')).join('\r\n'));
}));

// ---- Cuentas de clientes
const ligaCodigos = (q, id) => { const c = (Array.isArray(q.body.codigos) ? q.body.codigos : []).filter(x => typeof x === 'string').slice(0, 30); return c.length ? pool.query('UPDATE citas SET cuenta_id=$1 WHERE negocio_id=$2 AND codigo=ANY($3) AND cuenta_id IS NULL', [id, q.neg.id, c]) : null; };
api.post('/cliente/registro', wrap(async (q, s) => {
  if (limita('cr' + q.ip, 8, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  const nombre = String(q.body.nombre || '').trim().slice(0, 80), tel = tel10(q.body.telefono), pw = String(q.body.password || '');
  if (!nombre || tel.length !== 10 || pw.length < 6 || pw.length > 200) return s.status(400).json({ error: 'Escribe tu nombre, tu WhatsApp de 10 dígitos y una contraseña de al menos 6 caracteres' });
  const sa = nuevoSalt();
  let r;
  try { r = await pool.query('INSERT INTO cuentas(negocio_id,nombre,telefono,salt,hash) VALUES($1,$2,$3,$4,$5) RETURNING id', [q.neg.id, nombre, tel, sa, hashPass(pw, sa)]); }
  catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese WhatsApp ya tiene cuenta. Inicia sesión.' }); throw x; }
  await ligaCodigos(q, r.rows[0].id);
  await ponSesion(q, s, 'cliente', r.rows[0].id, q.neg.id, q.params.slug);
  s.json({ ok: true });
}));
api.post('/cliente/entrar', wrap(async (q, s) => {
  if (limLogin(q, s)) return;
  const c = (await pool.query('SELECT id,salt,hash FROM cuentas WHERE negocio_id=$1 AND telefono=$2', [q.neg.id, tel10(q.body.telefono)])).rows[0];
  if (!c || !okHash(String(q.body.password || ''), c.salt, c.hash)) return s.status(401).json({ error: 'WhatsApp o contraseña incorrectos' });
  await ligaCodigos(q, c.id);
  await ponSesion(q, s, 'cliente', c.id, q.neg.id, q.params.slug);
  s.json({ ok: true });
}));
api.post('/cliente/salir', wrap(async (q, s) => { await cierraSesion(q, s, 'cliente'); s.json({ ok: true }); }));
api.get('/cliente/yo', wrap(async (q, s) => {
  const c = await cuentaCli(q);
  if (!c) return s.status(401).json({ error: 'Sin sesión', sesion: false });
  const sel = 'SELECT codigo,servicio,barbero,fecha::text AS fecha,hora,precio,estado FROM citas WHERE negocio_id=$1 AND cuenta_id=$2';
  const prox = (await pool.query(sel + " AND estado='pendiente' AND fecha>=$3 ORDER BY fecha,hora", [q.neg.id, c.id, HOY()])).rows;
  const hist = (await pool.query(sel + " AND (fecha<$3 OR estado<>'pendiente') ORDER BY fecha DESC,hora DESC LIMIT 20", [q.neg.id, c.id, HOY()])).rows;
  s.json({ nombre: c.nombre, telefono: c.telefono, proximas: prox, historial: hist });
}));
api.post('/cliente/datos', wrap(async (q, s) => {
  const c = await cuentaCli(q);
  if (!c) return s.status(401).json({ error: 'Inicia sesión para continuar' });
  const nombre = String(q.body.nombre || '').trim().slice(0, 80), nueva = String(q.body.nueva || '');
  if (!nombre) return s.status(400).json({ error: 'Escribe tu nombre' });
  await pool.query('UPDATE cuentas SET nombre=$1 WHERE id=$2', [nombre, c.id]);
  if (nueva) {
    const k = (await pool.query('SELECT salt,hash FROM cuentas WHERE id=$1', [c.id])).rows[0];
    if (!okHash(String(q.body.actual || ''), k.salt, k.hash)) return s.status(400).json({ error: 'Tu contraseña actual no es correcta' });
    if (nueva.length < 6 || nueva.length > 200) return s.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    const sa = nuevoSalt(); await pool.query('UPDATE cuentas SET salt=$1,hash=$2 WHERE id=$3', [sa, hashPass(nueva, sa), c.id]);
  }
  s.json({ ok: true });
}));
api.post('/admin/cuentas/reset', auth, wrap(async (q, s) => {
  const c = (await pool.query('SELECT id,nombre FROM cuentas WHERE negocio_id=$1 AND telefono=$2', [q.neg.id, tel10(q.body.telefono)])).rows[0];
  if (!c) return s.status(404).json({ error: 'No hay una cuenta de cliente con ese WhatsApp' });
  const t = temporal(), sa = nuevoSalt();
  await pool.query('UPDATE cuentas SET salt=$1,hash=$2 WHERE id=$3', [sa, hashPass(t, sa), c.id]);
  await pool.query("DELETE FROM sesiones WHERE tipo='cliente' AND ref_id=$1", [c.id]);
  s.json({ nombre: c.nombre, temporal: t });
}));
api.get('/admin/cuentas', auth, wrap(async (q, s) => s.json((await pool.query('SELECT COUNT(*)::int total FROM cuentas WHERE negocio_id=$1', [q.neg.id])).rows[0])));

// ---- Fotos (guardadas en la propia base de datos)
api.post('/admin/imagen', auth, wrap(async (q, s) => {
  const { tipo, data } = q.body, n = q.neg; let ref = String(q.body.ref || '');
  if (!['portada', 'barbero', 'servicio', 'producto', 'evento'].includes(tipo)) return s.status(400).json({ error: 'Tipo de foto no válido' });
  if (tipo === 'portada') ref = '1';
  if (tipo === 'barbero' && !bars(n).includes(ref)) return s.status(400).json({ error: 'Ese barbero no está en tu lista' });
  const TB = { servicio: 'estilos', producto: 'productos', evento: 'eventos' }[tipo];
  if (TB && (!/^\d{1,10}$/.test(ref) || !(await pool.query(`SELECT 1 FROM ${TB} WHERE id=$1 AND negocio_id=$2`, [ref, n.id])).rowCount)) return s.status(400).json({ error: 'Ese elemento no existe' });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) return s.status(400).json({ error: 'La foto debe ser JPG, PNG o WebP' });
  const buf = Buffer.from(m[2], 'base64'), firma = buf.subarray(0, 12).toString('hex');
  if (!/^ffd8ff|^89504e47|^52494646.{8}57454250/.test(firma)) return s.status(400).json({ error: 'El archivo no parece una imagen válida' });
  if (buf.length > 700 * 1024) return s.status(400).json({ error: 'La foto es demasiado pesada (máximo 700 KB)' });
  await pool.query('DELETE FROM imagenes WHERE negocio_id=$1 AND tipo=$2 AND ref=$3', [n.id, tipo, ref]);
  const r = await pool.query('INSERT INTO imagenes(negocio_id,tipo,ref,mime,data) VALUES($1,$2,$3,$4,$5) RETURNING id', [n.id, tipo, ref, m[1], buf]);
  s.json({ id: r.rows[0].id });
}));
api.post('/admin/imagen/borrar', auth, wrap(async (q, s) => {
  await pool.query('DELETE FROM imagenes WHERE negocio_id=$1 AND tipo=$2 AND ref=$3', [q.neg.id, String(q.body.tipo), q.body.tipo === 'portada' ? '1' : String(q.body.ref || '')]);
  s.json({ ok: true });
}));
api.get('/info', wrap(async (q, s) => { const n = q.neg, im = (await pool.query("SELECT id,tipo,ref FROM imagenes WHERE negocio_id=$1 AND tipo IN ('portada','barbero')", [n.id])).rows; s.json({ portada: (im.find(x => x.tipo === 'portada') || {}).id || null, fotos_barberos: Object.fromEntries(im.filter(x => x.tipo === 'barbero').map(x => [x.ref, x.id])), nombre: n.nombre, direccion: n.direccion, whatsapp: n.whatsapp, maps: n.maps, barberos: bars(n), fotos: n.fotos, abierto: vigente(n), hora_ini: n.hora_ini, hora_fin: n.hora_fin, cierra: n.cierra || '' }); }));
api.get('/pagina', wrap(async (q, s) => {
  const n = q.neg, id = n.id, Q = (sql, p = [id]) => pool.query(sql, p).then(r => r.rows);
  const [pf, ev, pr, pd] = await Promise.all([
    Q("SELECT p.barbero,p.especialidad,p.bio,p.instagram FROM perfiles p WHERE p.negocio_id=$1"),
    Q("SELECT e.id,e.titulo,e.fecha::text AS fecha,e.hora,e.descripcion,e.cupo,i.id AS img,(SELECT COUNT(*)::int FROM asistentes a WHERE a.evento_id=e.id) AS van FROM eventos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='evento' AND i.ref=e.id::text WHERE e.negocio_id=$1 AND e.fecha>=$2 ORDER BY e.fecha,e.hora LIMIT 12", [id, HOY()]),
    Q('SELECT pregunta,respuesta FROM preguntas WHERE negocio_id=$1 ORDER BY orden,id'),
    Q("SELECT p.id,p.nombre,p.descripcion,p.precio,i.id AS img FROM productos p LEFT JOIN imagenes i ON i.negocio_id=p.negocio_id AND i.tipo='producto' AND i.ref=p.id::text WHERE p.negocio_id=$1 ORDER BY p.id")]);
  const P = Object.fromEntries(pf.map(x => [x.barbero, x]));
  s.json({ lema: n.lema || '', acerca: n.acerca || '', estacionamiento: n.estacionamiento || '', zonas: n.zonas || '', instagram: n.instagram || '',
    perfiles: bars(n).map(b => ({ barbero: b, especialidad: (P[b] || {}).especialidad || '', bio: (P[b] || {}).bio || '', instagram: (P[b] || {}).instagram || '' })),
    eventos: ev, preguntas: pr, productos: pd });
}));
api.post('/eventos/:id/asistir', wrap(async (q, s) => {
  if (limita('ev' + q.ip, 10, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  const e = (await pool.query('SELECT id,cupo,(SELECT COUNT(*)::int FROM asistentes a WHERE a.evento_id=e.id) AS van FROM eventos e WHERE id=$1 AND negocio_id=$2 AND fecha>=$3', [q.params.id, q.neg.id, HOY()])).rows[0];
  if (!e) return s.status(404).json({ error: 'Ese evento ya no está disponible' });
  const nombre = String(q.body.nombre || '').trim().slice(0, 80), tel = tel10(q.body.telefono);
  if (!nombre || tel.length !== 10) return s.status(400).json({ error: 'Escribe tu nombre y tu WhatsApp de 10 dígitos' });
  if (e.cupo && e.van >= e.cupo) return s.status(409).json({ error: 'Ya se llenó el cupo de este evento' });
  try { await pool.query('INSERT INTO asistentes(evento_id,nombre,telefono) VALUES($1,$2,$3)', [e.id, nombre, tel]); }
  catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ya estás apuntado a este evento' }); throw x; }
  s.json({ ok: true, van: e.van + 1 });
}));
api.get('/estilos', wrap(async (q, s) => s.json((await pool.query("SELECT e.id,e.nombre,e.tipo,e.descripcion,e.precio,i.id AS img FROM estilos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='servicio' AND i.ref=e.id::text WHERE e.negocio_id=$1 ORDER BY e.id", [q.neg.id])).rows)));
api.get('/productos', wrap(async (q, s) => s.json((await pool.query('SELECT id,nombre,descripcion,precio FROM productos WHERE negocio_id=$1 ORDER BY id', [q.neg.id])).rows)));
api.get('/horarios', wrap(async (q, s) => {
  const { fecha, barbero } = q.query, n = q.neg;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return s.json([]);
  const lista = barbero === 'cualquiera' ? bars(n) : [String(barbero)], sets = await Promise.all(lista.map(b => ocupadas(n, fecha, b)));
  s.json(todas(n).filter(h => sets.every(x => x.has(h))));
}));
api.post('/citas', wrap(async (q, s) => {
  if (limita('c' + q.ip, 10, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  if (!vigente(q.neg)) return s.status(403).json({ error: 'Esta barbería no está recibiendo citas por ahora.' });
  const n = q.neg, { cliente, telefono, servicio, fecha, hora } = q.body, h = +String(hora).slice(0, 2);
  let barbero = q.body.barbero;
  if (barbero === 'cualquiera' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) barbero = await elige(n, fecha, String(hora)) || bars(n)[0];
  if (!cliente || !telefono || !bars(n).includes(barbero) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora) || h < n.hora_ini || h > n.hora_fin)
    return s.status(400).json({ error: 'Revisa los datos de tu cita' });
  if (fecha < HOY() || (fecha === HOY() && h <= ahoraH())) return s.status(400).json({ error: 'Ese horario ya pasó. Elige otro.' });
  const e = await pool.query('SELECT precio FROM estilos WHERE nombre=$1 AND negocio_id=$2', [servicio, n.id]);
  if (!e.rowCount) return s.status(400).json({ error: 'Servicio no válido' });
  if (cerrado(n, fecha) || (await pool.query('SELECT 1 FROM bloqueos WHERE negocio_id=$1 AND fecha=$2 AND barbero=$3 AND (hora IS NULL OR hora=$4)', [n.id, fecha, barbero, hora])).rowCount)
    return s.status(409).json({ error: 'Ese horario no está disponible. Elige otro.' });
  try {
    const r = await pool.query('INSERT INTO citas(cliente,telefono,barbero,servicio,fecha,hora,precio,codigo,negocio_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING codigo,precio,barbero',
      [String(cliente).slice(0, 80), String(telefono).slice(0, 20), barbero, servicio, fecha, hora, e.rows[0].precio, crypto.randomBytes(6).toString('hex'), n.id]);
    const cu = await cuentaCli(q).catch(() => null);
    if (cu) await pool.query('UPDATE citas SET cuenta_id=$1 WHERE negocio_id=$2 AND codigo=$3', [cu.id, n.id, r.rows[0].codigo]);
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
api.post('/reprogramar', wrap(async (q, s) => {
  if (limita('m' + q.ip, 10, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  const n = q.neg, { codigo, fecha, hora } = q.body, h = +String(hora).slice(0, 2);
  if (!vigente(n)) return s.status(403).json({ error: 'Esta barbería no está recibiendo citas por ahora.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha)) || !/^\d{2}:\d{2}$/.test(String(hora)) || h < n.hora_ini || h > n.hora_fin) return s.status(400).json({ error: 'Revisa la nueva fecha y hora' });
  if (fecha < HOY() || (fecha === HOY() && h <= ahoraH())) return s.status(400).json({ error: 'Ese horario ya pasó. Elige otro.' });
  const c = (await pool.query("SELECT id,cliente,telefono,servicio,barbero,fecha::text AS fecha,hora,precio FROM citas WHERE negocio_id=$1 AND codigo=$2 AND estado='pendiente' AND fecha>=$3", [n.id, String(codigo), HOY()])).rows[0];
  if (!c) return s.status(404).json({ error: 'No encontramos esa cita' });
  if ((await ocupadas(n, fecha, c.barbero)).has(hora)) return s.status(409).json({ error: 'Ese horario no está disponible. Elige otro.' });
  try { await pool.query('UPDATE citas SET fecha=$1,hora=$2 WHERE id=$3', [fecha, hora, c.id]); }
  catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese horario ya se ocupó. Elige otro.' }); throw x; }
  avisa(n, { evento: 'cita_reprogramada', ...c, fecha, hora, precio: Number(c.precio), antes: new Date(c.fecha + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) + ' ' + c.hora });
  s.json({ ok: true });
}));
api.get('/admin/citas', auth, wrap(async (q, s) => s.json((await pool.query('SELECT id,cliente,telefono,barbero,servicio,fecha,hora,precio,estado FROM citas WHERE negocio_id=$1 AND fecha=$2 AND ($3::text IS NULL OR barbero=$3) ORDER BY hora', [q.neg.id, q.query.fecha, mio(q)])).rows)));
api.patch('/admin/citas/:id', auth, wrap(async (q, s) => ['pendiente', 'completada', 'cancelada', 'no_llego'].includes(q.body.estado) ? (async () => { const r = (await pool.query('UPDATE citas SET estado=$1 WHERE id=$2 AND negocio_id=$3 AND ($4::text IS NULL OR barbero=$4) RETURNING id,estado', [q.body.estado, q.params.id, q.neg.id, mio(q)])).rows[0]; r ? s.json(r) : s.status(404).json({ error: 'No encontramos esa cita' }); })() : s.status(400).json({ error: 'Estado no válido' })));
api.get('/admin/export', auth, wrap(async (q, s) => {
  const ok = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x)), hasta = ok(q.query.hasta) ? q.query.hasta : HOY(), desde = ok(q.query.desde) ? q.query.desde : hasta.slice(0, 8) + '01';
  const r = (await pool.query('SELECT fecha::text AS fecha,hora,cliente,telefono,servicio,barbero,precio,estado FROM citas WHERE negocio_id=$1 AND fecha BETWEEN $2 AND $3 ORDER BY fecha,hora', [q.neg.id, desde, hasta])).rows;
  const cel = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const E = { pendiente: 'Pendiente', completada: 'Completada', cancelada: 'Cancelada', no_llego: 'No llegó' };
  s.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="citas-${desde}-a-${hasta}.csv"`)
    .send('\ufeff' + [['Fecha', 'Hora', 'Cliente', 'WhatsApp', 'Servicio', 'Barbero', 'Precio', 'Estado'], ...r.map(x => [x.fecha, x.hora, x.cliente, x.telefono, x.servicio, x.barbero, Number(x.precio), E[x.estado] || x.estado])].map(f => f.map(cel).join(',')).join('\r\n'));
}));
api.get('/admin/corte', auth, wrap(async (q, s) => s.json((await pool.query(
  "SELECT barbero, COUNT(*)::int cortes, COALESCE(SUM(precio),0)::float total FROM citas WHERE negocio_id=$1 AND fecha=$2 AND estado='completada' AND ($3::text IS NULL OR barbero=$3) GROUP BY barbero", [q.neg.id, q.query.fecha, mio(q)])).rows)));
api.get('/admin/catalogo', auth, wrap(async (q, s) => s.json({
  estilos: (await pool.query("SELECT e.id,e.nombre,e.precio,i.id AS img FROM estilos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='servicio' AND i.ref=e.id::text WHERE e.negocio_id=$1 ORDER BY e.id", [q.neg.id])).rows,
  productos: (await pool.query("SELECT p.id,p.nombre,p.precio,i.id AS img FROM productos p LEFT JOIN imagenes i ON i.negocio_id=p.negocio_id AND i.tipo='producto' AND i.ref=p.id::text WHERE p.negocio_id=$1 ORDER BY p.id", [q.neg.id])).rows })));
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
  const n = q.neg, { cliente, telefono, servicio, fecha, hora, atendida } = q.body, barbero = mio(q) || q.body.barbero;
  if (!String(cliente || '').trim() || !bars(n).includes(barbero) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return s.status(400).json({ error: 'Revisa el nombre, el barbero y la hora' });
  const e = await pool.query('SELECT precio FROM estilos WHERE nombre=$1 AND negocio_id=$2', [servicio, n.id]);
  if (!e.rowCount) return s.status(400).json({ error: 'Servicio no válido' });
  try {
    await pool.query('INSERT INTO citas(cliente,telefono,barbero,servicio,fecha,hora,precio,codigo,estado,negocio_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [String(cliente).trim().slice(0, 80), String(telefono || '').slice(0, 20), barbero, servicio, fecha, hora, e.rows[0].precio, crypto.randomBytes(6).toString('hex'), atendida ? 'completada' : 'pendiente', n.id]);
    s.json({ ok: true });
  } catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese barbero ya tiene una cita a esa hora' }); throw x; }
}));
api.get('/admin/bloqueos', auth, wrap(async (q, s) => s.json((await pool.query('SELECT id,barbero,fecha::text AS fecha,hora,motivo FROM bloqueos WHERE negocio_id=$1 AND fecha>=$2 AND ($3::text IS NULL OR barbero=$3) ORDER BY fecha,barbero,hora', [q.neg.id, HOY(), mio(q)])).rows)));
api.post('/admin/bloqueo', auth, wrap(async (q, s) => {
  const n = q.neg, { barbero, fecha, hora, motivo } = q.body, lista = mio(q) ? [mio(q)] : barbero === 'todos' ? bars(n) : [barbero];
  if (!lista.every(b => bars(n).includes(b)) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || (hora && !/^\d{2}:\d{2}$/.test(hora))) return s.status(400).json({ error: 'Revisa los datos' });
  for (const b of lista) await pool.query('INSERT INTO bloqueos(negocio_id,barbero,fecha,hora,motivo) VALUES($1,$2,$3,$4,$5)', [n.id, b, fecha, hora || null, String(motivo || '').slice(0, 60)]);
  s.json({ ok: true });
}));
api.post('/admin/bloqueo/borrar', auth, wrap(async (q, s) => { await pool.query('DELETE FROM bloqueos WHERE id=$1 AND negocio_id=$2 AND ($3::text IS NULL OR barbero=$3)', [q.body.id, q.neg.id, mio(q)]); s.json({ ok: true }); }));
api.get('/admin/clientes', auth, wrap(async (q, s) => s.json((await pool.query(
  `SELECT regexp_replace(telefono,'\\D','','g') AS tel, (array_agg(cliente ORDER BY fecha DESC, id DESC))[1] AS nombre,
   COUNT(*) FILTER (WHERE estado='completada')::int AS visitas, COALESCE(SUM(precio) FILTER (WHERE estado='completada'),0)::float AS gastado,
   (MAX(fecha) FILTER (WHERE estado='completada'))::text AS ultima, (MIN(fecha) FILTER (WHERE estado='pendiente' AND fecha>=$2))::text AS proxima
   FROM citas WHERE negocio_id=$1 AND regexp_replace(telefono,'\\D','','g')<>'' GROUP BY 1 ORDER BY MAX(fecha) DESC LIMIT 300`, [q.neg.id, HOY()])).rows)));
api.get('/admin/ajustes', auth, (q, s) => { const { nombre, whatsapp, direccion, maps, barberos, hora_ini, hora_fin, plan, vence, cierra, avisos, correo, lema, acerca, estacionamiento, zonas, instagram } = q.neg; s.json({ nombre, whatsapp, direccion, maps, barberos, hora_ini, hora_fin, cierra, avisos, correo, lema, acerca, estacionamiento, zonas, instagram, plan, vence, abierto: vigente(q.neg) }); });
api.patch('/admin/ajustes', auth, wrap(async (q, s) => {
  const b = q.body, n = q.neg, v = k => String(b[k] !== undefined ? b[k] : (n[k] ?? '')).trim();
  const lista = v('barberos').split(',').map(x => x.trim().slice(0, 30)).filter(Boolean), lim = n.plan === 'pro' ? 8 : 3, barberos = lista.join(','), ini = +v('hora_ini'), fin = +v('hora_fin'), maps = v('maps'), cierra = v('cierra'), avisos = wa(v('avisos')) || null, correo = v('correo').toLowerCase().slice(0, 120);
  if (lista.length > lim) return s.status(400).json({ error: `Tu plan permite hasta ${lim} barberos` });
  if (!v('nombre') || !barberos || !(ini >= 0 && fin <= 23 && ini < fin) || (maps && !/^https?:\/\//.test(maps)) || !/^([0-6](,[0-6])*)?$/.test(cierra) || (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))) return s.status(400).json({ error: 'Revisa los datos' });
  await pool.query('UPDATE negocios SET nombre=$1,whatsapp=$2,direccion=$3,maps=$4,barberos=$5,hora_ini=$6,hora_fin=$7,cierra=$8,avisos=$9,correo=$10,lema=$11,acerca=$12,estacionamiento=$13,zonas=$14,instagram=$15 WHERE id=$16',
    [v('nombre').slice(0, 60), wa(v('whatsapp')) || null, v('direccion').slice(0, 120), maps, barberos, ini, fin, cierra, avisos, correo || null, v('lema').slice(0, 120), v('acerca').slice(0, 1200), v('estacionamiento').slice(0, 200), v('zonas').slice(0, 300), v('instagram').replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 40), n.id]);
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
  await pool.query('DELETE FROM imagenes WHERE negocio_id=$1 AND tipo=$2 AND ref=$3', [q.neg.id, q.body.tabla === 'estilos' ? 'servicio' : 'producto', String(q.body.id)]);
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
app.get('/sitemap.xml', wrap(async (q, s) => {
  const base = `${q.protocol}://${q.get('host')}`, r = (await pool.query('SELECT slug,activo,vence FROM negocios')).rows.filter(vigente);
  s.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['', '/registro', ...r.map(x => '/' + encodeURIComponent(x.slug))].map(u => `<url><loc>${base}${u}</loc></url>`).join('') + '</urlset>');
}));
const NEG = fs.readFileSync(__dirname + '/public/negocio.html', 'utf8');
const he = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// La landing sale con título, descripción y vista previa (WhatsApp, Google) ya puestos por el servidor.
app.get('/:slug', existe, wrap(async (q, s) => {
  const n = (await pool.query('SELECT nombre,direccion,fotos FROM negocios WHERE slug=$1', [q.params.slug])).rows[0];
  const t = he(/barber/i.test(n.nombre) ? n.nombre : n.nombre + ' · Barbería'), base = `${q.protocol}://${q.get('host')}`, url = `${base}/${encodeURIComponent(q.params.slug)}`;
  const d = he(`Agenda tu cita en línea en ${n.nombre}${n.direccion ? ', ' + n.direccion : ''}. Cortes clásicos y las tendencias más nuevas, con el barbero que tú elijas.`);
  const meta = `<meta property="og:url" content="${url}"><link rel="canonical" href="${url}">${n.fotos ? `<meta property="og:image" content="${base}/img/hero.jpg"><meta name="twitter:card" content="summary_large_image">` : ''}`;
  s.type('html').send(NEG.replace('<title>Barbería</title>', `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${d}">`)
    .replace('<meta property="og:title" content="Barbería">', `<meta property="og:title" content="${t}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${d}">${meta}`));
}));
app.get('/:slug/agenda', existe, page('app-agenda.html'));
app.get('/:slug/admin', existe, page('app-admin.html'));
app.get('/:slug/entrar', existe, page('entrar.html'));
app.get('/:slug/panel.json', existe, wrap(async (q, s) => {
  const n = (await pool.query('SELECT nombre FROM negocios WHERE slug=$1', [q.params.slug])).rows[0].nombre;
  s.type('application/manifest+json').json({ id: `/${q.params.slug}/admin`, name: 'Panel · ' + n, short_name: 'Panel', start_url: `/${q.params.slug}/admin`, scope: `/${q.params.slug}/`, display: 'standalone', orientation: 'portrait',
    background_color: '#07090f', theme_color: '#07090f', lang: 'es', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] });
}));
app.get('/:slug/cartel', existe, page('cartel.html'));
app.get('/:slug/manifest.json', existe, wrap(async (q, s) => {
  const n = (await pool.query('SELECT nombre FROM negocios WHERE slug=$1', [q.params.slug])).rows[0].nombre;
  s.type('application/manifest+json').json({ id: `/${q.params.slug}`, name: n, short_name: n.slice(0, 12), description: 'Agenda tu cita en ' + n, start_url: `/${q.params.slug}/agenda?app=1`, scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#07090f', theme_color: '#07090f', lang: 'es', categories: ['lifestyle', 'business'],
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    shortcuts: [{ name: 'Agendar cita', url: `/${q.params.slug}/agenda?app=1` }] });
}));
app.listen(process.env.PORT || 3000);
