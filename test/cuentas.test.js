// Cuentas de clientes: el cliente puede borrar la suya (derecho de cancelación) sin perder las citas del negocio.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const sufijo = Date.now().toString(36);
const HOY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' });
const mas = (f, k) => { const x = new Date(f + 'T12:00'); x.setDate(x.getDate() + k); return x.toLocaleDateString('en-CA'); };
let srv, pool, ipN = 0;
const ip = () => `10.92.${Math.floor(++ipN / 250)}.${ipN % 250 + 1}`;
const post = (slug, ruta, cuerpo, cookie = '') => fetch(`${srv.base}/api/${slug}${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': ip() }, body: JSON.stringify(cuerpo || {}) });
const get = (slug, ruta, cookie = '') => fetch(`${srv.base}/api/${slug}${ruta}`, { headers: { Cookie: cookie } });
const galleta = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

before(async () => {
  if (sinBase) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  srv = await arranca();
});
after(async () => { if (srv) srv.parar(); if (pool) await pool.end(); });

test('el cliente borra su cuenta con su contraseña: se cierran sus sesiones y sus citas quedan en la agenda', { skip: sinBase }, async () => {
  const slug = 'cb-' + sufijo;
  await registra(srv.base, slug, ip());
  const negocio = (await pool.query('SELECT id FROM negocios WHERE slug=$1', [slug])).rows[0].id;
  const alta = await post(slug, '/cliente/registro', { nombre: 'Cliente Borra', telefono: '999 555 0101', password: 'secreta-1' });
  assert.equal(alta.status, 200);
  const cookie = galleta(alta);
  const otra = galleta(await post(slug, '/cliente/entrar', { telefono: '9995550101', password: 'secreta-1' })); // otro celular
  const cita = await post(slug, '/citas', { cliente: 'Cliente Borra', telefono: '9995550101', barbero: 'Barbero 1', servicio: 'Mid fade', fecha: mas(HOY(), 1), hora: '11:00' }, cookie);
  assert.equal(cita.status, 200);

  assert.equal((await post(slug, '/cliente/borrar', { password: 'secreta-1' })).status, 401, 'sin sesión no se borra nada');
  const mala = await post(slug, '/cliente/borrar', { password: 'otra-cosa' }, cookie);
  assert.equal(mala.status, 400);
  assert.match((await mala.json()).error, /contraseña no es correcta/);
  assert.equal((await get(slug, '/cliente/yo', cookie)).status, 200, 'con la contraseña mal, la cuenta sigue');

  const ok = await post(slug, '/cliente/borrar', { password: 'secreta-1' }, cookie);
  assert.equal(ok.status, 200);
  assert.ok(ok.headers.getSetCookie().some(c => /Expires=Thu, 01 Jan 1970/.test(c)), 'borra la cookie de este celular');
  assert.equal((await get(slug, '/cliente/yo', cookie)).status, 401);
  assert.equal((await get(slug, '/cliente/yo', otra)).status, 401, 'también se cierra la sesión del otro celular');
  assert.equal((await pool.query('SELECT 1 FROM cuentas WHERE negocio_id=$1', [negocio])).rowCount, 0);
  const c = (await pool.query('SELECT cliente,telefono,cuenta_id FROM citas WHERE negocio_id=$1', [negocio])).rows;
  assert.deepEqual(c, [{ cliente: 'Cliente Borra', telefono: '9995550101', cuenta_id: null }], 'la cita sigue en la agenda, sin cuenta');
  assert.equal((await post(slug, '/cliente/entrar', { telefono: '9995550101', password: 'secreta-1' })).status, 401, 'ya no puede entrar');
  assert.equal((await post(slug, '/cliente/registro', { nombre: 'De nuevo', telefono: '9995550101', password: 'secreta-2' })).status, 200, 'puede volver a crear una cuenta');
});

test('una sesión de cliente de otra barbería no borra cuentas aquí', { skip: sinBase }, async () => {
  const a = 'ca-' + sufijo, b = 'cc-' + sufijo;
  await registra(srv.base, a, ip());
  await registra(srv.base, b, ip());
  const k = galleta(await post(a, '/cliente/registro', { nombre: 'De A', telefono: '9995550202', password: 'secreta-1' }));
  await post(b, '/cliente/registro', { nombre: 'De B', telefono: '9995550202', password: 'secreta-1' });
  assert.equal((await post(b, '/cliente/borrar', { password: 'secreta-1' }, k)).status, 401);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM cuentas WHERE telefono=$1', ['9995550202'])).rows[0].n, 2);
});
