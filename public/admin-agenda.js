// Pestaña Ajustes del panel (solo el dueño): horario de citas de la agenda.
// Citas cada hora o cada 30 minutos, y abrir en punto (10:00) o a la media hora (9:30). Guarda con POST /admin/agenda/config.
// Usa los globales del panel: $, J, P, esc, toast, ME y modulo. Al guardar, actualiza los espacios del panel
// (ponHoras, ncHoras y bloqueos de app-admin.html) para que "Nueva cita" y "Bloquear horario" ya salgan con el nuevo horario.
(() => {
  const css = `.ag-op{display:grid;gap:10px;margin:8px 0 18px}.ag-op button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;width:100%;margin:0;padding:14px 16px;text-transform:none;letter-spacing:0}
.ag-op button small{font-size:13px;opacity:.75}.ag-op button[aria-pressed=true]{outline:2px solid var(--gold);outline-offset:-2px}
.ag-res{font-size:14.5px;margin:0 0 14px}.ag-hrs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 16px}.ag-hrs span{border:1px solid var(--line);padding:4px 8px;font-size:13px;white-space:nowrap}
@media(min-width:620px){.ag-op{grid-template-columns:1fr 1fr}}`;
  const h12 = h => { const H = +String(h).slice(0, 2) % 24; return (H % 12 || 12) + ':' + String(h).slice(3, 5) + (H < 12 ? ' a. m.' : ' p. m.'); };
  const enPunto = x => String(x).padStart(2, '0') + ':00', aLaMedia = x => String(x).padStart(2, '0') + ':30';
  let C = null, sel = null;

  const opciones = (nombre, lista, act) => `<div class="ag-op" role="group" aria-label="${esc(nombre)}">${lista.map(([v, t, d]) =>
    `<button type="button" class="alt" data-${nombre}="${v}" aria-pressed="${v === act}"><b>${esc(t)}</b><small>${esc(d)}</small></button>`).join('')}</div>`;

  const pinta = caja => {
    const H = C.horas || [], cambia = sel.intervalo !== C.intervalo || sel.abre_min !== C.abre_min;
    caja.innerHTML = `<style>${css}</style><h2 style="margin-top:34px">Horario de citas</h2>
<p>Decide cada cuánto tiempo se pueden apartar citas en tu agenda. Las citas que ya tienes se respetan.</p>
<div class="panel"><label>¿Cada cuánto hay citas?</label>${opciones('intervalo', [[60, 'Cada hora', 'Ejemplo: 10:00, 11:00, 12:00'], [30, 'Cada 30 minutos', 'Ejemplo: 10:00, 10:30, 11:00']], sel.intervalo)}
<label>¿A qué hora abres?</label>${opciones('abre', [[0, 'En punto', 'La primera cita es a las ' + h12(enPunto(C.hora_ini))], [30, 'A la media hora', 'La primera cita es a las ' + h12(aLaMedia(C.hora_ini))]], sel.abre_min)}
<p class="ag-res">${H.length ? `Cada día que abres, tu agenda ofrece <b>${H.length} horarios</b> por barbero, de <b>${esc(h12(H[0]))}</b> a <b>${esc(h12(H[H.length - 1]))}</b>${C.termina ? ` (terminas a las ${esc(h12(C.termina))})` : ''}.` : 'Tu horario no tiene espacios: revisa la hora en que abres y la de la última cita en "Mi barbería".'}</p>
<details><summary style="cursor:pointer;color:var(--gold)">Ver los horarios que ven tus clientes</summary><div class="ag-hrs">${H.map(h => `<span>${esc(h12(h))}</span>`).join('')}</div></details>
<p style="font-size:13.5px;margin:12px 0">La hora en que abres y la de la última cita se cambian arriba, en "Mi barbería".</p>
<button type="button" id="ag-ok" style="width:100%" ${cambia ? '' : 'disabled'}>${cambia ? 'Guardar horario de citas' : 'Sin cambios'}</button></div>`;
    caja.querySelectorAll('[data-intervalo]').forEach(b => b.onclick = () => { sel.intervalo = +b.dataset.intervalo; pinta(caja); });
    caja.querySelectorAll('[data-abre]').forEach(b => b.onclick = () => { sel.abre_min = +b.dataset.abre; pinta(caja); });
    caja.querySelector('#ag-ok').onclick = async () => {
      const ok = caja.querySelector('#ag-ok'); ok.disabled = true; ok.textContent = 'Guardando…';
      try {
        C = await P('/admin/agenda/config', { intervalo: sel.intervalo, abre_min: sel.abre_min });
        sel = { intervalo: C.intervalo, abre_min: C.abre_min };
        toast('Horario de citas guardado');
        // Los demás apartados del panel toman los nuevos espacios.
        try { if (typeof ponHoras === 'function') ponHoras(C); if (typeof ncHoras === 'function') ncHoras(); if (typeof bloqueos === 'function') bloqueos(); } catch (e) { /* el resto del panel se actualiza al recargar */ }
      } catch (e) { toast(e.message); }
      pinta(caja);
    };
  };

  // Si otro módulo ya se registró en Ajustes, se conserva: este dibuja en su propia caja dentro de #mod-ajustes.
  const previo = (window.MOD || {}).ajustes;
  modulo('ajustes', async el => {
    if (previo) { try { await previo(el); } catch (e) { /* el otro módulo maneja sus errores */ } }
    if (!el || (typeof ME !== 'undefined' && ME.rol && ME.rol !== 'dueno')) return;
    let caja = el.querySelector('#ag-cfg');
    if (!caja) { caja = document.createElement('div'); caja.id = 'ag-cfg'; el.append(caja); }
    if (!C) caja.innerHTML = '<div class="vacio">Cargando horario de citas…</div>';
    try { C = await J('/admin/agenda/config'); } catch (e) { caja.innerHTML = ''; return; } // un barbero recibe 403: no ve esta sección
    sel = { intervalo: C.intervalo, abre_min: C.abre_min };
    pinta(caja);
  });
})();
