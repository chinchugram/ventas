#!/bin/sh
# Backup de la base. Los backups van a ./backups (que NO se versiona).
# Rotacion: se conservan los 30 ultimos.
set -e

mkdir -p backups
ARCHIVO="backups/ventas-$(date +%Y%m%d-%H%M%S).sql.gz"

docker compose exec -T db pg_dump -U ventas ventas | gzip > "$ARCHIVO"

echo "Backup generado: $ARCHIVO"
ls -1t backups/*.sql.gz | tail -n +31 | xargs -r rm --
echo "Rotacion aplicada (se conservan los 30 mas recientes)"
