'use strict';
const N=location.pathname.split('/')[1],$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mx=x=>{const n=Number(x)||0,v=Math.abs(n);return (n<0?'−':'')+'$'+v.toLocaleString('es-MX',{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2})};
const toast=t=>{$$('.toast').forEach(x=>x.remove());const e=document.createElement('div');e.className='toast';e.setAttribute('role','status');e.textContent=t;document.body.append(e);setTimeout(()=>e.remove(),3000)};
const J=async(u,b)=>{const r=await fetch('/api/'+N+u,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{});
if(r.status===401){location.replace('/'+N+'/entrar?volver=crm');throw new Error('Inicia sesión')}
const d=await r.json().catch(()=>({}));if(r.status===403)throw Object.assign(new Error(d.error||'Sin permiso'),{p:1});if(!r.ok)throw new Error(d.error||'Algo salió mal');return d};
const waUrl=(tel,txt)=>'https://wa.me/52'+String(tel).replace(/\D/g,'').slice(-10)+'?text='+encodeURIComponent(txt);
const fd=f=>f?new Date(f+'T12:00').toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}):'—';
const G={nuevo:'Nuevos',frecuente:'Frecuentes',vip:'VIP',riesgo:'En riesgo',perdido:'Perdidos',cumple:'Cumplen este mes',prospecto:'Prospectos'};
const GD={nuevo:'Su primera visita fue hace menos de 30 días',frecuente:'3 visitas o más',vip:'Los que más gastan',riesgo:'30 a 90 días sin venir',perdido:'Más de 90 días sin venir',cumple:'Cumpleaños este mes',prospecto:'Agregados a mano, aún sin cita'};
const pills=c=>c.grupos.map(g=>`<span class="pill ${g}">${G[g]}</span>`).join('')+(c.etiquetas?c.etiquetas.split(',').map(t=>`<span class="pill">#${esc(t)}</span>`).join(''):'');
const ini=n=>esc(((n||'?').trim()[0]||'?').toUpperCase());
let INFO={},V='inicio',FILTRO='todos',BUSCA='',CL=[];
$('#ap').href='/'+N+'/admin';
{const l=document.createElement('link');l.rel='manifest';l.href='/'+N+'/crm.json';document.head.append(l)}
function ir(v,extra){V=v;$$('#bn button').forEach(b=>b.setAttribute('aria-current',b.dataset.v===v));scrollTo({top:0});
$('#tt').textContent={inicio:'CRM',avisos:'Avisos de hoy',clientes:'Clientes',contenido:'Contenido',mas:'Más'}[v]||'CRM';
const f={inicio,avisos,clientes,contenido,mas}[v];$('#v').innerHTML='<div class="vacio">Cargando…</div>';
f(extra).catch(e=>{$('#v').innerHTML=`<div class="vacio">${esc(e.p?'Esta app es solo para el dueño de la barbería.':e.message)}</div>`})}
$$('#bn button').forEach(b=>b.onclick=()=>ir(b.dataset.v));

// ---------- Inicio
async function inicio(){const d=await J('/crm/inicio'),h=new Date().getHours(),sal=h<12?'Buenos días':h<19?'Buenas tardes':'Buenas noches';
$('#bd').textContent=d.avisos;$('#bd').hidden=!d.avisos;
const P={recordatorio:'recordatorios',gracias:'agradecimientos',extranamos:'"te extrañamos"',cumple:'cumpleaños',bienvenida:'bienvenidas',campana:'de campaña'};
$('#v').innerHTML=`<div class="vista"><p class="hola">${sal}</p><p class="sub">${esc(d.negocio)} · ${new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'})}</p>
<button class="hero-card" id="go-av"><small>MENSAJES PARA HOY</small><b>${d.avisos}</b><small>${d.avisos?Object.entries(d.porTipo).map(([k,n])=>n+' '+P[k]).join(' · '):'No tienes avisos pendientes. Todo al día.'}</small></button>
<div class="sec-t">Tus clientes · ${d.clientes} en total · ${d.regresan}% regresa</div>
<div class="segs">${['nuevo','frecuente','vip','riesgo','perdido','cumple'].map(k=>`<button class="seg-c" data-g="${k}"><b>${d.grupos[k]}</b><span>${G[k]}</span></button>`).join('')}</div>
<div class="sec-t">Contenido para redes</div>
<button class="row" id="go-ct"><div class="i"><b>${d.publicaciones.listas?d.publicaciones.listas+' lista'+(d.publicaciones.listas===1?'':'s')+' para publicar':d.publicaciones.prog?d.publicaciones.prog+' programada'+(d.publicaciones.prog===1?'':'s'):'Programa tu próxima publicación'}</b><small>Facebook e Instagram</small></div><span style="color:var(--gold)">›</span></button>
<div class="sec-t">Conexiones</div>
<button class="row" id="go-cx"><div class="i"><b>${['whatsapp','facebook','instagram'].map(k=>(d.conexiones[k]?'● ':'○ ')+{whatsapp:'WhatsApp',facebook:'Facebook',instagram:'Instagram'}[k]).join('   ')}</b><small>${Object.keys(d.conexiones).length?'Conectado: se envía y publica solo':'Sin conectar: envías con un toque y publicas a mano'}</small></div><span style="color:var(--gold)">›</span></button></div>`;
$('#go-av').onclick=()=>ir('avisos');$('#go-ct').onclick=()=>ir('contenido');$('#go-cx').onclick=()=>ir('mas','conexiones');
$$('.seg-c').forEach(b=>b.onclick=()=>{FILTRO=b.dataset.g;ir('clientes')})}

// ---------- Avisos
async function avisos(){const d=await J('/crm/bandeja'),L=d.items;$('#bd').textContent=L.length;$('#bd').hidden=!L.length;
const T=[...new Set(L.map(x=>x.titulo))];
$('#v').innerHTML=`<div class="vista">${L.length?`<p class="sub">Toca <b style="color:var(--ink);font-weight:400">Enviar</b>: se abre WhatsApp con el mensaje listo y aquí se marca como enviado.</p>`:''}
${d.whatsapp&&L.length?`<button style="width:100%;margin-bottom:18px" id="auto">Enviar todos automáticamente (${L.length})</button>`:''}
${L.length?T.map(t=>`<div class="sec-t">${esc(t)} · ${L.filter(x=>x.titulo===t).length}</div>`+L.map((x,i)=>x.titulo!==t?'':`<div class="card" data-i="${i}"><div class="cab"><b>${esc(x.nombre||'Cliente')}</b><small>${esc(x.detalle||'')}</small></div><div class="txt" contenteditable="true" spellcheck="false">${esc(x.texto)}</div>
<div class="acc mini"><a class="btn wa" href="#" data-a="env">Enviar por WhatsApp</a><button class="alt" data-a="omi">Omitir</button><button class="alt" data-a="ver">Ver cliente</button></div></div>`).join('')).join(''):'<div class="vacio">No hay avisos pendientes por hoy. Cuando tengas citas mañana, clientes que no regresan o cumpleaños, aparecerán aquí.</div>'}</div>`;
$$('#v .card').forEach(c=>{const x=L[c.dataset.i];
c.querySelector('[data-a=env]').onclick=e=>{const t=c.querySelector('.txt').innerText.trim();e.currentTarget.href=waUrl(x.tel,t);e.currentTarget.target='_blank';J('/crm/marcar',{tipo:x.tipo,ref:x.ref,tel:x.tel}).then(()=>{c.remove();toast('Marcado como enviado');cuenta()}).catch(er=>toast(er.message))};
c.querySelector('[data-a=omi]').onclick=()=>J('/crm/marcar',{tipo:x.tipo,ref:x.ref,tel:x.tel,omitir:true}).then(()=>{c.remove();cuenta()});
c.querySelector('[data-a=ver]').onclick=()=>ir('clientes',x.tel)});
const a=$('#auto');if(a)a.onclick=async()=>{if(!confirm(`¿Enviar ${L.length} mensajes por WhatsApp automáticamente?`))return;a.disabled=true;a.textContent='Enviando…';
try{const r=await J('/crm/enviar',{});toast(`Enviados: ${r.enviados}${r.errores.length?' · con error: '+r.errores.length:''}`);ir('avisos')}catch(e){toast(e.message);a.disabled=false}}}
function cuenta(){const n=$$('#v .card').length;$('#bd').textContent=n;$('#bd').hidden=!n}

// ---------- Clientes
async function clientes(tel){CL=await J('/crm/clientes');if(tel)return ficha(tel);
const cuenta=k=>k==='todos'?CL.length:CL.filter(c=>c.grupos.includes(k)).length;
$('#v').innerHTML=`<div class="vista"><div class="acc" style="align-items:center"><input id="q" placeholder="Buscar por nombre, teléfono o #etiqueta" value="${esc(BUSCA)}" style="flex:1;margin:0"><button id="nuevo" style="padding:12px 14px">+ Nuevo</button></div>
<div class="chips" style="margin-top:14px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px">${['todos','nuevo','frecuente','vip','riesgo','perdido','cumple','prospecto'].map(k=>`<button style="flex:0 0 auto" aria-pressed="${k===FILTRO}" data-g="${k}">${k==='todos'?'Todos':G[k]} · ${cuenta(k)}</button>`).join('')}</div>
${FILTRO!=='todos'?`<p style="font-size:14px;margin:-6px 0 10px">${GD[FILTRO]}. <button class="enlace" id="camp">Mandarles un mensaje</button></p>`:''}<div id="lst"></div></div>`;
const pinta=()=>{const b=BUSCA.toLowerCase().trim(),L=CL.filter(c=>(FILTRO==='todos'||c.grupos.includes(FILTRO))&&(!b||(b.startsWith('#')?c.etiquetas.split(',').includes(b.slice(1)):(c.nombre||'').toLowerCase().includes(b)||c.tel.includes(b.replace(/\D/g,'')||'×'))));
$('#lst').innerHTML=L.length?L.slice(0,200).map(c=>`<button class="row" data-t="${esc(c.tel)}"><span class="av">${ini(c.nombre)}</span><div class="i"><b>${esc(c.nombre)}</b><small>${c.visitas?`${c.visitas} visita${c.visitas===1?'':'s'} · ${mx(c.gastado)}${c.dias!==null?' · hace '+c.dias+' d':''}`:'Sin visitas aún'}${c.proxima?' · próxima '+fd(c.proxima):''}</small><div>${pills(c)}</div></div></button>`).join(''):'<div class="vacio">Sin clientes en este grupo.</div>';
$$('#lst .row').forEach(r=>r.onclick=()=>ficha(r.dataset.t))};pinta();
$('#q').oninput=e=>{BUSCA=e.target.value;pinta()};$$('.chips [data-g]').forEach(b=>b.onclick=()=>{FILTRO=b.dataset.g;clientes()});$('#nuevo').onclick=()=>nuevoCliente();
const c=$('#camp');if(c)c.onclick=()=>ir('mas','campana:'+FILTRO)}
const MES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const cumpleSel=v=>{const [m,d]=(v||'').split('-');return `<div class="acc"><select id="f-cd" style="flex:1;margin:0"><option value="">Día</option>${Array.from({length:31},(_,i)=>`<option ${+d===i+1?'selected':''}>${i+1}</option>`).join('')}</select><select id="f-cm" style="flex:2;margin:0"><option value="">Mes</option>${MES.map((x,i)=>`<option value="${i+1}" ${+m===i+1?'selected':''}>${x}</option>`).join('')}</select></div>`};
const leeCumple=()=>{const d=$('#f-cd').value,m=$('#f-cm').value;return d&&m?String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):''};
async function ficha(tel){let c;try{c=await J('/crm/cliente/'+tel)}catch(e){return toast(e.message)}scrollTo({top:0});$('#tt').textContent='Cliente';
const E={pendiente:'Pendiente',completada:'Atendida',cancelada:'Cancelada',no_llego:'No llegó'};
$('#v').innerHTML=`<div class="vista"><button class="back" id="bk">‹ Clientes</button><div class="cuenta-cab"><span class="av" style="width:56px;height:56px;font-size:26px">${ini(c.nombre)}</span><div style="flex:1;min-width:0"><b style="font:500 26px 'Cormorant Garamond',Georgia,serif">${esc(c.nombre)}</b><br><small style="color:var(--dim)">${esc(c.tel.replace(/(\d{3})(\d{3})(\d{4})/,'$1 $2 $3'))}${c.fuente?' · llegó por '+esc(c.fuente):''}</small><div>${pills(c)}</div></div></div>
<div class="acc"><a class="btn wa" href="${esc(waUrl(c.tel,'Hola '+(c.nombre||'').split(' ')[0]+', '))}" target="_blank">WhatsApp</a><a class="btn alt" href="tel:${esc(c.tel)}">Llamar</a><button class="alt" id="cp">Copiar enlace de agenda</button></div>
<div class="ficha-k"><div><b>${c.visitas}</b><span>Visitas</span></div><div><b>${mx(c.gastado)}</b><span>Ha gastado</span></div><div><b>${c.ultima?fd(c.ultima):'—'}</b><span>Última visita</span></div><div><b>${c.proxima?fd(c.proxima):'—'}</b><span>Próxima cita</span></div></div>
${c.faltas?`<p style="color:#e3a0a0;font-size:14px">Ha faltado a ${c.faltas} cita${c.faltas===1?'':'s'}.</p>`:''}
<div class="panel"><label for="f-n">Nombre</label><input id="f-n" value="${esc(c.nombre)}"><label>Cumpleaños</label>${cumpleSel(c.cumple)}<label for="f-e" style="display:block;margin-top:14px">Etiquetas (separadas por coma)</label><input id="f-e" value="${esc(c.etiquetas)}" placeholder="Ej. fade, barba, estudiante">
<label for="f-o">Notas</label><textarea id="f-o" rows="3" placeholder="Ej. Degradado bajo con 2 arriba; prefiere a Pedro">${esc(c.notas)}</textarea>
<div class="chk"><label><input type="checkbox" id="f-a" ${c.avisos?'checked':''}> Recibe avisos y promociones</label></div><button id="gd" style="width:100%">Guardar</button></div>
<div class="sec-t">Historial</div>${c.historial.length?c.historial.map(h=>`<div class="hb" style="flex-wrap:wrap"><span style="flex:1;min-width:150px;white-space:normal">${esc(h.servicio)} con ${esc(h.barbero)}<br><small style="color:var(--dim)">${fd(h.fecha)} · ${esc(h.hora)}</small></span><em>${mx(h.precio)}</em><span class="tag ${esc(h.estado)}">${E[h.estado]||esc(h.estado)}</span></div>`).join(''):'<div class="vacio">Aún no tiene citas.</div>'}
${c.envios.length?`<div class="sec-t">Mensajes enviados</div>`+c.envios.map(e=>`<div class="hb"><span style="flex:1">${esc({recordatorio:'Recordatorio',gracias:'Gracias y reseña',extranamos:'Te extrañamos',cumple:'Cumpleaños',bienvenida:'Bienvenida',campana:'Campaña'}[e.tipo]||e.tipo)}</span><em>${new Date(e.creado).toLocaleDateString('es-MX',{day:'numeric',month:'short'})} · ${e.canal==='api'?'automático':e.canal==='omitido'?'omitido':'manual'}</em></div>`).join(''):''}</div>`;
$('#bk').onclick=()=>clientes();$('#cp').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+'/'+N+'/agenda');toast('Enlace copiado')}catch(e){toast(location.origin+'/'+N+'/agenda')}};
$('#gd').onclick=async()=>{try{await J('/crm/cliente',{telefono:c.tel,nombre:$('#f-n').value,cumple:leeCumple(),etiquetas:$('#f-e').value,notas:$('#f-o').value,avisos:$('#f-a').checked});toast('Cliente guardado');ficha(c.tel)}catch(e){toast(e.message)}}}
function nuevoCliente(){$('#tt').textContent='Nuevo cliente';
$('#v').innerHTML=`<div class="vista"><button class="back" id="bk">‹ Clientes</button><p class="sub">Para quien te escribió por redes o pasó a preguntar. Le aparecerá un mensaje de bienvenida en Avisos.</p><div class="panel">
<label for="f-n">Nombre</label><input id="f-n" autocomplete="off"><label for="f-t">WhatsApp</label><input id="f-t" inputmode="tel" placeholder="10 dígitos">
<label for="f-f">¿Cómo llegó?</label><select id="f-f"><option>Instagram</option><option>Facebook</option><option>TikTok</option><option>Recomendación</option><option>Pasó por el local</option><option>Google</option><option>Otro</option></select>
<label style="display:block;margin-top:14px">Cumpleaños (opcional)</label>${cumpleSel('')}<label for="f-o" style="display:block;margin-top:14px">Notas</label><textarea id="f-o" rows="2"></textarea><button id="gd" style="width:100%">Agregar cliente</button></div></div>`;
$('#bk').onclick=()=>clientes();$('#gd').onclick=async()=>{try{const r=await J('/crm/cliente',{nombre:$('#f-n').value,telefono:$('#f-t').value,fuente:$('#f-f').value,cumple:leeCumple(),notas:$('#f-o').value,etiquetas:''});toast('Cliente agregado');ficha(r.tel)}catch(e){toast(e.message)}}}

// ---------- Contenido
const IDEAS=[
'Semana nueva, corte nuevo. ✂️ Aparta tu lugar en {negocio} en menos de un minuto: {agenda}',
'El detalle está en el degradado. Agenda con tu barbero favorito en {negocio}: {agenda}',
'¿Hace cuánto no te cortas? Si ya son más de 3 semanas, es hora. Agenda aquí: {agenda}',
'Corte + barba: sales listo para todo. Agenda en {negocio}: {agenda}',
'Hoy hay lugares disponibles. Agenda desde tu celular y llega directo a la silla: {agenda}',
'Antes y después. Así sale uno de {negocio}. 🔥 Tu turno: {agenda}',
'Conoce a nuestro equipo: barberos que cuidan cada detalle. Elige al tuyo: {agenda}',
'Fin de semana a la vista. Llega fresco: agenda tu corte en {negocio}: {agenda}',
'Clásico, fade o algo nuevo: dinos qué quieres y lo hacemos. Agenda: {agenda}',
'Gracias a todos los que nos visitaron esta semana. Los esperamos de vuelta. 🙌 {agenda}',
'Tip de barbero: para que tu fade dure más, recórtalo cada 2 o 3 semanas. Agenda: {agenda}',
'Sin filas ni esperas: agenda en línea y tu lugar queda apartado. {agenda}'];
let ID=Math.floor(Math.random()*IDEAS.length),FOTO=null;
const TAGS=' #barbería #barbershop #fade #Mérida #Yucatán';
async function contenido(){const d=await J('/crm/publicaciones'),man=new Date();man.setDate(man.getDate()+1);man.setHours(10,0,0,0);
const loc=t=>{const x=new Date(t);return x.toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'})+' · '+x.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})};
const iso=x=>new Date(x.getTime()-x.getTimezoneOffset()*6e4).toISOString().slice(0,16),grp={lista:[],programada:[],publicada:[],error:[]};d.lista.forEach(p=>(grp[p.estado]||grp.programada).push(p));
const card=p=>`<div class="card" data-id="${Number(p.id)}"><div class="post"><div class="mi" style="${p.img?`background-image:url(/i/${Number(p.img)})`:''}"></div><div class="i"><small class="est ${esc(p.estado)}">${{lista:'Lista para publicar',programada:'Programada',publicada:'Publicada',error:'Con error',procesando:'Publicando…'}[p.estado]||esc(p.estado)} · ${loc(p.cuando)} · ${esc(p.redes.replace('facebook','Facebook').replace('instagram','Instagram').replace(',',' + '))}</small><p>${esc(p.texto)}</p>${p.detalle?`<small class="est error">${esc(p.detalle)}</small>`:''}</div></div>
<div class="acc mini">${p.estado==='lista'||p.estado==='error'?`<button data-a="cp">Copiar texto</button>${p.img?`<a class="btn alt" href="/i/${Number(p.img)}" download="publicacion-${Number(p.id)}.jpg">Guardar foto</a>`:''}<a class="btn alt" href="https://www.instagram.com/" target="_blank">Instagram</a><a class="btn alt" href="https://www.facebook.com/" target="_blank">Facebook</a><button class="alt" data-a="ok">Ya la publiqué</button>`:''}${p.estado!=='publicada'?'<button class="alt" data-a="del">Borrar</button>':''}</div></div>`;
$('#v').innerHTML=`<div class="vista"><div class="panel"><h3 style="margin:0 0 4px">Nueva publicación</h3><p style="font-size:14px">${d.cuentas.length&&d.automatico?'Se publica sola a la hora que elijas en tus cuentas conectadas.':'Sin conexión: a la hora elegida te aparece lista aquí para copiar y publicar.'}</p>
<label class="ph" id="ph">Toca para elegir una foto<input type="file" accept="image/*" hidden id="fi"></label>
<label for="p-t">Texto</label><textarea id="p-t" rows="5"></textarea><div class="acc" style="margin:-6px 0 14px"><button class="alt mini-b" id="sug">Sugerir otro texto</button><button class="alt mini-b" id="tag">+ Hashtags</button></div>
<div class="chk"><label><input type="checkbox" id="r-ig" checked> Instagram</label><label><input type="checkbox" id="r-fb" checked> Facebook</label></div>
<label for="p-c">¿Cuándo?</label><input type="datetime-local" id="p-c" value="${iso(man)}"><button id="prg" style="width:100%">Programar</button></div>
${grp.lista.length||grp.error.length?`<div class="sec-t">Para publicar ahora</div>${[...grp.error,...grp.lista].map(card).join('')}`:''}
<div class="sec-t">Programadas</div>${grp.programada.length?grp.programada.reverse().map(card).join(''):'<div class="vacio">Nada programado. La constancia es lo que hace crecer tus redes: intenta una publicación diaria.</div>'}
${grp.publicada.length?`<div class="sec-t">Publicadas (30 días)</div>${grp.publicada.map(card).join('')}`:''}</div>`;
const sug=()=>{$('#p-t').value=IDEAS[ID%IDEAS.length].replace(/\{negocio\}/g,INFO.nombre||'').replace(/\{agenda\}/g,location.origin+'/'+N+'/agenda');ID++};if(!$('#p-t').value)sug();
$('#sug').onclick=sug;$('#tag').onclick=()=>{if(!$('#p-t').value.includes('#barbería'))$('#p-t').value+='\n\n'+TAGS.trim()};
if(FOTO){$('#ph').style.backgroundImage=`url(/i/${FOTO})`;$('#ph').firstChild.textContent=''}
$('#fi').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{toast('Preparando foto…');const im=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(new Error('No se pudo leer la foto'));i.src=URL.createObjectURL(f)});
let sw=im.naturalWidth,sh=im.naturalHeight,sx=0,sy=0;const ar=4/5;if(sw/sh>ar){sx=(sw-sh*ar)/2;sw=sh*ar}else{sy=(sh-sw/ar)/2;sh=sw/ar}
const c=document.createElement('canvas');c.width=1080;c.height=1350;c.getContext('2d').drawImage(im,sx,sy,sw,sh,0,0,1080,1350);let q=.86,dt=c.toDataURL('image/jpeg',q);while(dt.length>1150000&&q>.4){q-=.1;dt=c.toDataURL('image/jpeg',q)}
const r=await J('/crm/publicacion/foto',{data:dt});FOTO=r.id;$('#ph').style.backgroundImage=`url(/i/${FOTO})`;$('#ph').firstChild.textContent='';toast('Foto lista')}catch(er){toast(er.message)}};
$('#prg').onclick=async()=>{const redes=[$('#r-ig').checked&&'instagram',$('#r-fb').checked&&'facebook'].filter(Boolean);
try{await J('/crm/publicacion',{texto:$('#p-t').value,img:FOTO,redes,cuando:new Date($('#p-c').value).toISOString()});FOTO=null;toast('Publicación programada');contenido()}catch(e){toast(e.message)}};
$$('#v .card[data-id]').forEach(k=>{const p=d.lista.find(x=>x.id==k.dataset.id),b=s=>k.querySelector(`[data-a=${s}]`);
if(b('cp'))b('cp').onclick=async()=>{try{await navigator.clipboard.writeText(p.texto);toast('Texto copiado')}catch(e){toast('No se pudo copiar')}};
if(b('ok'))b('ok').onclick=()=>J('/crm/publicacion/estado',{id:p.id,estado:'publicada'}).then(()=>{toast('¡Bien! Marcada como publicada');contenido()});
if(b('del'))b('del').onclick=()=>{if(confirm('¿Borrar esta publicación?'))J('/crm/publicacion/estado',{id:p.id,estado:'borrar'}).then(contenido)}})}

// ---------- Más: plantillas, reseñas, campañas, conexiones
async function mas(sub){if(sub==='conexiones')return conexiones();if(sub&&sub.startsWith('campana:'))return campanas(sub.slice(8));if(sub==='plantillas')return plantillas();if(sub==='campanas')return campanas();
$('#v').innerHTML=`<div class="vista mas">${[['plantillas','Mensajes automáticos','Edita el texto de recordatorios, agradecimientos, cumpleaños y más'],['campanas','Campañas','Manda un mensaje a un grupo de clientes'],['conexiones','Conexiones','WhatsApp, Facebook e Instagram']].map(([k,t,s])=>`<button class="row" data-k="${k}"><div class="i"><b>${t}</b><small>${s}</small></div><span style="color:var(--gold)">›</span></button>`).join('')}
<button class="row" id="pn"><div class="i"><b>Panel de la barbería</b><small>Agenda, finanzas, página y ajustes</small></div><span style="color:var(--gold)">›</span></button>
<button class="row" id="sl"><div class="i"><b>Cerrar sesión</b><small>${esc(INFO.yo||'')}</small></div></button></div>`;
$$('.mas [data-k]').forEach(b=>b.onclick=()=>mas(b.dataset.k));$('#pn').onclick=()=>location.href='/'+N+'/admin';
$('#sl').onclick=async()=>{try{await J('/admin/salir',{})}catch(e){}location.replace('/'+N+'/entrar?volver=crm')}}
const atras=()=>`<button class="back" onclick="mas()">‹ Más</button>`;
async function plantillas(){const d=await J('/crm/plantillas');$('#tt').textContent='Mensajes automáticos';
$('#v').innerHTML=`<div class="vista">${atras()}<p class="vars">Puedes usar: <code>{nombre}</code> <code>{negocio}</code> <code>{agenda}</code> <code>{resena}</code> y en recordatorios <code>{fecha}</code> <code>{hora}</code> <code>{barbero}</code>.</p>
<div class="panel"><h3 style="margin:0 0 6px">Enlace para reseñas de Google</h3><p style="font-size:14px">Búscalo en tu Perfil de Empresa de Google → "Pedir reseñas". Se usa en el mensaje de agradecimiento.</p><input id="rs" value="${esc(d.resena)}" placeholder="https://g.page/r/…"><button id="rsg">Guardar enlace</button></div>
${d.plantillas.map((p,i)=>`<div class="panel"><h3 style="margin:0 0 6px">${esc(p.titulo)}</h3><textarea id="pl${i}" rows="4">${esc(p.texto)}</textarea><div class="acc mini"><button data-i="${i}" data-a="g">Guardar</button>${p.texto!==p.base?`<button class="alt" data-i="${i}" data-a="r">Volver al original</button>`:''}</div></div>`).join('')}</div>`;
$('#rsg').onclick=()=>J('/crm/resena',{url:$('#rs').value}).then(()=>toast('Enlace guardado')).catch(e=>toast(e.message));
$$('#v [data-a]').forEach(b=>b.onclick=()=>{const p=d.plantillas[b.dataset.i];J('/crm/plantilla',{tipo:p.tipo,texto:b.dataset.a==='r'?'':$('#pl'+b.dataset.i).value}).then(()=>{toast('Mensaje guardado');plantillas()}).catch(e=>toast(e.message))})}
async function campanas(pre){const L=await J('/crm/campanas'),CLx=await J('/crm/clientes');$('#tt').textContent='Campañas';
const n=k=>k==='todos'?CLx.filter(c=>c.avisos).length:CLx.filter(c=>c.avisos&&c.grupos.includes(k)).length;
$('#v').innerHTML=`<div class="vista">${atras()}<div class="panel"><h3 style="margin:0 0 10px">Nueva campaña</h3><label for="c-t">Nombre</label><input id="c-t" placeholder="Ej. Promo de fin de mes">
<label for="c-g">¿A quién?</label><select id="c-g">${['todos','frecuente','vip','riesgo','perdido','nuevo','cumple','prospecto'].map(k=>`<option value="${k}" ${k===pre?'selected':''}>${k==='todos'?'Todos mis clientes':G[k]} (${n(k)})</option>`).join('')}</select>
<label for="c-m">Mensaje</label><textarea id="c-m" rows="4" placeholder="Hola {nombre}, esta semana…">Hola {nombre}, </textarea><p class="vars">Usa <code>{nombre}</code> y <code>{agenda}</code>. Solo se incluye a quien acepta recibir avisos.</p>
<button id="c-ok" style="width:100%">Crear campaña</button></div>
${L.length?'<div class="sec-t">Tus campañas</div>'+L.map(c=>`<div class="card"><div class="cab"><b>${esc(c.titulo)}</b><small>${new Date(c.creado).toLocaleDateString('es-MX',{day:'numeric',month:'short'})}</small></div><p style="margin:6px 0">${c.enviados} de ${c.total} enviados${c.pendientes?` · ${c.pendientes} pendientes en Avisos`:''}</p><div class="prog"><i style="width:${c.total?Math.round(c.enviados/c.total*100):0}%"></i></div>${c.pendientes?`<div class="acc mini" style="margin-top:10px"><button class="alt" data-c="${Number(c.id)}">Cerrar campaña</button></div>`:''}</div>`).join(''):''}</div>`;
$('#c-ok').onclick=async()=>{try{const r=await J('/crm/campana',{titulo:$('#c-t').value,segmento:$('#c-g').value,texto:$('#c-m').value});toast(`Campaña creada: ${r.total} mensajes en Avisos`);ir('avisos')}catch(e){toast(e.message)}};
$$('#v [data-c]').forEach(b=>b.onclick=()=>{if(confirm('¿Cerrar la campaña? Los pendientes ya no aparecerán en Avisos.'))J('/crm/campana/cerrar',{id:+b.dataset.c}).then(()=>campanas())})}
async function conexiones(){const L=await J('/crm/conexiones');$('#tt').textContent='Conexiones';
const C={whatsapp:['WhatsApp Business (API de Meta)','phone_id','ID del número de teléfono','Envía los avisos solo, sin abrir WhatsApp. Meta cobra cada mensaje de plantilla y necesitas un número exclusivo.'],
facebook:['Página de Facebook','page_id','ID de la página','Publica tus publicaciones programadas en tu página. Puedes conectar varias páginas.'],
instagram:['Instagram profesional','ig_id','ID de la cuenta de Instagram','Publica fotos en Instagram. Debe ser cuenta profesional vinculada a una página de Facebook. Puedes conectar varias.']};
$('#v').innerHTML=`<div class="vista">${atras()}<p class="sub">Todo funciona sin conectar nada. Cuando tengas tus accesos de Meta (Meta for Developers → tu app → token de acceso), pégalos aquí y se activa solo.</p>
${Object.entries(C).map(([t,[tit,campo,lab,desc]])=>{const cs=L.filter(x=>x.tipo===t);return `<div class="panel"><h3 style="margin:0 0 4px">${cs.length?'● ':'○ '}${tit}</h3><p style="font-size:14px">${desc}</p>
${cs.map(x=>`<div class="hb"><span style="flex:1;white-space:normal">${esc(x.nombre)}<br><small style="color:var(--dim)">${esc(x.cuenta)} · token ${esc(x.token)}</small></span><button class="alt mini-b" data-b="${Number(x.id)}">Quitar</button></div>`).join('')}
<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--gold)">${cs.length?'Conectar otra':'Conectar'}</summary><label for="${t}-i" style="display:block;margin-top:12px">${lab}</label><input id="${t}-i" inputmode="numeric"><label for="${t}-k">Token de acceso</label><input id="${t}-k" type="password" autocomplete="off"><button data-t="${t}" data-c="${campo}">Probar y conectar</button></details></div>`}).join('')}
<p style="font-size:13px">Los tokens se guardan solo en tu servidor y nunca se vuelven a mostrar completos.</p></div>`;
$$('#v [data-t]').forEach(b=>b.onclick=async()=>{const t=b.dataset.t;b.disabled=true;b.textContent='Probando…';try{const r=await J('/crm/conexion',{tipo:t,[b.dataset.c]:$('#'+t+'-i').value,token:$('#'+t+'-k').value});toast('Conectado: '+r.nombre);conexiones()}catch(e){toast(e.message);b.disabled=false;b.textContent='Probar y conectar'}});
$$('#v [data-b]').forEach(b=>b.onclick=()=>{if(confirm('¿Quitar esta conexión?'))J('/crm/conexion/borrar',{id:+b.dataset.b}).then(conexiones)})}

// ---------- arranque
(async()=>{try{const me=await J('/admin/me');if(me.rol!=='dueno'){$('#v').innerHTML='<div class="vacio">Esta app es solo para el dueño de la barbería.</div>';$('#bn').hidden=true;return}
INFO={nombre:me.negocio,yo:me.nombre+' · '+me.email};document.title='CRM · '+me.negocio}catch(e){return}
const p=new URLSearchParams(location.search).get('v');ir(['avisos','clientes','contenido','mas'].includes(p)?p:'inicio')})();
