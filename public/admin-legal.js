// Pestaña Legal del panel (fase 4): checklist para abrir y operar la barbería en Mérida, documentos imprimibles
// y enlace al aviso de privacidad público. Usa las globales del panel: $, J, P, esc, toast, N, modulo y ve.
(() => {
  const css = `.lg-barra{height:8px;background:var(--line);margin:-14px 0 22px}.lg-barra i{display:block;height:100%;background:var(--gold);transition:width .3s}
.lg-paso{padding:14px 0;border-top:1px solid var(--line)}.lg-paso label{display:flex;gap:12px;align-items:flex-start;cursor:pointer;font-size:16px;text-transform:none;letter-spacing:0;color:var(--ink)}
.lg-paso input[type=checkbox]{width:22px;height:22px;flex:0 0 22px;margin:2px 0 0;accent-color:var(--gold)}.lg-paso.ok .lg-t{color:var(--dim);text-decoration:line-through}
.lg-paso details{margin:8px 0 0 34px;font-size:14.5px}.lg-paso summary{cursor:pointer;color:var(--gold);font-size:13px}.lg-paso dl{margin:8px 0 0}.lg-paso dt{color:var(--dim);font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-top:8px}.lg-paso dd{margin:2px 0 0}
.lg-paso .lg-nota{margin:8px 0 0 34px;width:calc(100% - 34px);font-size:14px;padding:8px 0}.lg-docs{display:grid;gap:10px}.lg-docs a{text-align:center}.lg-gr{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:30px}.lg-gr small{color:var(--dim)}`;
  const FALTA = { direccion: 'la dirección de tu barbería (Ajustes)', contacto: 'un medio de contacto: el WhatsApp del negocio (Ajustes) o un correo de privacidad (aquí abajo)', titular: 'el nombre completo o razón social del titular (aquí abajo)' };
  const url = u => /^https:\/\//.test(u || '') ? u : null; // solo enlaces https a fuentes oficiales
  let D = null;

  const progreso = el => {
    const k = el.querySelector('#lg-kpi'), b = el.querySelector('#lg-barra');
    if (k) k.innerHTML = `<b>${Number(D.progreso)} %</b><span>${Number(D.hechos)} de ${Number(D.total)} pasos listos</span>`;
    if (b) b.style.width = Number(D.progreso) + '%';
    D.grupos.forEach(g => { const c = el.querySelector(`[data-gc="${g.id}"]`); if (c) c.textContent = `${g.pasos.filter(p => p.hecho).length} de ${g.pasos.length}`; });
  };

  const paso = p => `<div class="lg-paso${p.hecho ? ' ok' : ''}" data-p="${esc(p.id)}">
<label><input type="checkbox" ${p.hecho ? 'checked' : ''} aria-label="Marcar como hecho: ${esc(p.titulo)}"><span class="lg-t">${esc(p.titulo)}</span></label>
<details><summary>Qué es y dónde se hace</summary><dl><dt>Por qué importa</dt><dd>${esc(p.porque)}</dd><dt>Qué necesitas</dt><dd>${esc(p.necesitas)}</dd><dt>Dónde se hace</dt><dd>${esc(p.donde)}</dd>
${p.costo ? `<dt>Costo</dt><dd>${esc(p.costo)}</dd>` : ''}<dt>Fuente</dt><dd>${url(p.fuente) ? `<a href="${esc(p.fuente)}" target="_blank" rel="noopener noreferrer" style="color:var(--gold);overflow-wrap:anywhere">${esc(p.fuente)}</a>` : 'Recomendación general (sin fuente oficial).'}</dd></dl></details>
<input class="lg-nota" maxlength="500" placeholder="Nota: folio, fecha de vencimiento, con quién lo tramitaste…" value="${esc(p.nota)}" aria-label="Nota para ${esc(p.titulo)}"></div>`;

  const dibuja = el => {
    const priv = '/' + N + '/privacidad', doc = t => `/api/${N}/admin/legal/doc/${t}`;
    el.innerHTML = `<style>${css}</style><h2>Marco legal</h2>
<div class="msg ok" role="note" style="margin:0 0 20px;font-size:14.5px"><b>Importante:</b> ${esc(D.aviso)}</div>
<div class="kpis" style="margin-bottom:14px"><div class="kpi" id="lg-kpi"></div></div><div class="lg-barra" aria-hidden="true"><i id="lg-barra" style="width:0"></i></div>
${D.faltan.length ? `<div class="msg" style="margin:0 0 20px">Para que tus documentos salgan completos falta: ${D.faltan.map(f => esc(FALTA[f] || f)).join('; ')}.${D.faltan.includes('direccion') || D.faltan.includes('contacto') ? ' <button class="enlace" id="lg-aj">Ir a Ajustes</button>' : ''}</div>` : ''}
<div class="panel"><label for="lg-tit">Nombre completo o razón social del titular</label><input id="lg-tit" maxlength="120" value="${esc(D.titular)}" placeholder="Como aparece en tu constancia del SAT">
<p style="font-size:13.5px;margin:-8px 0 10px">Aparece como responsable en el aviso de privacidad y en el contrato.</p>
<label for="lg-cor">Correo para temas de privacidad (opcional)</label><input id="lg-cor" type="email" maxlength="120" value="${esc(D.correo || '')}" placeholder="privacidad@tubarberia.com">
<p style="font-size:13.5px;margin:-8px 0 10px">Se publica en tu aviso de privacidad para que tus clientes ejerzan sus derechos. Si lo dejas vacío, se usa el WhatsApp del negocio.</p><button id="lg-tit-ok">Guardar</button></div>
<h2 style="margin-top:30px">Documentos</h2><p>Se llenan con los datos de tu barbería y se abren en otra pestaña para imprimir o guardar como PDF. Revísalos antes de usarlos.</p>
<div class="panel"><div class="lg-docs">${D.docs.map(x => x.tipo === 'contrato' ? '' : `<a class="btn alt" target="_blank" rel="noopener" href="${esc(doc(x.tipo))}">${esc(x.titulo)}</a>`).join('')}</div>
<label for="lg-bar" style="margin-top:18px;display:block">Contrato con barbero comisionista</label><select id="lg-bar"><option value="">Sin nombre (lo llenas a mano)</option>${D.barberos.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select>
<a class="btn alt" id="lg-con" target="_blank" rel="noopener" href="${esc(doc('contrato'))}" style="display:block;text-align:center">Abrir contrato</a>
<p style="font-size:13.5px;margin:12px 0 0">Tu aviso de privacidad público: <a style="color:var(--gold);overflow-wrap:anywhere" target="_blank" rel="noopener" href="${esc(priv)}">${esc(location.origin + priv)}</a></p></div>
<h2 style="margin-top:30px">Pasos para abrir y operar en Mérida</h2><p>Marca cada paso cuando lo tengas listo. Toca "Qué es y dónde se hace" para ver requisitos y la fuente oficial.</p>
${D.grupos.map(g => `<div class="lg-gr"><h3>${esc(g.titulo)}</h3><small data-gc="${esc(g.id)}"></small></div>${g.pasos.map(paso).join('')}`).join('')}`;
    progreso(el);
  };

  const busca = id => { for (const g of D.grupos) for (const p of g.pasos) if (p.id === id) return p; return null; };
  const guarda = async (el, caja, cambio) => {
    const p = busca(caja.dataset.p);
    if (!p) return;
    const antes = { hecho: p.hecho, nota: p.nota };
    Object.assign(p, cambio);
    try {
      const r = await P('/admin/legal/paso', { paso: p.id, hecho: p.hecho, nota: p.nota });
      Object.assign(D, { hechos: r.hechos, total: r.total, progreso: r.progreso });
      caja.classList.toggle('ok', p.hecho); progreso(el);
      if ('nota' in cambio) toast('Nota guardada'); else if (p.hecho) toast(r.progreso === 100 ? '¡Completaste todos los pasos!' : 'Paso marcado como listo');
    } catch (e) {
      Object.assign(p, antes); caja.querySelector('input[type=checkbox]').checked = p.hecho; toast(e.message);
    }
  };

  modulo('legal', async el => {
    if (!el) return;
    el.innerHTML = '<div class="vacio">Cargando…</div>';
    try { D = await J('/admin/legal/pasos'); } catch (e) { el.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; return; }
    dibuja(el);
    el.onchange = e => {
      const t = e.target, caja = t.closest('.lg-paso');
      if (t.id === 'lg-bar') { el.querySelector('#lg-con').href = `/api/${N}/admin/legal/doc/contrato${t.value ? '?barbero=' + encodeURIComponent(t.value) : ''}`; return; }
      if (!caja) return;
      if (t.type === 'checkbox') guarda(el, caja, { hecho: t.checked });
      else if (t.classList.contains('lg-nota')) guarda(el, caja, { nota: t.value.trim().slice(0, 500) });
    };
    el.onclick = async e => {
      if (e.target.id === 'lg-aj') { if (typeof ve === 'function') ve('ajustes', '#aj'); return; }
      if (e.target.id !== 'lg-tit-ok') return;
      try {
        await P('/admin/legal/datos', { titular: el.querySelector('#lg-tit').value, correo: el.querySelector('#lg-cor').value });
        toast('Datos guardados');
        D = await J('/admin/legal/pasos'); dibuja(el);
      } catch (x) { toast(x.message); }
    };
  });
})();
