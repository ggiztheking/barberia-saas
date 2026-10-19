// Página comercial bilingüe: / en español y /en en inglés, con hreflang, selector de idioma, precios e imágenes que sí existen.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { arranca } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const PUB = 'https://landing-prueba.ejemplo.mx'; // PUBLIC_URL fijo para que canonical y hreflang sean predecibles
let base, parar;
const pag = {};

before(async () => {
  if (sinBase) return;
  ({ base, parar } = await arranca({ PUBLIC_URL: PUB, PRECIO_BASICO: '399', PRECIO_PRO: '899', SOPORTE_WHATSAPP: '999 111 2233' }));
  for (const [k, ruta] of [['es', '/'], ['en', '/en']]) {
    const r = await fetch(base + ruta);
    pag[k] = { status: r.status, tipo: r.headers.get('content-type'), html: await r.text() };
  }
});
after(() => { if (parar) parar(); });

// Atributo de una etiqueta <link>/<meta>/<a> (orden de atributos libre).
const etiquetas = (html, nombre) => html.match(new RegExp(`<${nombre}\\b[^>]*>`, 'g')) || [];
const attr = (tag, a) => { const m = tag.match(new RegExp(`\\s${a}="([^"]*)"`)); return m ? m[1] : null; };

test('/ y /en responden 200 como HTML', { skip: sinBase }, async () => {
  for (const k of ['es', 'en']) {
    assert.equal(pag[k].status, 200, k);
    assert.match(pag[k].tipo, /text\/html/, k);
  }
});

test('/en está en inglés: lang, metas, canonical, og:locale y textos', { skip: sinBase }, async () => {
  const h = pag.en.html;
  assert.ok(h.startsWith('<!doctype html><html lang="en">'), 'lang="en"');
  assert.ok(h.includes(`<link rel="canonical" href="${PUB}/en">`), 'canonical a /en');
  assert.ok(h.includes('<meta property="og:locale" content="en_US">'));
  assert.ok(h.includes(`<meta property="og:url" content="${PUB}/en">`));
  for (const x of ['Free trial', 'Start my free trial', 'No credit card', 'Cancel anytime', 'Frequently asked questions', 'Pricing', 'Log in', 'MXN per month', 'Mexican pesos'])
    assert.ok(h.includes(x), 'falta: ' + x);
  for (const x of ['Prueba gratis', 'Preguntas frecuentes', 'Crear mi barbería', 'Sin tarjeta', 'al mes'])
    assert.ok(!h.includes(x), 'quedó en español: ' + x);
  const desc = attr(etiquetas(h, 'meta').find(t => attr(t, 'name') === 'description'), 'content');
  assert.match(desc, /online booking/);
  assert.match(h.match(/<title>([^<]*)<\/title>/)[1], /barbershop/);
});

test('ambas páginas muestran los precios que se cobran y no dejan marcadores', { skip: sinBase }, async () => {
  for (const k of ['es', 'en']) {
    const h = pag[k].html;
    assert.ok(h.includes('$399 <small>') && h.includes('$899 <small>'), k + ': precios');
    assert.ok(!/__[A-Z_]+__/.test(h), k + ': quedó un marcador');
    assert.ok(!h.includes('__'), k + ': quedó un doble guion bajo');
  }
  assert.ok(pag.es.html.includes('MXN al mes'));
});

test('JSON-LD válido en cada idioma, con FAQ y precios en MXN', { skip: sinBase }, async () => {
  for (const k of ['es', 'en']) {
    const m = pag[k].html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(m, k + ': falta JSON-LD');
    const g = JSON.parse(m[1])['@graph'];
    const app = g.find(x => x['@type'] === 'SoftwareApplication'), faq = g.find(x => x['@type'] === 'FAQPage');
    assert.deepEqual(app.offers.map(o => [o.price, o.priceCurrency]), [['399', 'MXN'], ['899', 'MXN']], k);
    assert.ok(faq.mainEntity.length >= 4, k + ': preguntas');
    // Cada pregunta del JSON-LD también se ve en la página.
    for (const q of faq.mainEntity) assert.ok(pag[k].html.includes(`<summary>${q.name}</summary>`), k + ': pregunta visible: ' + q.name);
  }
  const en = JSON.parse(pag.en.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.equal(en[0].url, PUB + '/en');
  assert.match(en[1].mainEntity[0].name, /credit card/);
});

test('hreflang es-MX, en y x-default en las dos páginas', { skip: sinBase }, async () => {
  for (const k of ['es', 'en']) {
    const alt = etiquetas(pag[k].html, 'link').filter(t => attr(t, 'rel') === 'alternate').map(t => [attr(t, 'hreflang'), attr(t, 'href')]);
    assert.deepEqual(alt, [['es-MX', PUB + '/'], ['en', PUB + '/en'], ['x-default', PUB + '/']], k);
  }
  assert.ok(pag.es.html.includes(`<link rel="canonical" href="${PUB}/">`));
});

test('selector de idioma en encabezado y pie, con enlaces cruzados y aria-current', { skip: sinBase }, async () => {
  for (const [k, actual] of [['es', '/'], ['en', '/en']]) {
    const h = pag[k].html;
    const grupos = [...h.matchAll(/<span class="idi"[^>]*>[\s\S]*?<\/span>/g)];
    assert.equal(grupos.length, 2, k + ': selector en encabezado y pie');
    assert.ok(grupos[0].index < h.indexOf('<main') && grupos[1].index > h.indexOf('<footer'), k + ': posiciones');
    for (const [g] of grupos) {
      const as = etiquetas(g, 'a');
      assert.deepEqual(as.map(a => attr(a, 'href')), ['/', '/en'], k);
      const cur = as.filter(a => attr(a, 'aria-current') === 'page');
      assert.equal(cur.length, 1, k + ': un solo idioma actual');
      assert.equal(attr(cur[0], 'href'), actual, k + ': marca la página actual');
    }
  }
});

test('/en avisa que registro, términos y privacidad están en español', { skip: sinBase }, async () => {
  const h = pag.en.html;
  const as = etiquetas(h, 'a').filter(a => ['/registro', '/terminos', '/privacidad'].includes(attr(a, 'href')));
  assert.ok(as.length >= 5, 'hay enlaces a esas páginas');
  for (const a of as) assert.equal(attr(a, 'hreflang'), 'es', 'enlace a página en español: ' + a);
  assert.ok(h.includes('Terms <small>(in Spanish)</small>') && h.includes('Privacy <small>(in Spanish)</small>'));
  assert.ok(h.includes('(in Spanish)') && h.includes('Sign-up form'));
  // El soporte del pie sale en inglés; el de la página en español, en español.
  assert.ok(h.includes('WhatsApp support') && !h.includes('Soporte por WhatsApp'));
  assert.ok(pag.es.html.includes('Soporte por WhatsApp') && pag.es.html.includes('href="/terminos"') && pag.es.html.includes('href="/privacidad"'));
});

test('todas las imágenes referenciadas en ambas páginas existen', { skip: sinBase }, async () => {
  const rutas = new Set();
  for (const k of ['es', 'en']) {
    const h = pag[k].html;
    for (const m of h.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)) rutas.add(m[1]);
    for (const m of h.matchAll(/url\(([^)]+)\)/g)) rutas.add(m[1].replace(/["']/g, ''));
    for (const m of h.matchAll(/<link rel="preload" as="image" href="([^"]+)"/g)) rutas.add(m[1]);
    const og = attr(etiquetas(h, 'meta').find(t => attr(t, 'property') === 'og:image'), 'content');
    assert.ok(og.startsWith(PUB + '/'), 'og:image absoluta');
    rutas.add(og.slice(PUB.length));
  }
  assert.ok(rutas.size >= 6, 'encontró las imágenes: ' + [...rutas]);
  for (const r of rutas) {
    assert.ok(r.startsWith('/'), 'ruta local: ' + r);
    const res = await fetch(base + r);
    assert.equal(res.status, 200, r);
    assert.match(res.headers.get('content-type'), /^image\//, r);
    await res.arrayBuffer();
  }
});

test('imágenes: medidas declaradas y las generadas con IA llevan crédito y alt sin atribuirlas a Estilo Internacional', { skip: sinBase }, async () => {
  for (const [k, credito] of [['es', 'Imágenes ilustrativas generadas con IA'], ['en', 'Illustrative AI-generated images']]) {
    const imgs = etiquetas(pag[k].html, 'img');
    for (const i of imgs) assert.ok(attr(i, 'width') && attr(i, 'height') && attr(i, 'alt') !== null, k + ': width, height y alt: ' + i);
    const ia = imgs.filter(i => /\/ia-[^"]+\.jpg"/.test(i));
    assert.ok(ia.length >= 1, k + ': usa al menos una imagen ilustrativa');
    assert.ok(pag[k].html.includes(credito), k + ': crédito de imágenes con IA');
    for (const i of ia) {
      assert.ok(attr(i, 'alt').length > 15, k + ': alt descriptivo');
      assert.ok(!/estilo internacional|cliente real|real client/i.test(attr(i, 'alt')), k + ': no se atribuye a la barbería');
      assert.equal(attr(i, 'loading'), 'lazy', k + ': carga diferida');
    }
    // La imagen principal se precarga y no es diferida.
    const hero = imgs.find(i => attr(i, 'fetchpriority') === 'high');
    assert.ok(hero && attr(hero, 'loading') === null, k + ': imagen principal sin lazy');
    assert.ok(pag[k].html.includes(`<link rel="preload" as="image" href="${attr(hero, 'src')}"`), k + ': preload de la principal');
  }
});

// Corre el script de la página con un DOM mínimo de mentira y devuelve sus funciones y la ventana "Entrar".
const correScript = html => {
  const vm = require('node:vm');
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  const el = () => ({ onclick: null, oninput: null, onsubmit: null, value: '', msg: '', setCustomValidity(m) { this.msg = m; }, reportValidity() { this.reportado = true; }, focus() {}, showModal() {} });
  const els = { dlg: el(), 'dlg-s': el(), 'dlg-f': el(), ent: el(), ent2: el() };
  const ctx = { location: { href: '' }, window: {}, prompt: () => null, document: { getElementById: id => els[id], querySelectorAll: () => [] } };
  vm.runInNewContext(js + ';globalThis.__t={slugDe,ir};', ctx);
  return { ...ctx.__t, els, location: ctx.location };
};

test('"Entrar a mi panel" acepta el enlace, la dirección pegada o el nombre con acentos y avisa si no hay enlace', { skip: sinBase }, async () => {
  for (const k of ['es', 'en']) {
    const { slugDe, els, location } = correScript(pag[k].html);
    const casos = {
      'estilo-internacional': 'estilo-internacional',
      '  Estilo-Internacional ': 'estilo-internacional',
      'https://www.agendabarberias.xyz/estilo-internacional/admin': 'estilo-internacional',
      'agendabarberias.xyz/mi-barberia?x=1': 'mi-barberia',
      'Barbería José': 'barberia-jose', // igual que el enlace que propone el registro
      'estilo internacional': 'estilo-internacional',
      '@la_navaja': 'la-navaja',
      'https://www.agendabarberias.xyz/': '',
      '': '',
    };
    for (const [entrada, esperado] of Object.entries(casos)) assert.equal(slugDe(entrada), esperado, k + ': ' + JSON.stringify(entrada));
    // Enviar con un enlace válido lleva al panel.
    const ev = { submitter: { value: 'ok' }, preventDefault() {} };
    els['dlg-s'].value = 'Barbería José';
    els['dlg-f'].onsubmit(ev);
    assert.equal(location.href, '/barberia-jose/admin', k);
    // Enviar algo sin enlace no se queda callado: muestra un aviso y no navega.
    location.href = '';
    els['dlg-s'].value = 'agendabarberias.xyz';
    els['dlg-f'].onsubmit(ev);
    assert.equal(location.href, '', k);
    assert.ok(els['dlg-s'].reportado && /estilo-internacional/.test(els['dlg-s'].msg), k + ': aviso');
    els['dlg-s'].oninput();
    assert.equal(els['dlg-s'].msg, '', k + ': el aviso se borra al escribir');
    // Cancelar no navega.
    els['dlg-f'].onsubmit({ submitter: { value: 'no' }, preventDefault() { throw new Error('no debe prevenir'); } });
    assert.equal(location.href, '', k);
  }
});

// Texto visible de un pedazo de HTML (sin etiquetas y con espacios normalizados).
const textoDe = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const faqDe = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity;
const respuestaVisible = (html, pregunta) => { const m = html.match(new RegExp(`<summary>${pregunta.replace(/[?¿]/g, '\\$&')}</summary><p>([\\s\\S]*?)</p>`)); return m && textoDe(m[1]); };

test('los recordatorios no se prometen automáticos: van ya escritos y se mandan con un toque, sin costo por mensaje', { skip: sinBase }, async () => {
  for (const [k, pregunta, toque, costo] of [['es', '¿Cómo les llegan los recordatorios?', 'con un toque', /sin costo por mensaje|no pagas nada por mensaje/i], ['en', 'How do reminders reach my clients?', 'with one tap', /no per-message cost/i]]) {
    const h = pag[k].html;
    assert.ok(!/WhatsApp Business|se mandan solos|se envían solos|autom[aá]tico si|go out automatically|automatic if/i.test(h), k + ': promete envío automático');
    // "Automático" solo puede referirse a la renovación del pago, nunca a los recordatorios.
    for (const [frase] of textoDe(h).matchAll(/[^.]*autom[aá]tic[^.]*/gi)) assert.match(frase, /renews|renueva/i, k + ': ' + frase);
    const fun = textoDe(h.match(/<h3>(?:Recordatorios|Reminders)<\/h3><p>([\s\S]*?)<\/p>/)[1]);
    assert.ok(fun.includes(toque) && costo.test(fun), k + ': tarjeta de recordatorios: ' + fun);
    // La pregunta frecuente se ve en la página y está en el JSON-LD con la misma respuesta.
    const vis = respuestaVisible(h, pregunta), ld = faqDe(h).find(q => q.name === pregunta);
    assert.ok(vis && ld, k + ': pregunta de recordatorios visible y en JSON-LD');
    assert.equal(ld.acceptedAnswer.text, vis, k);
    assert.ok(vis.includes(toque) && costo.test(vis) && /(fecha|date).*(hora|time).*(barbero|barber)/.test(vis), k + ': ' + vis);
  }
});

test('la historia no dice que la barbería de ejemplo es del creador', { skip: sinBase }, async () => {
  assert.ok(pag.es.html.includes('Lo hizo un barbero de Mérida y se probó en la barbería donde trabaja'));
  assert.ok(pag.en.html.includes('Built by a barber from Mérida and first tested in a real shop'));
  for (const k of ['es', 'en'])
    assert.ok(!/nuestra barbería|nuestra propia barbería|\bour own barbershop|\bour barbershop|built it for our|lo hicimos para/i.test(pag[k].html), k + ': se atribuye una barbería');
});

test('la captura en computadora no se aplasta en celular: las imágenes conservan su proporción', { skip: sinBase }, async () => {
  for (const k of ['es', 'en']) {
    const css = pag[k].html.match(/<style>([\s\S]*?)<\/style>/)[1];
    // Con width/height en el HTML y solo max-width:100%, el navegador encoge el ancho pero deja el alto de 800 px.
    assert.match(css, /(^|[}\s])img\{[^}]*height:auto/, k + ': regla global img con height:auto');
    assert.match(css, /\.esc img\{[^}]*width:100%/, k + ': la captura llena su marco');
    assert.ok(/<div class="esc[^"]*">[\s\S]*?<img [^>]*width="1280" height="800"/.test(pag[k].html), k + ': la captura declara sus medidas');
  }
});

test('el precio y "Precios"/"Entrar" se ven arriba también en celular', { skip: sinBase }, async () => {
  for (const [k, frase, ancla, entrar] of [['es', 'Desde $399 MXN al mes · 14 días gratis, sin tarjeta', '#precios', 'Entrar'], ['en', 'From $399 MXN per month · 14 days free, no credit card', '#pricing', 'Log in']]) {
    const h = pag[k].html;
    assert.ok(textoDe(h.match(/<section class="hero">([\s\S]*?)<\/section>/)[1]).includes(frase), k + ': precio en la portada');
    const nav = h.match(/<header[\s\S]*?<\/header>/)[0];
    const precios = etiquetas(nav, 'a').find(a => attr(a, 'href') === ancla), ent = etiquetas(nav, 'a').find(a => attr(a, 'id') === 'ent');
    assert.ok(precios, k + ': enlace a precios en el encabezado');
    assert.ok(!/\bln\b/.test(attr(precios, 'class') || ''), k + ': el enlace a precios no lleva la clase que se oculta en celular');
    assert.ok(ent && nav.includes(`id="ent">${entrar}</a>`), k + ': "Entrar" en el encabezado');
    // Ninguna regla para celular oculta "Entrar" a 360 px o más (solo en pantallas de 350 px o menos).
    const css = h.match(/<style>([\s\S]*?)<\/style>/)[1];
    for (const [, ancho, reglas] of css.matchAll(/@media\(max-width:(\d+)px\)\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
      if (/#ent\{display:none\}/.test(reglas)) assert.ok(+ancho < 360, k + ': oculta "Entrar" hasta ' + ancho + 'px');
      assert.ok(!/(^|[}\s])\.top nav>a\{[^}]*display:none/.test(reglas) && !/\[href="#(precios|pricing)"\][^{]*\{[^}]*display:none/.test(reglas), k + ': oculta precios a ' + ancho + 'px');
    }
  }
});

test('la prueba gratis aclara que incluye hasta 8 barberos; Básico hasta 3 y Pro hasta 8', { skip: sinBase }, async () => {
  for (const [k, tarjeta, faq, pregunta, b3, b8] of [
    ['es', 'Todo incluido, hasta 8 barberos', '14 días gratis con todo incluido, hasta 8 barberos', '¿Necesito tarjeta para la prueba gratis?', 'Hasta 3 barberos', 'Hasta 8 barberos'],
    ['en', 'Everything included, up to 8 barbers', '14 days free with everything included, up to 8 barbers', 'Do I need a credit card for the free trial?', 'Up to 3 barbers', 'Up to 8 barbers']]) {
    const h = pag[k].html;
    const pre = h.match(/<div class="pre ap">([\s\S]*?)<\/div>\n<p class="nota">/)[1];
    assert.ok(pre.includes(`<li>${tarjeta}</li>`), k + ': tarjeta de la prueba');
    assert.ok(pre.includes(`<li>${b3}</li>`) && pre.includes(`<li>${b8}</li>`), k + ': límites de los planes');
    const vis = respuestaVisible(h, pregunta), ld = faqDe(h).find(q => q.name === pregunta);
    assert.ok(vis.includes(faq) && ld.acceptedAnswer.text.includes(faq), k + ': pregunta de la prueba: ' + vis);
    assert.ok(!/todo incluido(?!, hasta 8)|everything included(?!, up to 8)/i.test(textoDe(h)), k + ': "todo incluido" sin aclarar los barberos');
  }
});

test('las dos páginas tienen la misma estructura de secciones y llamadas a la acción', { skip: sinBase }, async () => {
  const cuenta = (h, re) => (h.match(re) || []).length;
  for (const re of [/<section\b/g, /<img\b/g, /<dialog\b/g, /class="btn"[^>]*href="\/registro"/g])
    assert.equal(cuenta(pag.en.html, re), cuenta(pag.es.html, re), 'misma cantidad: ' + re);
  // En inglés hay una pregunta más: avisa que la app está en español.
  assert.equal(cuenta(pag.en.html, /<details>/g), cuenta(pag.es.html, /<details>/g) + 1);
  assert.ok(pag.es.html.includes('<a class="salta" href="#contenido">') && pag.en.html.includes('<a class="salta" href="#contenido">'), 'enlace para saltar al contenido');
});
