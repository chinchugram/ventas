#!/bin/sh
# Respaldo de la base: pg_dump comprimido en $BACKUP_DIR (por defecto ./backups,
# que NO se versiona). Rotacion: se conservan los $BACKUP_CONSERVAR mas recientes (30).
#
#   npm run db:backup                    # base de la app
#   sh scripts/backup.sh otra_base       # otra base (pruebas)
#
# Funciona con el compose levantado (docker compose exec db pg_dump) o con
# pg_dump local contra DATABASE_URL. Lo usa tambien el servicio `backup` del compose.
set -e
cd "$(dirname "$0")/.."
. scripts/respaldo-comun.sh

BACKUP_CONSERVAR="${BACKUP_CONSERVAR:-30}"
case "$BACKUP_CONSERVAR" in
  ''|*[!0-9]*|0) fallar "BACKUP_CONSERVAR debe ser un entero positivo (vino '$BACKUP_CONSERVAR')" ;;
esac

detectar_modo
BASE="${1:-$(base_por_defecto)}"
validar_nombre_base "$BASE"

mkdir -p "$BACKUP_DIR"
ARCHIVO="$BACKUP_DIR/$BASE-$(date +%Y%m%d-%H%M%S).sql.gz"
TEMPORAL="$ARCHIVO.tmp"
trap 'rm -f "$TEMPORAL"' EXIT

# Primero a un temporal: sh no tiene pipefail, asi que un pg_dump que falla a
# mitad no debe quedar como un .sql.gz "valido" (ni contar para el aviso de la app).
volcar_base "$BASE" | gzip > "$TEMPORAL"
# Un volcado sano termina con esta linea; si no esta, pg_dump fallo.
gzip -dc "$TEMPORAL" | tail -n 5 | grep -q "PostgreSQL database dump complete" \
  || fallar "el volcado de '$BASE' quedo incompleto; no se guardo nada"
mv "$TEMPORAL" "$ARCHIVO"

echo "Respaldo generado ($RESPALDO_MODO): $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# Rotacion: solo archivos de esta base, del mas nuevo al mas viejo.
ls -1t "$BACKUP_DIR/$BASE"-*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_CONSERVAR + 1))" | while read -r viejo; do
  rm -f -- "$viejo"
  echo "Rotacion: borrado $viejo"
done
echo "Rotacion aplicada (se conservan los $BACKUP_CONSERVAR mas recientes de '$BASE')"
