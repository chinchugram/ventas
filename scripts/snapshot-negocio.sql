-- Foto de lo que la migracion 20260601000000_negocio (y 20260601020000_negocio_produccion) NO debe cambiar: filas por
-- tabla, suma de ventas.totalBruto, saldo de cada cliente y stockActual de cada
-- material. Se corre antes y despues de migrar y las dos salidas tienen que ser
-- identicas (scripts/test-negocio-migracion.sh). No nombra negocioId a proposito.
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

SELECT 'filas', t.table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text
FROM information_schema.tables t
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  AND t.table_name NOT IN ('negocios', '_prisma_migrations')
ORDER BY t.table_name;

SELECT 'suma_ventas_totalBruto', coalesce(sum("totalBruto"), 0) FROM ventas;
SELECT 'suma_comprobantes_importeTotal', coalesce(sum("importeTotal"), 0) FROM comprobantes;
SELECT 'suma_pagos_monto', coalesce(sum(monto), 0) FROM pagos;

-- Produccion (ola 6): lo medido y los costos congelados no cambian al asignar el dueno.
SELECT 'suma_trabajo_minutos', coalesce(sum("minutosManoObra"), 0), coalesce(sum("costoHoraManoObraSnapshot"), 0) FROM trabajos_produccion;
SELECT 'suma_trabajo_tiempos', coalesce(sum(minutos), 0), coalesce(sum("costoHoraSnapshot"), 0) FROM trabajo_tiempos;
SELECT 'suma_trabajo_consumos', coalesce(sum(cantidad), 0), coalesce(sum("costoUnitarioSnapshot"), 0) FROM trabajo_consumos;

-- Saldo = ventas no anuladas - pagos no anulados, por cliente.
SELECT 'saldo_cliente', c.id,
       coalesce((SELECT sum(v."totalBruto") FROM ventas v WHERE v."clienteId" = c.id AND v.estado <> 'ANULADA'), 0)
     - coalesce((SELECT sum(p.monto) FROM pagos p WHERE p."clienteId" = c.id AND p."anuladoEn" IS NULL), 0)
FROM clientes c ORDER BY c.id;

SELECT 'stock_material', id, "stockActual" FROM materiales ORDER BY id;
