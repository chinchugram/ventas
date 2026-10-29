#!/bin/sh
# Respaldo programado: lo corre el servicio `backup` de docker-compose.yml.
#
# En vez de cron, un bucle: cada hora mira si el respaldo mas reciente tiene mas
# de $BACKUP_CADA_HORAS horas (24); si es asi (o no hay ninguno), genera uno con
# scripts/backup.sh, que tambien rota. Asi, si el VPS estuvo apagado a la hora
# del respaldo, se pone al dia apenas vuelve, sin depender de la hora exacta.
#
#   sh scripts/respaldo-programado.sh            # bucle infinito
#   sh scripts/respaldo-programado.sh --una-vez  # una sola revision (para probar)
set -e
cd "$(dirname "$0")/.."
. scripts/respaldo-comun.sh

BACKUP_CADA_HORAS="${BACKUP_CADA_HORAS:-24}"
BACKUP_REVISAR_SEGUNDOS="${BACKUP_REVISAR_SEGUNDOS:-3600}"
case "$BACKUP_CADA_HORAS" in
  ''|*[!0-9]*|0) fallar "BACKUP_CADA_HORAS debe ser un entero positivo (vino '$BACKUP_CADA_HORAS')" ;;
esac

# Hay un respaldo mas nuevo que BACKUP_CADA_HORAS?
hay_respaldo_reciente() {
  [ -d "$BACKUP_DIR" ] || return 1
  [ -n "$(find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -mmin -"$((BACKUP_CADA_HORAS * 60))" | head -n 1)" ]
}

revisar() {
  if hay_respaldo_reciente; then
    echo "$(date '+%Y-%m-%d %H:%M') Hay un respaldo de menos de $BACKUP_CADA_HORAS h; nada que hacer."
  else
    echo "$(date '+%Y-%m-%d %H:%M') Generando respaldo..."
    # Un fallo (base caida, disco lleno) no corta el bucle: se reintenta en la proxima vuelta.
    sh scripts/backup.sh || echo "$(date '+%Y-%m-%d %H:%M') ERROR: el respaldo fallo; se reintenta en la proxima revision." >&2
  fi
}

if [ "$1" = "--una-vez" ]; then
  revisar
  exit 0
fi

echo "Respaldo programado: cada $BACKUP_CADA_HORAS h en $BACKUP_DIR (se revisa cada $BACKUP_REVISAR_SEGUNDOS s)."
while true; do
  revisar
  sleep "$BACKUP_REVISAR_SEGUNDOS"
done
