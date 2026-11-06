#!/bin/sh
# Prueba de la migracion 20260601010000_unicos_por_negocio (multi-tenant F1.2), solo
# contra Postgres LOCAL. Crea una base descartable, aplica TODAS las migraciones y
# corre scripts/test-unicos-negocio.sql (INSERT directo: dos negocios con lo mismo
# no chocan, los duplicados dentro de un negocio siguen rechazados, un hijo de otro
# negocio que su padre lo rechaza la base). Despues borra la base.
#
# Conexion: variables estandar de psql (PGHOST, PGPORT, PGUSER). Ejemplo con un
# Postgres en un socket propio:
#   PGHOST=/tmp/pgsock7 PGPORT=5477 PGUSER=postgres sh scripts/test-unicos-negocio.sh
set -eu

case "${PGHOST:-localhost}" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Solo contra Postgres local (PGHOST=$PGHOST)"; exit 1 ;;
esac

DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="ventas_test_unicos_negocio"
psqldb() { db="$1"; shift; psql -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; }

psqldb postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
trap 'psqldb postgres -c "DROP DATABASE IF EXISTS '"$DB"'" >/dev/null 2>&1 || true' EXIT

for d in $(ls "$DIR/prisma/migrations" | sort); do
  [ -f "$DIR/prisma/migrations/$d/migration.sql" ] || continue
  psqldb "$DB" -1 -f "$DIR/prisma/migrations/$d/migration.sql" >/dev/null
done

SALIDA="$(mktemp)"
trap 'rm -f "$SALIDA"; psqldb postgres -c "DROP DATABASE IF EXISTS '"$DB"'" >/dev/null 2>&1 || true' EXIT
if ! psqldb "$DB" -f "$DIR/scripts/test-unicos-negocio.sql" > "$SALIDA" 2>&1; then
  cat "$SALIDA"
  echo "FALLO: unicos por negocio"; exit 1
fi
sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /' "$SALIDA"
echo "Unicos por negocio: todo bien."
