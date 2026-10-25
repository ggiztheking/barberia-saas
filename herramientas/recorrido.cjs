// Recorrido de humo en un navegador real sobre una base de prueba recién creada: abre la página de la barbería,
// agenda una cita como cliente, crea la cuenta del dueño, abre cada pestaña del panel y busca la cita en "Hoy".
// Guarda capturas (compu y celular) y falla si alguna página tira errores o se sale de la pantalla en celular.
// Uso: node herramientas/recorrido.cjs <url-del-servidor> <slug> <contraseña-inicial-del-panel> <carpeta-de-capturas>
const { chromium } = require('playwright');

const [base, slug, clavePanel, salida] = process.argv.slice(2);
const errores = [];
const anota = (donde) => (m) => errores.push(`${donde}: ${m}`);

async function nuevaPagina(navegador, ancho, alto) {
  const page = await navegador.newPage({ viewport: { width: ancho, height: alto } });
  page.on('pageerror', (e) => anota(page.url())(e.message));
  page.on('console', (m) => {
    // "Failed to load resource" sale también con los 401 esperados (¿hay sesión?) y con recursos externos sin red;
    // los 500 del servidor se cuentan abajo, en las respuestas.
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|Failed to load resource/.test(m.text())) anota(page.url())(m.text());
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(base).origin && r.status() >= 500) anota(page.url())(`${r.status()} en ${u.pathname}`);
  });
  return page;
}

async function sinDesborde(page, nombre) {
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  if (ancho > page.viewportSize().width + 2) errores.push(`${nombre}: en celular la página mide ${ancho}px, más que la pantalla`);
}

// Agenda una cita en la agenda del cliente: primer servicio, primer barbero, el primer día con horarios y su primera hora.
async function agendar(page) {
  await page.goto(`${base}/${slug}/agenda`);
  await page.locator('#srv .opt').first().waitFor();
  await page.locator('#srv .opt').first().click();
  await page.locator('#bar .opt').first().click();
  let fecha = null;
  for (const dia of await page.locator('#dias .dia:not([disabled])').all()) {
    await dia.click();
    await page.locator('#horas button[data-h]:not([disabled]), #horas .vacio:not(:has-text("Buscando"))').first().waitFor();
    if (await page.locator('#horas button[data-h]:not([disabled])').count()) { fecha = await dia.getAttribute('data-f'); break; }
  }
  if (!fecha) throw new Error('La agenda no ofrece ningún horario libre en los próximos días');
  await page.locator('#horas button[data-h]:not([disabled])').first().click();
  await page.fill('#nom', 'Cliente Recorrido');
  await page.fill('#tel', '9991234567');
  await page.screenshot({ path: `${salida}/2-agenda.png`, fullPage: true });
  await page.locator('#go').click();
  await Promise.race([
    page.locator('#hecho .exito').waitFor(),
    page.locator('#err .msg, #err:not(:empty)').waitFor().then(async () => { throw new Error('No se pudo agendar: ' + (await page.locator('#err').textContent())); }),
  ]);
  await page.screenshot({ path: `${salida}/3-cita-agendada.png` });
  return fecha;
}

(async () => {
  const navegador = await chromium.launch();
  const compu = await nuevaPagina(navegador, 1280, 860);

  await compu.goto(`${base}/${slug}`);
  await compu.waitForLoadState('networkidle');
  await compu.screenshot({ path: `${salida}/1-pagina.png`, fullPage: true });

  const fecha = await agendar(compu);

  // Panel: la base es nueva, así que se crea la cuenta del dueño con la contraseña inicial del panel.
  await compu.goto(`${base}/${slug}/entrar`);
  await compu.locator('#f-config:not([hidden])').waitFor();
  await compu.fill('#c-clave', clavePanel);
  await compu.fill('#c-nom', 'Dueño Recorrido');
  await compu.fill('#c-mail', 'dueno-recorrido@ejemplo.com');
  await compu.fill('#c-pw', 'clave-recorrido-123');
  await compu.locator('#f-config [type=submit]').click();
  await compu.waitForURL(`**/${slug}/admin`);
  await compu.locator('#tabs button').first().waitFor();

  // La cita recién agendada debe verse en "Hoy" al ir a su día.
  await compu.locator('#tabs button[data-t="hoy"]').click();
  await compu.fill('#dia', fecha);
  await compu.locator('#dia').dispatchEvent('change');
  await compu.getByText('Cliente Recorrido').first().waitFor({ timeout: 8000 })
    .catch(() => errores.push(`Panel: la cita de prueba del ${fecha} no aparece en "Hoy"`));
  await compu.screenshot({ path: `${salida}/4-panel-hoy.png`, fullPage: true });

  const pestanas = await compu.locator('#tabs button').evaluateAll((bs) => bs.map((b) => b.dataset.t));
  for (const t of pestanas) {
    await compu.locator(`#tabs button[data-t="${t}"]`).click();
    await compu.waitForLoadState('networkidle');
    await compu.waitForTimeout(300);
    if (t !== 'hoy') await compu.screenshot({ path: `${salida}/5-panel-${t}.png`, fullPage: true });
  }

  // Celular: la misma sesión del dueño en una pantalla de 390 px.
  const estado = await compu.context().storageState();
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, storageState: estado });
  const cel = await contexto.newPage();
  cel.on('pageerror', (e) => anota('celular ' + cel.url())(e.message));
  for (const [ruta, nombre] of [['', 'pagina'], ['/agenda', 'agenda'], ['/admin', 'panel']]) {
    await cel.goto(`${base}/${slug}${ruta}`);
    await cel.waitForLoadState('networkidle');
    await cel.waitForTimeout(300);
    await cel.screenshot({ path: `${salida}/6-celular-${nombre}.png` });
    await sinDesborde(cel, nombre);
  }

  await navegador.close();
  if (errores.length) {
    console.error('✗ El recorrido encontró problemas:\n  - ' + [...new Set(errores)].join('\n  - '));
    process.exit(1);
  }
  console.log(`  Página, agenda (cita del ${fecha}) y ${pestanas.length} pestañas del panel sin errores.`);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
