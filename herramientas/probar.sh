#!/usr/bin/env bash
# Prueba el SaaS antes de publicarlo, siempre sobre bases de datos nuevas que se borran al terminar:
#   1. reglas del repo (archivos nuevos en `npm run check`, `?v=N` subido en los .js/.css del front que cambiaron),
#   2. `npm run check` y `npm test`,
#   3. un recorrido en el navegador (página, agendar una cita, crear la cuenta del dueño, cada pestaña del panel,
#      celular) con capturas en $SALIDA.
# Uso:  bash herramientas/probar.sh                 todo
#       PRUEBAS=test/paquetes.test.js bash herramientas/probar.sh     solo esas pruebas (y el recorrido)
#       SIN_NAVEGADOR=1 bash herramientas/probar.sh                   sin el recorrido
# Base de datos: DATABASE_URL_ADMIN (un usuario que pueda crear bases). Si no está, levanta un PostgreSQL local
# de prueba (Linux con root y postgresql instalado). Nunca uses aquí la base de producción.
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
cd "$RAIZ"
SALIDA=${SALIDA:-/tmp/prueba-agenda}
mkdir -p "$SALIDA"
[ -d node_modules ] || npm ci --no-audit --no-fund --silent

echo "▸ Reglas del repo"
FALTAN=""
for f in *.js public/*.js; do
  [ "$f" = public/sw.js ] && continue
  grep -q "node --check $f" package.json || FALTAN="$FALTAN $f"
done
[ -z "$FALTAN" ] || { echo "✗ Agrega a \"check\" en package.json:$FALTAN"; exit 1; }
# Cada .js/.css del front que cambió respecto a main y se carga con ?v=N debe subir ese número (caché y sw.js).
if git rev-parse -q --verify origin/main >/dev/null; then
  SIN_V=""
  # Se lee una sola vez: con pipefail, `git diff | grep -q` falla si grep corta antes de que git termine de escribir.
  DIFF=$(git diff origin/main -- public ./*.js)
  for f in $(git diff --name-only origin/main -- 'public/*.js' 'public/*.css'; git ls-files --others --exclude-standard -- 'public/*.js' 'public/*.css'); do
    n=$(basename "$f")
    grep -rqF "$n?v=" public/*.html ./*.js || continue
    grep -qF "$n?v=" <<<"$(grep '^+' <<<"$DIFF")" || SIN_V="$SIN_V $n"
  done
  [ -z "$SIN_V" ] || { echo "✗ Cambiaste estos archivos pero no subiste su ?v=N donde se cargan:$SIN_V"; exit 1; }
fi
npm run check --silent
echo "  ok"

if [ -z "${DATABASE_URL_ADMIN:-}" ]; then
  PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$PGBIN" ] || { echo "No hay PostgreSQL: pon DATABASE_URL_ADMIN"; exit 1; }
  D=/var/tmp/barberia-pg
  if [ ! -f "$D/data/PG_VERSION" ]; then
    mkdir -p "$D" && chown postgres:postgres "$D"
    su postgres -c "$PGBIN/initdb -D $D/data -E UTF8 --locale=C.UTF-8 -U postgres -A trust" >/dev/null
  fi
  su postgres -c "$PGBIN/pg_ctl -D $D/data status" >/dev/null 2>&1 \
    || su postgres -c "$PGBIN/pg_ctl -D $D/data -o '-p 5435 -k $D' -l $D/log -w start" >/dev/null
  export DATABASE_URL_ADMIN="postgres://postgres@localhost:5435/postgres?host=$D"
fi
sql() { node -e 'const { Client } = require("pg"); const c = new Client(process.argv[1]); c.connect().then(() => c.query(process.argv[2])).then(() => c.end(), (e) => { console.error(e.message); process.exit(1); });' "$DATABASE_URL_ADMIN" "$1"; }
url_de() { node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$DATABASE_URL_ADMIN" "$1"; }
SUFIJO="$(date +%s)_$$"
BASES=()
PID=""
limpiar() {
  [ -z "$PID" ] || { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
  for b in "${BASES[@]}"; do sql "DROP DATABASE IF EXISTS $b WITH (FORCE)" || true; done
}
trap limpiar EXIT
nueva_base() { sql "CREATE DATABASE $1 ENCODING 'UTF8' TEMPLATE template0"; BASES+=("$1"); }

echo "▸ Pruebas automáticas"
nueva_base "prueba_$SUFIJO"
if [ -n "${PRUEBAS:-}" ]; then
  # shellcheck disable=SC2086
  DATABASE_URL=$(url_de "prueba_$SUFIJO") node --test --test-concurrency=1 $PRUEBAS > "$SALIDA/pruebas.log" 2>&1 || { tail -60 "$SALIDA/pruebas.log"; echo "✗ Fallaron pruebas (todo en $SALIDA/pruebas.log)"; exit 1; }
else
  DATABASE_URL=$(url_de "prueba_$SUFIJO") npm test --silent > "$SALIDA/pruebas.log" 2>&1 || { grep -A25 "^ *not ok" "$SALIDA/pruebas.log" | head -150; echo "✗ Fallaron pruebas (todo en $SALIDA/pruebas.log)"; exit 1; }
fi
grep -E "^# (tests|pass|fail|skipped)" "$SALIDA/pruebas.log" | sed 's/^# /  /'
if grep -qE "^# skipped [1-9]" "$SALIDA/pruebas.log"; then echo "✗ Hay pruebas omitidas: ¿falta DATABASE_URL?"; exit 1; fi

if [ -n "${SIN_NAVEGADOR:-}" ]; then echo "✓ Pasó todo (sin recorrido en el navegador)"; exit 0; fi
if ! node -e 'require("playwright")' 2>/dev/null; then echo "! No hay Playwright: se omite el recorrido en el navegador"; exit 0; fi
echo "▸ Recorrido en el navegador"
nueva_base "humo_$SUFIJO"
PUERTO=$((4100 + RANDOM % 800))
CLAVE=$(node -e 'console.log(require("crypto").randomBytes(9).toString("hex"))')
PORT=$PUERTO DATABASE_URL=$(url_de "humo_$SUFIJO") ADMIN_PASS=$CLAVE node server.js > "$SALIDA/servidor.log" 2>&1 &
PID=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PUERTO/health" >/dev/null && break; sleep 0.5; done
curl -sf "http://127.0.0.1:$PUERTO/health" >/dev/null || { tail -30 "$SALIDA/servidor.log"; echo "✗ El servidor no arrancó"; exit 1; }
node herramientas/recorrido.cjs "http://127.0.0.1:$PUERTO" estilo-internacional "$CLAVE" "$SALIDA" || { echo "  (registro del servidor en $SALIDA/servidor.log)"; exit 1; }
echo "✓ Pasó todo. Capturas en $SALIDA"
