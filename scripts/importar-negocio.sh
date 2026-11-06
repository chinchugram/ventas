#!/bin/sh
# Importa UN negocio exportado con scripts/exportar-negocio.sh, sin tocar a los demas.
#
#   sh scripts/importar-negocio.sh backups/negocios/hl-laser-ventas-2026....negocio.sql.gz --base ventas_aparte
#   sh scripts/importar-negocio.sh ARCHIVO --base ventas --reemplazar          # pisa SOLO ese negocio
#   sh scripts/importar-negocio.sh ARCHIVO --base ventas --reemplazar --si-estoy-seguro
#
# Politica (nunca sobreescribir datos vivos de otros negocios):
#   - --base es obligatorio: no hay base "por defecto" para importar.
#   - La base destino tiene que existir y tener el MISMO esquema que la de origen (misma
#     ultima migracion de Prisma y misma cantidad). Para una base limpia: crearla y correr
#     `npm run db:deploy` contra ella; no se crea ni se migra aca.
#   - (Toda base recien migrada trae un negocio "hl-laser" VACIO, el de la migracion inicial:
#     sin una sola fila de datos se descarta solo y se importa en su lugar.)
#   - Si el negocio (mismo id o mismo slug) ya esta en la base con datos, no importa nada. Con
#     --reemplazar borra SOLO las filas de ese negocio (por `negocioId`) y las carga de
#     nuevo; pide escribir el slug para confirmar (o --si-estoy-seguro; sin terminal y sin
#     el flag, no hace nada). Las sesiones del negocio tambien se borran: sus usuarios
#     vuelven a entrar.
#   - Recomendado para recuperar un negocio de produccion: restaurar el respaldo completo en
#     una base aparte (scripts/restaurar.sh --base ...), exportar de ahi el negocio
#     (exportar-negocio.sh) e importarlo en la base viva con --reemplazar.
# - Todo corre en una sola transaccion: si algo falla (incluida la verificacion final de
#   filas y huella de cada tabla), la base queda como estaba.
# - Necesita un rol que se salte RLS (DATABASE_URL_MIGRACIONES) y dueno de las tablas: durante
#   la carga se deshabilitan los triggers de usuario de las tablas del negocio (los de
#   comprobantes solo admiten altas PENDIENTES) y se vuelven a habilitar antes de confirmar.
#   Eso toma un candado exclusivo breve sobre esas tablas: conviene hacerlo con la app frenada.
set -e
cd "$(dirname "$0")/.."
. scripts/respaldo-comun.sh

ARCHIVO=""
BASE=""
REEMPLAZAR=no
SEGURO=no
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || fallar "--base necesita un nombre"; BASE="$2"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; shift ;;
    --reemplazar) REEMPLAZAR=si; shift ;;
    --si-estoy-seguro) SEGURO=si; shift ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    -*) fallar "opcion desconocida: $1" ;;
    *) [ -z "$ARCHIVO" ] || fallar "sobra el argumento '$1'"; ARCHIVO="$1"; shift ;;
  esac
done

[ -n "$ARCHIVO" ] || fallar "uso: sh scripts/importar-negocio.sh ARCHIVO.negocio.sql.gz --base NOMBRE [--reemplazar] [--si-estoy-seguro]"
[ -n "$BASE" ] || fallar "falta --base: la importacion nunca elige sola la base destino"
[ -f "$ARCHIVO" ] || fallar "no existe el archivo '$ARCHIVO'"
gzip -t "$ARCHIVO" || fallar "'$ARCHIVO' no es un gzip valido"
[ "$(gzip -dc "$ARCHIVO" | head -n 1)" = "-- ventas-exportacion-negocio v1" ] \
  || fallar "'$ARCHIVO' no es una exportacion de scripts/exportar-negocio.sh (un respaldo completo se restaura con restaurar.sh)"
gzip -dc "$ARCHIVO" | tail -n 2 | grep -q "^-- fin-exportacion$" \
  || fallar "'$ARCHIVO' esta incompleto (le falta el final de la exportacion)"

encabezado() {
  gzip -dc "$ARCHIVO" | sed -n "s/^-- $1: //p" | head -n 1
}
NEGOCIO_ID=$(encabezado negocio-id)
SLUG=$(encabezado negocio-slug)
ESQUEMA=$(encabezado esquema)
[ -n "$NEGOCIO_ID" ] && [ -n "$SLUG" ] && [ -n "$ESQUEMA" ] || fallar "'$ARCHIVO' no trae el encabezado completo"
validar_slug "$SLUG"
case "$NEGOCIO_ID" in
  *[!0-9a-f-]*|'') fallar "id de negocio invalido en el archivo: '$NEGOCIO_ID'" ;;
esac

detectar_modo
validar_nombre_base "$BASE"
[ "$BASE" != postgres ] || fallar "no se importa sobre la base 'postgres'"
base_existe "$BASE" || fallar "la base '$BASE' no existe. Crearla vacia y aplicar las migraciones (npm run db:deploy) antes de importar."

exigir_rol_sin_rls "$BASE"
verificar_tablas_negocio "$BASE"

ESQUEMA_DESTINO=$(version_esquema "$BASE")
[ "$ESQUEMA_DESTINO" = "$ESQUEMA" ] \
  || fallar "el esquema de '$BASE' ($ESQUEMA_DESTINO) no es el de la exportacion ($ESQUEMA). Aplicar las migraciones que faltan (npm run db:deploy) o exportar desde una base con el mismo esquema."

TODAS="$TABLAS_NEGOCIO $TABLAS_NEGOCIO_NO_EXPORTADAS"
INVERSA=""
for _t in $TODAS; do INVERSA="$_t $INVERSA"; done

# Negocio ya presente: mismo id o mismo slug. Toda base recien migrada trae un negocio
# "hl-laser" VACIO (lo crea la migracion `negocio`, con un id al azar por base, y la migracion
# inicial le deja la configuracion por defecto): ese cascaron no tiene datos que cuidar y se
# reemplaza solo. Con una sola fila de datos (o una configuracion distinta de la inicial) ya
# no es un cascaron y hace falta --reemplazar.
CONFIG_INICIAL="('nombreNegocio', 'Mi Negocio'), ('moneda', 'ARS'), ('ivaDefault', '21'), ('costoHoraManoObra', '0'), ('margenObjetivo', '40')"
EXISTENTES=$(valor_sql "$BASE" "SELECT id || ' ' || slug FROM negocios WHERE id = '$NEGOCIO_ID' OR slug = '$SLUG'")
CASCARON=no
if [ -n "$EXISTENTES" ]; then
  _filas=$(valor_sql "$BASE" "
SELECT count(*) FROM (
$(for _t in $TODAS; do
  if [ "$_t" = configuracion ]; then _extra="AND (\"clave\", \"valor\") NOT IN (VALUES $CONFIG_INICIAL)"; else _extra=""; fi
  echo "SELECT 1 FROM \"$_t\" WHERE \"negocioId\" IN (SELECT id FROM negocios WHERE id = '$NEGOCIO_ID' OR slug = '$SLUG') $_extra UNION ALL"
done)
SELECT 1 WHERE false) x")
  if [ "$_filas" = 0 ]; then
    CASCARON=si
  else
    if [ "$REEMPLAZAR" != si ]; then
      fallar "el negocio '$SLUG' ya esta en la base '$BASE' con datos ($EXISTENTES); no se importa nada. Importar en una base aparte o, para reemplazar SOLO ese negocio, usar --reemplazar."
    fi
    # Un slug igual con otro id es OTRO negocio: reemplazarlo no es "volver al estado anterior".
    [ "$(valor_sql "$BASE" "SELECT count(*) FROM negocios WHERE id = '$NEGOCIO_ID'")" = 1 ] \
      || fallar "en '$BASE' el slug '$SLUG' pertenece a otro negocio ($EXISTENTES); no se reemplaza"
    if [ "$SEGURO" != si ]; then
      if [ ! -t 0 ]; then
        fallar "se reemplazarian las filas del negocio '$SLUG' en '$BASE'. Sin terminal no se puede confirmar: agregar --si-estoy-seguro"
      fi
      echo "ATENCION: se van a BORRAR y volver a cargar todas las filas del negocio '$SLUG' en la base '$BASE' ($RESPALDO_MODO)."
      echo "Los demas negocios no se tocan. Conviene frenar la app y hacer antes un respaldo completo (npm run db:backup)."
      printf "Para confirmar, escribi el slug del negocio: "
      read -r CONFIRMACION
      [ "$CONFIRMACION" = "$SLUG" ] || fallar "confirmacion incorrecta; no se toco nada"
    fi
  fi
fi

DIR_TMP=$(mktemp -d)
trap 'rm -rf "$DIR_TMP"' EXIT

# Antes de la carga: triggers de usuario fuera y, si se reemplaza, borrado de ese negocio
# (hijos primero). Las FK de una tabla a si misma se anulan antes de borrar.
{
  for _t in $TODAS; do printf 'ALTER TABLE "%s" DISABLE TRIGGER USER;\n' "$_t"; done
  if [ "$CASCARON" = si ]; then
    printf 'DELETE FROM "configuracion" WHERE "negocioId" IN (SELECT id FROM negocios WHERE id = '"'"'%s'"'"' OR slug = '"'"'%s'"'"');\n' "$NEGOCIO_ID" "$SLUG"
    printf 'DELETE FROM "negocios" WHERE "id" = '"'"'%s'"'"' OR "slug" = '"'"'%s'"'"';\n' "$NEGOCIO_ID" "$SLUG"
  elif [ -n "$EXISTENTES" ]; then
    valor_sql "$BASE" "
SELECT format('DO \$a\$ BEGIN LOOP DELETE FROM %1\$I t WHERE t.\"negocioId\" = ''$NEGOCIO_ID'' AND NOT EXISTS (SELECT 1 FROM %1\$I h WHERE h.%2\$I = t.id); EXIT WHEN NOT FOUND; END LOOP; END \$a\$;', ch.relname, a.attname)
  FROM pg_constraint c
  JOIN pg_class ch ON ch.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND c.conrelid = c.confrelid AND ch.relname = ANY (string_to_array('$TODAS', ' '))"
    for _t in $INVERSA; do printf 'DELETE FROM "%s" WHERE "negocioId" = '"'"'%s'"'"';\n' "$_t" "$NEGOCIO_ID"; done
    printf 'DELETE FROM "negocios" WHERE "id" = '"'"'%s'"'"';\n' "$NEGOCIO_ID"
  fi
} > "$DIR_TMP/antes.sql"


{
  for _t in $TODAS; do printf 'ALTER TABLE "%s" ENABLE TRIGGER USER;\n' "$_t"; done
} > "$DIR_TMP/despues.sql"

echo "Importando el negocio '$SLUG' en '$BASE' ($RESPALDO_MODO)..."
{
  cat "$DIR_TMP/antes.sql"
  gzip -dc "$ARCHIVO"
  cat "$DIR_TMP/despues.sql"
} | psql_en "$BASE" --single-transaction >/dev/null
echo "Importacion terminada: negocio '$SLUG' en '$BASE'. Filas cargadas (verificadas con huella):"
gzip -dc "$ARCHIVO" | sed -n 's/^-- filas \(.*\)$/  \1/p'
if [ "$CASCARON" = si ]; then
  echo "La base tenia el negocio '$SLUG' vacio (el de la migracion inicial): se reemplazo por el importado."
elif [ -n "$EXISTENTES" ]; then
  echo "Se reemplazo el negocio existente; los demas negocios no se tocaron."
fi
