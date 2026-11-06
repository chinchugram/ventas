#!/bin/sh
# Ensayo del despliegue multi-tenant (VTA-21, docs/07-multitenant-despliegue.md), SOLO contra
# Postgres LOCAL. Simula "Neon" con una base local y recorre el procedimiento completo:
#
#   0. arma la base "Neon simulada" tal como esta hoy en produccion: esquema ANTERIOR al
#      multi-tenant (todas las migraciones hasta 20260501...) con datos (scripts/test-negocio-datos.sql)
#   1. respaldo completo (pg_dump, scripts/backup.sh)
#   2. copia (restaurar el respaldo en otra base) y reconciliacion copia == original
#   3. en la COPIA: migrate deploy con el migrador, reconciliacion antes/despues, roles
#      (scripts/crear-roles-db.sql), test:rls y humo con el rol de la app
#   4. en la base "real" simulada: lo mismo, en el mismo orden
#   5. vuelta atras: restaurar el respaldo del paso 1 sobre la base real simulada y reconciliar
#
# Uso (los roles ventas_app / ventas_migrador ya existen en el servidor):
#
#   ENSAYO_HOST=/tmp/pgsock7 ENSAYO_PORT=5477 sh scripts/ensayo-despliegue.sh
#
# Variables:
#   ENSAYO_HOST          socket unix (/tmp/pgsock7) o localhost. Obligatoria. NUNCA un host remoto.
#   ENSAYO_PORT          puerto (por defecto 5432)
#   ENSAYO_ADMIN_USER    superusuario local, solo para CREATE/DROP DATABASE y crear-roles-db.sql (postgres)
#   ENSAYO_BASE          nombre de la base "Neon simulada" (ventas_ensayo); la copia es <base>_copia
#   ENSAYO_CLAVE_APP / ENSAYO_CLAVE_MIGRADOR   claves de los roles (por defecto, el nombre del rol)
#   ENSAYO_CONSERVAR=1   no borra las bases ni los archivos al terminar
#
# Borra y recrea ENSAYO_BASE y ENSAYO_BASE_copia: no usar un nombre de base que importe.
set -eu

cd "$(dirname "$0")/.."
DIR="$(pwd)"

fallar() { echo "ERROR: $*" >&2; exit 1; }
paso() { printf '\n== %s\n' "$*"; }

HOST="${ENSAYO_HOST:-}"
PORT="${ENSAYO_PORT:-5432}"
ADMIN="${ENSAYO_ADMIN_USER:-postgres}"
NEON="${ENSAYO_BASE:-ventas_ensayo}"
COPIA="${NEON}_copia"
CLAVE_APP="${ENSAYO_CLAVE_APP:-ventas_app}"
CLAVE_MIG="${ENSAYO_CLAVE_MIGRADOR:-ventas_migrador}"

[ -n "$HOST" ] || fallar "falta ENSAYO_HOST (socket unix como /tmp/pgsock7, o localhost)"
case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) fallar "ENSAYO_HOST='$HOST': el ensayo corre solo contra Postgres local. Nunca contra Neon." ;;
esac
case "$NEON" in ''|*[!A-Za-z0-9_]*) fallar "ENSAYO_BASE invalida: '$NEON'" ;; esac
[ "$NEON" != postgres ] || fallar "ENSAYO_BASE no puede ser 'postgres'"

url() { # rol clave base
  case "$HOST" in
    /*) echo "postgresql://$1:$2@localhost:$PORT/$3?host=$HOST" ;;
    *) echo "postgresql://$1:$2@$HOST:$PORT/$3" ;;
  esac
}
admin() { psql -h "$HOST" -p "$PORT" -U "$ADMIN" -X -q -v ON_ERROR_STOP=1 "$@"; }

TMP="$(mktemp -d)"
CONFIG_PRISMA="$DIR/prisma.ensayo.config.ts"
limpiar() {
  rm -f "$CONFIG_PRISMA"
  if [ "${ENSAYO_CONSERVAR:-}" != 1 ]; then
    admin -d postgres -c "DROP DATABASE IF EXISTS $NEON" -c "DROP DATABASE IF EXISTS $COPIA" >/dev/null 2>&1 || true
    rm -rf "$TMP"
  else
    echo "ENSAYO_CONSERVAR=1: quedan las bases $NEON y $COPIA y los archivos en $TMP"
  fi
}
trap limpiar EXIT

MIG_NEON="$(url ventas_migrador "$CLAVE_MIG" "$NEON")"
APP_NEON="$(url ventas_app "$CLAVE_APP" "$NEON")"
MIG_COPIA="$(url ventas_migrador "$CLAVE_MIG" "$COPIA")"
APP_COPIA="$(url ventas_app "$CLAVE_APP" "$COPIA")"

# Restaura un respaldo de la base ANTERIOR al multi-tenant (sin tabla `negocios`). No se usa
# scripts/restaurar.sh: al final intenta `GRANT ... ON negocios`, que en un esquema anterior no
# existe, y como todo va en una transaccion la restauracion entera se deshace (ver
# docs/07-multitenant-despliegue.md, "Restaurar un respaldo del esquema anterior").
restaurar_previo() { # archivo urlDestino
  { echo "SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; gzip -dc "$1"; } \
    | psql "$2" -X -q -v ON_ERROR_STOP=1 --single-transaction >/dev/null
}

snapshot() { psql "$1" -X -q -v ON_ERROR_STOP=1 -f scripts/snapshot-negocio.sql; }
# La reconciliacion es la foto de scripts/snapshot-negocio.sql: filas por tabla, sumas de ventas,
# comprobantes, pagos y produccion, saldo de cada cliente y stock de cada material.
reconciliar() { # etiqueta archivoA archivoB
  if diff "$2" "$3" >"$TMP/diff.txt"; then
    echo "RECONCILIACION IDENTICA ($1): $(grep -c '^filas|' "$2") tablas, $(wc -l <"$2" | tr -d ' ') lineas"
  else
    cat "$TMP/diff.txt"; fallar "la reconciliacion ($1) difiere"
  fi
}

# ─── Prerrequisito: los dos roles existen en el servidor ────────────────────────────
paso "Roles del servidor"
psql -h "$HOST" -p "$PORT" -U "$ADMIN" -d postgres -At -c \
  "SELECT rolname, 'super=' || rolsuper, 'bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname IN ('ventas_app','ventas_migrador') ORDER BY 1"
[ "$(admin -d postgres -At -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('ventas_app','ventas_migrador')")" = 2 ] \
  || fallar "faltan los roles: crearlos antes con scripts/crear-roles-db.sql (en una base de pruebas)"

# ─── 0. La base "Neon simulada": esquema ANTERIOR al multi-tenant, con datos ──────────
paso "0. Base '$NEON' = produccion hoy (antes del multi-tenant), con datos"
admin -d postgres -c "DROP DATABASE IF EXISTS $NEON" -c "DROP DATABASE IF EXISTS $COPIA" -c "CREATE DATABASE $NEON OWNER ventas_migrador"
# Solo las migraciones anteriores a 20260601000000_negocio, aplicadas con prisma (quedan registradas
# en _prisma_migrations como en Neon).
mkdir -p "$TMP/migraciones_previas"
for d in $(ls prisma/migrations | sort); do
  [ "$d" = 20260601000000_negocio ] && break
  [ -d "prisma/migrations/$d" ] && cp -r "prisma/migrations/$d" "$TMP/migraciones_previas/$d"
done
cp prisma/migrations/migration_lock.toml "$TMP/migraciones_previas/" 2>/dev/null || true
cat >"$CONFIG_PRISMA" <<EOF
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "$TMP/migraciones_previas" },
  datasource: { url: process.env.DATABASE_URL_MIGRACIONES ?? "" },
});
EOF
DATABASE_URL_MIGRACIONES="$MIG_NEON" npx prisma migrate deploy --config "$CONFIG_PRISMA" 2>&1 | tail -3
rm -f "$CONFIG_PRISMA"
psql "$MIG_NEON" -X -q -v ON_ERROR_STOP=1 -f scripts/test-negocio-datos.sql >/dev/null
# El dueño de la fila de ejemplo tiene una clave real (en Neon ya existen las de verdad).
CLAVE_DUENO="clave-de-ensayo-1234"
HASH="$(npx tsx -e 'import { hashearClave } from "./src/lib/auth-pura"; hashearClave(process.argv[1]).then((h) => console.log(h));' "$CLAVE_DUENO")"
echo "UPDATE usuarios SET \"hashClave\" = :'hash' WHERE usuario = 'dueno';" | psql "$MIG_NEON" -X -q -v ON_ERROR_STOP=1 -v hash="$HASH"
echo "migraciones aplicadas: $(psql "$MIG_NEON" -At -c 'SELECT count(*) FROM _prisma_migrations')"
snapshot "$MIG_NEON" >"$TMP/antes_real.txt"
echo "ventas: $(grep '^filas|ventas|' "$TMP/antes_real.txt" | cut -d'|' -f3); $(grep '^suma_ventas_totalBruto' "$TMP/antes_real.txt")"
ESPERADO_VENTAS="$(grep '^filas|ventas|' "$TMP/antes_real.txt" | cut -d'|' -f3)"
ESPERADO_TOTAL="$(grep '^suma_ventas_totalBruto' "$TMP/antes_real.txt" | cut -d'|' -f2)"

# ─── 1. Respaldo completo ─────────────────────────────────────────────────────────
paso "1. Respaldo completo de '$NEON' (pg_dump)"
DATABASE_URL_MIGRACIONES="$MIG_NEON" RESPALDO_MODO=directo BACKUP_DIR="$TMP/backups" sh scripts/backup.sh "$NEON"
RESPALDO="$(ls -1t "$TMP/backups/$NEON"-*.sql.gz | head -n 1)"
echo "respaldo: $RESPALDO"

# ─── 2. Copia: se restaura el respaldo en otra base ───────────────────────────────
paso "2. Copia '$COPIA' = restaurar ese respaldo (en Neon: una rama)"
admin -d postgres -c "CREATE DATABASE $COPIA OWNER ventas_migrador"
restaurar_previo "$RESPALDO" "$MIG_COPIA"
snapshot "$MIG_COPIA" >"$TMP/antes_copia.txt"
reconciliar "copia == original, antes de migrar" "$TMP/antes_real.txt" "$TMP/antes_copia.txt"

# ─── 3. Migrar la copia ───────────────────────────────────────────────────────────
paso "3. En la COPIA: migrate deploy con el migrador"
echo "duenos de las tablas distintos del migrador: $(psql "$MIG_COPIA" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tableowner <> 'ventas_migrador'")"
DATABASE_URL="$MIG_COPIA" DATABASE_URL_MIGRACIONES="$MIG_COPIA" npm run db:deploy 2>&1 | tail -12
snapshot "$MIG_COPIA" >"$TMP/despues_copia.txt"
reconciliar "copia, antes == despues de migrar" "$TMP/antes_real.txt" "$TMP/despues_copia.txt"
psql "$MIG_COPIA" -X -q -v ON_ERROR_STOP=1 -f scripts/verificar-negocio.sql && echo "verificar-negocio.sql OK"

paso "3b. En la COPIA: roles (scripts/crear-roles-db.sql, se RE-CORRE tras migrar) y permisos"
admin -d "$COPIA" -v app_password="'$CLAVE_APP'" -v migrador_password="'$CLAVE_MIG'" -f scripts/crear-roles-db.sql
psql "$MIG_COPIA" -X -q -v ON_ERROR_STOP=1 -f scripts/verificar-roles-db.sql && echo "verificar-roles-db.sql OK"

paso "3c. En la COPIA: npm run test:rls (rol de la app + migrador)"
DATABASE_URL="$APP_COPIA" DATABASE_URL_MIGRACIONES="$MIG_COPIA" npm run test:rls 2>&1 | tail -6
snapshot "$MIG_COPIA" >"$TMP/post_rls_copia.txt"
reconciliar "copia, despues de test:rls (no deja rastro)" "$TMP/antes_real.txt" "$TMP/post_rls_copia.txt"

paso "3d. En la COPIA: humo con el rol de la app (login por negocio, cookie vieja, totales, una venta)"
DATABASE_URL="$APP_COPIA" SMOKE_NEGOCIO=hl-laser SMOKE_USUARIO=dueno SMOKE_CLAVE="$CLAVE_DUENO" \
  SMOKE_ESPERADO_VENTAS="$ESPERADO_VENTAS" SMOKE_ESPERADO_TOTAL_BRUTO="$ESPERADO_TOTAL" npx tsx scripts/smoke-despliegue.ts
snapshot "$MIG_COPIA" >"$TMP/post_humo_copia.txt"
# El login crea y cierra una sesion; la venta se deshace: la foto queda igual.
reconciliar "copia, despues del humo (no deja rastro)" "$TMP/antes_real.txt" "$TMP/post_humo_copia.txt"

# ─── 4. Repetir en la base "real" (simulada) ──────────────────────────────────────
paso "4. En la base REAL simulada '$NEON': respaldo final, migrar, roles, reconciliar, humo"
DATABASE_URL_MIGRACIONES="$MIG_NEON" RESPALDO_MODO=directo BACKUP_DIR="$TMP/backups" sh scripts/backup.sh "$NEON" | head -n 1
DATABASE_URL="$MIG_NEON" DATABASE_URL_MIGRACIONES="$MIG_NEON" npm run db:deploy 2>&1 | tail -3
snapshot "$MIG_NEON" >"$TMP/despues_real.txt"
reconciliar "real, antes == despues de migrar" "$TMP/antes_real.txt" "$TMP/despues_real.txt"
psql "$MIG_NEON" -X -q -v ON_ERROR_STOP=1 -f scripts/verificar-negocio.sql && echo "verificar-negocio.sql OK"
admin -d "$NEON" -v app_password="'$CLAVE_APP'" -v migrador_password="'$CLAVE_MIG'" -f scripts/crear-roles-db.sql
psql "$MIG_NEON" -X -q -v ON_ERROR_STOP=1 -f scripts/verificar-roles-db.sql && echo "verificar-roles-db.sql OK"
DATABASE_URL="$APP_NEON" SMOKE_NEGOCIO=hl-laser SMOKE_USUARIO=dueno SMOKE_CLAVE="$CLAVE_DUENO" \
  SMOKE_ESPERADO_VENTAS="$ESPERADO_VENTAS" SMOKE_ESPERADO_TOTAL_BRUTO="$ESPERADO_TOTAL" npx tsx scripts/smoke-despliegue.ts

# ─── 5. Vuelta atras ──────────────────────────────────────────────────────────────
paso "5. Vuelta atras: restaurar el respaldo del paso 1 sobre '$NEON'"
restaurar_previo "$RESPALDO" "$MIG_NEON"
snapshot "$MIG_NEON" >"$TMP/restaurada_real.txt"
reconciliar "real restaurada == antes de migrar" "$TMP/antes_real.txt" "$TMP/restaurada_real.txt"
echo "migraciones registradas tras la vuelta atras: $(psql "$MIG_NEON" -At -c 'SELECT count(*) FROM _prisma_migrations') (las del esquema anterior)"
echo "tabla negocios existe: $(psql "$MIG_NEON" -At -c "SELECT to_regclass('public.negocios') IS NOT NULL")"

paso "ENSAYO COMPLETO: copia y base real simulada migradas con reconciliacion identica, y vuelta atras verificada"
