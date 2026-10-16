// Pestaña Clientes: tarjeta de sellos digital (rutas en lealtad.js). Activa el programa, ve el avance de cada cliente,
// registra el premio entregado y manda el mensaje por WhatsApp. Usa las globales del panel: $, J, P, esc, toast y modulo.
(() => {
  const css = `.le-cab{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}.le-cab small{color:var(--dim)}
.le-cfg{display:grid;gap:10px}.le-cfg label{margin:0}.le-cfg input[type=number],.le-cfg input[type=text],.le-cfg input[type=date]{width:100%;margin:4px 0 0}
.le-sw{display:flex;gap:10px;align-items:center;font-size:15px;text-transform:none;letter-spacing:0;color:var(--ink);cursor:pointer}
.le-sw input{width:22px;height:22px;flex:0 0 22px;margin:0;accent-color:var(--gold)}
.le-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px;margin:6px 0 14px}.le-kpis .kpi b{font-size:28px}
.le-bus{width:100%;margin:0 0 12px}.le-lista{display:grid;gap:12px}
.le-t{border:1px solid var(--line);padding:12px;display:grid;gap:8px}.le-t.listo{border-color:var(--gold)}
.le-n{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.le-n b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.le-n small,.le-t small{color:var(--dim)}.le-tag{background:var(--gold);color:#12100a;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;white-space:nowrap}
.le-bar{height:8px;background:var(--line)}.le-bar i{display:block;height:100%;background:var(--gold)}
.le-sel{display:flex;flex-wrap:wrap;gap:4px}.le-sel span{width:18px;height:18px;border:1px solid var(--gold);border-radius:50%}.le-sel span.si{background:var(--gold)}
.le-acc{display:flex;flex-wrap:wrap;gap:8px}.le-acc button,.le-acc .btn{margin:0;padding:10px 12px;font-size:12px;flex:1 1 140px;min-height:44px;cursor:pointer;text-align:center}
.le-canje{display:grid;gap:8px;border-top:1px dashed var(--line);padding-top:8px}.le-canje input{width:100%;margin:0}
@media(min-width:720px){.le-lista{grid-template-columns:1fr 1fr}.le-cfg{grid-template-columns:1fr 1fr}.le-cfg .le-ancho{grid-column:1/-1}}`;
  let C = null, L = [], R = {}, filtro = '', abierto = '', ocupado = false;

  const tel = t => String(t || '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
  const fecha = f => f ? new Date(f + 'T12:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const formulario = () => `<div class="panel le-cfg" id="le-cfg">
<label class="le-sw le-ancho"><input type="checkbox" id="le-act" ${C.activo ? 'checked' : ''}>Programa de lealtad activo</label>
<div><label for="le-cada">Visitas para ganar el premio</label><input type="number" id="le-cada" min="${Number(C.min) || 3}" max="${Number(C.max) || 20}" step="1" inputmode="numeric" value="${Number(C.cada) || 10}"></div>
<div><label for="le-desde">Cuentan las visitas desde</label><input type="date" id="le-desde" max="${esc(C.hoy || '')}" value="${esc(C.desde || C.hoy || '')}"></div>
<div class="le-ancho"><label for="le-premio">Premio</label><input type="text" id="le-premio" maxlength="120" value="${esc(C.premio)}" placeholder="Un corte gratis"></div>
<small class="le-ancho">Solo cuentan las citas marcadas como atendidas. Cuando entregues el premio, regístralo aquí y su tarjeta vuelve a empezar.</small>
<div class="le-acc le-ancho"><button data-a="guardar">Guardar</button></div></div>`;

  const sellos = c => {
    const n = Math.min(Number(C.cada) || 10, 20), v = Math.min(c.visitas, n);
    return `<div class="le-sel" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<span class="${k < v ? 'si' : ''}"></span>`).join('')}</div>`;
  };

  const tarjeta = c => {
    const pct = Math.min(100, Math.round(c.visitas / (Number(C.cada) || 10) * 100)), k = esc(c.tel);
    const ult = c.ultimos && c.ultimos.length ? `<small>Premios: ${c.ultimos.map(u => esc(fecha(u.fecha)) + (u.nota ? ' (' + esc(u.nota) + ')' : '')).join(' · ')}${c.canjes > c.ultimos.length ? ` y ${Number(c.canjes) - c.ultimos.length} más` : ''}</small>` : '';
    return `<div class="le-t${c.listo ? ' listo' : ''}" data-tel="${k}">
<div class="le-n"><b>${esc(c.nombre || 'Sin nombre')}</b>${c.listo ? '<span class="le-tag">Premio listo</span>' : `<small>Faltan ${Number(c.faltan)}</small>`}</div>
<small>${esc(tel(c.tel))}${c.ultima ? ' · última visita ' + esc(fecha(c.ultima)) : ''}</small>
${sellos(c)}<div class="le-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${Number(C.cada)}" aria-valuenow="${Number(c.visitas)}" aria-label="Visitas"><i style="width:${pct}%"></i></div>
<small>${Number(c.visitas)} de ${Number(C.cada)} visitas</small>${ult}
<div class="le-acc">${c.listo && C.activo ? '<button data-a="premio">Registrar premio</button>' : ''}${c.wa ? `<a class="btn alt" href="${esc(c.wa)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}</div>
${abierto === c.tel ? `<div class="le-canje"><label for="le-nota">Nota (opcional)</label><input type="text" id="le-nota" maxlength="200" placeholder="Corte gratis entregado"><div class="le-acc"><button data-a="confirmar">Confirmar premio entregado</button><button class="alt" data-a="cancelar">Cancelar</button></div></div>` : ''}</div>`;
  };

  const lista = () => {
    const f = filtro.trim().toLowerCase(), d = f.replace(/\D/g, '');
    const V = f ? L.filter(c => (c.nombre || '').toLowerCase().includes(f) || (d && c.tel.includes(d))) : L;
    if (!L.length) return `<div class="vacio">${C.activo ? 'Aún no hay visitas que cuenten. Marca las citas como atendidas y aquí verás el avance de cada cliente.' : 'Activa el programa para empezar a contar visitas.'}</div>`;
    return V.length ? `<div class="le-lista">${V.slice(0, 120).map(tarjeta).join('')}</div>${V.length > 120 ? `<p><small>Mostrando 120 de ${V.length}. Busca por nombre o teléfono para ver más.</small></p>` : ''}` : '<div class="vacio">Nadie coincide con tu búsqueda.</div>';
  };

  const dibuja = el => {
    el.innerHTML = `<style>${css}</style><div class="le-cab" style="margin-top:34px"><h2 style="margin:0">Tarjeta de sellos</h2><small>${C.activo ? 'Activa' : 'Apagada'}</small></div>
<p>Premia a tus clientes frecuentes: cada visita atendida suma un sello y al juntar ${Number(C.cada)} ganan ${C.premio ? '<b>' + esc(C.premio) + '</b>' : 'su premio'}.</p>
${formulario()}
<div class="le-kpis"><div class="kpi"><b>${Number(R.clientes) || 0}</b><span>Con sellos</span></div><div class="kpi"><b>${Number(R.listos) || 0}</b><span>Premio listo</span></div><div class="kpi"><b>${Number(R.canjes) || 0}</b><span>Premios dados</span></div></div>
${L.length ? `<input type="search" class="le-bus" id="le-bus" placeholder="Buscar por nombre o teléfono" value="${esc(filtro)}" aria-label="Buscar cliente">` : ''}
<div id="le-lista">${lista()}</div>`;
  };

  const carga = async el => {
    try { const [c, r] = await Promise.all([J('/admin/lealtad/config'), J('/admin/lealtad/clientes')]); C = c; L = r.clientes || []; R = r.resumen || {}; }
    catch (e) { el.innerHTML = `<div class="vacio" style="margin-top:34px">${esc(e.message)}</div>`; return; }
    dibuja(el);
  };

  // Acciones que esperan al servidor: una a la vez, con los botones bloqueados mientras tanto.
  const haz = async (el, f) => {
    if (ocupado) return;
    ocupado = true; el.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await f(); } catch (e) { toast(e.message); }
    finally { ocupado = false; el.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  };

  const repinta = el => { const x = el.querySelector('#le-lista'); if (x) x.innerHTML = lista(); };

  modulo('clientes', async el => {
    if (!el) return;
    el.onclick = e => {
      const b = e.target.closest('button[data-a]'); if (!b || b.disabled) return;
      const a = b.dataset.a, caja = b.closest('.le-t'), t = caja ? caja.dataset.tel : '';
      if (a === 'guardar') return haz(el, async () => {
        const cada = Number(el.querySelector('#le-cada').value), premio = el.querySelector('#le-premio').value.trim(), activo = el.querySelector('#le-act').checked;
        if (!Number.isInteger(cada) || cada < 3 || cada > 20) throw new Error('Las visitas para el premio van de 3 a 20');
        if (activo && !premio) throw new Error('Escribe cuál es el premio');
        await P('/admin/lealtad/config', { activo, cada, premio, desde: el.querySelector('#le-desde').value });
        toast(activo ? 'Programa de lealtad guardado' : 'Programa de lealtad apagado'); await carga(el);
      });
      if (a === 'premio') { abierto = t; repinta(el); const n = el.querySelector('#le-nota'); if (n) n.focus(); return; }
      if (a === 'cancelar') { abierto = ''; repinta(el); return; }
      if (a === 'confirmar') return haz(el, async () => {
        const n = el.querySelector('#le-nota');
        await P('/admin/lealtad/canje', { telefono: t, nota: n ? n.value.trim() : '' });
        abierto = ''; toast('Premio registrado. Su tarjeta empieza de nuevo.'); await carga(el);
      });
    };
    el.oninput = e => { if (e.target.id === 'le-bus') { filtro = e.target.value; repinta(el); } };
    el.innerHTML = '<div class="vacio" style="margin-top:34px">Cargando tarjeta de sellos…</div>';
    await carga(el);
  });
})();
