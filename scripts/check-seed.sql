-- Verificacion post-seed (`npm run db:seed`): valida los DOS negocios de ejemplo.
--
--   psql "$DATABASE_URL_MIGRACIONES" -v ON_ERROR_STOP=1 -f scripts/check-seed.sql
--
-- Hay que correrlo con un rol que se salte RLS (el migrador o un superusuario): con el rol de la
-- app, sin `app.negocio_id`, no se ve ninguna fila y la verificacion falla a proposito.
-- Si una comprobacion falla, el script termina con un error que dice cual (RAISE EXCEPTION).
-- Si el seed corrio en produccion (sin usuarios ni datos fiscales de ejemplo):
--   -v produccion=1
--
-- Comprueba, por negocio: que existe y esta activo, cuantas filas de cada tabla tiene, que los
-- nombres, precios y stock son los propios (no se parecen a los del otro), que el stock de cada
-- material coincide con su libro de movimientos, que la numeracion de ventas arranca en 1 y que
-- hay un dueno, un empleado y datos fiscales (CUIT ficticio, punto de venta 1). Al final lista
-- cada articulo con el costo de su receta.

\if :{?produccion}
\else
  \set produccion 0
\endif
-- Los bloques DO ($$...$$) no reciben variables de psql: se pasan por un parametro de sesion.
SELECT set_config('check_seed.produccion', :'produccion', false);

-- ─── 1. Los dos negocios y sus filas ───────────────────────────────────────────
DO $$
DECLARE
  esperado record;
  real_n integer;
  nid uuid;
BEGIN
  IF (SELECT count(*) FROM negocios) <> 2 THEN
    RAISE EXCEPTION 'Se esperaban exactamente 2 negocios y hay %', (SELECT count(*) FROM negocios);
  END IF;

  -- slug, nombre, clientes, articulos, materiales, maquinas, compras, ventas
  FOR esperado IN
    SELECT * FROM (VALUES
      ('hl-laser',    'HL Laser',    4, 5, 5, 3, 2, 7),
      ('taller-demo', 'Taller Demo', 4, 5, 6, 3, 2, 6)
    ) AS t(slug, nombre, clientes, articulos, materiales, maquinas, compras, ventas)
  LOOP
    SELECT id INTO nid FROM negocios WHERE slug = esperado.slug AND nombre = esperado.nombre AND activo;
    IF nid IS NULL THEN
      RAISE EXCEPTION 'Falta el negocio % (%), o esta inactivo', esperado.nombre, esperado.slug;
    END IF;

    SELECT count(*) INTO real_n FROM clientes WHERE "negocioId" = nid;
    IF real_n <> esperado.clientes THEN RAISE EXCEPTION '%: % clientes (se esperaban %)', esperado.slug, real_n, esperado.clientes; END IF;
    SELECT count(*) INTO real_n FROM articulos WHERE "negocioId" = nid;
    IF real_n <> esperado.articulos THEN RAISE EXCEPTION '%: % articulos (se esperaban %)', esperado.slug, real_n, esperado.articulos; END IF;
    SELECT count(*) INTO real_n FROM materiales WHERE "negocioId" = nid;
    IF real_n <> esperado.materiales THEN RAISE EXCEPTION '%: % materiales (se esperaban %)', esperado.slug, real_n, esperado.materiales; END IF;
    SELECT count(*) INTO real_n FROM maquinas WHERE "negocioId" = nid;
    IF real_n <> esperado.maquinas THEN RAISE EXCEPTION '%: % maquinas (se esperaban %)', esperado.slug, real_n, esperado.maquinas; END IF;
    SELECT count(*) INTO real_n FROM compras WHERE "negocioId" = nid;
    IF real_n <> esperado.compras THEN RAISE EXCEPTION '%: % compras (se esperaban %)', esperado.slug, real_n, esperado.compras; END IF;
    SELECT count(*) INTO real_n FROM ventas WHERE "negocioId" = nid;
    IF real_n <> esperado.ventas THEN RAISE EXCEPTION '%: % ventas (se esperaban %)', esperado.slug, real_n, esperado.ventas; END IF;

    -- Cada articulo con receta tiene componentes; solo los servicios no tienen receta.
    SELECT count(*) INTO real_n FROM articulos a
     WHERE a."negocioId" = nid AND NOT a."esServicio"
       AND NOT EXISTS (SELECT 1 FROM recetas r JOIN receta_componentes rc ON rc."recetaId" = r.id WHERE r."articuloId" = a.id);
    IF real_n <> 0 THEN RAISE EXCEPTION '%: % articulos que no son servicio quedaron sin receta', esperado.slug, real_n; END IF;

    -- Ventas con items y pagos que no pasan del total.
    SELECT count(*) INTO real_n FROM ventas v
     WHERE v."negocioId" = nid AND NOT EXISTS (SELECT 1 FROM venta_items vi WHERE vi."ventaId" = v.id);
    IF real_n <> 0 THEN RAISE EXCEPTION '%: % ventas sin items', esperado.slug, real_n; END IF;
    SELECT count(*) INTO real_n FROM ventas v
     WHERE v."negocioId" = nid AND (SELECT COALESCE(sum(p.monto), 0) FROM pagos p WHERE p."ventaId" = v.id) > v."totalBruto";
    IF real_n <> 0 THEN RAISE EXCEPTION '%: % ventas con pagos mayores al total', esperado.slug, real_n; END IF;

    -- La numeracion es por negocio: arranca en 1 y no tiene huecos.
    SELECT count(*) INTO real_n FROM (
      SELECT anio, min(numero) AS minimo, max(numero) AS maximo, count(*) AS cuantas
        FROM ventas WHERE "negocioId" = nid GROUP BY anio
    ) x WHERE minimo <> 1 OR maximo <> cuantas;
    IF real_n <> 0 THEN RAISE EXCEPTION '%: la numeracion de ventas no es 1..n por anio', esperado.slug; END IF;
  END LOOP;
END $$;

-- ─── 2. Datos distintos: nada de un negocio se repite en el otro ───────────────
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM clientes a JOIN clientes b ON a.nombre = b.nombre AND a."negocioId" <> b."negocioId";
  IF n <> 0 THEN RAISE EXCEPTION 'Hay % clientes con el mismo nombre en los dos negocios', n; END IF;
  SELECT count(*) INTO n FROM articulos a JOIN articulos b ON a.nombre = b.nombre AND a."negocioId" <> b."negocioId";
  IF n <> 0 THEN RAISE EXCEPTION 'Hay % articulos con el mismo nombre en los dos negocios', n; END IF;
  SELECT count(*) INTO n FROM materiales a JOIN materiales b ON a.nombre = b.nombre AND a."negocioId" <> b."negocioId";
  IF n <> 0 THEN RAISE EXCEPTION 'Hay % materiales con el mismo nombre en los dos negocios', n; END IF;
  SELECT count(*) INTO n FROM maquinas a JOIN maquinas b ON a.nombre = b.nombre AND a."negocioId" <> b."negocioId";
  IF n <> 0 THEN RAISE EXCEPTION 'Hay % maquinas con el mismo nombre en los dos negocios', n; END IF;
  -- Distinto stock total y distinta facturacion: se reconocen a simple vista.
  IF (SELECT count(DISTINCT t) FROM (SELECT sum("stockActual") AS t FROM materiales GROUP BY "negocioId") s) <> 2 THEN
    RAISE EXCEPTION 'El stock total de los dos negocios es igual: los datos no son distinguibles';
  END IF;
  IF (SELECT count(DISTINCT t) FROM (SELECT sum("totalBruto") AS t FROM ventas GROUP BY "negocioId") s) <> 2 THEN
    RAISE EXCEPTION 'La facturacion total de los dos negocios es igual: los datos no son distinguibles';
  END IF;
END $$;

-- ─── 3. Stock coherente con el libro de movimientos (por material) ─────────────
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM materiales m
   WHERE m."stockActual" <> COALESCE((SELECT sum(mv.cantidad) FROM movimientos_stock mv WHERE mv."materialId" = m.id), 0);
  IF n <> 0 THEN RAISE EXCEPTION '% materiales con stock distinto de la suma de sus movimientos', n; END IF;
  SELECT count(*) INTO n FROM materiales WHERE "stockActual" < 0;
  IF n <> 0 THEN RAISE EXCEPTION '% materiales con stock negativo', n; END IF;
  SELECT count(*) INTO n FROM movimientos_stock mv JOIN materiales m ON m.id = mv."materialId" WHERE m."negocioId" <> mv."negocioId";
  IF n <> 0 THEN RAISE EXCEPTION '% movimientos de stock de otro negocio que su material', n; END IF;
END $$;

-- ─── 4. Usuarios y datos fiscales por negocio (no existen si el seed corrio en produccion) ──
DO $$
DECLARE
  neg record;
  n integer;
  produccion boolean := current_setting('check_seed.produccion') = '1';
BEGIN
  FOR neg IN SELECT id, slug FROM negocios ORDER BY slug LOOP
    IF produccion THEN
      SELECT count(*) INTO n FROM usuarios WHERE "negocioId" = neg.id;
      IF n <> 0 THEN RAISE EXCEPTION '%: el seed de produccion no deberia crear usuarios', neg.slug; END IF;
      CONTINUE;
    END IF;

    SELECT count(*) INTO n FROM usuarios WHERE "negocioId" = neg.id AND rol = 'DUENO' AND activo;
    IF n <> 1 THEN RAISE EXCEPTION '%: % duenos activos (se esperaba 1)', neg.slug, n; END IF;
    SELECT count(*) INTO n FROM usuarios WHERE "negocioId" = neg.id AND rol = 'EMPLEADO' AND activo;
    IF n <> 1 THEN RAISE EXCEPTION '%: % empleados activos (se esperaba 1)', neg.slug, n; END IF;

    SELECT count(*) INTO n FROM configuracion WHERE "negocioId" = neg.id AND clave = 'fiscalCuit' AND valor ~ '^[0-9]{11}$';
    IF n <> 1 THEN RAISE EXCEPTION '%: falta el CUIT fiscal de ejemplo (11 digitos)', neg.slug; END IF;
    SELECT count(*) INTO n FROM configuracion WHERE "negocioId" = neg.id AND clave = 'fiscalPuntoVenta' AND valor = '1';
    IF n <> 1 THEN RAISE EXCEPTION '%: el punto de venta fiscal de ejemplo deberia ser 1', neg.slug; END IF;
    SELECT count(*) INTO n FROM configuracion WHERE "negocioId" = neg.id AND clave IN ('fiscalRazonSocial', 'fiscalCondicionIva', 'fiscalDomicilio', 'fiscalInicioActividades');
    IF n <> 4 THEN RAISE EXCEPTION '%: faltan datos fiscales de ejemplo', neg.slug; END IF;
  END LOOP;

  IF NOT produccion THEN
    -- Los dos negocios no comparten CUIT.
    IF (SELECT count(DISTINCT valor) FROM configuracion WHERE clave = 'fiscalCuit') <> 2 THEN
      RAISE EXCEPTION 'Los dos negocios comparten el CUIT fiscal de ejemplo';
    END IF;
    -- Sin sesiones abiertas por el seed y sin usuarios huerfanos de negocio.
    SELECT count(*) INTO n FROM usuarios WHERE "negocioId" IS NULL;
    IF n <> 0 THEN RAISE EXCEPTION '% usuarios sin negocio', n; END IF;
  END IF;
END $$;

\echo 'check-seed: los dos negocios estan bien sembrados.'

-- ─── Resumen: filas por negocio ────────────────────────────────────────────────
SELECT n.slug AS negocio,
       (SELECT count(*) FROM clientes   WHERE "negocioId" = n.id) AS clientes,
       (SELECT count(*) FROM articulos  WHERE "negocioId" = n.id) AS articulos,
       (SELECT count(*) FROM materiales WHERE "negocioId" = n.id) AS materiales,
       (SELECT count(*) FROM ventas     WHERE "negocioId" = n.id) AS ventas,
       (SELECT COALESCE(sum("totalBruto"), 0) FROM ventas WHERE "negocioId" = n.id) AS facturado,
       (SELECT COALESCE(sum("stockActual"), 0) FROM materiales WHERE "negocioId" = n.id) AS stock_total
FROM negocios n
ORDER BY n.slug;

-- ─── Resumen: cada articulo y el desglose de su receta ─────────────────────────
-- La mano de obra se valua con el costo hora de la configuracion de CADA negocio.
SELECT n.slug AS negocio,
       a.nombre AS articulo,
       a."precioVenta" AS precio,
       count(rc.id) AS componentes,
       round(sum(rc.cantidad * COALESCE(rc."costoUnitarioOverride",
             CASE rc.tipo
               WHEN 'MATERIAL' THEN m."costoUnitario"
               WHEN 'MAQUINA'  THEN ma."costoHora"
               ELSE (SELECT c.valor::numeric FROM configuracion c
                      WHERE c."negocioId" = a."negocioId" AND c.clave = 'costoHoraManoObra')
             END))::numeric, 2) AS costo_receta
FROM articulos a
JOIN negocios n ON n.id = a."negocioId"
LEFT JOIN recetas r ON r."articuloId" = a.id
LEFT JOIN receta_componentes rc ON rc."recetaId" = r.id
LEFT JOIN materiales m ON m.id = rc."materialId"
LEFT JOIN maquinas ma ON ma.id = rc."maquinaId"
GROUP BY n.slug, a.nombre, a."precioVenta", a."negocioId"
ORDER BY n.slug, a.nombre;
