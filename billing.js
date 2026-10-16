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
    // Cobros ya acreditados (30 días cada uno): permite revisar en MP sin depender del aviso y sin contar dos veces.
    await pool.query('ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS cobros INT NOT NULL DEFAULT 0');
    await pool.query('CREATE TABLE IF NOT EXISTS pagos_eventos (proveedor TEXT NOT NULL, id_evento TEXT NOT NULL, tipo TEXT, negocio_id INT, creado TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (proveedor, id_evento))');
  })().catch(console.error);

  // Misma regla que las acciones pagar_basico / pagar_pro de /api/super/negocio/:id: suma 30 días al vencimiento vigente.
  const acredita = (cl, negId, plan) => cl.query(
    "UPDATE negocios SET plan=$2, activo=true, vence=GREATEST(COALESCE(vence,now()),now())+interval '30 days' WHERE id=$1", [negId, plan]);
  const guarda = (cl, negId, proveedor, ref, plan, estado, cliente) => cl.query(
    `INSERT INTO suscripciones(negocio_id,proveedor,ref_externa,plan,estado,cliente_ref) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (proveedor,ref_externa) DO UPDATE SET estado=EXCLUDED.estado, plan=COALESCE(EXCLUDED.plan,suscripciones.plan), actualizado=now()`,
    [negId, proveedor, ref, plan, estado, cliente || null]);
  // Estados: 'pendiente' (enlace de pago creado), vivos ('activa','pago_fallido','pausada'), finales ('cancelada','duplicada')
  // y de cierre ('expirada' = enlace reemplazado, 'completada' = sesión de Stripe ya convertida en suscripción).
  const VIVOS = ['activa', 'pago_fallido', 'pausada'], FINALES = ['cancelada', 'duplicada'];
  const ESTADO_MP = { authorized: 'activa', cancelled: 'cancelada', canceled: 'cancelada', paused: 'pausada' };
  // Una suscripción cancelada o sobrante no vuelve a "activa" ni a "pago_fallido" por un aviso tardío.
  const estadoDe = (cl, proveedor, ref, estado) => cl.query(`UPDATE suscripciones SET estado=$3, actualizado=now() WHERE proveedor=$1 AND ref_externa=$2
    AND (estado NOT IN ('cancelada','duplicada') OR $3 IN ('cancelada','duplicada'))`, [proveedor, ref, estado]);
  const buscaSub = async (cl, proveedor, ref) => (await cl.query('SELECT negocio_id,plan FROM suscripciones WHERE proveedor=$1 AND ref_externa=$2', [proveedor, ref])).rows[0];
  const negocioExiste = async (cl, id) => Number.isInteger(id) && id > 0 && (await cl.query('SELECT 1 FROM negocios WHERE id=$1', [id])).rowCount > 0;

  // Cada evento se procesa una sola vez: el registro del evento y su efecto van en la misma transacción.
  const enTx = async fn => {
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      const r = await fn(cl);
      await cl.query('COMMIT');
      return r || 'ok';
    } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  };
  class Repetido extends Error {}
  const unaVez = (proveedor, idEvento, tipo, fn) => enTx(async cl => {
    if (!(await cl.query('INSERT INTO pagos_eventos(proveedor,id_evento,tipo) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [proveedor, idEvento, tipo])).rowCount) throw new Repetido();
    return fn(cl);
  }).catch(e => { if (e instanceof Repetido) return 'repetido'; throw e; });

  // Guarda el estado de una suscripción. Si el negocio ya tiene OTRA viva (pagó dos enlaces), esta queda 'duplicada'
  // y devuelve 'duplicada' para que se cancele en el proveedor: así no se le cobra dos veces cada mes.
  const registra = async (cl, negId, proveedor, ref, plan, estado, cliente) => {
    await cl.query('SELECT 1 FROM negocios WHERE id=$1 FOR UPDATE', [negId]); // dos avisos a la vez del mismo negocio se atienden en fila
    const previo = (await cl.query('SELECT estado FROM suscripciones WHERE proveedor=$1 AND ref_externa=$2', [proveedor, ref])).rows[0];
    if (VIVOS.includes(estado)) {
      if (previo && FINALES.includes(previo.estado)) estado = previo.estado;
      else if ((await cl.query(`SELECT 1 FROM suscripciones WHERE negocio_id=$1 AND estado IN ('activa','pago_fallido','pausada') AND NOT (proveedor=$2 AND ref_externa=$3) LIMIT 1`,
        [negId, proveedor, ref])).rowCount) estado = 'duplicada';
    }
    await guarda(cl, negId, proveedor, ref, plan, estado, cliente);
    return estado === 'duplicada' ? 'duplicada' : 'ok';
  };
  // Cancela en el proveedor: una suscripción, o un enlace de pago que aún no se usa.
  const cancelaEn = (proveedor, ref) => (proveedor === 'stripe'
    ? (ref.startsWith('cs_') ? stripePost('/v1/checkout/sessions/' + encodeURIComponent(ref) + '/expire', {}) : stripeCancela(ref))
    : mpSend('PUT', '/preapproval/' + encodeURIComponent(ref), { status: 'cancelled' }));
  const sobra = async (r, proveedor, ref, negId) => {
    if (r !== 'duplicada') return;
    console.error(`suscripción duplicada: negocio ${negId}, ${proveedor} ${ref}; se cancela para no cobrar dos veces`);
    await cancelaEn(proveedor, ref).catch(e => console.error('no se pudo cancelar la duplicada (cancélala a mano en el panel del proveedor):', e.message));
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
    let subRef = null, subNeg = null;
    const r = await unaVez('stripe', ev.id, ev.type, async cl => {
      if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
        const negId = Number(o.client_reference_id), plan = o.metadata && o.metadata.plan;
        if (!PLANES.includes(plan) || !(await negocioExiste(cl, negId))) return 'ignorado';
        if (o.id) await estadoDe(cl, 'stripe', o.id, 'completada');
        subRef = o.subscription; subNeg = negId;
        return registra(cl, negId, 'stripe', o.subscription, plan, 'activa', o.customer);
      }
      if (ev.type === 'invoice.paid') {
        const par = (o.parent && o.parent.subscription_details) || {}, ref = o.subscription || par.subscription, meta = (o.subscription_details && o.subscription_details.metadata) || par.metadata || {};
        if (!ref) return 'ignorado';
        const sub = await buscaSub(cl, 'stripe', ref), negId = Number(meta.negocio_id || (sub && sub.negocio_id)), plan = meta.plan || (sub && sub.plan);
        if (!PLANES.includes(plan) || !(await negocioExiste(cl, negId))) return 'ignorado';
        await acredita(cl, negId, plan); // el dinero ya se cobró: siempre suma sus días
        subRef = ref; subNeg = negId;
        return registra(cl, negId, 'stripe', ref, plan, 'activa', o.customer);
      }
      const ref = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      if (ev.type === 'invoice.payment_failed' && ref) { await estadoDe(cl, 'stripe', ref, 'pago_fallido'); return 'ok'; }
      if (ev.type === 'customer.subscription.deleted' && o.id) { await estadoDe(cl, 'stripe', o.id, 'cancelada'); return 'ok'; }
      return 'ignorado';
    });
    await sobra(r, 'stripe', subRef, subNeg);
    s.json({ recibido: true, resultado: r });
  }));

  // ---- Mercado Pago (suscripciones = "preapproval")
  const firmaMP = (q, secreto) => {
    const h = Object.fromEntries(String(q.get('x-signature') || '').split(',').map(x => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }));
    const id = String(q.query['data.id'] ?? (q.body && q.body.data && q.body.data.id) ?? '').toLowerCase();
    if (!h.ts || !h.v1 || !id) return false;
    return igual(h.v1, crypto.createHmac('sha256', secreto).update(`id:${id};request-id:${q.get('x-request-id') || ''};ts:${h.ts};`).digest('hex'));
  };
  // null si MP no conoce el recurso (p. ej. "Simular notificación" usa ids inventados): no tiene caso que MP reintente.
  // Las caídas temporales sí lanzan error, para que el webhook responda 500 y MP lo reintente.
  const mpGet = async ruta => {
    const r = await fetch(mpApi() + ruta, { headers: { Authorization: 'Bearer ' + E.MP_ACCESS_TOKEN }, signal: AbortSignal.timeout(10000) });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) console.error('mercadopago: MP_ACCESS_TOKEN rechazado (' + r.status + '); revisa la clave en las variables del servidor');
    // El mensaje de MP dice por qué rechazó (p. ej. un id de otra cuenta); los números largos se tapan en el log.
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(('mercadopago ' + r.status + ' ' + ruta + ' ' + (j.message || j.error || '')).trim().replace(/\d{4,}/g, '#')); }
    return r.json();
  };
  const mpSend = async (metodo, ruta, cuerpo) => {
    const r = await fetch(mpApi() + ruta, { method: metodo, headers: { Authorization: 'Bearer ' + E.MP_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('mercadopago ' + r.status + ' ' + (j.message || ''));
    return j;
  };
  const refMP = ext => { const [n, p] = String(ext || '').split(':'); return { negId: Number(n), plan: p }; };

  // Lleva a la base el estado actual de una suscripción de MP y acredita 30 días por cada cobro que aún no se acreditó.
  // Lo usan los avisos y la revisión directa (sincronizaMP), así que un cobro nunca se cuenta dos veces:
  // MP reporta en summarized.charged_quantity cuántas cuotas lleva cobradas; si no lo trae, cuenta el cobro aprobado del aviso.
  const aplicaMP = async (cl, ref, pre, cobroAprobado) => {
    const { negId, plan } = refMP(pre.external_reference);
    if (!PLANES.includes(plan) || !(await negocioExiste(cl, negId))) return 'ignorado';
    const estado = ESTADO_MP[pre.status] || (cobroAprobado ? 'activa' : null);
    if (!estado) return 'ignorado'; // sigue pendiente en MP: nada que hacer todavía
    const r = await registra(cl, negId, 'mercadopago', ref, plan, estado, pre.payer_id && String(pre.payer_id));
    const hechos = (await cl.query('SELECT cobros FROM suscripciones WHERE proveedor=$1 AND ref_externa=$2', ['mercadopago', ref])).rows[0].cobros;
    const reporta = pre.summarized && Number(pre.summarized.charged_quantity);
    const objetivo = Number.isInteger(reporta) ? Math.max(reporta, cobroAprobado && !hechos ? 1 : 0) : hechos + (cobroAprobado ? 1 : 0);
    // El dinero ya se cobró: siempre suma sus días, aunque la suscripción esté cancelada o sobre.
    for (let i = hechos; i < objetivo; i++) await acredita(cl, negId, plan);
    if (objetivo > hechos) await cl.query('UPDATE suscripciones SET cobros=$3 WHERE proveedor=$1 AND ref_externa=$2', ['mercadopago', ref, objetivo]);
    return r;
  };
  // Pregunta a MP por las suscripciones pendientes o vivas (de un negocio, o de todos): no depende de que llegue el aviso.
  const sincronizaMP = async negId => {
    if (!E.MP_ACCESS_TOKEN) return;
    const subs = await Q(`SELECT ref_externa,negocio_id FROM suscripciones WHERE proveedor='mercadopago' AND ($1::int IS NULL OR negocio_id=$1)
      AND (estado IN ('activa','pago_fallido','pausada') OR (estado='pendiente' AND creado > now() - interval '7 days')) ORDER BY creado`, [negId || null]);
    // Cada suscripción por separado: si MP rechaza una (id de otra cuenta, token cambiado), las demás se revisan igual.
    for (const sub of subs) {
      try {
        const pre = await mpGet('/preapproval/' + encodeURIComponent(sub.ref_externa));
        if (!pre) continue;
        const r = await enTx(cl => aplicaMP(cl, sub.ref_externa, pre, false));
        await sobra(r, 'mercadopago', sub.ref_externa, sub.negocio_id);
      } catch (e) { console.error('revisión de Mercado Pago (negocio ' + sub.negocio_id + '):', e.message); }
    }
  };
  setInterval(() => sincronizaMP().catch(e => console.error('revisión de Mercado Pago:', e.message)), 3600e3).unref();

  app.post('/webhooks/mercadopago', (q, s, n) => {
    // Deja rastro de cada aviso (sin datos del pagador) para poder confirmar en el log del servidor que MP sí avisa.
    s.on('finish', () => console.log('mercadopago aviso:', JSON.stringify({ tipo: (q.body && q.body.type) || q.query.type || q.query.topic || null,
      id: q.query['data.id'] ?? (q.body && q.body.data && q.body.data.id) ?? q.query.id ?? null, http: s.statusCode, firma: q.firma || null })));
    n();
  }, wrap(async (q, s) => {
    // El aviso solo dice "revisa este id": todo lo que se acredita se vuelve a consultar en la API de MP con nuestro token,
    // así que un aviso falso no puede activar nada. Por eso no se rechaza un aviso cuya firma no coincide (p. ej. si
    // MP_WEBHOOK_SECRET no es la clave de la app): se procesa igual y queda en el log para corregir la clave.
    q.firma = !q.get('x-signature') ? 'sin_firma' : E.MP_WEBHOOK_SECRET && firmaMP(q, E.MP_WEBHOOK_SECRET) ? 'valida' : 'no_valida';
    if (q.firma !== 'valida' && limita('mpw' + q.ip, 30, 60e3)) return s.status(429).json({ error: 'Demasiados avisos' });
    const tipo = String((q.body && q.body.type) || q.query.type || q.query.topic || ''), id = String(q.query['data.id'] ?? (q.body && q.body.data && q.body.data.id) ?? '');
    if (!/^[\w-]{1,64}$/.test(id)) return s.status(400).json({ error: 'Evento no válido' });
    // Solo el cobro de la suscripción acredita; la notificación "payment" del mismo cobro se ignora para no contarlo dos veces.
    if (tipo === 'subscription_authorized_payment') {
      const ap = await mpGet('/authorized_payments/' + encodeURIComponent(id));
      if (!ap) return s.json({ recibido: true, resultado: 'no_encontrado' });
      if (!ap.preapproval_id || !ap.payment || ap.payment.status !== 'approved') {
        // Sin datos del pagador: solo lo necesario para entender por qué no se acreditó.
        console.log('mercadopago sin_aprobar:', JSON.stringify({ id, preapproval: ap.preapproval_id, status: ap.status, pago: ap.payment && ap.payment.status, detalle: ap.payment && ap.payment.status_detail }));
        return s.json({ recibido: true, resultado: 'sin_aprobar' });
      }
      const pre = await mpGet('/preapproval/' + encodeURIComponent(ap.preapproval_id));
      if (!pre) return s.json({ recibido: true, resultado: 'no_encontrado' });
      const r = await unaVez('mercadopago', 'ap-' + id, tipo, cl => aplicaMP(cl, ap.preapproval_id, pre, true));
      await sobra(r, 'mercadopago', ap.preapproval_id, refMP(pre.external_reference).negId);
      return s.json({ recibido: true, resultado: r });
    }
    if (tipo === 'subscription_preapproval') {
      const pre = await mpGet('/preapproval/' + encodeURIComponent(id));
      if (!pre) return s.json({ recibido: true, resultado: 'no_encontrado' });
      const r = await enTx(cl => aplicaMP(cl, id, pre, false));
      await sobra(r, 'mercadopago', id, refMP(pre.external_reference).negId);
      return s.json({ recibido: true, resultado: r });
    }
    s.json({ recibido: true, resultado: 'ignorado' });
  }));

  // ---- Panel del dueño (auth ya limita todo /admin/plan/* al dueño)
  const vivas = negId => Q("SELECT proveedor,ref_externa,plan,estado FROM suscripciones WHERE negocio_id=$1 AND estado IN ('activa','pago_fallido','pausada') ORDER BY actualizado DESC", [negId]);
  // Un enlace de pago viejo no debe poder autorizarse junto con uno nuevo: se cancela en el proveedor antes de crear otro.
  const cierraPendientes = async negId => {
    for (const p of await Q("SELECT proveedor,ref_externa FROM suscripciones WHERE negocio_id=$1 AND estado='pendiente'", [negId])) {
      await cancelaEn(p.proveedor, p.ref_externa).catch(e => console.error('cerrar enlace pendiente:', e.message));
      await estadoDe(pool, p.proveedor, p.ref_externa, 'expirada');
    }
  };
  const correoOk = c => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(c);
  api.get('/admin/plan', auth, wrap(async (q, s) => {
    // Al volver del pago el panel consulta esto varias veces: se revisa en MP como mucho cada 20 s por negocio.
    if (!limita('mps' + q.neg.id, 1, 20e3)) {
      await sincronizaMP(q.neg.id).catch(e => console.error('revisión de Mercado Pago:', e.message));
      q.neg = (await Q('SELECT * FROM negocios WHERE id=$1', [q.neg.id]))[0]; // pudo cambiar plan y vencimiento
    }
    const n = q.neg, sub = (await Q(`SELECT proveedor,plan,estado FROM suscripciones WHERE negocio_id=$1 AND estado IN ('activa','pago_fallido','pausada','cancelada')
      ORDER BY (estado<>'cancelada') DESC, actualizado DESC LIMIT 1`, [n.id]))[0] || null;
    s.json({ plan: n.plan, vence: n.vence, activo: n.activo !== false, abierto: vigente(n), suscripcion: sub,
      planes: PLANES.map(p => ({ id: p, nombre: NOMBRE[p], precio: precio(p), stripe: stripeLista(p), mercadopago: mpLista(p) })) });
  }));
  api.post('/admin/plan/checkout', auth, wrap(async (q, s) => {
    const plan = String(q.body.plan || ''), prov = String(q.body.proveedor || '');
    if (!PLANES.includes(plan) || !['stripe', 'mercadopago'].includes(prov)) return s.status(400).json({ error: 'Elige un plan y una forma de pago' });
    if (limita('ck' + q.neg.id, 10, 3600e3)) return s.status(429).json({ error: 'Demasiados intentos. Espera un rato.' });
    if (!(prov === 'stripe' ? stripeLista(plan) : mpLista(plan))) return s.status(503).json({ error: 'Esta forma de pago aún no está disponible. Escríbenos y te activamos el plan.' });
    if ((await vivas(q.neg.id)).length) return s.status(409).json({ error: 'Ya tienes una suscripción activa. Cancélala primero si quieres cambiar de plan.' });
    // Mercado Pago liga la suscripción al correo de la cuenta de MP que paga, que puede no ser el del panel.
    // MP_PAYER_EMAIL_PRUEBA (solo en pruebas) lo reemplaza por el de la cuenta Comprador de prueba.
    const correo = String(E.MP_PAYER_EMAIL_PRUEBA || q.body.correo || q.user.email || '').trim().toLowerCase();
    if (prov === 'mercadopago' && !correoOk(correo)) return s.status(400).json({ error: 'Escribe el correo de tu cuenta de Mercado Pago' });
    await cierraPendientes(q.neg.id);
    const panel = `${base(q)}/${encodeURIComponent(q.params.slug)}/admin`;
    try {
      if (prov === 'stripe') {
        const j = await stripePost('/v1/checkout/sessions', { mode: 'subscription', locale: 'es-419', 'line_items[0][price]': E['STRIPE_PRICE_' + plan.toUpperCase()], 'line_items[0][quantity]': '1',
          success_url: panel + '?pago=ok', cancel_url: panel + '?pago=cancelado', client_reference_id: String(q.neg.id), customer_email: q.user.email,
          'metadata[plan]': plan, 'metadata[negocio_id]': String(q.neg.id), 'subscription_data[metadata][plan]': plan, 'subscription_data[metadata][negocio_id]': String(q.neg.id) });
        if (!j.url) throw new Error('stripe sin url');
        if (j.id) await guarda(pool, q.neg.id, 'stripe', j.id, plan, 'pendiente');
        return s.json({ url: j.url });
      }
      const j = await mpSend('POST', '/preapproval', { reason: `${NOMBRE[plan]} · ${q.neg.nombre}`.slice(0, 120), external_reference: `${q.neg.id}:${plan}`, payer_email: correo,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: precio(plan), currency_id: 'MXN' }, back_url: panel + '?pago=ok', status: 'pending' });
      if (!j.init_point) throw new Error('mercadopago sin init_point');
      if (j.id) await guarda(pool, q.neg.id, 'mercadopago', String(j.id), plan, 'pendiente');
      s.json({ url: j.init_point });
    } catch (e) {
      console.error('checkout:', e.message);
      const datos = /^(stripe|mercadopago) 4\d\d/.test(e.message); // 4xx: algo de los datos o de la cuenta, reintentar no sirve
      s.status(502).json({ error: datos ? 'El proveedor de pago rechazó los datos. Revisa el correo de tu cuenta o escríbenos.' : 'No pudimos iniciar el pago. Intenta de nuevo en un momento.' });
    }
  }));
  // Cancela TODAS las suscripciones vivas del negocio (por si alguna quedó duplicada) y los enlaces de pago sin usar.
  api.post('/admin/plan/cancelar', auth, wrap(async (q, s) => {
    const subs = await vivas(q.neg.id);
    if (!subs.length) return s.status(404).json({ error: 'No tienes una suscripción activa' });
    let fallo = false;
    for (const sub of subs) {
      try { await cancelaEn(sub.proveedor, sub.ref_externa); await estadoDe(pool, sub.proveedor, sub.ref_externa, 'cancelada'); }
      catch (e) { console.error('cancelar:', e.message); fallo = true; }
    }
    await cierraPendientes(q.neg.id);
    if (fallo) return s.status(502).json({ error: 'No pudimos cancelar ahora. Intenta de nuevo en un momento.' });
    s.json({ ok: true, vence: q.neg.vence });
  }));
};
