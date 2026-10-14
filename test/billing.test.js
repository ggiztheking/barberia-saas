// Cobro de suscripciones: firma de webhooks, idempotencia y extensión del vencimiento.
// Stripe y Mercado Pago se simulan con servidores locales; las firmas HMAC son las reales.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { arranca, registra } = require('./helpers');

const sinBase = !process.env.DATABASE_URL && 'falta DATABASE_URL';
const WH_STRIPE = 'whsec_de_prueba', WH_MP = 'mp_secreto_de_prueba', SUPER = 'super-de-prueba', DIA = 864e5;
const sufijo = Date.now().toString(36);
let srv, base, stripe, mp;
const stripeVisto = [], mpVisto = [];
// Ids únicos por corrida: la base de desarrollo persiste y los eventos ya procesados no se repiten.
const MP_OK = String(Date.now()) + '1', MP_NO = String(Date.now()) + '2', MP_PRE = 'pre_' + sufijo;

// Servidor falso: guarda lo que recibe y responde con lo que dicte `resp(metodo, url, cuerpo)`.
const falso = (visto, resp) => new Promise(ok => {
  const s = http.createServer((q, r) => {
    let b = ''; q.on('data', c => { b += c; });
    q.on('end', () => { visto.push({ metodo: q.method, url: q.url, cuerpo: b, auth: q.headers.authorization }); const [c, j] = resp(q.method, q.url, b); r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(j)); });
  });
  s.listen(0, '127.0.0.1', () => ok(s));
});
const url = s => `http://127.0.0.1:${s.address().port}`;

before(async () => {
  if (sinBase) return;
  stripe = await falso(stripeVisto, (m, u) => (u === '/v1/checkout/sessions' ? [200, { url: 'https://checkout.stripe.test/sesion' }] : [200, {}]));
  mp = await falso(mpVisto, (m, u) => {
    if (m === 'POST' && u === '/preapproval') return [200, { init_point: 'https://mercadopago.test/suscribir' }];
    if (u === '/authorized_payments/' + MP_OK) return [200, { preapproval_id: MP_PRE, payment: { status: 'approved' } }];
    if (u === '/authorized_payments/' + MP_NO) return [200, { preapproval_id: MP_PRE, payment: { status: 'rejected' } }];
    if (u === '/preapproval/' + MP_PRE) return [200, { status: 'authorized', external_reference: `${mp.negId}:pro`, payer_id: 77 }];
    return [404, {}];
  });
  ({ base, parar: srv } = await arranca({ SUPER_PASS: SUPER, STRIPE_SECRET_KEY: 'sk_test_falsa', STRIPE_PRICE_BASICO: 'price_basico', STRIPE_PRICE_PRO: 'price_pro', STRIPE_WEBHOOK_SECRET: WH_STRIPE,
    STRIPE_API_URL: url(stripe), MP_ACCESS_TOKEN: 'TEST-falso', MP_WEBHOOK_SECRET: WH_MP, MP_API_URL: url(mp), PRECIO_BASICO: '199', PRECIO_PRO: '599', PUBLIC_URL: 'https://ejemplo.test' }));
});
after(() => { if (srv) srv(); if (stripe) stripe.close(); if (mp) mp.close(); });

const negocioId = async slug => (await (await fetch(base + '/api/super/negocios', { headers: { 'x-super': SUPER } })).json()).find(n => n.slug === slug).id;
const plan = async (slug, cookie) => (await fetch(`${base}/api/${slug}/admin/plan`, { headers: { Cookie: cookie } })).json();
const post = (slug, cookie, ruta, cuerpo) => fetch(`${base}/api/${slug}/admin/plan/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(cuerpo || {}) });

const firmaStripe = (cuerpo, t = Math.floor(Date.now() / 1000), secreto = WH_STRIPE) => `t=${t},v1=${crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;
const evento = (id, type, object) => JSON.stringify({ id, type, data: { object } });
const manda = (cuerpo, firma) => fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': firma }, body: cuerpo });
const mandaOk = async (cuerpo) => { const r = await manda(cuerpo, firmaStripe(cuerpo)); assert.equal(r.status, 200); return (await r.json()).resultado; };

test('Stripe: firma inválida, vieja o sin secreto se rechaza', { skip: sinBase }, async () => {
  const c = evento('evt_x', 'invoice.paid', {});
  assert.equal((await manda(c, 'firma-basura')).status, 400);
  assert.equal((await manda(c, firmaStripe(c, Math.floor(Date.now() / 1000), 'otro-secreto'))).status, 400);
  assert.equal((await manda(c, firmaStripe(c, Math.floor(Date.now() / 1000) - 3600))).status, 400);
  assert.equal((await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: c })).status, 400);
});

test('Stripe: checkout, pago, repetición, renovación y cancelación', { skip: sinBase }, async () => {
  const slug = 'st-' + sufijo, cookie = await registra(base, slug), negId = await negocioId(slug);
  const p0 = await plan(slug, cookie);
  assert.equal(p0.plan, 'prueba');
  assert.deepEqual(p0.planes.map(x => [x.id, x.precio, x.stripe, x.mercadopago]), [['basico', 199, true, true], ['pro', 599, true, true]]);

  const ck = await post(slug, cookie, 'checkout', { plan: 'basico', proveedor: 'stripe' });
  assert.equal(ck.status, 200);
  assert.equal((await ck.json()).url, 'https://checkout.stripe.test/sesion');
  const f = new URLSearchParams(stripeVisto.at(-1).cuerpo);
  assert.equal(stripeVisto.at(-1).auth, 'Bearer sk_test_falsa');
  assert.equal(f.get('mode'), 'subscription');
  assert.equal(f.get('line_items[0][price]'), 'price_basico');
  assert.equal(f.get('client_reference_id'), String(negId));
  assert.equal(f.get('subscription_data[metadata][plan]'), 'basico');
  assert.equal(f.get('success_url'), `https://ejemplo.test/${slug}/admin?pago=ok`);

  assert.equal((await post(slug, cookie, 'checkout', { plan: 'oro', proveedor: 'stripe' })).status, 400);
  assert.equal(await mandaOk(evento('evt_' + sufijo + '_1', 'checkout.session.completed', { mode: 'subscription', subscription: 'sub_' + sufijo, customer: 'cus_1', client_reference_id: String(negId), metadata: { plan: 'basico' } })), 'ok');
  assert.equal((await post(slug, cookie, 'checkout', { plan: 'pro', proveedor: 'stripe' })).status, 409, 'no permite una segunda suscripción activa');

  const pagada = (id) => evento(id, 'invoice.paid', { subscription: 'sub_' + sufijo, customer: 'cus_1', subscription_details: { metadata: { negocio_id: String(negId), plan: 'basico' } } });
  assert.equal(await mandaOk(pagada('evt_' + sufijo + '_2')), 'ok');
  const a = await plan(slug, cookie), v1 = new Date(a.vence).getTime();
  assert.equal(a.plan, 'basico');
  assert.ok(v1 > Date.now() + 40 * DIA && v1 < Date.now() + 46 * DIA, 'prueba restante (14) + 30 días');

  assert.equal(await mandaOk(pagada('evt_' + sufijo + '_2')), 'repetido');
  assert.equal(new Date((await plan(slug, cookie)).vence).getTime(), v1, 'el mismo evento no extiende dos veces');

  assert.equal(await mandaOk(pagada('evt_' + sufijo + '_3')), 'ok');
  const v2 = new Date((await plan(slug, cookie)).vence).getTime();
  assert.ok(Math.abs(v2 - v1 - 30 * DIA) < 60e3, 'una renovación nueva suma 30 días');

  assert.equal(await mandaOk(evento('evt_' + sufijo + '_4', 'invoice.payment_failed', { subscription: 'sub_' + sufijo })), 'ok');
  assert.equal((await plan(slug, cookie)).suscripcion.estado, 'pago_fallido');
  assert.equal(new Date((await plan(slug, cookie)).vence).getTime(), v2, 'un pago fallido no extiende');

  const can = await post(slug, cookie, 'cancelar');
  assert.equal(can.status, 200);
  assert.deepEqual(stripeVisto.at(-1).metodo + ' ' + stripeVisto.at(-1).url, 'DELETE /v1/subscriptions/sub_' + sufijo);
  const d = await plan(slug, cookie);
  assert.equal(d.suscripcion.estado, 'cancelada');
  assert.equal(d.abierto, true, 'conserva el acceso hasta que venza');
});

test('Stripe: un evento de un negocio inexistente se ignora sin romper', { skip: sinBase }, async () => {
  assert.equal(await mandaOk(evento('evt_' + sufijo + '_x', 'invoice.paid', { subscription: 'sub_no_existe', subscription_details: { metadata: { negocio_id: '99999999', plan: 'pro' } } })), 'ignorado');
});

test('Mercado Pago: checkout, firma, cobro aprobado, repetición y rechazado', { skip: sinBase }, async () => {
  const slug = 'mp-' + sufijo, cookie = await registra(base, slug), negId = await negocioId(slug);
  mp.negId = negId;
  const ck = await post(slug, cookie, 'checkout', { plan: 'pro', proveedor: 'mercadopago' });
  assert.equal(ck.status, 200);
  assert.equal((await ck.json()).url, 'https://mercadopago.test/suscribir');
  const cuerpo = JSON.parse(mpVisto.at(-1).cuerpo);
  assert.equal(cuerpo.external_reference, `${negId}:pro`);
  assert.equal(cuerpo.auto_recurring.transaction_amount, 599);
  assert.equal(cuerpo.auto_recurring.currency_id, 'MXN');
  assert.equal(cuerpo.payer_email, `${slug}@ejemplo.com`);

  const notifica = (id, secreto = WH_MP) => {
    const ts = String(Date.now()), rid = 'req-' + id, v1 = crypto.createHmac('sha256', secreto).update(`id:${id};request-id:${rid};ts:${ts};`).digest('hex');
    return fetch(`${base}/webhooks/mercadopago?data.id=${id}&type=subscription_authorized_payment`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': rid }, body: JSON.stringify({ type: 'subscription_authorized_payment', data: { id } }) });
  };
  assert.equal((await notifica(MP_OK, 'otro-secreto')).status, 400);
  assert.equal((await fetch(`${base}/webhooks/mercadopago?data.id=${MP_OK}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);

  assert.equal((await (await notifica(MP_NO)).json()).resultado, 'sin_aprobar');
  assert.equal((await plan(slug, cookie)).plan, 'prueba', 'un pago rechazado no activa nada');

  assert.equal((await (await notifica(MP_OK)).json()).resultado, 'ok');
  const a = await plan(slug, cookie), v1 = new Date(a.vence).getTime();
  assert.equal(a.plan, 'pro');
  assert.equal(a.suscripcion.proveedor, 'mercadopago');
  assert.ok(v1 > Date.now() + 40 * DIA);

  assert.equal((await (await notifica(MP_OK)).json()).resultado, 'repetido');
  assert.equal(new Date((await plan(slug, cookie)).vence).getTime(), v1);

  assert.equal((await post(slug, cookie, 'cancelar')).status, 200);
  assert.equal(mpVisto.at(-1).metodo + ' ' + mpVisto.at(-1).url, 'PUT /preapproval/' + MP_PRE);
  assert.equal((await plan(slug, cookie)).suscripcion.estado, 'cancelada');
});

test('las rutas de plan exigen sesión', { skip: sinBase }, async () => {
  const slug = 'sc-' + sufijo, cookie = await registra(base, slug);
  assert.equal((await fetch(`${base}/api/${slug}/admin/plan`)).status, 401);
  assert.equal((await fetch(`${base}/api/${slug}/admin/plan/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.ok(cookie.includes('st_' + slug));
});
