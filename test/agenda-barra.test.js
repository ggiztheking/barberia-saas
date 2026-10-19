// Agenda del cliente: la barra fija inferior, el contraste del tema claro ("ei") y los nombres de barbero.
// - El total va en su propio elemento junto a "Confirmar" y nunca se recorta; el resumen del servicio sí puede recortarse
//   y con 2 o más extras se resume ("Elige tu corte + 2 extras"). La página pública promete "El total se ve antes de confirmar".
// - Los textos del tema claro (aviso del teléfono, precios) cumplen contraste AA sobre el fondo crema.
// - Los nombres de barbero solo se parten entre palabras (antes salía "Cualquier/a" o "GGTHEBA/RBER").
// Casi todo se revisa leyendo los archivos (no necesita base); la última prueba arranca el servidor y pide las URLs reales.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { arranca } = require('./helpers');

const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const HTML = pub('app-agenda.html'), S = pub('s.css'), EI = pub('agenda-ei.css');

// Reglas de un CSS sin comentarios, aplanando los @media: [{ sels: ['.a b', ...], d: { prop: valor } }]
const reglas = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, s, d]) => ({
  sels: s.split(',').map(x => x.trim().replace(/\s+/g, ' ')),
  d: Object.fromEntries(d.split(';').map(x => x.split(':')).filter(x => x.length >= 2).map(([k, ...v]) => [k.trim(), v.join(':').trim()]))
}));
const RS = reglas(S), REI = reglas(EI);
const de = (R, sel) => R.filter(r => r.sels.includes(sel));
// Valor final de una propiedad para un selector exacto: agenda-ei.css se carga después de s.css y gana.
const prop = (sel, p) => { for (const R of [REI, RS]) { const v = de(R, sel).map(r => r.d[p]).filter(Boolean).pop(); if (v) return v; } };
const vars = Object.assign({}, ...de(REI, ':root').map(r => Object.fromEntries(Object.entries(r.d).filter(([k]) => k.startsWith('--')))));
const color = v => { const m = /^var\((--[\w-]+)\)$/.exec(v); return m ? vars[m[1]] : v; };
const lum = h => { const c = h.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('la barra fija lleva el total en su propio elemento, fuera del resumen que se recorta', () => {
  const barra = /<div class="barra" id="barra"[^>]*>([\s\S]*?)<button id="go"/.exec(HTML);
  assert.ok(barra, 'existe la barra con el botón Confirmar');
  const res = /<div class="res" id="res">([\s\S]*?)<\/div>/.exec(barra[1]);
  assert.ok(res, 'el resumen es su propio bloque');
  assert.ok(!res[1].includes('id="tot'), 'el total no va dentro del resumen');
  assert.match(barra[1], /<div class="tot" id="tot"[^>]*><small>Total<\/small><b id="tot-v"><\/b><\/div>$/, 'el total va justo antes de Confirmar');
  // El JS ya no mete el total en el mismo <b> que el nombre del servicio (antes: `${nombre}${extras} · ${m(total())}`)
  const est = /function estado\(\)\{[\s\S]*?\n(?=const fmtTel)/.exec(HTML)[0];
  assert.ok(!/\$\('#res'\)\.innerHTML=[^;]*total\(\)/.test(est), 'el resumen no lleva el total');
  assert.match(est, /\$\('#tot-v'\)\.textContent=tv/, 'el total se escribe en #tot-v');
  // CSS: el total no se recorta nunca; ninguna regla de "div dentro de la barra" lo alcanza con ellipsis.
  for (const r of RS.filter(r => r.sels.some(s => /^\.barra( div|\s*>\s*div)\b/.test(s)))) assert.ok(r.d.overflow !== 'hidden', 'regla genérica que recortaría el total: ' + r.sels);
  assert.equal(prop('.barra .tot', 'white-space'), 'nowrap');
  assert.equal(prop('.barra .tot', 'flex'), '0 0 auto', 'el total no se encoge');
  for (const s of ['.barra .tot', '.barra .tot b']) assert.ok(!prop(s, 'overflow') && !prop(s, 'text-overflow'), s + ' no se recorta');
  assert.equal(prop('.barra .res', 'min-width'), '0', 'el resumen sí cede espacio');
  assert.equal(prop('.barra .res span', 'text-overflow'), 'ellipsis');
});

test('con 2 o más extras el resumen de la barra se acorta ("Elige tu corte + 2 extras")', () => {
  const linea = n => { const m = new RegExp(`^const ${n}=.*$`, 'm').exec(HTML); assert.ok(m, 'falta ' + n); return m[0]; };
  const ctx = { EX: [{ id: 1, nombre: 'Cejas' }, { id: 2, nombre: 'Lavado' }, { id: 3, nombre: 'Masaje relajante de cuero cabelludo' }], X: {} };
  vm.createContext(ctx);
  vm.runInContext(linea('nombresX') + '\n' + linea('resumenS') + '\nthis.resumenS=resumenS;', ctx);
  const con = ex => { ctx.X = { srv: { nombre: 'Elige tu corte', precio: 200 }, ex }; return ctx.resumenS(); };
  assert.equal(con([]), 'Elige tu corte');
  assert.equal(con([1]), 'Elige tu corte + Cejas');
  assert.equal(con([1, 3]), 'Elige tu corte + 2 extras');
  assert.equal(con([1, 2, 3]), 'Elige tu corte + 3 extras');
});

test('tema claro: el aviso del teléfono y los precios tienen contraste AA; los botones conservan el naranja de la marca', () => {
  const bg = vars['--bg'], panel = vars['--panel'];
  assert.equal(bg, '#f1efe9'); assert.equal(panel, '#e4e3dc');
  const casos = [['.aviso-campo', bg], ['.opt em', panel], ['.card b', bg], ['.barra .tot b', bg], ['.fecha b', panel], ['.atajo span', panel], ['.tag.pendiente', panel], ['.tag.cancelada', panel], ['.tag.completada', panel]];
  for (const [sel, fondo] of casos) {
    const c = color(prop(sel, 'color'));
    assert.match(c || '', /^#[0-9a-f]{6}$/i, sel + ' tiene color propio');
    const k = contraste(c, fondo);
    assert.ok(k >= 4.5, `${sel}: ${c} sobre ${fondo} da ${k.toFixed(2)}:1`);
  }
  assert.equal(vars['--gold'], '#cc7232', 'el naranja de la marca sigue en botones y bordes');
  assert.equal(prop('button', 'background'), 'var(--gold)');
});

test('los nombres de barbero solo se parten entre palabras', () => {
  const R = de(RS, '#bar .opt strong');
  assert.ok(R.length, 'hay regla para el nombre del barbero');
  for (const r of R) {
    assert.notEqual(r.d['overflow-wrap'], 'anywhere', 'overflow-wrap:anywhere parte "Cualquier/a"');
    assert.notEqual(r.d['word-break'], 'break-all');
    assert.notEqual(r.d['word-wrap'], 'anywhere');
  }
  assert.equal(prop('#bar .opt strong', 'overflow-wrap'), 'normal');
  assert.equal(prop('#bar .opt strong', 'max-width'), '100%', 'un nombre muy largo no se sale de la tarjeta');
  // Columnas más anchas: en 390 px caben 2 tarjetas por fila (antes 3 de ~83 px útiles, donde "Cualquiera" no cabía).
  const min = +/minmax\((\d+)px/.exec(prop('#bar.opts', 'grid-template-columns'))[1];
  assert.ok(min >= 130, 'ancho mínimo de la tarjeta: ' + min);
});

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
let srv;
before(async () => { if (!sinBase) srv = await arranca(); });
after(() => { if (srv) srv.parar(); });

test('la agenda servida pide las versiones nuevas de s.css y agenda-ei.css', { skip: sinBase }, async () => {
  const r = await fetch(srv.base + '/estilo-internacional/agenda');
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.ok(h.includes('id="tot"'), 'la página servida trae el total aparte');
  const vs = /\/s\.css\?v=(\d+)/.exec(h), ve = /\/agenda-ei\.css\?v=(\d+)/.exec(h);
  assert.ok(+vs[1] >= 19, 's.css con la caché renovada: v=' + vs[1]);
  assert.ok(+ve[1] >= 2, 'agenda-ei.css con la caché renovada: v=' + ve[1]);
  const css = await fetch(srv.base + vs[0]), ei = await fetch(srv.base + ve[0]);
  assert.equal(css.status, 200); assert.equal(ei.status, 200);
  assert.ok((await css.text()).includes('.barra .tot{'));
  assert.ok((await ei.text()).includes('--precio'));
});
