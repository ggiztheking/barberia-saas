const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());
app.use(express.static('public'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`CREATE TABLE IF NOT EXISTS citas (
  id SERIAL PRIMARY KEY, cliente TEXT NOT NULL, telefono TEXT, barbero TEXT NOT NULL,
  servicio TEXT NOT NULL, fecha DATE NOT NULL, hora TEXT NOT NULL,
  precio NUMERIC DEFAULT 0, estado TEXT DEFAULT 'pendiente')`).catch(console.error);
const wrap = f => (q, s) => f(q, s).catch(e => s.status(500).json({ error: e.message }));
app.get('/api/citas', wrap(async (q, s) => {
  const r = await pool.query('SELECT * FROM citas WHERE fecha=$1 ORDER BY hora', [q.query.fecha]);
  s.json(r.rows);
}));
app.post('/api/citas', wrap(async (q, s) => {
  const { cliente, telefono, barbero, servicio, fecha, hora, precio } = q.body;
  const r = await pool.query(
    'INSERT INTO citas (cliente,telefono,barbero,servicio,fecha,hora,precio) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [cliente, telefono, barbero, servicio, fecha, hora, precio || 0]);
  s.json(r.rows[0]);
}));
app.patch('/api/citas/:id', wrap(async (q, s) => {
  const r = await pool.query('UPDATE citas SET estado=$1 WHERE id=$2 RETURNING *', [q.body.estado, q.params.id]);
  s.json(r.rows[0]);
}));
app.get('/api/corte', wrap(async (q, s) => {
  const r = await pool.query(
    "SELECT barbero, COUNT(*)::int cortes, COALESCE(SUM(precio),0)::float total FROM citas WHERE fecha=$1 AND estado='completada' GROUP BY barbero",
    [q.query.fecha]);
  s.json(r.rows);
}));
app.listen(process.env.PORT || 3000);
