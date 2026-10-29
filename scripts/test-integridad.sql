-- Pruebas de las restricciones de integridad.
-- Cada caso debe fallar, excepto el marcado como [OK].
\set ON_ERROR_STOP off

\echo ''
\echo '--- 1. MATERIAL con maquinaId en vez de materialId -> debe FALLAR (CHECK tipo_coherente)'
INSERT INTO receta_componentes (id, "recetaId", tipo, "maquinaId", cantidad)
SELECT gen_random_uuid(), r.id, 'MATERIAL', m.id, 1 FROM recetas r, maquinas m LIMIT 1;

\echo ''
\echo '--- 2. MANO_OBRA con materialId -> debe FALLAR (CHECK tipo_coherente)'
INSERT INTO receta_componentes (id, "recetaId", tipo, "materialId", cantidad)
SELECT gen_random_uuid(), r.id, 'MANO_OBRA', mat.id, 1 FROM recetas r, materiales mat LIMIT 1;

\echo ''
\echo '--- 3. MATERIAL sin materialId -> debe FALLAR (CHECK tipo_coherente)'
INSERT INTO receta_componentes (id, "recetaId", tipo, cantidad)
SELECT gen_random_uuid(), r.id, 'MATERIAL', 1 FROM recetas r LIMIT 1;

\echo ''
\echo '--- 4. cantidad = 0 en receta -> debe FALLAR (CHECK cantidad_positiva)'
INSERT INTO receta_componentes (id, "recetaId", tipo, cantidad)
SELECT gen_random_uuid(), r.id, 'MANO_OBRA', 0 FROM recetas r LIMIT 1;

\echo ''
\echo '--- 5. pago con monto negativo -> debe FALLAR (CHECK monto_positivo)'
INSERT INTO pagos (id, "ventaId", "clienteId", fecha, monto, "actualizadoEn")
SELECT gen_random_uuid(), v.id, v."clienteId", CURRENT_DATE, -50, NOW() FROM ventas v LIMIT 1;

\echo ''
\echo '--- 6. stock negativo -> debe FALLAR (CHECK stock_no_negativo)'
UPDATE materiales SET "stockActual" = -5 WHERE id = (SELECT id FROM materiales LIMIT 1);

\echo ''
\echo '--- 7. dos clientes con el mismo CUIT -> debe FALLAR (indice parcial cuit_unico)'
INSERT INTO clientes (id, nombre, cuit, "creadoEn", "actualizadoEn")
VALUES (gen_random_uuid(), 'Cliente duplicado', '30712345671', NOW(), NOW());

\echo ''
\echo '--- 8. numero de venta repetido en el mismo anio -> debe FALLAR (UNIQUE anio,numero)'
INSERT INTO ventas (id, numero, anio, "clienteId", fecha, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "actualizadoEn")
SELECT gen_random_uuid(), v.numero, v.anio, v."clienteId", v.fecha, 0, 0, 100, 0, NOW() FROM ventas v LIMIT 1;

\echo ''
\echo '--- 9. anio fuera de rango -> debe FALLAR (CHECK anio_plausible)'
INSERT INTO ventas (id, numero, anio, "clienteId", fecha, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "actualizadoEn")
SELECT gen_random_uuid(), 9999, 1800, v."clienteId", CURRENT_DATE, 0, 0, 100, 0, NOW() FROM ventas v LIMIT 1;

\echo ''
\echo '--- 9b. pago anulado sin motivo -> debe FALLAR (CHECK pagos_anulacion_con_motivo)'
UPDATE pagos SET "anuladoEn" = NOW() WHERE id = (SELECT id FROM pagos LIMIT 1);

\echo '--- 10. linea de receta MATERIAL valida -> debe ACEPTAR [OK]'
-- Se usa un id fijo para poder borrar exactamente la fila de prueba y no tocar
-- las recetas que ya estaban cargadas.
INSERT INTO receta_componentes (id, "recetaId", tipo, "materialId", cantidad)
SELECT '00000000-0000-4000-8000-000000000001', r.id, 'MATERIAL', mat.id, 1.5
FROM recetas r, materiales mat LIMIT 1;
DELETE FROM receta_componentes WHERE id = '00000000-0000-4000-8000-000000000001';

\echo ''
\echo '--- Configuracion sembrada por la migracion:'
SELECT clave, valor FROM configuracion ORDER BY clave;
