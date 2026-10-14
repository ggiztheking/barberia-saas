// Cobro de suscripciones con Stripe y Mercado Pago.
// Todo se configura por variables de entorno (ver .env.example). Sin claves el módulo no cobra,
// pero el resto del sistema sigue igual (prueba de 14 días y activación manual desde /super).
// Los webhooks son la única fuente de verdad: solo ellos activan o extienden un plan.
const crypto = require('crypto');

module.exports = (app, api, d) => {
  const { pool, auth, wrap, limita, vigente } = d;
  const E = process.env;
  const PLANES = ['basico', 'pro'];
  const NOMBRE = { basico: 'Plan Básico', pro: 'Plan Pro' };
  const precio = p => Number(E['PRECIO_' + p.toUpperCase()]) || null;
  const stripeApi = () => (E.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/$/, '');
  const mpApi = () => (E.MP_API_URL || 'https://api.mercadopago.com').replace(/\/$/, '');
  const stripeLista = p => !!(E.STRIPE_SECRET_KEY && E['STRIPE_PRICE_' + p.toUpperCase()]);
  const mpLista = p => !!(E.MP_ACCESS_TOKEN && precio(p));
  const base = q => (E.PUBLIC_URL || `${q.protocol}://${q.get('host')}`).replace(/\/$/, '');
  const igual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const Q = (sql, p) => pool.query(sql, p).then(r => r.rows);

  (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS suscripciones (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, proveedor TEXT NOT NULL, ref_externa TEXT NOT NULL, plan TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'activa', cliente_ref TEXT, creado TIMESTAMPTZ DEFAULT now(), actualizado TIMESTAMPTZ DEFAULT now(), UNIQUE (proveedor, ref_externa))`);
    await pool.query('CREATE INDEX IF NOT EXISTS suscripciones_neg ON suscripciones(negocio_id)');
    await pool.query('CREATE TABLE IF NOT EXISTS pagos_eventos (proveedor TEXT NOT NULL, id_evento TEXT NOT NULL, tipo TEXT, negocio_id INT, creado TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (proveedor, id_evento))');
  })().catch(console.error);

  // Misma regla que las acciones pagar_basico / pagar_pro de /api/super/negocio/:id: suma 30 días al vencimiento vigente.
  const acredita = (cl, negId, plan) => cl.query(
    "UPDATE negocios SET plan=$2, activo=true, vence=GREATEST(COALESCE(vence,now()),now())+interval '30 days' WHERE id=$1", [negId, plan]);
  const guarda = (cl, negId, proveedor, ref, plan, estado, cliente) => cl.query(
    `INSERT INTO suscripciones(negocio_id,proveedor,ref_externa,plan,estado,cliente_ref) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (proveedor,ref_externa) DO UPDATE SET estado=EXCLUDED.estado, plan=COALESCE(EXCLUDED.plan,suscripciones.plan), actualizado=now()`,
    [negId, proveedor, ref, plan, estado, cliente || null]);
  const estadoDe = (cl, proveedor, ref, estado) => cl.query('UPDATE suscripciones SET estado=$3, actualizado=now() WHERE proveedor=$1 AND ref_externa=$2', [proveedor, ref, estado]);
  const buscaSub = async (cl, proveedor, ref) => (await cl.query('SELECT negocio_id,plan FROM suscripciones WHERE proveedor=$1 AND ref_externa=$2', [proveedor, ref])).rows[0];
  const negocioExiste = async (cl, id) => Number.isInteger(id) && id > 0 && (await cl.query('SELECT 1 FROM negocios WHERE id=$1', [id])).rowCount > 0;

  // Cada evento se procesa una sola vez: el registro del evento y su efecto van en la misma transacción.
  const unaVez = async (proveedor, idEvento, tipo, fn) => {
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      if (!(await cl.query('INSERT INTO pagos_eventos(proveedor,id_evento,tipo) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [proveedor, idEvento, tipo])).rowCount) { await cl.query('ROLLBACK'); return 'repetido'; }
      const r = await fn(cl);
      await cl.query('COMMIT');
      return r || 'ok';
    } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  };

  // ---- Stripe
  const firmaStripe = (raw, cabecera, secreto, ahora = Date.now()) => {
    const partes = String(cabecera || '').split(',').map(x => x.trim().split('=')), t = (partes.find(x => x[0] === 't') || [])[1];
    const v1 = partes.filter(x => x[0] === 'v1' && x[1]).map(x => x[1]);
    if (!t || !v1.length || !raw || Math.abs(ahora / 1000 - Number(t)) > 300) return false;
    const esperada = crypto.createHmac('sha256', secreto).update(t + '.').update(raw).digest('hex');
    return v1.some(v => igual(v, esperada));
  };
  const stripePost = async (ruta, form) => {
    const r = await fetch(stripeApi() + ruta, { method: 'POST', headers: { Authorization: 'Bearer ' + E.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('stripe ' + r.status + ' ' + ((j.error && j.error.message) || ''));
    return j;
  };
  const stripeCancela = async ref => {
    const r = await fetch(stripeApi() + '/v1/subscriptions/' + encodeURIComponent(ref), { method: 'DELETE', headers: { Authorization: 'Bearer ' + E.STRIPE_SECRET_KEY }, signal: AbortSignal.timeout(15000) });
    if (!r.ok && r.status !== 404) throw new Error('stripe cancelar ' + r.status);
  };

  // Los webhooks no llevan cookie ni origen: viven fuera del router /api/:slug y se autentican por firma.
  app.post('/webhooks/stripe', wrap(async (q, s) => {
    if (!E.STRIPE_WEBHOOK_SECRET || !firmaStripe(q.raw, q.get('stripe-signature'), E.STRIPE_WEBHOOK_SECRET)) return s.status(400).json({ error: 'Firma no válida' });
    const ev = q.body || {}, o = (ev.data && ev.data.object) || {};
    if (!ev.id || !ev.type) return s.status(400).json({ error: 'Evento no válido' });
    const r = await unaVez('stripe', ev.id, ev.type, async cl => {
      if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
        const negId = Number(o.client_reference_id), plan = o.metadata && o.metadata.plan;
        if (!PLANES.includes(plan) || !(await negocioExiste(cl, negId))) return 'ignorado';
        await guarda(cl, negId, 'stripe', o.subscription, plan, 'activa', o.customer);
        return 'ok';
      }
      if (ev.type === 'invoice.paid') {
        const par = (o.parent && o.parent.subscription_details) || {}, ref = o.subscription || par.subscription, meta = (o.subscription_details && o.subscription_details.metadata) || par.metadata || {};
        if (!ref) return 'ignorado';
        const sub = await buscaSub(cl, 'stripe', ref), negId = Number(meta.negocio_id || (sub && sub.negocio_id)), plan = meta.plan || (sub && sub.plan);
        if (!PLANES.includes(plan) || !(await negocioExiste(cl, negId))) return 'ignorado';
        await acredita(cl, negId, plan);
        await guarda(cl, negId, 'stripe', ref, plan, 'activa', o.customer);
        return 'ok';
      }
      const ref = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      if (ev.type === 'invoice.payment_failed' && ref) { await estadoDe(cl, 'stripe', ref, 'pago_fallido'); return 'ok'; }
      if (ev.type === 'customer.subscription.deleted' && o.id) { await estadoDe(cl, 'stripe', o.id, 'cancelada'); return 'ok'; }
      return 'ignorado';
    });
    s.json({ recibido: true, resultado: r });
  }));

  // ---- Mercado Pago (suscripciones = "preapproval")
  const firmaMP = (q, secreto) => {
    const h = Object.fromEntries(String(q.get('x-signature') || '').split(',').map(x => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }));
    const id = String(q.query['data.id'] ?? (q.body && q.body.data && q.body.data.id) ?? '').toLowerCase();
    if (!h.ts || !h.v1 || !id) return false;
    return igual(h.v1, crypto.createHmac('sha256', secreto).update(`id:${id};request-id:${q.get('x-request-id') || ''};ts:${h.ts};`).digest('hex'));
  };
  const mpGet = async ruta => {
    const r = await fetch(mpApi() + ruta, { headers: { Authorization: 'Bearer ' + E.MP_ACCESS_TOKEN }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('mercadopago ' + r.status + ' ' + ruta.replace(/\d{4,}/g, '#'));
    return r.json();
  };
  const mpSend = async (metodo, ruta, cuerpo) => {
    const r = await fetch(mpApi() + ruta, { method: metodo, headers: { Authorization: 'Bearer ' + E.MP_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('mercadopago ' + r.status + ' ' + (j.message || ''));
    return j;
  };
  const refMP = ext => { const [n, p] = String(ext || '').split(':'); return { negId: Number(n), plan: p }; };

  app.post('/webhooks/mercadopago', wrap(async (q, s) => {
    if (!E.MP_WEBHOOK_SECRET || !firmaMP(q, E.MP_WEBHOOK_SECRET)) return s.status(400).json({ error: 'Firma no válida' });
    const tipo = String((q.body && q.body.type) || q.query.type || q.query.topic || ''), id = String(q.query['data.id'] ?? (q.body && q.body.data && q.body.data.id) ?? '');
    if (!/^[\w-]{1,64}$/.test(id)) return s.status(400).json({ error: 'Evento no válido' });
    // Solo el cobro de la suscripción acredita; la notificación "payment" del mismo cobro se ignora para no contarlo dos veces.
    if (tipo === 'subscription_authorized_payment') {
      const ap = await mpGet('/authorized_payments/' + encodeURIComponent(id));
      if (!ap.preapproval_id || !ap.payment || ap.payment.status !== 'approved') return s.json({ recibido: true, resultado: 'sin_aprobar' });
      const pre = await mpGet('/preapproval/' + encodeURIComponent(ap.preapproval_id)), { negId, plan } = refMP(pre.external_reference);
      const r = await unaVez('mercadopago', 'ap-' + id, tipo, async cl => {
        if (!PLANES.includes(plan) || !(await negocioExiste(cl, negId))) return 'ignorado';
        await acredita(cl, negId, plan);
        await guarda(cl, negId, 'mercadopago', ap.preapproval_id, plan, 'activa', pre.payer_id && String(pre.payer_id));
        return 'ok';
      });
      return s.json({ recibido: true, resultado: r });
    }
    if (tipo === 'subscription_preapproval') {
      const pre = await mpGet('/preapproval/' + encodeURIComponent(id)), { negId, plan } = refMP(pre.external_reference);
      const estado = { authorized: 'activa', cancelled: 'cancelada', paused: 'pausada' }[pre.status];
      if (estado && PLANES.includes(plan) && (await negocioExiste(pool, negId))) await guarda(pool, negId, 'mercadopago', id, plan, estado, pre.payer_id && String(pre.payer_id));
      return s.json({ recibido: true, resultado: estado ? 'ok' : 'ignorado' });
    }
    s.json({ recibido: true, resultado: 'ignorado' });
  }));

  // ---- Panel del dueño (auth ya limita todo /admin/plan/* al dueño)
  const activa = async negId => (await Q("SELECT proveedor,ref_externa,plan,estado FROM suscripciones WHERE negocio_id=$1 AND estado IN ('activa','pago_fallido','pausada') ORDER BY actualizado DESC LIMIT 1", [negId]))[0];
  api.get('/admin/plan', auth, wrap(async (q, s) => {
    const n = q.neg, sub = (await Q('SELECT proveedor,plan,estado FROM suscripciones WHERE negocio_id=$1 ORDER BY actualizado DESC LIMIT 1', [n.id]))[0] || null;
    s.json({ plan: n.plan, vence: n.vence, activo: n.activo !== false, abierto: vigente(n), suscripcion: sub,
      planes: PLANES.map(p => ({ id: p, nombre: NOMBRE[p], precio: precio(p), stripe: stripeLista(p), mercadopago: mpLista(p) })) });
  }));
  api.post('/admin/plan/checkout', auth, wrap(async (q, s) => {
    const plan = String(q.body.plan || ''), prov = String(q.body.proveedor || '');
    if (!PLANES.includes(plan) || !['stripe', 'mercadopago'].includes(prov)) return s.status(400).json({ error: 'Elige un plan y una forma de pago' });
    if (limita('ck' + q.neg.id, 10, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Espera un rato.' });
    if (!(prov === 'stripe' ? stripeLista(plan) : mpLista(plan))) return s.status(503).json({ error: 'Esta forma de pago aún no está disponible. Escríbenos y te activamos el plan.' });
    if (await activa(q.neg.id)) return s.status(409).json({ error: 'Ya tienes una suscripción activa. Cancélala primero si quieres cambiar de plan.' });
    const panel = `${base(q)}/${encodeURIComponent(q.params.slug)}/admin`;
    try {
      if (prov === 'stripe') {
        const j = await stripePost('/v1/checkout/sessions', { mode: 'subscription', locale: 'es-419', 'line_items[0][price]': E['STRIPE_PRICE_' + plan.toUpperCase()], 'line_items[0][quantity]': '1',
          success_url: panel + '?pago=ok', cancel_url: panel + '?pago=cancelado', client_reference_id: String(q.neg.id), customer_email: q.user.email,
          'metadata[plan]': plan, 'metadata[negocio_id]': String(q.neg.id), 'subscription_data[metadata][plan]': plan, 'subscription_data[metadata][negocio_id]': String(q.neg.id) });
        if (!j.url) throw new Error('stripe sin url');
        return s.json({ url: j.url });
      }
      const j = await mpSend('POST', '/preapproval', { reason: `${NOMBRE[plan]} · ${q.neg.nombre}`.slice(0, 120), external_reference: `${q.neg.id}:${plan}`, payer_email: q.user.email,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: precio(plan), currency_id: 'MXN' }, back_url: panel + '?pago=ok', status: 'pending' });
      if (!j.init_point) throw new Error('mercadopago sin init_point');
      s.json({ url: j.init_point });
    } catch (e) { console.error('checkout:', e.message); s.status(502).json({ error: 'No pudimos iniciar el pago. Intenta de nuevo en un momento.' }); }
  }));
  api.post('/admin/plan/cancelar', auth, wrap(async (q, s) => {
    const sub = await activa(q.neg.id);
    if (!sub) return s.status(404).json({ error: 'No tienes una suscripción activa' });
    try {
      if (sub.proveedor === 'stripe') await stripeCancela(sub.ref_externa); else await mpSend('PUT', '/preapproval/' + encodeURIComponent(sub.ref_externa), { status: 'cancelled' });
    } catch (e) { console.error('cancelar:', e.message); return s.status(502).json({ error: 'No pudimos cancelar ahora. Intenta de nuevo en un momento.' }); }
    await estadoDe(pool, sub.proveedor, sub.ref_externa, 'cancelada');
    s.json({ ok: true, vence: q.neg.vence });
  }));
};
