# Funciones comunes de respaldo y restauracion. Se incluye con `. scripts/respaldo-comun.sh`
# desde backup.sh, restaurar.sh, probar-restauracion.sh, respaldo-programado.sh,
# exportar-negocio.sh e importar-negocio.sh.
#
# Dos formas de llegar a Postgres:
#   - docker:  el servicio `db` del compose esta levantado; se usa `docker compose exec`.
#   - directo: pg_dump/psql del sistema contra la base (ver cargar_url).
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

# Lee una variable de .env (sin comillas).
leer_env() {
  sed -n "s/^$1=//p" .env | tail -n 1 | sed 's/^["'\'']//; s/["'\'']$//'
}

# URL de conexion para respaldar y restaurar. Con varios negocios en la misma base RLS rige
# para el rol de la app (`ventas_app`): un pg_dump con ese rol no puede leer las tablas. Por
# eso se usa DATABASE_URL_MIGRACIONES (rol `ventas_migrador`, con BYPASSRLS) si esta, y
# DATABASE_URL si no (base local de un solo rol, o el servicio `backup` del compose).
# Se descarta `schema=` (lo rechaza libpq) y se conserva el resto de la query (`host=` del
# socket local, `sslmode=` de Neon). Deja en URL_BASE la URL sin el nombre de la base, en
# URL_QUERY la query que se pega despues del nombre y en BASE_ACTUAL el nombre.
cargar_url() {
  if [ -z "$DATABASE_URL_MIGRACIONES" ] && [ -f .env ]; then
    DATABASE_URL_MIGRACIONES=$(leer_env DATABASE_URL_MIGRACIONES)
  fi
  if [ -z "$DATABASE_URL" ] && [ -f .env ]; then
    DATABASE_URL=$(leer_env DATABASE_URL)
  fi
  _url="${DATABASE_URL_MIGRACIONES:-$DATABASE_URL}"
  [ -n "$_url" ] || fallar "falta DATABASE_URL_MIGRACIONES o DATABASE_URL (en el entorno o en .env)"
  _sin_query="${_url%%\?*}"
  URL_BASE="${_sin_query%/*}"
  BASE_ACTUAL="${_sin_query##*/}"
  [ -n "$BASE_ACTUAL" ] || fallar "la URL de la base no trae nombre de base"
  URL_QUERY=""
  case "$_url" in
    *\?*)
      _q=$(printf '%s' "${_url#*\?}" | tr '&' '\n' | grep -v '^schema=' | paste -sd'&' - || true)
      [ -z "$_q" ] || URL_QUERY="?$_q"
      ;;
  esac
}

# Nombre de la base "de la app": la del contenedor o la de la URL.
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
    pg_dump --no-owner --no-privileges -d "$URL_BASE/$1$URL_QUERY"
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
    psql -X -q -v ON_ERROR_STOP=1 -d "$URL_BASE/$_base$URL_QUERY" "$@"
  fi
}

# Consulta de un solo valor (sin encabezados).
valor_sql() {
  printf "%s\n" "$2" | psql_en "$1" -At
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

# Con el esquema ya restaurado (restaurar.sh), devuelve a la app los permisos que
# `pg_dump --no-privileges` no guarda: el rol `ventas_app` lee y escribe las tablas de datos
# y solo lee `negocios` (lo mismo que dan la migracion de RLS y scripts/crear-roles-db.sql).
# Si el rol no existe en este servidor no hace nada. Va en SQL para correr dentro de la misma
# transaccion que la restauracion (el volcado deja el search_path vacio: todo va calificado).
sql_permisos_app() {
  cat <<'SQL'
DO $permisos$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventas_app') THEN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('negocios', '_prisma_migrations') LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO ventas_app', t);
    END LOOP;
    IF to_regclass('public.negocios') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE ON public."negocios" TO ventas_app;
    END IF;
    IF to_regprocedure('public.usuarios_por_negocio()') IS NOT NULL THEN
      REVOKE ALL ON FUNCTION public.usuarios_por_negocio() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.usuarios_por_negocio() TO ventas_app;
    END IF;
    GRANT USAGE ON SCHEMA public TO ventas_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ventas_app;
  END IF;
END $permisos$;
SQL
}

# ─── Respaldo por negocio (exportar-negocio.sh / importar-negocio.sh) ─────────────────
# Tablas con `negocioId` que se exportan, en orden de dependencias: los padres antes que
# los hijos (la importacion respeta las FK, no las deshabilita). `verificar_tablas_negocio`
# comprueba contra el catalogo que la lista sigue completa y ordenada; si una migracion
# agrega una tabla con `negocioId`, hay que sumarla aca (hasta entonces exportar e importar
# se niegan, en vez de dejar datos afuera sin avisar).
TABLAS_NEGOCIO="usuarios listas_precios clientes materiales maquinas articulos lista_precio_items recetas receta_componentes ventas venta_items pagos compras compra_items movimientos_stock contactos_cobranza presupuestos presupuesto_items comprobantes comprobante_items comprobante_iva configuracion trabajos_produccion trabajo_tiempos trabajo_consumos"
# Con `negocioId` pero fuera de la exportacion: las sesiones son credenciales vivas, no datos
# del negocio (los usuarios vuelven a entrar). Al reemplazar un negocio se borran igual.
TABLAS_NEGOCIO_NO_EXPORTADAS="sesiones"

# Los slugs se interpolan en SQL y en nombres de archivo.
validar_slug() {
  case "$1" in
    ''|*[!A-Za-z0-9_-]*) fallar "slug invalido: '$1' (solo letras, numeros, - y _)" ;;
  esac
}

# Falla si TABLAS_NEGOCIO no coincide con la base: tablas con `negocioId` sin cubrir, tablas
# que no existen, claves foraneas a tablas fuera de la lista, o hijos antes que sus padres.
verificar_tablas_negocio() {
  _problemas=$(valor_sql "$1" "
WITH orden AS (
  SELECT t, i FROM unnest(string_to_array('$TABLAS_NEGOCIO', ' ')) WITH ORDINALITY AS x(t, i)
), fuera AS (
  SELECT unnest(string_to_array('$TABLAS_NEGOCIO_NO_EXPORTADAS', ' ')) AS t
), fk AS (
  SELECT c.conrelid::regclass::text AS hijo, c.confrelid::regclass::text AS padre
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE c.contype = 'f' AND n.nspname = 'public'
)
SELECT 'tabla con negocioId fuera de la lista: ' || c.table_name
  FROM information_schema.columns c JOIN information_schema.tables tb USING (table_schema, table_name)
 WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'negocioId'
   AND c.table_name NOT IN (SELECT t FROM orden) AND c.table_name NOT IN (SELECT t FROM fuera)
UNION ALL
SELECT 'la lista nombra una tabla que no existe: ' || o.t
  FROM orden o WHERE to_regclass(format('public.%I', o.t)) IS NULL
UNION ALL
SELECT 'clave foranea de ' || fk.hijo || ' a ' || fk.padre || ', que no esta en la lista'
  FROM fk JOIN orden h ON h.t = fk.hijo
 WHERE fk.padre <> 'negocios' AND fk.padre NOT IN (SELECT t FROM orden)
UNION ALL
SELECT 'orden: ' || fk.hijo || ' va antes que su padre ' || fk.padre
  FROM fk JOIN orden h ON h.t = fk.hijo JOIN orden p ON p.t = fk.padre
 WHERE fk.hijo <> fk.padre AND h.i < p.i;")
  [ -z "$_problemas" ] || fallar "TABLAS_NEGOCIO (scripts/respaldo-comun.sh) no coincide con la base '$1':
$_problemas"
}

# Falla si el rol de la conexion no se salta RLS: con ventas_app las politicas dejan ver y
# escribir solo un negocio (y ninguno sin contexto), asi que no podria exportar ni importar.
exigir_rol_sin_rls() {
  [ "$(valor_sql "$1" "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")" = t ] \
    || fallar "el rol de la conexion no se salta RLS (no es superusuario ni tiene BYPASSRLS). Usar DATABASE_URL_MIGRACIONES (rol ventas_migrador)."
}

# Ultima migracion de Prisma aplicada y cuantas hay: una exportacion solo se importa en una
# base con exactamente el mismo esquema.
version_esquema() {
  valor_sql "$1" "SELECT coalesce(max(migration_name), '-') || ' ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
}
