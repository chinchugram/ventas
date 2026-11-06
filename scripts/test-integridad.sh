#!/bin/sh
# Corre las pruebas de integridad de la base contra la migracion aplicada.
# Cada INSERT de test-integridad.sql tiene que fallar, salvo el caso 10.
set -e

echo "Ejecutando pruebas de integridad..."
docker compose exec -T db psql -U ventas -d ventas < scripts/test-integridad.sql
echo ""
echo "Revisar la salida: 12 errores esperados (uno por restriccion) y 1 INSERT aceptado."
