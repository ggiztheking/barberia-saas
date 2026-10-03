const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());
app.use(express.static('public'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BARBEROS = (process.env.BARBEROS || 'Barbero 1,Barbero 2').split(',').map(s => s.trim());
const ADMIN = process.env.ADMIN_PASS || '';
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const wrap = f => (q, s) => f(q, s).catch(e => s.status(500).json({ error: 'Error del servidor' }));
const auth = (q, s, n) => (ADMIN && q.get('x-admin') === ADMIN) ? n() : s.status(401).json({ error: 'Contraseña incorrecta' });
const SEED = [
 ['Taper clásico','clásico','Laterales degradados suaves y largo natural arriba.',200],
 ['Corte a tijera','clásico','Todo el corte con tijera, acabado natural.',200],
 ['Pompadour','clásico','Volumen al frente peinado hacia atrás.',200],
 ['Raya lateral','clásico','El corte formal de siempre, con raya marcada.',200],
 ['Corte militar','clásico','Corto y parejo, fácil de mantener.',200],
 ['Low fade','nuevo','Degradado bajo que arranca sobre la oreja.',200],
 ['Mid fade','nuevo','Degradado medio, el más pedido.',200],
 ['Burst fade','nuevo','Degradado curvo alrededor de la oreja.',200],
 ['Textured crop','nuevo','Corto con textura arriba y flequillo.',200],
 ['Mullet moderno','nuevo','Corto a los lados, largo atrás.',200],
 ['Corte y barba','servicio','Corte a elegir más perfilado de barba con navaja.',350],
 ['Barba con navaja','servicio','Toalla caliente, navaja y aceite.',130]];
const PROD = [
 ['Pomada mate','Fijación fuerte sin brillo.',180],['Cera con brillo','Acabado clásico y peinado pulido.',180],
 ['Aceite para barba','Suaviza e hidrata.',160],['Shampoo para barba','Limpieza diaria.',140],['Spray texturizante','Volumen y textura.',170]];
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS citas (id SERIAL PRIMARY KEY, cliente TEXT NOT NULL, telefono TEXT, barbero TEXT NOT NULL,
    servicio TEXT NOT NULL, fecha DATE NOT NULL, hora TEXT NOT NULL, precio NUMERIC DEFAULT 0, estado TEXT DEFAULT 'pendiente')`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS citas_slot ON citas(barbero,fecha,hora) WHERE estado<>'cancelada'`);
  await pool.query('ALTER TABLE citas ADD COLUMN IF NOT EXISTS codigo TEXT');
  await pool.query(`CREATE TABLE IF NOT EXISTS estilos (id SERIAL PRIMARY KEY, nombre TEXT, tipo TEXT, descripcion TEXT, precio NUMERIC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS productos (id SERIAL PRIMARY KEY, nombre TEXT, descripcion TEXT, precio NUMERIC)`);
  if (!(await pool.query('SELECT 1 FROM estilos LIMIT 1')).rowCount)
    for (const r of SEED) await pool.query('INSERT INTO estilos(nombre,tipo,descripcion,precio) VALUES($1,$2,$3,$4)', r);
  await pool.query("UPDATE estilos SET precio=200 WHERE tipo IN ('clásico','nuevo')");
  await pool.query("UPDATE estilos SET precio=350 WHERE nombre='Corte y barba'");
  if (!(await pool.query('SELECT 1 FROM productos LIMIT 1')).rowCount)
    for (const r of PROD) await pool.query('INSERT INTO productos(nombre,descripcion,precio) VALUES($1,$2,$3)', r);
})().catch(console.error);

app.get('/api/info', (q, s) => s.json({ barberos: BARBEROS }));
app.get('/api/estilos', wrap(async (q, s) => s.json((await pool.query('SELECT * FROM estilos ORDER BY id')).rows)));
app.get('/api/productos', wrap(async (q, s) => s.json((await pool.query('SELECT * FROM productos ORDER BY id')).rows)));
app.get('/api/horarios', wrap(async (q, s) => {
  const r = await pool.query("SELECT hora FROM citas WHERE fecha=$1 AND barbero=$2 AND estado<>'cancelada'", [q.query.fecha, q.query.barbero]);
  s.json(r.rows.map(x => x.hora));
}));
app.post('/api/citas', wrap(async (q, s) => {
  const { cliente, telefono, barbero, servicio, fecha, hora } = q.body;
  if (!cliente || !telefono || !BARBEROS.includes(barbero) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora))
    return s.status(400).json({ error: 'Revisa los datos de tu cita' });
  if (fecha < HOY()) return s.status(400).json({ error: 'Elige una fecha de hoy en adelante' });
  const e = await pool.query('SELECT precio FROM estilos WHERE nombre=$1', [servicio]);
  if (!e.rowCount) return s.status(400).json({ error: 'Servicio no válido' });
  try {
    const codigo = require('crypto').randomBytes(6).toString('hex');
    const r = await pool.query('INSERT INTO citas(cliente,telefono,barbero,servicio,fecha,hora,precio,codigo) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,codigo,precio',
      [String(cliente).slice(0, 80), String(telefono).slice(0, 20), barbero, servicio, fecha, hora, e.rows[0].precio, codigo]);
    s.json(r.rows[0]);
  } catch (x) { if (x.code === '23505') return s.status(409).json({ error: 'Ese horario ya se ocupó. Elige otro.' }); throw x; }
}));
app.post('/api/mis-citas', wrap(async (q, s) => {
  const c = (Array.isArray(q.body.codigos) ? q.body.codigos : []).filter(x => typeof x === 'string').slice(0, 20);
  const r = await pool.query('SELECT codigo,servicio,barbero,fecha::text AS fecha,hora,precio,estado FROM citas WHERE codigo = ANY($1) AND fecha >= $2 ORDER BY fecha,hora', [c, HOY()]);
  s.json(r.rows);
}));
app.post('/api/cancelar', wrap(async (q, s) => {
  const r = await pool.query("UPDATE citas SET estado='cancelada' WHERE codigo=$1 AND estado='pendiente' RETURNING id", [String(q.body.codigo)]);
  r.rowCount ? s.json({ ok: true }) : s.status(404).json({ error: 'No se pudo cancelar esa cita' });
}));
app.get('/api/admin/citas', auth, wrap(async (q, s) => s.json((await pool.query('SELECT * FROM citas WHERE fecha=$1 ORDER BY hora', [q.query.fecha])).rows)));
app.patch('/api/admin/citas/:id', auth, wrap(async (q, s) => s.json((await pool.query('UPDATE citas SET estado=$1 WHERE id=$2 RETURNING *', [q.body.estado, q.params.id])).rows[0])));
app.get('/api/admin/corte', auth, wrap(async (q, s) => s.json((await pool.query(
  "SELECT barbero, COUNT(*)::int cortes, COALESCE(SUM(precio),0)::float total FROM citas WHERE fecha=$1 AND estado='completada' GROUP BY barbero", [q.query.fecha])).rows)));
app.listen(process.env.PORT || 3000);
