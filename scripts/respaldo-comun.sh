# Funciones comunes de respaldo y restauracion. Se incluye con `. scripts/respaldo-comun.sh`
# desde backup.sh, restaurar.sh, probar-restauracion.sh y respaldo-programado.sh.
#
# Dos formas de llegar a Postgres:
#   - docker:  el servicio `db` del compose esta levantado; se usa `docker compose exec`.
#   - directo: pg_dump/psql del sistema contra DATABASE_URL (del entorno o de .env).
# Se elige sola; RESPALDO_MODO=docker|directo la fuerza.

# Directorio de respaldos (el mismo que lee la app en src/lib/respaldo-estado.ts).
BACKUP_DIR="${BACKUP_DIR:-./backups}"

fallar() {
  echo "ERROR: $*" >&2
  exit 1
}

# Decide el modo una sola vez y lo deja en RESPALDO_MODO.
detectar_modo() {
  if [ -n "$RESPALDO_MODO" ]; then
    case "$RESPALDO_MODO" in
      docker|directo) return 0 ;;
      *) fallar "RESPALDO_MODO debe ser 'docker' o 'directo' (vino '$RESPALDO_MODO')" ;;
    esac
  fi
  if command -v docker >/dev/null 2>&1 \
    && docker compose ps --status running --services 2>/dev/null | grep -qx db; then
    RESPALDO_MODO=docker
  else
    RESPALDO_MODO=directo
  fi
}

# URL de conexion sin parametros de Prisma (`?schema=public` lo rechaza libpq).
# Deja en URL_BASE la URL sin el nombre de la base y en BASE_ACTUAL el nombre.
cargar_url() {
  if [ -z "$DATABASE_URL" ] && [ -f .env ]; then
    DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' .env | tail -n 1 | sed 's/^["'\'']//; s/["'\'']$//')
  fi
  [ -n "$DATABASE_URL" ] || fallar "falta DATABASE_URL (en el entorno o en .env)"
  _sin_query="${DATABASE_URL%%\?*}"
  URL_BASE="${_sin_query%/*}"
  BASE_ACTUAL="${_sin_query##*/}"
  [ -n "$BASE_ACTUAL" ] || fallar "DATABASE_URL no trae nombre de base"
}

# Nombre de la base "de la app": la del contenedor o la de DATABASE_URL.
base_por_defecto() {
  if [ "$RESPALDO_MODO" = docker ]; then
    docker compose exec -T db sh -c 'echo "$POSTGRES_DB"'
  else
    cargar_url
    echo "$BASE_ACTUAL"
  fi
}

# pg_dump de una base a stdout (SQL plano, sin duenios ni permisos para que se
# pueda restaurar con cualquier usuario).
volcar_base() {
  if [ "$RESPALDO_MODO" = docker ]; then
    docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges "$1"' _ "$1"
  else
    cargar_url
    pg_dump --no-owner --no-privileges -d "$URL_BASE/$1"
  fi
}

# psql contra una base, leyendo SQL de stdin. Corta en el primer error.
psql_en() {
  _base="$1"
  shift
  if [ "$RESPALDO_MODO" = docker ]; then
    docker compose exec -T db sh -c '_b="$1"; shift; psql -U "$POSTGRES_USER" -X -q -v ON_ERROR_STOP=1 -d "$_b" "$@"' _ "$_base" "$@"
  else
    cargar_url
    psql -X -q -v ON_ERROR_STOP=1 -d "$URL_BASE/$_base" "$@"
  fi
}

# Consulta de un solo valor (sin encabezados).
valor_sql() {
  echo "$2" | psql_en "$1" -At
}

base_existe() {
  [ "$(valor_sql postgres "SELECT 1 FROM pg_database WHERE datname = '$1'")" = 1 ]
}

# Los nombres de base se interpolan en SQL: solo letras, numeros y guion bajo.
validar_nombre_base() {
  case "$1" in
    ''|*[!A-Za-z0-9_]*) fallar "nombre de base invalido: '$1' (solo letras, numeros y _)" ;;
  esac
}
