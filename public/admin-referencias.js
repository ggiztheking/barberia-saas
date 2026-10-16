// Pestaña Página: referencias de estilo editables (rutas en paquetes.js). Se ven en la sección "Encuentra tu siguiente
// estilo" del diseño Estilo Internacional. Usa las globales del panel: $, J, P, esc, toast y modulo.
(() => {
  const css = `.rf-cab{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}.rf-cab small{color:var(--dim)}
.rf-lista{display:grid;gap:14px;margin-top:12px}.rf-t{border:1px solid var(--line);padding:12px;display:grid;gap:10px}
.rf-foto{position:relative;width:100%;aspect-ratio:4/3;background:var(--line) center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:13px}
.rf-foto .rf-n{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;padding:2px 8px}
.rf-t label{margin:0}.rf-t input[type=text],.rf-t textarea{width:100%;margin:4px 0 0}.rf-t textarea{min-height:64px;resize:vertical}
.rf-ia{display:flex;gap:10px;align-items:center;font-size:15px;text-transform:none;letter-spacing:0;color:var(--ink);cursor:pointer}
.rf-ia input{width:22px;height:22px;flex:0 0 22px;margin:0;accent-color:var(--gold)}
.rf-acc{display:flex;flex-wrap:wrap;gap:8px}.rf-acc button,.rf-acc .btn{margin:0;padding:10px 12px;font-size:12px;flex:1 1 auto;min-height:44px;cursor:pointer;text-align:center}
.rf-acc .rf-mini{flex:0 0 48px}@media(min-width:720px){.rf-lista{grid-template-columns:1fr 1fr}}`;
  let L = [], MAX = 24, ocupado = false;

  // Achica la foto en el navegador: lado mayor de 1200 px como máximo, JPG, y baja la calidad hasta que pese menos de ~730 KB.
  const achicaRef = f => new Promise((ok, no) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(im.src);
      let q = .86, d = c.toDataURL('image/jpeg', q);
      while (d.length > 980000 && q > .35) { q -= .1; d = c.toDataURL('image/jpeg', q); }
      d.length > 980000 ? no(new Error('La foto es demasiado pesada, prueba con otra')) : ok(d);
    };
    im.onerror = () => no(new Error('No se pudo leer la foto'));
    im.src = URL.createObjectURL(f);
  });

  const campos = (r, p) => `<label for="${p}-n">Nombre del estilo</label><input type="text" id="${p}-n" data-c="nombre" maxlength="40" value="${esc(r.nombre || '')}" placeholder="Degradado bajo">
<label for="${p}-d">Descripción corta</label><textarea id="${p}-d" data-c="descripcion" maxlength="160" placeholder="Transición cerca de la oreja. Discreto y limpio.">${esc(r.descripcion || '')}</textarea>
<label for="${p}-e">Etiqueta (opcional)</label><input type="text" id="${p}-e" data-c="etiqueta" maxlength="40" value="${esc(r.etiqueta || '')}" placeholder="Tendencia, Clásico, Favorito…">
<label class="rf-ia"><input type="checkbox" data-c="ia" ${r.ia ? 'checked' : ''}>Imagen generada con IA (se avisa en tu página)</label>`;

  const tarjeta = (r, k) => `<div class="rf-t" data-id="${Number(r.id)}">
<div class="rf-foto" style="${r.img ? `background-image:url(/i/${Number(r.img)})` : ''}"><span class="rf-n">${k + 1}</span>${r.img ? '' : 'Sin foto'}</div>
<div class="rf-acc"><label class="btn alt">${r.img ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" hidden data-a="foto"></label>${r.img ? '<button class="alt" data-a="sinfoto">Quitar foto</button>' : ''}</div>
${campos(r, 'rf' + Number(r.id))}
<div class="rf-acc"><button data-a="guardar">Guardar</button><button class="alt rf-mini" data-a="sube" aria-label="Subir de lugar" ${k === 0 ? 'disabled' : ''}>↑</button><button class="alt rf-mini" data-a="baja" aria-label="Bajar de lugar" ${k === L.length - 1 ? 'disabled' : ''}>↓</button><button class="alt" data-a="borrar">Borrar</button></div></div>`;

  const dibuja = (el, tema) => {
    el.innerHTML = `<style>${css}</style><div class="rf-cab" style="margin-top:34px"><h2 style="margin:0">Referencias de estilo</h2><small>${L.length} de ${MAX}</small></div>
<p>Fotos de cortes para que tus clientes se inspiren. Puedes cambiar el texto, la foto y el orden. ${tema === 'ei' ? '' : '<b>Se muestran con el diseño "Estilo Internacional"</b> (arriba, en "Diseño de tu página").'} Si usas imágenes hechas con IA, márcalas: tu página lo avisa.</p>
${L.length ? `<div class="rf-lista">${L.map(tarjeta).join('')}</div>` : '<div class="vacio">Aún no tienes referencias. Sin referencias, la sección no aparece en tu página.</div>'}
${L.length < MAX ? `<div class="panel rf-t" id="rf-nueva" style="margin-top:16px"><h3 style="margin:0">Agregar referencia</h3>${campos({}, 'rf-x')}<div class="rf-acc"><button data-a="crear">Agregar</button></div><small style="color:var(--dim)">Después de agregarla podrás subir su foto.</small></div>` : `<p style="margin-top:12px">Llegaste al límite de ${MAX} referencias.</p>`}`;
  };

  const datos = caja => {
    const v = c => caja.querySelector(`[data-c="${c}"]`);
    return { nombre: v('nombre').value.trim(), descripcion: v('descripcion').value.trim(), etiqueta: v('etiqueta').value.trim(), ia: v('ia').checked };
  };

  const carga = async el => {
    let tema = '';
    try { const [r, t] = await Promise.all([J('/admin/referencias'), J('/admin/tema').catch(() => ({}))]); L = r.referencias; MAX = r.max || 24; tema = t.tema; }
    catch (e) { el.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; return; }
    dibuja(el, tema);
  };

  // Acciones que esperan al servidor: una a la vez, con los botones bloqueados mientras tanto.
  const haz = async (el, f) => {
    if (ocupado) return toast('Espera a que termine lo anterior');
    ocupado = true; el.querySelectorAll('button').forEach(b => { b.dataset.d = b.disabled ? '1' : ''; b.disabled = true; });
    try { await f(); } catch (e) { toast(e.message); }
    finally { ocupado = false; el.querySelectorAll('button[data-d]').forEach(b => { b.disabled = b.dataset.d === '1'; delete b.dataset.d; }); } // si se redibujó, los botones nuevos ya traen su estado
  };

  const mueve = async (el, id, paso) => {
    const k = L.findIndex(r => r.id === id), j = k + paso;
    if (k < 0 || j < 0 || j >= L.length) return;
    const nueva = L.slice(); [nueva[k], nueva[j]] = [nueva[j], nueva[k]];
    await P('/admin/referencias/orden', { ids: nueva.map(r => r.id) });
    await carga(el);
    const t = el.querySelector(`.rf-t[data-id="${Number(id)}"]`); if (t) t.scrollIntoView({ block: 'center' });
  };

  modulo('pagina', async el => {
    if (!el) return;
    el.onclick = e => {
      const b = e.target.closest('button[data-a]'); if (!b || b.disabled) return;
      const caja = b.closest('.rf-t'), id = caja && caja.dataset.id ? Number(caja.dataset.id) : null, a = b.dataset.a;
      if (a === 'crear') return haz(el, async () => {
        const d = datos(caja); if (!d.nombre) throw new Error('Escribe el nombre del estilo');
        await P('/admin/referencia', d); toast('Referencia agregada. Ahora sube su foto.'); await carga(el);
      });
      if (!id) return;
      if (a === 'guardar') return haz(el, async () => {
        const d = datos(caja); if (!d.nombre) throw new Error('Escribe el nombre del estilo');
        await P('/admin/referencia', { id, ...d }); toast('Cambios guardados'); await carga(el);
      });
      if (a === 'sube' || a === 'baja') return haz(el, () => mueve(el, id, a === 'sube' ? -1 : 1));
      if (a === 'sinfoto') { if (!confirm('¿Quitar la foto de esta referencia?')) return; return haz(el, async () => { await P('/admin/referencia/foto/borrar', { id }); toast('Foto quitada'); await carga(el); }); }
      if (a === 'borrar') {
        const r = L.find(x => x.id === id);
        if (!confirm(`¿Borrar la referencia "${r ? r.nombre : ''}"? También se borra su foto.`)) return;
        return haz(el, async () => { await P('/admin/referencia/borrar', { id }); toast('Referencia borrada'); await carga(el); });
      }
    };
    el.onchange = e => {
      const t = e.target; if (t.dataset.a !== 'foto') return;
      const f = t.files[0], caja = t.closest('.rf-t'), id = Number(caja.dataset.id); t.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) return toast('Elige una imagen');
      haz(el, async () => { toast('Subiendo foto…'); await P('/admin/referencia/foto', { id, data: await achicaRef(f) }); toast('Foto guardada'); await carga(el); });
    };
    el.innerHTML = '<div class="vacio" style="margin-top:34px">Cargando referencias…</div>';
    await carga(el);
  });
})();
