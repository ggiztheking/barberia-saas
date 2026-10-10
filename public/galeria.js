'use strict';
// Visor de fotos a pantalla completa: deslizar, flechas y una acción opcional.
window.galeria = (L, i, o) => {
  if (!L || !L.length) return;
  i = i || 0; o = o || {};
  const v = document.createElement('div');
  v.className = 'visor'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true');
  v.innerHTML = '<div class="vtop"><span class="vn"></span><button type="button" class="vx" aria-label="Cerrar">×</button></div>' +
    '<div class="vimg"><img alt=""></div><button type="button" class="vnav vp" aria-label="Anterior">‹</button><button type="button" class="vnav vs" aria-label="Siguiente">›</button>' +
    '<div class="vpie"><p class="vt"></p></div>';
  document.body.append(v);
  const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
  const im = v.querySelector('img');
  const go = k => {
    i = (k + L.length) % L.length; im.src = '/i/' + L[i].img; im.alt = L[i].titulo || 'Foto de un corte';
    v.querySelector('.vn').textContent = L.length > 1 ? (i + 1) + ' de ' + L.length : '';
    v.querySelector('.vt').textContent = L[i].titulo || '';
    const s = L[(i + 1) % L.length]; if (s) new Image().src = '/i/' + s.img;
  };
  const fin = () => { v.remove(); document.body.style.overflow = prev; removeEventListener('keydown', kd); };
  const kd = e => { if (e.key === 'Escape') fin(); else if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); };
  v.querySelector('.vx').onclick = fin; v.querySelector('.vp').onclick = () => go(i - 1); v.querySelector('.vs').onclick = () => go(i + 1);
  addEventListener('keydown', kd);
  let x0 = null; const z = v.querySelector('.vimg');
  z.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  z.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); x0 = null; });
  z.onclick = e => { if (e.target === z) fin(); };
  if (L.length < 2) v.querySelectorAll('.vnav').forEach(b => { b.hidden = true; });
  if (o.accion) { const b = document.createElement('button'); b.type = 'button'; b.className = 'vac'; b.textContent = o.accion; b.onclick = () => { fin(); o.fn && o.fn(); }; v.querySelector('.vpie').append(b); }
  go(i); v.querySelector('.vx').focus();
};
window.capTrab = t => ({ img: t.img, titulo: [t.servicio, t.barbero && 'por ' + t.barbero].filter(Boolean).join(' · ') });
