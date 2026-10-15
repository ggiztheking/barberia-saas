// Contabilidad en la pestaña Finanzas del panel (fase 3): estado de resultados para el contador, comparativo,
// punto de equilibrio, proyección de cierre, ISR orientativo de RESICO y descarga en CSV.
// Se dibuja al final de #mod-finanzas y usa los globales del panel: $, J, esc, toast, N y (si existen) FM, TAB y finanzas().
(() => {
  const din = v => { const n = Number(v) || 0, a = Math.abs(n); return (n < 0 ? '−' : '') + '$' + a.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const por = v => (v === null || v === undefined ? '—' : (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-MX', { maximumFractionDigits: 2 }) + '%');
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombre = m => MES[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
  const mesHoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Merida' }).slice(0, 7);
  const dinK = v => { const n = Math.round(Number(v) || 0); return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('es-MX'); }; // tarjetas grandes, sin centavos
  const kpi = (b, t) => `<div class="kpi"><b>${b}</b><span>${esc(t)}</span></div>`;
  const fila = (t, v, o = {}) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line);${o.fuerte ? 'font-weight:600;' : ''}${o.sub ? 'padding-left:14px;font-size:14px;color:var(--dim);' : ''}"><span>${t}</span><span style="white-space:nowrap">${v}</span></div>`;
  // Diferencia contra el mes anterior: "más" es bueno en ingresos y utilidad, malo en gastos y comisiones
  const dif = (c, bueno = 1) => {
    if (!c) return '';
    const s = c.diferencia === 0 ? 0 : c.diferencia > 0 ? 1 : -1, col = s === 0 ? 'var(--dim)' : s === bueno ? '#8fd1a6' : '#e3a0a0';
    return `<span style="color:${col}">${s > 0 ? '▲ ' : s < 0 ? '▼ ' : ''}${din(Math.abs(c.diferencia))}${c.pct === null ? '' : ' (' + por(Math.abs(c.pct)) + ')'}</span>`;
  };
  let CM = null, turno = 0, el = null;

  async function dibuja() {
    const t = ++turno, mes = CM;
    el.innerHTML = `<h2 style="margin-top:34px">Contabilidad del mes</h2><p>Estado de resultados para tu contador: lo que entró, lo que costó y lo que te quedó.</p>
<div class="panel"><label for="ct-mes">Mes</label><input type="month" id="ct-mes" value="${esc(mes)}" max="${esc(mesHoy())}"></div><div id="ct-cuerpo"><div class="vacio">Calculando…</div></div>`;
    $('#ct-mes').onchange = e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { CM = e.target.value; dibuja(); } };
    let r;
    try { r = await J('/admin/contabilidad/reporte?mes=' + encodeURIComponent(mes)); } catch (e) { if (t === turno) $('#ct-cuerpo').innerHTML = `<div class="msg">${esc(e.message)}</div>`; return; }
    if (t !== turno) return; // el dueño ya eligió otro mes
    const c = r.comparativo, e = r.equilibrio, p = r.proyeccion, isr = r.isr, gastoTotal = r.gastos.total + r.comisiones.total;
    const vs = c.utilidad.pct === null ? (r.anterior.ingresos || r.anterior.gastos ? dinK(c.utilidad.diferencia) : 'Sin datos') : (c.utilidad.diferencia >= 0 ? '+' : '−') + por(Math.abs(c.utilidad.pct));
    let h = `<div class="kpis">${kpi(dinK(r.ingresos.total), 'Ingresos')}${kpi(dinK(gastoTotal), 'Gastos y comisiones')}${kpi(dinK(r.utilidad), 'Utilidad')}${kpi(por(r.margen), 'Margen')}${kpi(esc(vs), 'Utilidad vs ' + MES[+r.mes_anterior.slice(5) - 1])}</div>`;
    // Estado de resultados
    h += `<div class="panel"><h3 style="margin:0 0 8px">Estado de resultados · ${esc(nombre(r.mes))}</h3>
${fila(`Servicios (${Number(r.ingresos.cortes)} cortes)`, din(r.ingresos.servicios))}
${r.ingresos.otras.map(x => fila(esc(x.categoria), din(x.total), { sub: 1 })).join('')}
${r.ingresos.otras.length ? fila('Otras ventas', din(r.ingresos.otras_ventas)) : ''}
${fila('Ingresos', din(r.ingresos.total), { fuerte: 1 })}
${r.comisiones.barberos.filter(b => b.costo).map(b => fila(`${esc(b.barbero)} · ${Number(b.pct)}%`, din(-b.costo), { sub: 1 })).join('')}
${fila('Comisiones', din(-r.comisiones.total))}
${r.gastos.categorias.map(x => fila(esc(x.categoria), din(-x.total), { sub: 1 })).join('')}
${fila('Gastos de operación', din(-r.gastos.total))}
${fila('Utilidad de operación', din(r.utilidad), { fuerte: 1 })}
${fila('Margen', por(r.margen))}
${r.inversion ? `<p style="font-size:14px;margin:10px 0 0">Además invertiste ${din(r.inversion)}; la inversión no se resta de la utilidad.</p>` : ''}</div>`;
    // Comparativo
    h += `<div class="panel"><h3 style="margin:0 0 8px">Contra ${esc(nombre(r.mes_anterior))}</h3>
${fila('Ingresos', dif(c.ingresos))}${fila('Comisiones', dif(c.comisiones, -1))}${fila('Gastos', dif(c.gastos, -1))}${fila('Utilidad', dif(c.utilidad))}
${fila('Cortes', `${Number(c.cortes.actual)} vs ${Number(c.cortes.anterior)}`)}${fila('Margen', c.margen.puntos === null ? '—' : `${c.margen.puntos >= 0 ? '+' : '−'}${Math.abs(c.margen.puntos).toLocaleString('es-MX')} puntos`)}</div>`;
    // Punto de equilibrio
    h += `<div class="card"><h3>Punto de equilibrio</h3>${e.cortes_mes !== null
      ? `<p style="font-size:18px">Necesitas <b>${Number(e.cortes_mes)} cortes al mes</b>${e.cortes_dia !== null ? `, unos <b>${Number(e.cortes_dia).toLocaleString('es-MX', { maximumFractionDigits: 1 })} por día</b> de trabajo (${Number(e.dias_trabajo)} días),` : ''} para cubrir tus ${esc(e.origen)} de ${din(e.costos_fijos)}.</p>
<p>Cada corte te deja ${din(e.margen_por_corte)}: ticket promedio de ${din(e.ticket_promedio)}${e.base_ticket === '90 días' ? ' (últimos 90 días)' : ''} menos ${por(e.comision_promedio)} de comisión.</p>
<p>Llevas ${Number(e.cortes_actuales)} cortes este mes${e.avance !== null ? ` (${Number(e.avance)}% de la meta)` : ''}.</p>`
      : `<p>${esc(e.mensaje)}</p>`}</div>`;
    // Proyección
    if (p) h += `<div class="card"><h3>Si sigues a este ritmo</h3><p>Llevas ${Number(p.dias_trabajo_transcurridos)} de ${Number(p.dias_trabajo)} días de trabajo. Cerrarías ${esc(nombre(r.mes))} con unos <b>${din(p.ingresos)}</b> de ingresos, ${din(p.gastos + p.comisiones)} de gastos y comisiones, y una utilidad de <b>${din(p.utilidad)}</b>${p.margen === null ? '' : ` (${por(p.margen)})`}.</p></div>`;
    // ISR estimado
    h += `<div class="card"><h3>ISR estimado (RESICO)</h3>${isr.fuera ? `<p>${esc(isr.nota)}</p>`
      : `<p style="font-size:18px">Alrededor de <b>${din(isr.isr)}</b> este mes</p><p>${por(isr.tasa)} sobre ${din(isr.base)} cobrados. ${esc(isr.nota)}</p>
<p style="font-size:14px">Si tus precios ya incluyen IVA, la base sin IVA sería ${din(isr.base_sin_iva)} y el ISR, unos ${din(isr.isr_sin_iva)}. En el año llevas ${din(isr.acumulado_anual)} cobrados (el límite del RESICO es de $3.5 millones).</p>`}
<div class="msg" role="note"><b style="font:inherit;color:var(--gold)">Aviso:</b> ${esc(isr.aviso)}</div></div>`;
    h += `<div class="acc" style="margin-top:14px"><button id="ct-csv">Descargar reporte para tu contador</button></div>`;
    $('#ct-cuerpo').innerHTML = h;
    $('#ct-csv').onclick = () => descarga(r.mes);
  }

  async function descarga(mes) {
    const b = $('#ct-csv');
    b.disabled = true;
    try {
      const r = await fetch(`/api/${N}/admin/contabilidad/export?mes=${encodeURIComponent(mes)}`);
      if (!r.ok) throw new Error(r.status === 401 ? 'Inicia sesión de nuevo' : 'No se pudo descargar');
      const m = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || ''), u = URL.createObjectURL(await r.blob()), a = document.createElement('a');
      a.href = u; a.download = m ? m[1] : `contabilidad-${N}-${mes}.csv`; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
      toast('Reporte descargado');
    } catch (e) { toast(e.message); }
    b.disabled = false;
  }

  // Cada vez que Finanzas se vuelve a cargar (flechas de mes, gasto o venta nueva, pago de comisión, gasto fijo),
  // la contabilidad se redibuja con el mismo mes para que los números de la pestaña no se contradigan.
  const fz = window.finanzas;
  if (typeof fz === 'function') window.finanzas = async function (...a) {
    const r = await fz.apply(this, a);
    if (el && el.isConnected && (typeof TAB === 'undefined' || TAB === 'finanzas') && typeof FM === 'string' && /^\d{4}-\d{2}$/.test(FM)) { CM = FM; dibuja(); }
    return r;
  };

  modulo('finanzas', async x => {
    if (!x) return;
    el = x;
    CM = typeof FM === 'string' && /^\d{4}-\d{2}$/.test(FM) ? FM : CM || mesHoy(); // al abrir la pestaña, el mismo mes que Finanzas
    await dibuja();
  });
})();
