#!/bin/sh
# Prueba del respaldo por negocio (scripts/exportar-negocio.sh e importar-negocio.sh):
#
#   npm run test:respaldo:negocio          # (sh scripts/test-respaldo-negocio.sh)
#
# Arma dos bases descartables a partir del esquema real (prisma migrate deploy):
#   <base>_negocio_prueba   con DOS negocios: hl-laser (el del seed, mas facturas y una nota
#                           de credito) y "otro-negocio" (una copia modificada, para que no
#                           sea identico) .
#   <base>_negocio_destino  vacia (solo el esquema).
# y comprueba:
#   1. Exportar A e importarlo en una base vacia reproduce exactamente sus datos (filas y
#      huella md5 de cada tabla, totales de ventas/pagos/stock).
#   2. Importar A (con y sin --reemplazar) no modifica ni una fila de B.
#   3. Las negativas: negocio ya presente, archivo truncado o de otro esquema, falta --base,
#      rol que no se salta RLS, restaurar.sh rechaza una exportacion de negocio.
#   4. El respaldo completo sigue restaurando y la app (`ventas_app`) conserva sus permisos.
#
# Requisitos: pg_dump/psql, node (prisma migrate deploy y el seed), y un rol que pueda CREAR
# BASES. Si DATABASE_URL_MIGRACIONES (ventas_migrador) no puede, pasar en RESPALDO_ADMIN_URL
# la URL de un superusuario: se usa solo para CREATE/DROP DATABASE; las exportaciones e
# importaciones corren con el rol de DATABASE_URL_MIGRACIONES. RESPALDO_URL_APP (opcional):
# URL con el rol ventas_app, para probar que exportar se niega con un rol sujeto a RLS.
# Nunca toca la base de la app: solo crea y borra sus dos bases de prueba.
set -e
cd "$(dirname "$0")/.."
. scripts/respaldo-comun.sh

detectar_modo
[ "$RESPALDO_MODO" = directo ] || fallar "esta prueba corre en modo directo (RESPALDO_MODO=directo)"
ORIGEN=$(base_por_defecto)
validar_nombre_base "$ORIGEN"
cargar_url
PRUEBA="${ORIGEN}_negocio_prueba"
DESTINO="${ORIGEN}_negocio_destino"
COPIA="${ORIGEN}_negocio_copia"
ROL=$(valor_sql "$ORIGEN" "SELECT current_user")

DIR_TMP=$(mktemp -d)
BACKUP_DIR="$DIR_TMP/backups"
export BACKUP_DIR
mkdir -p "$BACKUP_DIR"

url_de() { echo "$URL_BASE/$1$URL_QUERY"; }

admin_sql() {
  if [ -n "$RESPALDO_ADMIN_URL" ]; then
    psql -X -q -v ON_ERROR_STOP=1 -d "$RESPALDO_ADMIN_URL"
  else
    psql_en postgres
  fi
}
borrar_bases() {
  for _b in "$PRUEBA" "$DESTINO" "$COPIA"; do
    echo "SET client_min_messages = warning; DROP DATABASE IF EXISTS \"$_b\";" | admin_sql || true
  done
}
trap 'borrar_bases; rm -rf "$DIR_TMP"' EXIT
borrar_bases

FALLOS=0
comprobar() { # etiqueta, 0|1 (1 = ok)
  if [ "$2" = 1 ]; then echo "OK    $1"; else echo "FALLA $1"; FALLOS=$((FALLOS + 1)); fi
}
# Ejecuta un comando que DEBE fallar; guarda su salida en $DIR_TMP/salida.
debe_fallar() { # etiqueta, mensaje esperado (fragmento), comando...
  _et="$1"; _msg="$2"; shift 2
  if "$@" > "$DIR_TMP/salida" 2>&1; then
    comprobar "$_et (debia fallar)" 0
  elif grep -q "$_msg" "$DIR_TMP/salida"; then
    comprobar "$_et" 1
  else
    echo "  salida: $(cat "$DIR_TMP/salida")"
    comprobar "$_et (fallo, pero no con '$_msg')" 0
  fi
}

crear_base() {
  echo "CREATE DATABASE \"$1\" OWNER \"$ROL\";" | admin_sql
  DATABASE_URL="$(url_de "$1")" DATABASE_URL_MIGRACIONES="$(url_de "$1")" npx prisma migrate deploy >/dev/null
}

echo "--- Armado: dos negocios en '$PRUEBA' y una base vacia '$DESTINO' ---"
crear_base "$PRUEBA"
crear_base "$DESTINO"
DATABASE_URL="$(url_de "$PRUEBA")" DATABASE_URL_MIGRACIONES="$(url_de "$PRUEBA")" npx tsx prisma/seed.ts >/dev/null
SLUG_A=hl-laser
SLUG_B=otro-negocio

# Facturas C emitidas (con sus lineas) sobre dos ventas de A y una nota de credito: ejercita los
# triggers de comprobantes, que la importacion tiene que saltear. Despues clona A como B.
{
  cat <<EOF
BEGIN;
DO \$fact\$
DECLARE
  v RECORD;
  c uuid;
  n int := 0;
  nc uuid;
BEGIN
  FOR v IN SELECT id, "negocioId", "totalBruto" FROM ventas
            WHERE "negocioId" = (SELECT id FROM negocios WHERE slug = '$SLUG_A') AND estado <> 'ANULADA' ORDER BY id LIMIT 2 LOOP
    n := n + 1;
    c := gen_random_uuid();
    INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
      "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
      "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
      "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn")
    VALUES (c, v."negocioId", 'SIMULADO', 'FACTURA_C', 11, 1, n, current_date, 'PENDIENTE',
      'Emisor de prueba', '20333333334', 'MONOTRIBUTO', 'Calle 1', '2020-03-02',
      'Consumidor final', 99, '0', 'CONSUMIDOR_FINAL', v."totalBruto", 0, v."totalBruto", v.id, now());
    INSERT INTO comprobante_items (id, "negocioId", "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto")
    VALUES (gen_random_uuid(), v."negocioId", c, 1, 'Linea', 1, v."totalBruto", 0, v."totalBruto", 0, v."totalBruto");
    UPDATE comprobantes SET estado = 'EMITIDO', cae = '1234567890123' || n, "caeVencimiento" = current_date + 10 WHERE id = c;
    IF n = 1 THEN
      nc := gen_random_uuid();
      INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
        "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
        "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
        "importeNeto", "importeIva", "importeTotal", "ventaId", "comprobanteAsociadoId", "actualizadoEn")
      VALUES (nc, v."negocioId", 'SIMULADO', 'NOTA_CREDITO_C', 13, 1, 1, current_date, 'PENDIENTE',
        'Emisor de prueba', '20333333334', 'MONOTRIBUTO', 'Calle 1', '2020-03-02',
        'Consumidor final', 99, '0', 'CONSUMIDOR_FINAL', v."totalBruto", 0, v."totalBruto", v.id, c, now());
      INSERT INTO comprobante_items (id, "negocioId", "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto")
      VALUES (gen_random_uuid(), v."negocioId", nc, 1, 'Anulacion', 1, v."totalBruto", 0, v."totalBruto", 0, v."totalBruto");
      UPDATE comprobantes SET estado = 'EMITIDO', cae = '12345678901299', "caeVencimiento" = current_date + 10 WHERE id = nc;
    END IF;
  END LOOP;
END \$fact\$;
COMMIT;
EOF
} | psql_en "$PRUEBA" >/dev/null

# B = copia de A con otros ids (todas las columnas uuid se remapean, negocioId pasa a B). Se
# deshabilitan los triggers de usuario solo para clonar (los de comprobantes no admiten altas
# EMITIDO). Despues B se hace distinto de A: mas stock, menos pagos, otra configuracion.
{
  echo "BEGIN;"
  for _t in $TABLAS_NEGOCIO; do echo "ALTER TABLE \"$_t\" DISABLE TRIGGER USER;"; done
  cat <<EOF
INSERT INTO negocios (id, nombre, slug, activo, "actualizadoEn") VALUES (gen_random_uuid(), 'Otro negocio', '$SLUG_B', true, now());
CREATE TEMP TABLE mapa (viejo uuid PRIMARY KEY, nuevo uuid NOT NULL DEFAULT gen_random_uuid());
DO \$clon\$
DECLARE
  t text; a uuid; b uuid; cols text; sel text;
BEGIN
  SELECT id INTO a FROM negocios WHERE slug = '$SLUG_A';
  SELECT id INTO b FROM negocios WHERE slug = '$SLUG_B';
  FOREACH t IN ARRAY string_to_array('$TABLAS_NEGOCIO', ' ') LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'id') THEN
      EXECUTE format('INSERT INTO mapa (viejo) SELECT id FROM %I WHERE "negocioId" = \$1', t) USING a;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY string_to_array('$TABLAS_NEGOCIO', ' ') LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
           string_agg(CASE
             WHEN column_name = 'negocioId' THEN quote_literal(b) || '::uuid'
             WHEN data_type = 'uuid' THEN format('COALESCE((SELECT m.nuevo FROM mapa m WHERE m.viejo = x.%I), x.%I)', column_name, column_name)
             ELSE format('x.%I', column_name) END, ', ' ORDER BY ordinal_position)
      INTO cols, sel
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t;
    EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM %I x WHERE x."negocioId" = \$1', t, cols, sel, t) USING a;
  END LOOP;
  -- B distinto de A.
  UPDATE materiales SET "stockActual" = "stockActual" + 1000 WHERE "negocioId" = b;
  DELETE FROM pagos WHERE id IN (SELECT id FROM pagos WHERE "negocioId" = b ORDER BY id LIMIT 2);
  UPDATE configuracion SET valor = 'Otro negocio' WHERE "negocioId" = b AND clave = 'nombreNegocio';
END \$clon\$;
EOF
  for _t in $TABLAS_NEGOCIO; do echo "ALTER TABLE \"$_t\" ENABLE TRIGGER USER;"; done
  echo "COMMIT;"
} | psql_en "$PRUEBA" >/dev/null

# Foto de un negocio: por tabla, filas y huella; mas totales de negocio.
foto() { # base, slug
  {
    for _t in $TABLAS_NEGOCIO; do
      echo "SELECT '$_t', count(*), coalesce(md5(string_agg(t::text, E'\\n' ORDER BY t::text)), '') FROM \"$_t\" t WHERE t.\"negocioId\" = (SELECT id FROM negocios WHERE slug = '$2') UNION ALL"
    done
    echo "SELECT 'negocios', count(*), coalesce(md5(string_agg(t::text, E'\\n' ORDER BY t::text)), '') FROM negocios t WHERE t.slug = '$2';"
    echo "SELECT 'total ventas.totalBruto', 0, coalesce(sum(\"totalBruto\"), 0)::text FROM ventas WHERE \"negocioId\" = (SELECT id FROM negocios WHERE slug = '$2');"
    echo "SELECT 'total pagos.monto', 0, coalesce(sum(monto), 0)::text FROM pagos WHERE \"negocioId\" = (SELECT id FROM negocios WHERE slug = '$2');"
    echo "SELECT 'total materiales.stockActual', 0, coalesce(sum(\"stockActual\"), 0)::text FROM materiales WHERE \"negocioId\" = (SELECT id FROM negocios WHERE slug = '$2');"
    echo "SELECT 'total comprobantes.importeTotal', 0, coalesce(sum(\"importeTotal\"), 0)::text FROM comprobantes WHERE \"negocioId\" = (SELECT id FROM negocios WHERE slug = '$2');"
  } | psql_en "$1" -At
}
negocios_en() { valor_sql "$1" "SELECT string_agg(slug, ',' ORDER BY slug) FROM negocios"; }

foto "$PRUEBA" "$SLUG_A" > "$DIR_TMP/A.antes"
foto "$PRUEBA" "$SLUG_B" > "$DIR_TMP/B.antes"
[ "$(grep -c '' "$DIR_TMP/A.antes")" -gt 27 ] || fallar "la foto de A salio vacia"
comprobar "armado: A y B existen y son distintos" "$(cmp -s "$DIR_TMP/A.antes" "$DIR_TMP/B.antes" && echo 0 || echo 1)"
comprobar "armado: A tiene comprobantes emitidos y nota de credito" "$([ "$(valor_sql "$PRUEBA" "SELECT count(*) FROM comprobantes c JOIN negocios n ON n.id = c.\"negocioId\" WHERE n.slug = '$SLUG_A' AND c.estado = 'EMITIDO'")" = 3 ] && echo 1 || echo 0)"
echo "      A: $(grep -E '^(ventas|pagos|negocios)\|' "$DIR_TMP/A.antes" | cut -d'|' -f1,2 | tr '\n' ' ')"
echo "      A: $(grep '^total' "$DIR_TMP/A.antes" | cut -d'|' -f1,3 | tr '\n' ' ')"
echo "      B: $(grep '^total' "$DIR_TMP/B.antes" | cut -d'|' -f1,3 | tr '\n' ' ')"

echo "--- 1. Exportar A e importarlo en una base vacia ---"
ARCHIVO="$BACKUP_DIR/negocios/$SLUG_A-$PRUEBA.negocio.sql.gz"
sh scripts/exportar-negocio.sh "$SLUG_A" --base "$PRUEBA" --salida "$ARCHIVO" >/dev/null
comprobar "se genero el archivo" "$([ -s "$ARCHIVO" ] && echo 1 || echo 0)"
ID_B=$(valor_sql "$PRUEBA" "SELECT id FROM negocios WHERE slug = '$SLUG_B'")
comprobar "el archivo no trae nada de B (ni su id ni su slug)" "$(gzip -dc "$ARCHIVO" | grep -qE "$ID_B|$SLUG_B" && echo 0 || echo 1)"
comprobar "el archivo no trae sesiones" "$(gzip -dc "$ARCHIVO" | grep -q 'COPY "sesiones"' && echo 0 || echo 1)"
comprobar "el archivo no cuenta como respaldo completo (extension .negocio.sql.gz)" "$(case "$ARCHIVO" in *.negocio.sql.gz) echo 1 ;; *) echo 0 ;; esac)"

sh scripts/importar-negocio.sh "$ARCHIVO" --base "$DESTINO" >/dev/null
foto "$DESTINO" "$SLUG_A" > "$DIR_TMP/A.destino"
if diff "$DIR_TMP/A.antes" "$DIR_TMP/A.destino" >/dev/null; then
  comprobar "la base vacia tiene exactamente los datos de A (conteos y huella de las 26 tablas, totales de ventas, pagos, stock y comprobantes)" 1
else
  diff "$DIR_TMP/A.antes" "$DIR_TMP/A.destino" || true
  comprobar "la base vacia tiene exactamente los datos de A" 0
fi
comprobar "en la base vacia esta solo A" "$([ "$(negocios_en "$DESTINO")" = "$SLUG_A" ] && echo 1 || echo 0)"
comprobar "los triggers quedaron habilitados despues de importar" "$([ "$(valor_sql "$DESTINO" "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'")" = 0 ] && echo 1 || echo 0)"

echo "--- 2. Negativas ---"
debe_fallar "importar A de nuevo en la misma base" "ya esta en la base" sh scripts/importar-negocio.sh "$ARCHIVO" --base "$DESTINO"
debe_fallar "importar A donde esta A y esta B (sin --reemplazar)" "ya esta en la base" sh scripts/importar-negocio.sh "$ARCHIVO" --base "$PRUEBA"
debe_fallar "--reemplazar sin terminal ni --si-estoy-seguro" "Sin terminal" sh scripts/importar-negocio.sh "$ARCHIVO" --base "$PRUEBA" --reemplazar < /dev/null
debe_fallar "sin --base no elige una" "falta --base" sh scripts/importar-negocio.sh "$ARCHIVO"
debe_fallar "base destino inexistente" "no existe" sh scripts/importar-negocio.sh "$ARCHIVO" --base "${ORIGEN}_no_existe_nunca"
head -c 3000 "$ARCHIVO" > "$DIR_TMP/truncado.negocio.sql.gz" || true
debe_fallar "archivo truncado" "gzip\|incompleto" sh scripts/importar-negocio.sh "$DIR_TMP/truncado.negocio.sql.gz" --base "$DESTINO"
gzip -dc "$ARCHIVO" | sed 's/^-- fin-exportacion$//' | gzip > "$DIR_TMP/sinfinal.negocio.sql.gz"
debe_fallar "archivo sin el marcador final" "incompleto" sh scripts/importar-negocio.sh "$DIR_TMP/sinfinal.negocio.sql.gz" --base "$DESTINO"
gzip -dc "$ARCHIVO" | sed 's/^-- esquema: .*/-- esquema: 20990101000000_futura 99/' | gzip > "$DIR_TMP/otro-esquema.negocio.sql.gz"
debe_fallar "exportacion de otro esquema" "no es el de la exportacion" sh scripts/importar-negocio.sh "$DIR_TMP/otro-esquema.negocio.sql.gz" --base "$PRUEBA" --reemplazar --si-estoy-seguro
# Datos alterados a mano: la huella no coincide y no queda nada (transaccion deshecha).
echo "CREATE DATABASE \"$COPIA\" OWNER \"$ROL\";" | admin_sql
DATABASE_URL="$(url_de "$COPIA")" DATABASE_URL_MIGRACIONES="$(url_de "$COPIA")" npx prisma migrate deploy >/dev/null
gzip -dc "$ARCHIVO" | sed 's/Vinil adhesivo brillante/Vinil ALTERADO brillante/' | gzip > "$DIR_TMP/alterado.negocio.sql.gz"
debe_fallar "datos alterados (la huella no coincide)" "Verificacion fallida" sh scripts/importar-negocio.sh "$DIR_TMP/alterado.negocio.sql.gz" --base "$COPIA"
comprobar "tras el fallo la base no quedo con datos a medias (sigue solo el negocio vacio de la migracion)" "$([ "$(valor_sql "$COPIA" "SELECT (SELECT count(*) FROM negocios) + (SELECT count(*) FROM ventas) + (SELECT count(*) FROM materiales)")" = 1 ] && echo 1 || echo 0)"
debe_fallar "restaurar.sh rechaza una exportacion de negocio" "exportacion de un solo negocio" sh scripts/restaurar.sh "$ARCHIVO" --base "$COPIA" --si-estoy-seguro
debe_fallar "exportar un slug que no existe" "no hay un negocio" sh scripts/exportar-negocio.sh no-existe --base "$PRUEBA" --salida "$DIR_TMP/x.negocio.sql.gz"
debe_fallar "slug con caracteres raros" "slug invalido" sh scripts/exportar-negocio.sh "a'b" --base "$PRUEBA"
if [ -n "$RESPALDO_URL_APP" ]; then
  debe_fallar "exportar con el rol de la app (sujeto a RLS)" "no se salta RLS" env DATABASE_URL_MIGRACIONES="$RESPALDO_URL_APP" sh scripts/exportar-negocio.sh "$SLUG_A" --base "$PRUEBA" --salida "$DIR_TMP/y.negocio.sql.gz"
else
  echo "OMITIDA exportar con el rol de la app (definir RESPALDO_URL_APP con la URL de ventas_app)"
fi
# Tabla nueva con negocioId sin sumar a la lista: la exportacion se niega.
echo 'CREATE TABLE "tabla_nueva_prueba" (id uuid PRIMARY KEY, "negocioId" uuid NOT NULL);' | psql_en "$PRUEBA"
debe_fallar "tabla con negocioId fuera de la lista" "tabla_nueva_prueba" sh scripts/exportar-negocio.sh "$SLUG_A" --base "$PRUEBA" --salida "$DIR_TMP/z.negocio.sql.gz"
echo 'DROP TABLE "tabla_nueva_prueba";' | psql_en "$PRUEBA"

echo "--- 3. Reemplazar A en la base que tiene A y B: B no cambia ---"
# A se estropea en la base viva: un pago menos, stock cambiado, una venta anulada.
valor_sql "$PRUEBA" "
UPDATE materiales SET \"stockActual\" = \"stockActual\" + 5 WHERE \"negocioId\" = (SELECT id FROM negocios WHERE slug = '$SLUG_A');
DELETE FROM pagos WHERE id = (SELECT id FROM pagos WHERE \"negocioId\" = (SELECT id FROM negocios WHERE slug = '$SLUG_A') ORDER BY id LIMIT 1);
UPDATE clientes SET nombre = 'ROTO' WHERE \"negocioId\" = (SELECT id FROM negocios WHERE slug = '$SLUG_A');" >/dev/null
foto "$PRUEBA" "$SLUG_A" > "$DIR_TMP/A.roto"
comprobar "A quedo distinto del respaldo" "$(cmp -s "$DIR_TMP/A.antes" "$DIR_TMP/A.roto" && echo 0 || echo 1)"
sh scripts/importar-negocio.sh "$ARCHIVO" --base "$PRUEBA" --reemplazar --si-estoy-seguro >/dev/null
foto "$PRUEBA" "$SLUG_A" > "$DIR_TMP/A.despues"
foto "$PRUEBA" "$SLUG_B" > "$DIR_TMP/B.despues"
comprobar "A volvio exactamente al estado exportado" "$(diff "$DIR_TMP/A.antes" "$DIR_TMP/A.despues" >/dev/null && echo 1 || echo 0)"
if diff "$DIR_TMP/B.antes" "$DIR_TMP/B.despues" >/dev/null; then
  comprobar "B no cambio: mismas filas y misma huella en las 26 tablas" 1
else
  diff "$DIR_TMP/B.antes" "$DIR_TMP/B.despues" || true
  comprobar "B no cambio" 0
fi
comprobar "siguen los dos negocios" "$([ "$(negocios_en "$PRUEBA")" = "$SLUG_A,$SLUG_B,taller-demo" ] && echo 1 || echo 0)"

echo "--- 4. Exportar B e importarlo tambien en la base vacia: conviven sin tocarse ---"
ARCHIVO_B="$BACKUP_DIR/negocios/$SLUG_B-$PRUEBA.negocio.sql.gz"
sh scripts/exportar-negocio.sh "$SLUG_B" --base "$PRUEBA" --salida "$ARCHIVO_B" >/dev/null
sh scripts/importar-negocio.sh "$ARCHIVO_B" --base "$DESTINO" >/dev/null
foto "$DESTINO" "$SLUG_A" > "$DIR_TMP/A.destino2"
foto "$DESTINO" "$SLUG_B" > "$DIR_TMP/B.destino"
comprobar "importar B no toco a A (que ya estaba en la base)" "$(diff "$DIR_TMP/A.antes" "$DIR_TMP/A.destino2" >/dev/null && echo 1 || echo 0)"
comprobar "B quedo exacto" "$(diff "$DIR_TMP/B.antes" "$DIR_TMP/B.destino" >/dev/null && echo 1 || echo 0)"

echo "--- 5. Rotacion de exportaciones (BACKUP_CONSERVAR=2) ---"
rm -rf "$BACKUP_DIR/negocios"
for _i in 1 2 3; do
  BACKUP_CONSERVAR=2 sh scripts/exportar-negocio.sh "$SLUG_A" --base "$PRUEBA" >/dev/null
  [ "$_i" = 3 ] || sleep 1
done
comprobar "quedan las 2 mas recientes" "$([ "$(ls "$BACKUP_DIR/negocios" | wc -l)" = 2 ] && echo 1 || echo 0)"

echo "--- 6. El respaldo completo sigue funcionando ---"
sh scripts/backup.sh "$PRUEBA" >/dev/null
COMPLETO=$(ls -1t "$BACKUP_DIR/$PRUEBA"-*.sql.gz | head -n 1)
sh scripts/restaurar.sh "$COMPLETO" --base "$COPIA" --si-estoy-seguro >/dev/null
comprobar "restaurar el completo trae a los dos negocios" "$([ "$(negocios_en "$COPIA")" = "$SLUG_A,$SLUG_B,taller-demo" ] && echo 1 || echo 0)"
foto "$COPIA" "$SLUG_A" > "$DIR_TMP/A.completo"
foto "$COPIA" "$SLUG_B" > "$DIR_TMP/B.completo"
comprobar "y los datos de A y B son exactos" "$(diff "$DIR_TMP/A.antes" "$DIR_TMP/A.completo" >/dev/null && diff "$DIR_TMP/B.antes" "$DIR_TMP/B.completo" >/dev/null && echo 1 || echo 0)"
if [ "$(valor_sql "$COPIA" "SELECT count(*) FROM pg_roles WHERE rolname = 'ventas_app'")" = 1 ]; then
  comprobar "la restauracion completa le devuelve sus permisos a ventas_app" "$([ "$(valor_sql "$COPIA" "SELECT has_table_privilege('ventas_app', 'ventas', 'INSERT') AND has_table_privilege('ventas_app', 'negocios', 'SELECT') AND NOT has_table_privilege('ventas_app', 'negocios', 'INSERT')")" = t ] && echo 1 || echo 0)"
fi

echo ""
if [ "$FALLOS" -eq 0 ]; then
  echo "RESPALDO POR NEGOCIO OK."
else
  echo "RESPALDO POR NEGOCIO FALLO: $FALLOS comprobaciones."
  exit 1
fi
