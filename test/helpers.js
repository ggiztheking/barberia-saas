// Utilidades de prueba: arrancan el servidor real en un puerto libre.
const { spawn } = require('node:child_process');

exports.arranca = async (env = {}) => {
  const puerto = 20000 + Math.floor(Math.random() * 20000), base = `http://127.0.0.1:${puerto}`;
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(puerto), ...env }, stdio: 'inherit' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/health')).ok) return { base, parar: () => proc.kill() }; } catch (e) { /* aún no arranca */ }
    await new Promise(r => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('El servidor no arrancó a tiempo');
};

// Registra una barbería y devuelve la cookie de sesión del dueño.
exports.registra = async (base, slug) => {
  const r = await fetch(base + '/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Barbería ' + slug, slug, dueno: 'Dueño', email: `${slug}@ejemplo.com`, password: 'clave-segura-123', whatsapp: '9991234567' }) });
  if (r.status !== 200) throw new Error('registro falló: ' + r.status);
  return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
};
