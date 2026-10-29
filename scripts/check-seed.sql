-- Verificacion post-seed: cada articulo y su desglose de receta.
SELECT a.nombre AS articulo,
       a."precioVenta" AS precio,
       count(rc.id) AS componentes,
       round(sum(rc.cantidad * COALESCE(rc."costoUnitarioOverride",
             CASE rc.tipo
               WHEN 'MATERIAL' THEN m."costoUnitario"
               WHEN 'MAQUINA'  THEN ma."costoHora"
               ELSE 3500
             END))::numeric, 2) AS costo_receta
FROM articulos a
LEFT JOIN recetas r ON r."articuloId" = a.id
LEFT JOIN receta_componentes rc ON rc."recetaId" = r.id
LEFT JOIN materiales m ON m.id = rc."materialId"
LEFT JOIN maquinas ma ON ma.id = rc."maquinaId"
GROUP BY a.nombre, a."precioVenta"
ORDER BY a.nombre;
