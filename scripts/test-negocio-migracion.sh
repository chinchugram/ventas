#!/bin/sh
# Prueba de la migracion 20260601000000_negocio (multi-tenant F1.1), solo contra
# Postgres LOCAL. Para cada caso crea una base descartable, aplica las migraciones
# anteriores y despues la nueva:
#   (a) base vacia
#   (b) base con datos (scripts/test-negocio-datos.sql: una fila en cada tabla,
#       con comprobantes EMITIDOS cuyos triggers vuelven inmutable lo fiscal)
# En (b) compara la foto de antes y de despues (scripts/snapshot-negocio.sql):
# filas por tabla, suma de ventas.totalBruto, saldos de clientes y stockActual
# tienen que ser IDENTICOS. En ambos verifica: ninguna fila con negocioId nulo,
# un solo negocio "hl-laser", sin DEFAULT, triggers reactivados e insertar sin
# negocio falla.
#
# Uso:  NEGOCIO_TEST_URL=postgresql://ventas:ventas@localhost:5432 sh scripts/test-negocio-migracion.sh
# La migracion sobre una base con `npm run db:seed` se prueba aparte (ver
# docs/02-modelo-datos.md): el seed solo corre con el cliente de Prisma anterior.
set -eu

BASE="${NEGOCIO_TEST_URL:-postgresql://ventas:ventas@localhost:5432}"
case "$BASE" in
  *@localhost:*|*@127.0.0.1:*|*@localhost|*@127.0.0.1) ;;
  *) echo "Solo contra Postgres local (NEGOCIO_TEST_URL=$BASE)"; exit 1 ;;
esac

MIG="20260601000000_negocio"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

psqldb() { db="$1"; shift; psql "$BASE/$db" -X -q -v ON_ERROR_STOP=1 "$@"; }

crear() {
  psqldb postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" >/dev/null
  for d in $(ls "$DIR/prisma/migrations" | sort); do
    [ "$d" = "$MIG" ] && break
    [ -f "$DIR/prisma/migrations/$d/migration.sql" ] || continue
    psqldb "$1" -f "$DIR/prisma/migrations/$d/migration.sql" >/dev/null
  done
}

verificar() {
  psqldb "$1" -f "$DIR/scripts/verificar-negocio.sql"
}

echo "(a) base vacia"
crear ventas_test_negocio_vacia
psqldb ventas_test_negocio_vacia -1 -f "$DIR/prisma/migrations/$MIG/migration.sql" >/dev/null
verificar ventas_test_negocio_vacia
echo "    OK"

echo "(b) base con datos"
crear ventas_test_negocio_datos
psqldb ventas_test_negocio_datos -f "$DIR/scripts/test-negocio-datos.sql" >/dev/null
psqldb ventas_test_negocio_datos -f "$DIR/scripts/snapshot-negocio.sql" > "$TMP/antes.txt"
psqldb ventas_test_negocio_datos -1 -f "$DIR/prisma/migrations/$MIG/migration.sql" >/dev/null
psqldb ventas_test_negocio_datos -f "$DIR/scripts/snapshot-negocio.sql" > "$TMP/despues.txt"
verificar ventas_test_negocio_datos
if ! diff "$TMP/antes.txt" "$TMP/despues.txt"; then
  echo "FALLO: la foto de antes y despues difiere"; exit 1
fi
TABLAS=$(grep -c '^filas|' "$TMP/antes.txt")
echo "    OK ($TABLAS tablas comparadas; $(wc -l < "$TMP/antes.txt") lineas identicas)"

psqldb postgres -c "DROP DATABASE ventas_test_negocio_vacia" -c "DROP DATABASE ventas_test_negocio_datos" >/dev/null
echo "Migracion negocio: todo bien."
