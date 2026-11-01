#!/bin/sh
# Exporta UN negocio: un archivo con solo las filas de ese `negocioId`, en orden de
# dependencias, para restaurarlo sin tocar a los demas (scripts/importar-negocio.sh).
#
#   sh scripts/exportar-negocio.sh hl-laser                      # de la base de la app
#   sh scripts/exportar-negocio.sh hl-laser --base ventas_copia  # de otra base
#   sh scripts/exportar-negocio.sh hl-laser --salida /ruta/hl.negocio.sql.gz
#
# NO reemplaza al respaldo completo (scripts/backup.sh), que sigue siendo el seguro
# principal: guarda esquema, roles de datos y todos los negocios. Esto es para devolver un
# negocio a un estado anterior sin pisar a los otros.
#
# - Necesita un rol que se salte RLS: DATABASE_URL_MIGRACIONES (ventas_migrador).
# - Todo sale de una sola transaccion REPEATABLE READ: es una foto consistente aunque la
#   app siga cargando datos.
# - Queda en $BACKUP_DIR/negocios/<slug>-<base>-AAAAMMDD-HHMMSS.negocio.sql.gz (no es un
#   respaldo completo: no cuenta para el aviso de la app ni lo toma restaurar.sh). Se
#   conservan las $BACKUP_CONSERVAR mas recientes de cada negocio y base (30).
# - Excluye las sesiones (credenciales vivas). El archivo trae, por tabla, la cantidad de
#   filas y una huella (md5) que la importacion vuelve a calcular: si no coinciden, no
#   importa nada.
set -e
cd "$(dirname "$0")/.."
. scripts/respaldo-comun.sh

SLUG=""
BASE=""
SALIDA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || fallar "--base necesita un nombre"; BASE="$2"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; shift ;;
    --salida) [ $# -ge 2 ] || fallar "--salida necesita una ruta"; SALIDA="$2"; shift 2 ;;
    --salida=*) SALIDA="${1#--salida=}"; shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    -*) fallar "opcion desconocida: $1" ;;
    *) [ -z "$SLUG" ] || fallar "sobra el argumento '$1'"; SLUG="$1"; shift ;;
  esac
done

[ -n "$SLUG" ] || fallar "uso: sh scripts/exportar-negocio.sh SLUG [--base NOMBRE] [--salida ARCHIVO]"
validar_slug "$SLUG"

BACKUP_CONSERVAR="${BACKUP_CONSERVAR:-30}"
case "$BACKUP_CONSERVAR" in
  ''|*[!0-9]*|0) fallar "BACKUP_CONSERVAR debe ser un entero positivo (vino '$BACKUP_CONSERVAR')" ;;
esac

detectar_modo
[ -n "$BASE" ] || BASE=$(base_por_defecto)
validar_nombre_base "$BASE"

exigir_rol_sin_rls "$BASE"
verificar_tablas_negocio "$BASE"

NEGOCIO_ID=$(valor_sql "$BASE" "SELECT id FROM negocios WHERE slug = '$SLUG'")
[ -n "$NEGOCIO_ID" ] || fallar "no hay un negocio con slug '$SLUG' en la base '$BASE'"

# Una fila del negocio que apunta a una fila de OTRO negocio (o de ninguno) no se podria
# importar sola. La base lo impide (triggers negocio_igual_al_padre), salvo un usuario sin
# negocio (SUPERADMIN) como autor: si pasa, la exportacion se niega en vez de fallar al
# importar.
FKS=$(valor_sql "$BASE" "
SELECT ch.relname || '|' || a.attname || '|' || cf.relname
  FROM pg_constraint c
  JOIN pg_class ch ON ch.oid = c.conrelid
  JOIN pg_class cf ON cf.oid = c.confrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND cf.relname <> 'negocios'
   AND ch.relname = ANY (string_to_array('$TABLAS_NEGOCIO', ' '))")
CONSULTA_COLGANTES=""
for _fk in $FKS; do
  _h="${_fk%%|*}"; _resto="${_fk#*|}"; _c="${_resto%%|*}"; _p="${_resto#*|}"
  CONSULTA_COLGANTES="$CONSULTA_COLGANTES
SELECT '$_h.$_c -> $_p' FROM \"$_h\" h JOIN \"$_p\" p ON p.id = h.\"$_c\" WHERE h.\"negocioId\" = '$NEGOCIO_ID' AND p.\"negocioId\" IS DISTINCT FROM '$NEGOCIO_ID'::uuid GROUP BY 1;"
done
COLGANTES=$(valor_sql "$BASE" "$CONSULTA_COLGANTES")
[ -z "$COLGANTES" ] || fallar "hay filas de '$SLUG' que apuntan a filas de otro negocio o de ninguno; no se puede exportar solo este negocio:
$COLGANTES"

# Columnas de cada tabla, en el orden del esquema: "tabla|col1, col2, ...".
COLUMNAS=$(valor_sql "$BASE" "
SELECT table_name || '|' || string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  FROM information_schema.columns WHERE table_schema = 'public' GROUP BY table_name")
columnas_de() {
  printf '%s\n' "$COLUMNAS" | grep "^$1|" | cut -d'|' -f2-
}

mkdir -p "$BACKUP_DIR/negocios"
if [ -z "$SALIDA" ]; then
  SALIDA="$BACKUP_DIR/negocios/$SLUG-$BASE-$(date +%Y%m%d-%H%M%S).negocio.sql.gz"
fi
TEMPORAL="$SALIDA.tmp"
DIR_TMP=$(mktemp -d)
trap 'rm -f "$TEMPORAL"; rm -rf "$DIR_TMP"' EXIT

# Condicion de las filas del negocio en cada tabla.
donde() {
  if [ "$1" = negocios ]; then echo "t.\"id\" = '$NEGOCIO_ID'"; else echo "t.\"negocioId\" = '$NEGOCIO_ID'"; fi
}
# Huella de las filas: md5 del texto de cada fila ordenado. Igual en la importacion.
HUELLA="coalesce(md5(string_agg(t::text, E'\\n' ORDER BY t::text)), '')"

SQL="$DIR_TMP/exportar.sql"
emitir() { printf "%s\n" "$*"; }
{
  emitir "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"
  emitir "SET TimeZone = 'UTC'; SET DateStyle = 'ISO, MDY'; SET extra_float_digits = 3;"
  emitir "SELECT '-- ventas-exportacion-negocio v1';"
  emitir "SELECT '-- negocio-id: $NEGOCIO_ID';"
  emitir "SELECT '-- negocio-slug: $SLUG';"
  emitir "SELECT '-- base-origen: $BASE';"
  emitir "SELECT '-- generado: ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');"
  emitir "SELECT '-- esquema: ' || coalesce(max(migration_name), '-') || ' ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"
  emitir "SELECT '-- tablas-no-exportadas: $TABLAS_NEGOCIO_NO_EXPORTADAS';"
  for _t in negocios $TABLAS_NEGOCIO; do
    emitir "SELECT '-- filas $_t: ' || count(*) FROM \"$_t\" t WHERE $(donde "$_t");"
  done
  cat <<'EOF'
SELECT $t$
-- Cargar SOLO con scripts/importar-negocio.sh (deshabilita los triggers de las tablas
-- durante la carga y la hace en una transaccion).
SET client_min_messages = warning;
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, MDY';
SET extra_float_digits = 3;
CREATE FUNCTION pg_temp.exigir_filas(tabla text, negocio uuid, esperadas bigint, huella text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  n bigint;
  h text;
BEGIN
  EXECUTE format(
    'SELECT count(*), coalesce(md5(string_agg(t::text, E''\n'' ORDER BY t::text)), '''') FROM %I t WHERE t.%I = $1',
    tabla, CASE WHEN tabla = 'negocios' THEN 'id' ELSE 'negocioId' END)
    INTO n, h USING negocio;
  IF n <> esperadas OR h <> huella THEN
    RAISE EXCEPTION 'Verificacion fallida en %: se esperaban % filas (huella %) y quedaron % (huella %)',
      tabla, esperadas, huella, n, h;
  END IF;
END;
$f$;
$t$;
EOF
  for _t in negocios $TABLAS_NEGOCIO; do
    _cols=$(columnas_de "$_t")
    [ -n "$_cols" ] || fallar "no se encontraron las columnas de '$_t'"
    emitir "SELECT 'COPY \"$_t\" ($_cols) FROM stdin;';"
    emitir "COPY (SELECT $_cols FROM \"$_t\" t WHERE $(donde "$_t") ORDER BY 1) TO STDOUT;"
    emitir "SELECT '\\.';"
  done
  # Verificacion al final de la carga: filas y huella de cada tabla, medidas en la misma foto.
  for _t in negocios $TABLAS_NEGOCIO; do
    emitir "SELECT format('SELECT pg_temp.exigir_filas(%L, %L, %s, %L);', '$_t', '$NEGOCIO_ID', n, h) FROM (SELECT count(*) AS n, $HUELLA AS h FROM \"$_t\" t WHERE $(donde "$_t")) x;"
  done
  emitir "SELECT '-- fin-exportacion';"
  emitir "COMMIT;"
} > "$SQL"

psql_en "$BASE" -At < "$SQL" | gzip > "$TEMPORAL"

# Un archivo sano termina con el marcador; si no esta, la exportacion fallo a mitad.
gzip -dc "$TEMPORAL" | tail -n 2 | grep -q "^-- fin-exportacion$" \
  || fallar "la exportacion de '$SLUG' quedo incompleta; no se guardo nada"
mv "$TEMPORAL" "$SALIDA"

echo "Exportacion generada ($RESPALDO_MODO): $SALIDA ($(du -h "$SALIDA" | cut -f1))"
gzip -dc "$SALIDA" | sed -n 's/^-- filas \(.*\)$/  \1/p'

# Rotacion: solo las exportaciones de este negocio y esta base en el directorio por defecto.
case "$SALIDA" in
  "$BACKUP_DIR/negocios/"*)
    ls -1t "$BACKUP_DIR/negocios/$SLUG-$BASE"-[0-9]*.negocio.sql.gz 2>/dev/null | tail -n +"$((BACKUP_CONSERVAR + 1))" | while read -r viejo; do
      rm -f -- "$viejo"
      echo "Rotacion: borrado $viejo"
    done
    ;;
esac
