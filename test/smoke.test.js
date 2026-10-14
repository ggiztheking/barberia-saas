// Pruebas de humo: arrancan el servidor real contra una base PostgreSQL.
// Requieren DATABASE_URL (en CI viene del servicio postgres); sin ella se omiten.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = 3900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
let srv;
const slug = 'prueba-' + Date.now().toString(36);

const listo = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) { /* aún no arranca */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('El servidor no arrancó a tiempo');
};
const registra = body => fetch(BASE + '/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  if (sinBase) return;
  srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), SUPER_PASS: 'super-de-prueba' }, stdio: 'inherit' });
  await listo();
});
after(() => { if (srv) srv.kill(); });

test('health responde ok', { skip: sinBase }, async () => {
  const r = await fetch(BASE + '/health');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
});

test('la landing y /registro cargan', { skip: sinBase }, async () => {
  for (const ruta of ['/', '/registro']) assert.equal((await fetch(BASE + ruta)).status, 200, ruta);
});

test('registrar una barbería nueva crea su página pública', { skip: sinBase }, async () => {
  const r = await registra({ nombre: 'Barbería de prueba', slug, dueno: 'Dueño', email: `${slug}@ejemplo.com`, password: 'clave-segura-123', whatsapp: '9991234567' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).slug, slug);
  assert.equal((await fetch(`${BASE}/${slug}`)).status, 200);
  const info = await (await fetch(`${BASE}/api/${slug}/info`)).json();
  assert.ok(info && typeof info === 'object');
});

test('un enlace repetido da 409', { skip: sinBase }, async () => {
  const r = await registra({ nombre: 'Otra', slug, dueno: 'Dueño', email: `otro-${slug}@ejemplo.com`, password: 'clave-segura-123' });
  assert.equal(r.status, 409);
});

test('el panel de admin exige sesión', { skip: sinBase }, async () => {
  assert.equal((await fetch(`${BASE}/api/${slug}/admin/finanzas`)).status, 401);
});

test('el panel /super rechaza sin contraseña y acepta con ella', { skip: sinBase }, async () => {
  assert.equal((await fetch(BASE + '/api/super/negocios')).status, 401);
  const ok = await fetch(BASE + '/api/super/negocios', { headers: { 'x-super': 'super-de-prueba' } });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(await ok.json()));
});
