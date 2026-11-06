#!/bin/sh
# Prueba de restauracion de punta a punta: un respaldo que nunca se restauro no
# es un respaldo.
#
#   npm run test:respaldo:restaurar                       # respaldo nuevo de la base de la app
#   sh scripts/probar-restauracion.sh backups/X.sql.gz    # probar un archivo existente
#
# 1. Si no se pasa archivo, genera un respaldo con scripts/backup.sh.
# 2. Lo restaura en una base nueva <base>_restore_prueba (nunca en la de la app).
# 3. Compara conteos de las tablas clave y la suma de ventas.totalBruto entre la
#    base original y la copia.
# 4. Borra la base de prueba (tambien si algo falla).
#
# Si la app esta cargando datos mientras corre, los conteos pueden diferir por
# lo cargado despues del volcado: conviene correrla en un momento tranquilo.
set -e
cd "$(dirname "$0")/.."
. scripts/respaldo-comun.sh

detectar_modo
ORIGEN=$(base_por_defecto)
validar_nombre_base "$ORIGEN"
PRUEBA="${ORIGEN}_restore_prueba"

if [ -n "$1" ]; then
  ARCHIVO="$1"
else
  sh scripts/backup.sh "$ORIGEN"
  ARCHIVO=$(ls -1t "$BACKUP_DIR/$ORIGEN"-*.sql.gz | head -n 1)
fi
[ -f "$ARCHIVO" ] || fallar "no existe el archivo '$ARCHIVO'"

borrar_prueba() {
  echo "SET client_min_messages = warning; DROP DATABASE IF EXISTS \"$PRUEBA\";" | psql_en postgres || true
}
DIR_TMP=$(mktemp -d)
trap 'borrar_prueba; echo "Base de prueba $PRUEBA borrada."; rm -rf "$DIR_TMP"' EXIT
# La base de prueba es descartable: si quedo de una corrida anterior, se borra.
borrar_prueba

sh scripts/restaurar.sh "$ARCHIVO" --base "$PRUEBA"

CONTROL="
SELECT 'clientes', count(*)::text FROM clientes
UNION ALL SELECT 'articulos', count(*)::text FROM articulos
UNION ALL SELECT 'materiales', count(*)::text FROM materiales
UNION ALL SELECT 'ventas', count(*)::text FROM ventas
UNION ALL SELECT 'venta_items', count(*)::text FROM venta_items
UNION ALL SELECT 'pagos', count(*)::text FROM pagos
UNION ALL SELECT 'compras', count(*)::text FROM compras
UNION ALL SELECT 'movimientos_stock', count(*)::text FROM movimientos_stock
UNION ALL SELECT 'configuracion', count(*)::text FROM configuracion
UNION ALL SELECT 'restricciones CHECK', count(*)::text FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND c.contype = 'c'
UNION ALL SELECT 'indices', count(*)::text FROM pg_indexes WHERE schemaname = 'public'
UNION ALL SELECT 'migraciones aplicadas', count(*)::text FROM _prisma_migrations WHERE finished_at IS NOT NULL
UNION ALL SELECT 'suma ventas.totalBruto', COALESCE(sum(\"totalBruto\"), 0)::text FROM ventas
UNION ALL SELECT 'suma pagos.monto', COALESCE(sum(monto), 0)::text FROM pagos
UNION ALL SELECT 'stock total materiales', COALESCE(sum(\"stockActual\"), 0)::text FROM materiales;
"

valor_sql "$ORIGEN" "$CONTROL" > "$DIR_TMP/origen"
valor_sql "$PRUEBA" "$CONTROL" > "$DIR_TMP/copia"

echo ""
echo "Archivo: $ARCHIVO"
printf "%-26s %14s %14s\n" "Control" "$ORIGEN" "copia"
FALLOS=0
while IFS='|' read -r etiqueta valor; do
  copia=$(grep "^$etiqueta|" "$DIR_TMP/copia" | cut -d'|' -f2)
  if [ "$valor" = "$copia" ]; then marca="OK"; else marca="DISTINTO"; FALLOS=$((FALLOS + 1)); fi
  printf "%-26s %14s %14s  %s\n" "$etiqueta" "$valor" "$copia" "$marca"
done < "$DIR_TMP/origen"

echo ""
if [ "$FALLOS" -eq 0 ]; then
  echo "PRUEBA DE RESTAURACION OK: la copia coincide con la base original."
else
  echo "PRUEBA DE RESTAURACION FALLO: $FALLOS controles distintos."
  exit 1
fi
