#!/bin/sh
# Restaura un respaldo (.sql.gz de scripts/backup.sh) en una base.
#
#   sh scripts/restaurar.sh backups/ventas-20261029-031500.sql.gz            # en la base de la app
#   sh scripts/restaurar.sh backups/ventas-....sql.gz --base ventas_copia     # en otra base
#   sh scripts/restaurar.sh ARCHIVO --si-estoy-seguro                         # sin preguntar
#
# - Si la base destino no existe, se crea y se carga (no pisa nada, no pregunta).
# - Si existe, se REEMPLAZA su contenido: hay que escribir el nombre de la base
#   para confirmar, o pasar --si-estoy-seguro. Sin terminal y sin el flag, no hace nada.
# - Todo corre en una sola transaccion: si algo falla, la base queda como estaba.
set -e
cd "$(dirname "$0")/.."
. scripts/respaldo-comun.sh

ARCHIVO=""
BASE=""
SEGURO=no
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || fallar "--base necesita un nombre"; BASE="$2"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; shift ;;
    --si-estoy-seguro) SEGURO=si; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) fallar "opcion desconocida: $1" ;;
    *) [ -z "$ARCHIVO" ] || fallar "sobra el argumento '$1'"; ARCHIVO="$1"; shift ;;
  esac
done

[ -n "$ARCHIVO" ] || fallar "uso: sh scripts/restaurar.sh ARCHIVO.sql.gz [--base NOMBRE] [--si-estoy-seguro]"
[ -f "$ARCHIVO" ] || fallar "no existe el archivo '$ARCHIVO'"
gzip -t "$ARCHIVO" || fallar "'$ARCHIVO' no es un gzip valido"
gzip -dc "$ARCHIVO" | tail -n 5 | grep -q "PostgreSQL database dump complete" \
  || fallar "'$ARCHIVO' no parece un volcado completo de pg_dump"

detectar_modo
[ -n "$BASE" ] || BASE=$(base_por_defecto)
validar_nombre_base "$BASE"
[ "$BASE" != postgres ] || fallar "no se restaura sobre la base 'postgres'"

if base_existe "$BASE"; then
  if [ "$SEGURO" != si ]; then
    if [ ! -t 0 ]; then
      fallar "la base '$BASE' existe y se reemplazaria. Sin terminal no se puede confirmar: agregar --si-estoy-seguro"
    fi
    echo "ATENCION: se va a REEMPLAZAR todo el contenido de la base '$BASE' ($RESPALDO_MODO)"
    echo "con el respaldo $ARCHIVO."
    echo "Conviene frenar la app antes y hacer un respaldo del estado actual (npm run db:backup)."
    printf "Para confirmar, escribi el nombre de la base: "
    read -r CONFIRMACION
    [ "$CONFIRMACION" = "$BASE" ] || fallar "confirmacion incorrecta; no se toco nada"
  fi
else
  echo "La base '$BASE' no existe: se crea."
  echo "CREATE DATABASE \"$BASE\";" | psql_en postgres
fi

# El esquema se vacia dentro de la misma transaccion que la carga: si la carga
# falla, el DROP tambien se deshace.
echo "Restaurando $ARCHIVO en '$BASE'..."
{ echo "SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; gzip -dc "$ARCHIVO"; } | psql_en "$BASE" --single-transaction >/dev/null
echo "Restauracion terminada en '$BASE'."
