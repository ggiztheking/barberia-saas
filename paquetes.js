// Paquetes y extras: lo que el cliente elige antes de reservar (base de la plantilla "Estilo Internacional").
// Un paquete es una fila de `estilos` con tipo='paquete'; los extras viven en su propia tabla.
// Las "referencias" (tipo='referencia') son fotos de estilos para inspirarse: no se pueden reservar.
const fs = require('fs'), path = require('path');

module.exports = (app, api, d) => {
  const { pool, auth, wrap, listo, PRINCIPAL } = d;
  const Q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const SEP = ' + '; // une paquete y extras en citas.servicio: "Corte y barba + Cejas"
  const lista = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);

  // Estilo Internacional: catálogo real del sitio original (se siembra una sola vez).
  const EI = {
    paquetes: [
      ['Elige tu corte', 200, 'EL CORTE QUE TE DEFINE', ['Cualquier corte'], false],
      ['Corte y barba', 350, 'UN LOOK COMPLETO', ['Cualquier corte', 'Arreglo de barba'], false],
      ['Corte Fresco', 280, 'FRESCO DE PRINCIPIO A FIN', ['Cualquier corte', 'Lavado', 'Peinado'], true],
      ['VIP Diamante', 450, 'EL RITUAL COMPLETO', ['Cualquier corte', 'Arreglo de barba', 'Lavado', 'Peinado', 'Toalla caliente'], true]],
    extras: [['Cejas', 40, false], ['Lavado', 50, true], ['Masaje relajante de cuero cabelludo', 60, false]],
    referencias: [
      ['bajo', 'Degradado bajo', 'Transición cerca de la oreja. Discreto y limpio.'], ['medio', 'Degradado medio', 'Transición a media altura. Equilibrio y definición.'],
      ['alto', 'Degradado alto', 'Transición cerca de la sien. Contraste marcado.'], ['taper', 'Taper', 'Degradado localizado en patillas y nuca.'],
      ['clasico', 'Clásico', 'Laterales con largo y raya lateral. Acabado natural.'], ['texturizado', 'Texturizado', 'Mechones definidos y movimiento en la parte superior.']],
    etiquetaReferencia: 'Referencia generada con IA', // el sitio original aclara que estas imágenes no son trabajos de la barbería
    lema: 'Tu estilo. Sin fronteras.', acerca: 'Un corte que habla por ti. Un espacio para sentirte tú.', horario: '9:30 AM a 11:00 PM' };

  const listoBD = (async () => {
    await listo;
    await pool.query('ALTER TABLE estilos ADD COLUMN IF NOT EXISTS incluye TEXT');
    await pool.query('ALTER TABLE estilos ADD COLUMN IF NOT EXISTS etiqueta TEXT');
    await pool.query('ALTER TABLE estilos ADD COLUMN IF NOT EXISTS lavado BOOLEAN DEFAULT false');
    await pool.query('ALTER TABLE negocios ADD COLUMN IF NOT EXISTS tema TEXT');
    await pool.query('ALTER TABLE negocios ADD COLUMN IF NOT EXISTS horario_texto TEXT');
    await pool.query('CREATE TABLE IF NOT EXISTS extras (id SERIAL PRIMARY KEY, negocio_id INT NOT NULL, nombre TEXT NOT NULL, precio NUMERIC(10,2) NOT NULL, lavado BOOLEAN DEFAULT false, orden INT DEFAULT 0)');
    await pool.query('CREATE INDEX IF NOT EXISTS extras_neg ON extras(negocio_id)');
    await siembraEI();
  })().catch(console.error);

  // Sin pisar nada: un paquete que ya existe por nombre (p. ej. "Corte y barba") se convierte en paquete y conserva su precio.
  async function siembraEI() {
    const n = (await Q('SELECT id FROM negocios WHERE slug=$1', [PRINCIPAL]))[0];
    if (!n) return;
    // Catálogos sembrados antes de que existiera la etiqueta: se completa sin tocar nada más.
    await pool.query("UPDATE estilos SET etiqueta=$2 WHERE negocio_id=$1 AND tipo='referencia' AND etiqueta IS NULL", [n.id, EI.etiquetaReferencia]);
    if ((await Q("SELECT 1 FROM config WHERE k='ei_catalogo'")).length) return;
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      for (const [nombre, precio, etiqueta, incluye, lavado] of EI.paquetes) {
        const r = await cl.query("UPDATE estilos SET tipo='paquete',etiqueta=$3,incluye=$4,descripcion=$5,lavado=$6 WHERE negocio_id=$1 AND nombre=$2", [n.id, nombre, etiqueta, incluye.join('\n'), incluye.join(' · '), lavado]);
        if (!r.rowCount) await cl.query("INSERT INTO estilos(negocio_id,nombre,tipo,precio,etiqueta,incluye,descripcion,lavado) VALUES($1,$2,'paquete',$3,$4,$5,$6,$7)", [n.id, nombre, precio, etiqueta, incluye.join('\n'), incluye.join(' · '), lavado]);
      }
      if (!(await cl.query('SELECT 1 FROM extras WHERE negocio_id=$1', [n.id])).rowCount)
        for (const [k, [nombre, precio, lavado]] of EI.extras.entries()) await cl.query('INSERT INTO extras(negocio_id,nombre,precio,lavado,orden) VALUES($1,$2,$3,$4,$5)', [n.id, nombre, precio, lavado, k]);
      if (!(await cl.query("SELECT 1 FROM estilos WHERE negocio_id=$1 AND tipo='referencia'", [n.id])).rowCount)
        for (const [archivo, nombre, detalle] of EI.referencias) {
          const e = (await cl.query("INSERT INTO estilos(negocio_id,nombre,tipo,precio,descripcion,etiqueta) VALUES($1,$2,'referencia',0,$3,$4) RETURNING id", [n.id, nombre, detalle, EI.etiquetaReferencia])).rows[0];
          let foto = null; try { foto = fs.readFileSync(path.join(__dirname, 'public', 'img', 'ref', archivo + '.jpg')); } catch (x) { /* sin foto, la referencia se muestra sin imagen */ }
          if (foto) await cl.query("INSERT INTO imagenes(negocio_id,tipo,ref,mime,data) VALUES($1,'servicio',$2,'image/jpeg',$3) ON CONFLICT (negocio_id,tipo,ref) DO NOTHING", [n.id, String(e.id), foto]);
        }
      await cl.query("UPDATE negocios SET tema=COALESCE(tema,'ei'), lema=COALESCE(NULLIF(lema,''),$2), acerca=COALESCE(NULLIF(acerca,''),$3), horario_texto=COALESCE(horario_texto,$4) WHERE id=$1", [n.id, EI.lema, EI.acerca, EI.horario]);
      await cl.query("INSERT INTO config(k,v) VALUES('ei_catalogo','1') ON CONFLICT (k) DO NOTHING");
      await cl.query('COMMIT');
    } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  }

  const catalogo = async id => {
    const [p, e] = await Promise.all([
      Q("SELECT e.id,e.nombre,e.precio::float AS precio,e.etiqueta,e.incluye,e.lavado,i.id AS img FROM estilos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='servicio' AND i.ref=e.id::text WHERE e.negocio_id=$1 AND e.tipo='paquete' ORDER BY e.precio,e.id", [id]),
      Q('SELECT id,nombre,precio::float AS precio,lavado FROM extras WHERE negocio_id=$1 ORDER BY orden,id', [id])]);
    return { paquetes: p.map(x => ({ ...x, incluye: lista(x.incluye) })), extras: e };
  };

  // Precio y nombre finales de una cita: el paquete o servicio elegido más sus extras. El precio siempre lo calcula el servidor.
  // Un extra de lavado no se cobra si el paquete ya lo incluye.
  const cotiza = async (negId, nombre, extrasIds) => {
    const b = (await Q("SELECT precio::float AS precio,lavado FROM estilos WHERE negocio_id=$1 AND nombre=$2 AND tipo<>'referencia' ORDER BY id LIMIT 1", [negId, String(nombre)]))[0];
    if (!b) return null;
    const ids = [...new Set((Array.isArray(extrasIds) ? extrasIds : []).map(Number).filter(x => Number.isInteger(x) && x > 0))].slice(0, 10);
    const ex = ids.length ? (await Q('SELECT id,nombre,precio::float AS precio,lavado FROM extras WHERE negocio_id=$1 AND id=ANY($2) ORDER BY id', [negId, ids])).filter(x => !(x.lavado && b.lavado)) : [];
    return { precio: Math.round((b.precio + ex.reduce((a, x) => a + x.precio, 0)) * 100) / 100, servicio: String(nombre) + ex.map(x => SEP + x.nombre).join('') };
  };

  const referencias = id => Q("SELECT e.id,e.nombre,e.descripcion,e.etiqueta,i.id AS img FROM estilos e LEFT JOIN imagenes i ON i.negocio_id=e.negocio_id AND i.tipo='servicio' AND i.ref=e.id::text WHERE e.negocio_id=$1 AND e.tipo='referencia' ORDER BY e.id", [id]);
  // Para barberías sin paquetes: sus servicios hacen de paquetes en la plantilla (primero combos y barba, luego los cortes), máximo 4.
  const servicios = id => Q("SELECT id,nombre,precio::float AS precio,descripcion FROM estilos WHERE negocio_id=$1 AND tipo<>'referencia' ORDER BY (tipo='servicio') DESC,id LIMIT 4", [id]);

  api.get('/paquetes', wrap(async (q, s) => s.json(await catalogo(q.neg.id))));

  const texto = (v, max) => String(v ?? '').trim().slice(0, max);
  const precioOk = v => { const p = Math.round(Number(v) * 100) / 100; return p >= 0 && p <= 100000 ? p : null; };
  api.post('/admin/paquete', auth, wrap(async (q, s) => {
    const b = q.body, nombre = texto(b.nombre, 60), precio = precioOk(b.precio), incluye = (Array.isArray(b.incluye) ? b.incluye : lista(b.incluye)).map(x => texto(x, 60)).filter(Boolean).slice(0, 8);
    if (!nombre || nombre.includes(SEP) || precio === null || !incluye.length) return s.status(400).json({ error: 'Escribe el nombre, el precio y lo que incluye (sin el signo +)' });
    const campos = [nombre, precio, texto(b.etiqueta, 40).toUpperCase(), incluye.join('\n'), incluye.join(' · '), !!b.lavado];
    if (b.id) {
      const r = await pool.query("UPDATE estilos SET nombre=$3,precio=$4,etiqueta=$5,incluye=$6,descripcion=$7,lavado=$8 WHERE id=$1 AND negocio_id=$2 AND tipo='paquete' RETURNING id", [b.id, q.neg.id, ...campos]);
      return r.rowCount ? s.json({ id: r.rows[0].id }) : s.status(404).json({ error: 'No encontramos ese paquete' });
    }
    if ((await pool.query("SELECT COUNT(*)::int c FROM estilos WHERE negocio_id=$1 AND tipo='paquete'", [q.neg.id])).rows[0].c >= 12) return s.status(400).json({ error: 'Llegaste al límite de 12 paquetes' });
    if ((await pool.query('SELECT 1 FROM estilos WHERE negocio_id=$1 AND nombre=$2', [q.neg.id, nombre])).rowCount) return s.status(409).json({ error: 'Ya tienes un servicio con ese nombre' });
    s.json({ id: (await pool.query("INSERT INTO estilos(negocio_id,nombre,precio,etiqueta,incluye,descripcion,lavado,tipo) VALUES($1,$2,$3,$4,$5,$6,$7,'paquete') RETURNING id", [q.neg.id, ...campos])).rows[0].id });
  }));
  api.post('/admin/extra', auth, wrap(async (q, s) => {
    const b = q.body, nombre = texto(b.nombre, 60), precio = precioOk(b.precio);
    if (!nombre || nombre.includes(SEP) || precio === null) return s.status(400).json({ error: 'Escribe el nombre y un precio válido (sin el signo +)' });
    if (b.id) {
      const r = await pool.query('UPDATE extras SET nombre=$3,precio=$4,lavado=$5 WHERE id=$1 AND negocio_id=$2 RETURNING id', [b.id, q.neg.id, nombre, precio, !!b.lavado]);
      return r.rowCount ? s.json({ id: r.rows[0].id }) : s.status(404).json({ error: 'No encontramos ese extra' });
    }
    if ((await pool.query('SELECT COUNT(*)::int c FROM extras WHERE negocio_id=$1', [q.neg.id])).rows[0].c >= 20) return s.status(400).json({ error: 'Llegaste al límite de 20 extras' });
    s.json({ id: (await pool.query('INSERT INTO extras(negocio_id,nombre,precio,lavado,orden) VALUES($1,$2,$3,$4,(SELECT COALESCE(MAX(orden),0)+1 FROM extras WHERE negocio_id=$1)) RETURNING id', [q.neg.id, nombre, precio, !!b.lavado])).rows[0].id });
  }));
  // Tema de la página pública: 'ei' (Estilo Internacional, claro) o 'oscuro' (el anterior, que se guarda como NULL).
  const TEMAS = [['oscuro', 'Oscuro y dorado'], ['ei', 'Estilo Internacional (claro)']];
  api.get('/admin/tema', auth, (q, s) => s.json({ tema: q.neg.tema || 'oscuro', temas: TEMAS.map(([id, nombre]) => ({ id, nombre })) }));
  api.post('/admin/tema', auth, wrap(async (q, s) => {
    if (!TEMAS.some(([id]) => id === q.body.tema)) return s.status(400).json({ error: 'Ese tema no existe' });
    await pool.query('UPDATE negocios SET tema=$2 WHERE id=$1', [q.neg.id, q.body.tema === 'oscuro' ? null : q.body.tema]);
    s.json({ ok: true });
  }));
  api.post('/admin/extra/borrar', auth, wrap(async (q, s) => { await pool.query('DELETE FROM extras WHERE id=$1 AND negocio_id=$2', [q.body.id, q.neg.id]); s.json({ ok: true }); }));

  return { catalogo, cotiza, referencias, servicios, listo: listoBD, SEP };
};
