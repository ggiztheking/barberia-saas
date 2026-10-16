// Pestaña "Agenda llena" del panel (fase 5): huecos de los próximos días, promo relámpago,
// mapa de ocupación por día y hora, e inasistencias. Usa los globales del panel: $, J, P, esc, toast, modulo.
(() => {
  const DC = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const SEG = [['todos', 'Todos mis clientes'], ['frecuente', 'Frecuentes'], ['vip', 'VIP'], ['riesgo', 'En riesgo (30 a 89 días sin venir)'], ['perdido', 'Perdidos (90 días o más)'], ['nuevo', 'Nuevos'], ['cumple', 'Cumpleañeros del mes'], ['prospecto', 'Prospectos']];
  const S = { dias: 7, semanas: 8, sel: {}, promo: null, H: null, PT: null, IN: null, el: null };
  const hh = h => { const x = +h.slice(0, 2); return `${x % 12 || 12}:${h.slice(3, 5)} ${x < 12 ? 'a. m.' : 'p. m.'}`; };
  const corta = h => { const x = +h.slice(0, 2); return (x % 12 || 12) + (h.slice(3, 5) !== '00' ? ':' + h.slice(3, 5) : '') + (x < 12 ? 'a' : 'p'); }; // 9a, 9:30a
  const fecha = (f, hoy) => { const d = new Date(f + 'T12:00'), m = new Date(hoy + 'T12:00'); m.setDate(m.getDate() + 1);
    const t = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/^./, c => c.toUpperCase());
    return f === hoy ? 'Hoy · ' + t : f === m.toLocaleDateString('en-CA') ? 'Mañana · ' + t : t; };
  const nivel = p => p === null ? '' : p >= 60 ? 'alta' : p >= 25 ? 'media' : 'baja';
  const CSS = `<style>
#mod-tiempo .tq-h{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px}
#mod-tiempo .tq-h button{margin:0;padding:9px 12px;font-size:13px;letter-spacing:.04em;text-transform:none;background:transparent;color:var(--ink);border:1px solid var(--line)}
#mod-tiempo .tq-h button[aria-pressed=true]{background:var(--gold);color:#12100a;border-color:var(--gold)}
#mod-tiempo .tq-bar{height:6px;background:var(--line);margin:6px 0 2px}#mod-tiempo .tq-bar i{display:block;height:100%;background:var(--gold)}
#mod-tiempo .tq-mapa{overflow-x:auto;margin:10px 0 6px}
#mod-tiempo table{border-collapse:collapse;width:100%;min-width:300px;font-size:13px;font-variant-numeric:tabular-nums}
#mod-tiempo th,#mod-tiempo td{border:1px solid var(--line);padding:6px 2px;text-align:center;font-weight:400}
#mod-tiempo th{color:var(--dim);font-size:11px;letter-spacing:.06em}
#mod-tiempo td.baja{background:rgba(194,164,95,.08);color:var(--dim)}
#mod-tiempo td.media{background:rgba(194,164,95,.38);color:var(--ink)}
#mod-tiempo td.alta{background:var(--gold);color:#12100a;font-weight:600}
#mod-tiempo td.nada{color:var(--dim)}
#mod-tiempo .tq-ley{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--dim);margin:8px 0}
#mod-tiempo .tq-ley span{display:inline-flex;align-items:center;gap:6px}#mod-tiempo .tq-ley i{width:16px;height:16px;border:1px solid var(--line);display:inline-block}
#mod-tiempo textarea{font:inherit;width:100%;min-height:120px;padding:12px;margin:8px 0;background:transparent;color:var(--ink);border:1px solid var(--line);resize:vertical}
#mod-tiempo .tq-n{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#mod-tiempo .tq-n input{width:80px;margin:0}
</style>`;

  // ---- Carga
  async function carga(el) {
    S.el = el;
    if (!el.innerHTML) el.innerHTML = CSS + '<h2>Agenda llena</h2><div id="tq-cuerpo"><div class="vacio">Cargando…</div></div>';
    try {
      [S.H, S.PT, S.IN] = await Promise.all([J('/admin/tiempo/huecos?dias=' + S.dias), J('/admin/tiempo/patron?semanas=' + S.semanas), J('/admin/tiempo/inasistencias')]);
    } catch (e) { $('#tq-cuerpo').innerHTML = `<div class="msg">${esc(e.message)}</div>`; return; }
    pinta();
  }
  function pinta() {
    const H = S.H, PT = S.PT, IN = S.IN, abiertos = H.dias.filter(d => !d.cerrado && d.ocupacion !== null);
    // Quita de la selección las horas que ya no están libres (alguien las reservó o ya pasaron): si no, no se podrían desmarcar.
    for (const f of Object.keys(S.sel)) { const d = H.dias.find(x => x.fecha === f), ok = new Set(d ? d.huecos.map(x => x.hora) : []); for (const h of [...S.sel[f]]) if (!ok.has(h)) S.sel[f].delete(h); }
    const prom = abiertos.length ? Math.round(abiertos.reduce((a, d) => a + d.ocupacion, 0) / abiertos.length) : null;
    let h = '<p>Encuentra las horas vacías de tu agenda y llénalas. Lo que aparece libre aquí es exactamente lo que tus clientes pueden reservar en línea.</p>';
    if (!H.abierto) h += '<div class="msg">Tu cuenta está vencida o suspendida: ahora mismo tus clientes no pueden agendar. Revisa la pestaña Plan.</div>';
    h += `<div class="kpis">
      <div class="kpi"><b>${H.totalLibres}</b><span>Lugares libres en ${S.dias} días</span></div>
      <div class="kpi"><b>${prom === null ? '—' : prom + ' %'}</b><span>Agenda ocupada (próximos ${S.dias} días)</span></div>
      <div class="kpi"><b>${PT.inasistencia === null ? '—' : PT.inasistencia + ' %'}</b><span>No llegaron (${PT.semanas} semanas)</span></div>
      <div class="kpi"><b>${IN.manana.sinEnviar}</b><span>Recordatorios de mañana sin enviar</span></div></div>`;
    h += '<h2 style="margin-top:26px">Huecos de los próximos días</h2><div class="chips" role="group" aria-label="Días a mostrar">' + [7, 14].map(n => `<button data-tq="dias" data-v="${n}" aria-pressed="${S.dias === n}">${n} días</button>`).join('') + '</div>';
    h += '<p style="font-size:14px">Toca las horas que quieres llenar y arma una promo relámpago. Si no eliges ninguna, se usan todas las del día.</p><div id="tq-promo"></div>';
    h += H.dias.map(dia).join('');
    h += mapa();
    h += faltas();
    $('#tq-cuerpo').innerHTML = h;
    if (S.promo) promo();
  }

  // ---- Huecos por día
  function dia(d) {
    const tit = esc(fecha(d.fecha, S.H.hoy));
    if (d.cerrado) return `<div class="card"><h3>${tit}</h3><p style="color:var(--dim)">Cerrado</p></div>`;
    const sel = S.sel[d.fecha] || new Set(), oc = d.ocupacion === null ? 0 : d.ocupacion;
    const cab = `<h3>${tit}</h3><p>${d.ocupacion === null ? 'Sin barberos disponibles' : `Ocupación ${d.ocupacion} % · ${d.libres} lugar${d.libres === 1 ? '' : 'es'} libre${d.libres === 1 ? '' : 's'}`}</p><div class="tq-bar" role="img" aria-label="Ocupación ${oc} %"><i style="width:${Math.min(100, oc)}%"></i></div>`;
    if (!d.huecos.length) return `<div class="card">${cab}<p style="color:var(--dim)">${d.fecha === S.H.hoy ? 'Ya no quedan horas libres hoy.' : 'Día lleno.'}</p></div>`;
    return `<div class="card">${cab}<div class="tq-h" role="group" aria-label="Horas libres">${d.huecos.map(x => `<button data-tq="hora" data-f="${esc(d.fecha)}" data-h="${esc(x.hora)}" aria-pressed="${sel.has(x.hora)}" title="${esc(x.barberos.join(', '))}">${hh(x.hora)} · ${x.libres} libre${x.libres === 1 ? '' : 's'}</button>`).join('')}</div>
      <div class="acc"><button data-tq="relampago" data-f="${esc(d.fecha)}">⚡ Promo relámpago${sel.size ? ` (${sel.size})` : ''}</button></div></div>`;
  }

  // ---- Promo relámpago
  function promo() {
    const p = S.promo, el = $('#tq-promo');
    if (!el) return;
    if (!p) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="panel"><h3 style="margin-top:0">Promo relámpago · ${esc(fecha(p.fecha, S.H.hoy))}</h3>
      <div class="tq-n"><label for="tq-desc" style="margin:0">Descuento</label><input id="tq-desc" type="number" min="0" max="90" step="5" inputmode="numeric" value="${Number(p.descuento)}"><span>%</span><button class="alt" data-tq="rehacer" style="margin:0">Actualizar texto</button></div>
      <label for="tq-texto">Texto listo para WhatsApp, estados y redes</label><textarea id="tq-texto">${esc(p.texto)}</textarea>
      <div class="acc"><button data-tq="copiar">Copiar</button><a class="btn alt" href="${esc(p.compartir)}" target="_blank" rel="noopener">Compartir por WhatsApp</a></div>
      <label for="tq-seg" style="margin-top:16px">Mandar como campaña a</label><select id="tq-seg">${SEG.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
      <div class="acc"><button class="alt" data-tq="campana">Mandar como campaña</button><button class="alt" data-tq="cerrar">Cerrar</button></div>
      <p style="font-size:13px;color:var(--dim)">La campaña queda en la bandeja del CRM para enviarla cliente por cliente (o automática si conectaste WhatsApp).</p></div>`;
  }
  async function relampago(f, descuento, fijas) {
    const d = S.H.dias.find(x => x.fecha === f), sel = S.sel[f];
    const horas = fijas || (sel && sel.size ? [...sel] : d.huecos.slice(0, 12).map(x => x.hora));
    try {
      S.promo = await P('/admin/tiempo/relampago', { fecha: f, horas, descuento: descuento ?? (S.promo ? S.promo.descuento : 15) });
      promo(); $('#tq-promo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast(e.message); if (/lugar|pasó/.test(e.message)) carga(S.el); }
  }
  async function copiar() {
    const t = $('#tq-texto');
    try { await navigator.clipboard.writeText(t.value); toast('Copiado'); }
    catch (e) { t.select(); try { document.execCommand('copy'); toast('Copiado'); } catch (x) { toast('Selecciona el texto y cópialo'); } }
  }
  async function campana() {
    const p = S.promo, seg = $('#tq-seg').value, editado = $('#tq-texto').value.trim();
    const texto = editado && editado !== p.texto ? 'Hola {nombre}. ' + editado : p.textoCampana;
    if (!confirm(`¿Mandar la promo a "${(SEG.find(x => x[0] === seg) || [, seg])[1]}"?`)) return;
    try { const r = await P('/crm/campana', { titulo: p.titulo, texto, segmento: seg }); toast(`Campaña lista para ${r.total} cliente${r.total === 1 ? '' : 's'}. Envíala desde CRM → Campañas`); }
    catch (e) { toast(e.message); }
  }

  // ---- Mapa de calor: filas = horas, columnas = días (cabe en un celular)
  function mapa() {
    const PT = S.PT, D = PT.dias;
    let h = `<h2 style="margin-top:34px">Cómo se llena tu semana</h2><div class="chips" role="group" aria-label="Semanas a analizar">${[4, 8, 12].map(n => `<button data-tq="semanas" data-v="${n}" aria-pressed="${S.semanas === n}">${n} semanas</button>`).join('')}</div>`;
    if (!PT.citas) return h + `<div class="vacio">Aún no hay citas atendidas ni faltas en las últimas ${PT.semanas} semanas. Marca tus citas como "Atendida" o "No llegó" en la pestaña Hoy y aquí verás tus horas fuertes y tus horas muertas.</div>`;
    h += `<p style="font-size:14px">Porcentaje de lugares ocupados (citas atendidas o que no llegaron) de las últimas ${PT.semanas} semanas. Ocupación general: <b style="color:var(--ink);font-weight:400">${PT.ocupacion} %</b>.</p>`;
    h += `<div class="tq-mapa"><table><caption class="sr" style="position:absolute;left:-9999px">Ocupación por hora y día de la semana, en porcentaje</caption><thead><tr><th scope="col">Hora</th>${D.map(d => `<th scope="col">${DC[d.dow]}</th>`).join('')}</tr></thead><tbody>`;
    h += PT.horas.map((hr, k) => `<tr><th scope="row">${corta(hr)}</th>${D.map(d => { const c = d.horas[k];
      if (d.cerrado) return '<td class="nada" aria-label="Cerrado">—</td>';
      if (c.ocupacion === null) return '<td class="nada" aria-label="Sin datos">·</td>';
      return `<td class="${nivel(c.ocupacion)}" aria-label="${esc(d.dia)} ${hh(hr)}: ${c.ocupacion} %">${c.ocupacion}</td>`; }).join('')}</tr>`).join('');
    h += `</tbody><tfoot><tr><th scope="row">Día</th>${D.map(d => `<td>${d.ocupacion === null ? '—' : d.ocupacion}</td>`).join('')}</tr><tr><th scope="row" title="Porcentaje de citas en que el cliente no llegó">Faltas</th>${D.map(d => `<td>${d.inasistencia === null ? '—' : d.inasistencia}</td>`).join('')}</tr></tfoot></table></div>`;
    h += '<div class="tq-ley"><span><i style="background:rgba(194,164,95,.08)"></i>Baja: menos de 25</span><span><i style="background:rgba(194,164,95,.38)"></i>Media: 25 a 59</span><span><i style="background:var(--gold)"></i>Alta: 60 o más</span><span>— cerrado · sin datos</span></div>';
    if (PT.muertas.length) h += `<div class="panel"><h3 style="margin-top:0">Horas muertas</h3><p style="font-size:14px">Se repiten casi vacías semana tras semana. Son las mejores para una promo fija (por ejemplo, "martes de 10 a 12 con descuento") o para tus descansos.</p>${PT.muertas.map(x => `<div class="hb"><span>${esc(x.dia.replace(/^./, c => c.toUpperCase()))} ${hh(x.hora)}</span><u><i style="width:${x.ocupacion}%"></i></u><em>${x.ocupacion} %</em></div>`).join('')}</div>`;
    if (PT.sinCerrar) h += `<div class="msg">Tienes ${PT.sinCerrar} cita${PT.sinCerrar === 1 ? '' : 's'} pasada${PT.sinCerrar === 1 ? '' : 's'} sin marcar. Márcalas como "Atendida" o "No llegó" para que este análisis sea exacto.</div>`;
    return h;
  }

  // ---- Inasistencias
  function faltas() {
    const I = S.IN, M = I.manana;
    let h = '<h2 style="margin-top:34px">Que no te dejen plantado</h2>';
    h += `<div class="panel"><h3 style="margin-top:0">Recordatorios de mañana</h3>${M.total ? `<p>${M.total} cita${M.total === 1 ? '' : 's'} mañana · ${M.enviados} recordatorio${M.enviados === 1 ? '' : 's'} enviado${M.enviados === 1 ? '' : 's'} · <b style="color:var(--ink);font-weight:400">${M.sinEnviar} sin enviar</b>${M.sinAvisos ? ` · ${M.sinAvisos} no quiere${M.sinAvisos === 1 ? '' : 'n'} avisos` : ''}${M.total - M.conTelefono ? ` · ${M.total - M.conTelefono} sin WhatsApp` : ''}</p>` : '<p>Aún no hay citas para mañana.</p>'}
      ${M.riesgo.length ? `<div class="msg" style="margin:10px 0">Ojo: ${M.riesgo.map(c => `${esc(c.cliente)} (${hh(c.hora)}, ${c.faltas} faltas)`).join(', ')}. Confírmale${M.riesgo.length === 1 ? '' : 's'} hoy por WhatsApp.</div>` : ''}
      <div class="acc"><a class="btn${M.sinEnviar ? '' : ' alt'}" href="${esc(I.crm)}">Mandar recordatorios en el CRM</a></div></div>`;
    h += '<h3>Clientes que han faltado 2 veces o más (últimos 90 días)</h3>';
    h += I.clientes.length ? I.clientes.map(c => `<div class="card"><h3>${esc(c.nombre)} <span class="tag no_llego">${c.faltas} faltas</span></h3><p>Última falta: ${esc(c.ultima)} · ${c.visitas} visita${c.visitas === 1 ? '' : 's'} atendida${c.visitas === 1 ? '' : 's'}${c.proxima ? ` · <b style="font:inherit;color:var(--ink)">Próxima cita: ${esc(c.proxima)}</b>` : ''}</p>
      <div class="acc"><a class="btn alt" href="https://wa.me/52${esc(c.tel)}?text=${encodeURIComponent(`Hola ${String(c.nombre || '').split(' ')[0]}, ${c.proxima ? 'te escribimos para confirmar tu próxima cita. ¿Nos confirmas que vienes?' : '¿te apartamos un lugar esta semana? Si agendas, avísanos si no puedes llegar para dárselo a alguien más.'}`)}" target="_blank" rel="noopener">WhatsApp</a></div></div>`).join('')
      : '<div class="vacio">Nadie ha faltado 2 veces en los últimos 90 días. Sigue marcando "No llegó" en la pestaña Hoy para detectarlos.</div>';
    return h;
  }

  // ---- Acciones (delegadas: este archivo no deja funciones globales)
  function clic(ev) {
    const b = ev.target.closest('[data-tq]');
    if (!b || !S.el.contains(b)) return;
    const a = b.dataset.tq;
    if (a === 'dias' || a === 'semanas') { S[a] = +b.dataset.v; S.promo = null; carga(S.el); }
    else if (a === 'hora') { // sin volver a dibujar todo, para no perder lo escrito en la promo
      const s = S.sel[b.dataset.f] = S.sel[b.dataset.f] || new Set(), h = b.dataset.h;
      s.has(h) ? s.delete(h) : s.add(h); b.setAttribute('aria-pressed', s.has(h));
      const r = b.closest('.card').querySelector('[data-tq=relampago]'); if (r) r.textContent = '⚡ Promo relámpago' + (s.size ? ` (${s.size})` : '');
    }
    else if (a === 'relampago') relampago(b.dataset.f);
    else if (a === 'rehacer') { const v = parseInt($('#tq-desc').value); relampago(S.promo.fecha, Number.isFinite(v) ? v : 0, S.promo.horas.map(x => x.hora)); }
    else if (a === 'copiar') copiar();
    else if (a === 'campana') campana();
    else if (a === 'cerrar') { S.promo = null; promo(); }
  }
  let ligado = false;
  modulo('tiempo', el => { if (!ligado) { el.addEventListener('click', clic); ligado = true; } carga(el); });
})();
