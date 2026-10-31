-- Pruebas de 20260601010000_unicos_por_negocio (multi-tenant F1.2), con INSERT directo.
-- Las corre scripts/test-unicos-negocio.sh sobre una base descartable con todas las
-- migraciones aplicadas. Cualquier incumplimiento lanza una excepcion.
--
--   1. Dos negocios cargan lo mismo (venta 2026/1, presupuesto 2026/1, CUIT de cliente,
--      usuario, lista de precios, serie fiscal de comprobantes, clave de configuracion)
--      sin chocar.
--   2. Dentro de UN negocio esos mismos duplicados siguen rechazados.
--   3. Un hijo con negocioId distinto del padre es rechazado por la base (todas las
--      FK de datos, los comprobantes y su detalle) y el negocio de una fila no se cambia.
--   4. Los triggers de comprobantes siguen haciendo su trabajo.

CREATE FUNCTION pg_temp.cargar(neg UUID, usuario_nombre TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  u UUID := gen_random_uuid(); l UUID := gen_random_uuid(); c UUID := gen_random_uuid();
  m UUID := gen_random_uuid(); a UUID := gen_random_uuid(); v UUID := gen_random_uuid();
  p UUID := gen_random_uuid(); f UUID := gen_random_uuid(); vi UUID := gen_random_uuid();
  mq UUID := gen_random_uuid(); tr UUID := gen_random_uuid();
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO usuarios (id, "negocioId", usuario, nombre, rol, "hashClave", "actualizadoEn")
    VALUES (u, neg, usuario_nombre, 'Dueño', 'DUENO',
      'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now());
  INSERT INTO listas_precios (id, "negocioId", nombre, "descuentoPct", "actualizadoEn")
    VALUES (l, neg, 'Mayorista', 10, now());
  INSERT INTO clientes (id, "negocioId", nombre, cuit, "listaPrecioId", "actualizadoEn")
    VALUES (c, neg, 'Cliente Uno', '30712345671', l, now());
  INSERT INTO materiales (id, "negocioId", nombre, unidad, "stockActual", "stockMinimo", "costoUnitario", "actualizadoEn")
    VALUES (m, neg, 'Vinilo', 'M2', 10, 1, 100, now());
  INSERT INTO articulos (id, "negocioId", nombre, "precioVenta", "actualizadoEn")
    VALUES (a, neg, 'Sticker', 1210, now());
  INSERT INTO ventas (id, "negocioId", numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "usuarioId", "actualizadoEn")
    VALUES (v, neg, 1, 2026, c, '2026-05-01', 'PENDIENTE', 1000, 210, 1210, 600, u, now());
  INSERT INTO venta_items (id, "negocioId", "ventaId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIVA", "subtotalBruto")
    VALUES (vi, neg, v, a, 'Sticker', 1, 1210, 21, 1000, 210, 1210);
  INSERT INTO presupuestos (id, "negocioId", numero, anio, "clienteId", fecha, "actualizadoEn")
    VALUES (p, neg, 1, 2026, c, '2026-05-05', now());
  INSERT INTO configuracion ("negocioId", clave, valor) VALUES (neg, 'ivaPorDefecto', '21');
  -- Produccion (ola 6): un trabajo de la linea de venta con un tiempo de maquina y un consumo de material.
  INSERT INTO maquinas (id, "negocioId", nombre, "costoHora", "actualizadoEn") VALUES (mq, neg, 'Plotter', 2500, now());
  INSERT INTO trabajos_produccion (id, "negocioId", "ventaItemId", fecha, "usuarioId", "actualizadoEn")
    VALUES (tr, neg, vi, '2026-05-02', u, now());
  INSERT INTO trabajo_tiempos (id, "negocioId", "trabajoId", "maquinaId", minutos) VALUES (gen_random_uuid(), neg, tr, mq, 30);
  INSERT INTO trabajo_consumos (id, "negocioId", "trabajoId", "materialId", cantidad) VALUES (gen_random_uuid(), neg, tr, m, 1);
  -- Misma serie fiscal en los dos negocios: SIMULADO, punto de venta 1, FACTURA_C, numero 1.
  INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
    "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
    "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
    "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn")
    VALUES (f, neg, 'SIMULADO', 'FACTURA_C', 11, 1, 1, '2026-05-01', 'PENDIENTE',
      'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
      'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL', 1210, 0, 1210, v, now());
  INSERT INTO comprobante_items (id, "negocioId", "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto")
    VALUES (gen_random_uuid(), neg, f, 1, 'Sticker', 1, 1210, 0, 1210, 0, 1210);
  SET CONSTRAINTS ALL IMMEDIATE;  -- verifica los importes del comprobante ahora
  SET CONSTRAINTS ALL DEFERRED;
  RETURN jsonb_build_object('usuario', u, 'lista', l, 'cliente', c, 'material', m, 'articulo', a,
                            'venta', v, 'presupuesto', p, 'comprobante', f, 'ventaItem', vi,
                            'maquina', mq, 'trabajo', tr);
END;
$$;

-- Ejecuta `sentencia` y exige que falle con un mensaje que contenga `esperado`.
CREATE FUNCTION pg_temp.debe_fallar(descripcion TEXT, sentencia TEXT, esperado TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  fallo BOOLEAN := false;
  msg TEXT;
BEGIN
  BEGIN
    EXECUTE sentencia;
  EXCEPTION WHEN OTHERS THEN
    fallo := true;
    msg := SQLERRM;
  END;
  IF NOT fallo THEN
    RAISE EXCEPTION 'DEBIA FALLAR y se acepto: %', descripcion;
  END IF;
  IF position(esperado IN msg) = 0 THEN
    RAISE EXCEPTION 'Fallo por otra razon: % (esperado "%", salio "%")', descripcion, esperado, msg;
  END IF;
  RAISE NOTICE 'ok  rechazado: %', descripcion;
END;
$$;

DO $do$
DECLARE
  a UUID := gen_random_uuid(); b UUID := gen_random_uuid();
  ia JSONB; ib JSONB;
  pend_a UUID;
BEGIN
  INSERT INTO negocios (id, nombre, slug, "actualizadoEn") VALUES
    (a, 'Negocio A', 'test-a', now()), (b, 'Negocio B', 'test-b', now());

  -- ─── 1. Dos negocios cargan lo mismo sin chocar ───
  ia := pg_temp.cargar(a, 'dueno');
  ib := pg_temp.cargar(b, 'dueno');
  RAISE NOTICE 'ok  dos negocios con venta 2026/1, presupuesto 2026/1, mismo CUIT, usuario, lista, serie fiscal y configuracion';
  RAISE NOTICE 'ok  dos negocios con su propio trabajo de produccion (con tiempos y consumos)';

  -- Un SUPERADMIN (sin negocio) puede figurar como autor en cualquier negocio.
  INSERT INTO usuarios (id, "negocioId", usuario, nombre, rol, "hashClave", "actualizadoEn")
    VALUES (gen_random_uuid(), NULL, 'super', 'Super', 'DUENO',
      'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now());
  UPDATE ventas SET "usuarioId" = (SELECT id FROM usuarios WHERE usuario = 'super') WHERE id = (ia->>'venta')::uuid;
  RAISE NOTICE 'ok  un usuario sin negocio puede ser autor de una venta de cualquier negocio';

  -- ─── 2. Dentro de un negocio los duplicados siguen rechazados ───
  PERFORM pg_temp.debe_fallar('venta 2026/1 repetida en el mismo negocio', format(
    $q$INSERT INTO ventas (id, "negocioId", numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 1, 2026, %L, '2026-05-02', 'PENDIENTE', 1, 0, 1, 0, now())$q$, a, ia->>'cliente'),
    'ventas_negocioId_anio_numero_key');
  PERFORM pg_temp.debe_fallar('presupuesto 2026/1 repetido en el mismo negocio', format(
    $q$INSERT INTO presupuestos (id, "negocioId", numero, anio, "clienteId", fecha, "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 1, 2026, %L, '2026-05-06', now())$q$, a, ia->>'cliente'),
    'presupuestos_negocioId_anio_numero_key');
  PERFORM pg_temp.debe_fallar('CUIT de cliente repetido en el mismo negocio', format(
    $q$INSERT INTO clientes (id, "negocioId", nombre, cuit, "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'Otro', '30712345671', now())$q$, a),
    'clientes_cuit_unico');
  PERFORM pg_temp.debe_fallar('usuario repetido en el mismo negocio', format(
    $q$INSERT INTO usuarios (id, "negocioId", usuario, nombre, rol, "hashClave", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'dueno', 'Otro', 'EMPLEADO',
       'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now())$q$, a),
    'usuarios_negocioId_usuario_key');
  PERFORM pg_temp.debe_fallar('usuario repetido entre quienes no tienen negocio', $q$
    INSERT INTO usuarios (id, "negocioId", usuario, nombre, rol, "hashClave", "actualizadoEn")
    VALUES (gen_random_uuid(), NULL, 'super', 'Otro', 'DUENO',
    'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now())$q$,
    'usuarios_usuario_key');
  PERFORM pg_temp.debe_fallar('lista de precios con el mismo nombre en el mismo negocio', format(
    $q$INSERT INTO listas_precios (id, "negocioId", nombre, "descuentoPct", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'Mayorista', 5, now())$q$, a),
    'listas_precios_negocioId_nombre_key');
  PERFORM pg_temp.debe_fallar('clave de configuracion repetida en el mismo negocio', format(
    $q$INSERT INTO configuracion ("negocioId", clave, valor) VALUES (%L, 'ivaPorDefecto', '10.5')$q$, a),
    'configuracion_pkey');
  -- La serie fiscal: un segundo comprobante vigente con el mismo numero (PENDIENTE, un 2do pendiente
  -- tambien viola la serie) en el mismo negocio. Otra venta para no chocar con "una factura por venta".
  INSERT INTO ventas (id, "negocioId", numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "actualizadoEn")
    VALUES ('00000000-0000-4000-8000-0000000000a1', a, 2, 2026, (ia->>'cliente')::uuid, '2026-05-02', 'PENDIENTE', 1, 0, 1, 0, now());
  PERFORM pg_temp.debe_fallar('numero de comprobante repetido en la misma serie y negocio', format(
    $q$INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
         "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
         "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
         "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'SIMULADO', 'FACTURA_C', 11, 1, 1, '2026-05-02', 'PENDIENTE',
         'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
         'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL', 1, 0, 1, %L, now())$q$, a, '00000000-0000-4000-8000-0000000000a1'),
    'comprobantes_numero_vigente_key');
  PERFORM pg_temp.debe_fallar('segundo comprobante PENDIENTE en la misma serie y negocio', format(
    $q$INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
         "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
         "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
         "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'SIMULADO', 'FACTURA_C', 11, 1, 2, '2026-05-02', 'PENDIENTE',
         'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
         'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL', 1, 0, 1, %L, now())$q$, a, '00000000-0000-4000-8000-0000000000a1'),
    'comprobantes_un_pendiente_por_serie_key');

  -- ─── 3. Hijo con negocioId distinto del padre ───
  PERFORM pg_temp.debe_fallar('venta_item de otro negocio que su venta', format(
    $q$INSERT INTO venta_items (id, "negocioId", "ventaId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIVA", "subtotalBruto")
       VALUES (gen_random_uuid(), %L, %L, %L, 'x', 1, 1, 21, 1, 0, 1)$q$, b, ia->>'venta', ib->>'articulo'),
    'de otro negocio');
  PERFORM pg_temp.debe_fallar('venta_item del negocio de su venta pero con articulo de otro negocio', format(
    $q$INSERT INTO venta_items (id, "negocioId", "ventaId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIVA", "subtotalBruto")
       VALUES (gen_random_uuid(), %L, %L, %L, 'x', 1, 1, 21, 1, 0, 1)$q$, a, ia->>'venta', ib->>'articulo'),
    'venta_items.articuloId');
  PERFORM pg_temp.debe_fallar('venta de un cliente de otro negocio', format(
    $q$INSERT INTO ventas (id, "negocioId", numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 99, 2026, %L, '2026-05-02', 'PENDIENTE', 1, 0, 1, 0, now())$q$, a, ib->>'cliente'),
    'ventas.clienteId');
  PERFORM pg_temp.debe_fallar('pago de otro negocio que su venta', format(
    $q$INSERT INTO pagos (id, "negocioId", "ventaId", "clienteId", fecha, monto, "actualizadoEn")
       VALUES (gen_random_uuid(), %L, %L, %L, '2026-05-01', 10, now())$q$, b, ia->>'venta', ib->>'cliente'),
    'pagos.ventaId');
  PERFORM pg_temp.debe_fallar('movimiento de stock con material de otro negocio', format(
    $q$INSERT INTO movimientos_stock (id, "negocioId", "materialId", tipo, cantidad, "stockResultante")
       VALUES (gen_random_uuid(), %L, %L, 'AJUSTE', 1, 1)$q$, a, ib->>'material'),
    'movimientos_stock.materialId');
  PERFORM pg_temp.debe_fallar('cliente con lista de precios de otro negocio', format(
    $q$INSERT INTO clientes (id, "negocioId", nombre, "listaPrecioId", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'Z', %L, now())$q$, a, ib->>'lista'),
    'clientes.listaPrecioId');
  PERFORM pg_temp.debe_fallar('presupuesto duplicado de un presupuesto de otro negocio', format(
    $q$INSERT INTO presupuestos (id, "negocioId", numero, anio, "clienteId", fecha, "duplicadoDeId", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 50, 2026, %L, '2026-05-06', %L, now())$q$, a, ia->>'cliente', ib->>'presupuesto'),
    'presupuestos.duplicadoDeId');
  PERFORM pg_temp.debe_fallar('venta con un usuario CON negocio de otro negocio', format(
    $q$UPDATE ventas SET "usuarioId" = %L WHERE id = %L$q$, ib->>'usuario', ia->>'venta'),
    'ventas.usuarioId');
  PERFORM pg_temp.debe_fallar('sesion de otro negocio que su usuario', format(
    $q$INSERT INTO sesiones (id, "negocioId", "tokenHash", "usuarioId", "expiraEn")
       VALUES (gen_random_uuid(), %L, repeat('b', 64), %L, now() + interval '1 day')$q$, b, ia->>'usuario'),
    'sesiones.usuarioId');
  PERFORM pg_temp.debe_fallar('cambiar el negocio de un articulo (padre de venta_items)', format(
    $q$UPDATE articulos SET "negocioId" = %L WHERE id = %L$q$, b, ia->>'articulo'),
    'el negocio de una fila no se cambia');
  PERFORM pg_temp.debe_fallar('cambiar el negocio de una venta (con hijos)', format(
    $q$UPDATE ventas SET "negocioId" = %L WHERE id = %L$q$, b, ia->>'venta'),
    'de otro negocio');
  PERFORM pg_temp.debe_fallar('cambiar el negocio de una clave de configuracion', format(
    $q$UPDATE configuracion SET "negocioId" = %L WHERE "negocioId" = %L$q$, b, a),
    'el negocio de una fila no se cambia');

  -- Produccion (ola 6): cada FK del trabajo y de sus tiempos y consumos tiene que ser del mismo negocio.
  PERFORM pg_temp.debe_fallar('trabajo de produccion de otro negocio que su linea de venta', format(
    $q$INSERT INTO trabajos_produccion (id, "negocioId", "ventaItemId", fecha, "actualizadoEn")
       VALUES (gen_random_uuid(), %L, %L, '2026-05-03', now())$q$, b, ia->>'ventaItem'),
    'trabajos_produccion.ventaItemId');
  PERFORM pg_temp.debe_fallar('trabajo de produccion cargado por un usuario CON negocio de otro negocio', format(
    $q$INSERT INTO trabajos_produccion (id, "negocioId", "ventaItemId", fecha, "usuarioId", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, %L, '2026-05-03', %L, now())$q$, a, ia->>'ventaItem', ib->>'usuario'),
    'trabajos_produccion.usuarioId');
  PERFORM pg_temp.debe_fallar('tiempo de maquina de otro negocio que su trabajo', format(
    $q$INSERT INTO trabajo_tiempos (id, "negocioId", "trabajoId", "maquinaId", minutos)
       VALUES (gen_random_uuid(), %L, %L, %L, 5)$q$, b, ia->>'trabajo', ib->>'maquina'),
    'trabajo_tiempos.trabajoId');
  PERFORM pg_temp.debe_fallar('tiempo de maquina con una maquina de otro negocio', format(
    $q$INSERT INTO trabajo_tiempos (id, "negocioId", "trabajoId", "maquinaId", minutos)
       VALUES (gen_random_uuid(), %L, %L, %L, 5)$q$, a, ia->>'trabajo', ib->>'maquina'),
    'trabajo_tiempos.maquinaId');
  PERFORM pg_temp.debe_fallar('consumo de otro negocio que su trabajo', format(
    $q$INSERT INTO trabajo_consumos (id, "negocioId", "trabajoId", "materialId", cantidad)
       VALUES (gen_random_uuid(), %L, %L, %L, 1)$q$, b, ia->>'trabajo', ib->>'material'),
    'trabajo_consumos.trabajoId');
  PERFORM pg_temp.debe_fallar('consumo con un material de otro negocio', format(
    $q$INSERT INTO trabajo_consumos (id, "negocioId", "trabajoId", "materialId", cantidad)
       VALUES (gen_random_uuid(), %L, %L, %L, 1)$q$, a, ia->>'trabajo', ib->>'material'),
    'trabajo_consumos.materialId');
  PERFORM pg_temp.debe_fallar('cambiar el negocio de un trabajo de produccion (con hijos)', format(
    $q$UPDATE trabajos_produccion SET "negocioId" = %L WHERE id = %L$q$, b, ia->>'trabajo'),
    'el negocio de una fila no se cambia');
  PERFORM pg_temp.debe_fallar('cambiar el negocio de un tiempo de maquina', format(
    $q$UPDATE trabajo_tiempos SET "negocioId" = %L WHERE "trabajoId" = %L$q$, b, ia->>'trabajo'),
    'de otro negocio');
  PERFORM pg_temp.debe_fallar('borrar una linea de venta con trabajos (ON DELETE RESTRICT)', format(
    $q$DELETE FROM venta_items WHERE id = %L$q$, ia->>'ventaItem'),
    'trabajos_produccion_ventaItemId_fkey');

  -- Comprobantes: negocio distinto del de su venta (la venta de A, el comprobante de B).
  PERFORM pg_temp.debe_fallar('comprobante de otro negocio que su venta', format(
    $q$INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
         "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
         "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
         "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'SIMULADO', 'FACTURA_C', 11, 7, 1, '2026-05-02', 'PENDIENTE',
         'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
         'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL', 1, 0, 1, %L, now())$q$, b, '00000000-0000-4000-8000-0000000000a1'),
    'mismo negocio');
  -- Detalle: linea de otro negocio que su comprobante (PENDIENTE, de A).
  SELECT id INTO pend_a FROM comprobantes WHERE "negocioId" = a;
  PERFORM pg_temp.debe_fallar('linea de comprobante de otro negocio que su comprobante', format(
    $q$INSERT INTO comprobante_items (id, "negocioId", "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto")
       VALUES (gen_random_uuid(), %L, %L, 2, 'x', 1, 1, 0, 1, 0, 1)$q$, b, pend_a),
    'mismo negocio');
  PERFORM pg_temp.debe_fallar('alicuota de comprobante de otro negocio que su comprobante', format(
    $q$INSERT INTO comprobante_iva (id, "negocioId", "comprobanteId", "alicuotaPct", "codigoArca", "baseImponible", importe)
       VALUES (gen_random_uuid(), %L, %L, 21, 5, 1, 0)$q$, b, pend_a),
    'mismo negocio');

  -- ─── 4. Los triggers de comprobantes siguen funcionando ───
  PERFORM pg_temp.debe_fallar('anular una venta con factura PENDIENTE', format(
    $q$UPDATE ventas SET estado = 'ANULADA' WHERE id = %L$q$, ia->>'venta'),
    'tiene una factura vigente');
  -- Emitir la factura de A y de B; anular la venta de A solo sigue prohibido hasta una NC emitida.
  UPDATE comprobantes SET estado = 'EMITIDO', cae = '12345678901234', "caeVencimiento" = '2026-05-11' WHERE id = (ia->>'comprobante')::uuid;
  PERFORM pg_temp.debe_fallar('modificar un comprobante EMITIDO', format(
    $q$UPDATE comprobantes SET "importeNeto" = 5, "importeTotal" = 5 WHERE id = %L$q$, ia->>'comprobante'),
    'no se modifica');
  PERFORM pg_temp.debe_fallar('NC de una factura EMITIDA pero con otra venta (no la de la factura)', format(
    $q$INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
         "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
         "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
         "importeNeto", "importeIva", "importeTotal", "ventaId", "comprobanteAsociadoId", "actualizadoEn")
       VALUES (gen_random_uuid(), %L, 'SIMULADO', 'NOTA_CREDITO_C', 13, 1, 1, '2026-05-02', 'PENDIENTE',
         'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
         'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL', 1210, 0, 1210, %L, %L, now())$q$, a, '00000000-0000-4000-8000-0000000000a1', ia->>'comprobante'),
    'misma venta, ambiente y letra');
  -- Una NC valida (misma venta, ambiente, letra y negocio) se acepta, con su linea.
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
      "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
      "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
      "importeNeto", "importeIva", "importeTotal", "ventaId", "comprobanteAsociadoId", "actualizadoEn")
    VALUES ('00000000-0000-4000-8000-0000000000a2', a, 'SIMULADO', 'NOTA_CREDITO_C', 13, 1, 1, '2026-05-02', 'PENDIENTE',
      'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
      'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL', 1210, 0, 1210, (ia->>'venta')::uuid, (ia->>'comprobante')::uuid, now());
  INSERT INTO comprobante_items (id, "negocioId", "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto")
    VALUES (gen_random_uuid(), a, '00000000-0000-4000-8000-0000000000a2', 1, 'Sticker', 1, 1210, 0, 1210, 0, 1210);
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE NOTICE 'ok  una nota de credito del mismo negocio se acepta';
  -- Un comprobante cuyas lineas no suman el total sigue rechazado al confirmar.
  PERFORM pg_temp.debe_fallar('comprobante cuyas lineas no suman el total (diferido)', format(
    $q$DO $i$ BEGIN
         SET CONSTRAINTS ALL DEFERRED;
         INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
           "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
           "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
           "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn")
         VALUES (gen_random_uuid(), %L, 'SIMULADO', 'FACTURA_C', 11, 9, 1, '2026-05-02', 'PENDIENTE',
           'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
           'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL', 100, 0, 100, %L, now());
         SET CONSTRAINTS ALL IMMEDIATE;
       END $i$$q$, a, '00000000-0000-4000-8000-0000000000a1'),
    'las lineas no suman el total');

  RAISE NOTICE 'TODO BIEN';
END $do$;
