-- Datos de prueba para scripts/test-negocio-migracion.sh: una fila en cada tabla
-- de datos, escrita contra el esquema ANTERIOR a 20260601000000_negocio (sin
-- negocioId). Incluye un comprobante EMITIDO con lineas (sus triggers vuelven
-- inmutable lo fiscal: el backfill tiene que poder atravesarlos) y los trabajos de
-- produccion de la ola 6 (`trabajos_produccion`, `trabajo_tiempos`, `trabajo_consumos`,
-- que reciben `negocioId` en 20260601020000_negocio_produccion).
BEGIN;

INSERT INTO usuarios (id, usuario, nombre, rol, "hashClave", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000001', 'dueno', 'Dueño', 'DUENO',
   'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now());
INSERT INTO sesiones (id, "tokenHash", "usuarioId", "expiraEn") VALUES
  ('00000000-0000-4000-8000-000000000002', repeat('a', 64), '00000000-0000-4000-8000-000000000001', now() + interval '1 day');

INSERT INTO listas_precios (id, nombre, "descuentoPct", "actualizadoEn", "usuarioId") VALUES
  ('00000000-0000-4000-8000-000000000010', 'Mayorista', 10, now(), '00000000-0000-4000-8000-000000000001');
INSERT INTO clientes (id, nombre, "actualizadoEn", "listaPrecioId") VALUES
  ('00000000-0000-4000-8000-000000000011', 'Cliente Uno', now(), '00000000-0000-4000-8000-000000000010'),
  ('00000000-0000-4000-8000-000000000012', 'Cliente Dos', now(), NULL);
INSERT INTO materiales (id, nombre, unidad, "stockActual", "stockMinimo", "costoUnitario", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000020', 'Vinilo', 'M2', 37.500, 5, 1200.0000, now());
INSERT INTO maquinas (id, nombre, "costoHora", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000021', 'Plotter', 2500, now());
INSERT INTO articulos (id, nombre, "precioVenta", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000030', 'Sticker', 1210.0000, now());
INSERT INTO lista_precio_items (id, "listaPrecioId", "articuloId", precio, "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000030', 1000, now());
INSERT INTO recetas (id, "articuloId", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000030', now());
INSERT INTO receta_componentes (id, "recetaId", tipo, "materialId", "maquinaId", cantidad) VALUES
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000032', 'MATERIAL', '00000000-0000-4000-8000-000000000020', NULL, 0.5),
  ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000032', 'MAQUINA', NULL, '00000000-0000-4000-8000-000000000021', 1);

INSERT INTO ventas (id, numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "usuarioId", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000040', 1, 2026, '00000000-0000-4000-8000-000000000011', '2026-05-01', 'ENTREGADA', 1000, 210, 1210, 600, '00000000-0000-4000-8000-000000000001', now()),
  ('00000000-0000-4000-8000-000000000041', 2, 2026, '00000000-0000-4000-8000-000000000012', '2026-05-02', 'PENDIENTE', 2000, 420, 2420, 1200, NULL, now()),
  ('00000000-0000-4000-8000-000000000042', 3, 2026, '00000000-0000-4000-8000-000000000012', '2026-05-03', 'ANULADA', 500, 105, 605, 300, NULL, now());
INSERT INTO venta_items (id, "ventaId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIVA", "subtotalBruto") VALUES
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 'Sticker', 1, 1210, 21, 1000, 210, 1210);
INSERT INTO pagos (id, "ventaId", "clienteId", fecha, monto, "usuarioId", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000011', '2026-05-01', 1210, NULL, now()),
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000012', '2026-05-02', 500, NULL, now());

INSERT INTO compras (id, fecha, proveedor, total, "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000050', '2026-04-20', 'Proveedor', 12000, now());
INSERT INTO compra_items (id, "compraId", "materialId", cantidad, "costoUnitario", subtotal) VALUES
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000020', 10, 1200, 12000);
INSERT INTO movimientos_stock (id, "materialId", tipo, cantidad, "stockResultante", "compraId") VALUES
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000020', 'COMPRA', 10, 37.5, '00000000-0000-4000-8000-000000000050');

INSERT INTO contactos_cobranza (id, "clienteId", fecha, nota) VALUES
  ('00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000012', '2026-05-10', 'Se llamó');
INSERT INTO presupuestos (id, numero, anio, "clienteId", fecha, "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000061', 1, 2026, '00000000-0000-4000-8000-000000000012', '2026-05-05', now());
INSERT INTO presupuesto_items (id, "presupuestoId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct") VALUES
  ('00000000-0000-4000-8000-000000000062', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000030', 'Sticker', 2, 1210, 21);

-- Ola 6: un trabajo de produccion vigente (con tiempo y consumo) y otro anulado.
INSERT INTO trabajos_produccion (id, "ventaItemId", fecha, "minutosManoObra", "costoHoraManoObraSnapshot", notas, "usuarioId", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000090', '00000000-0000-4000-8000-000000000043', '2026-05-02', 30, 4000, 'Trabajo de prueba', '00000000-0000-4000-8000-000000000001', now());
INSERT INTO trabajos_produccion (id, "ventaItemId", fecha, "minutosManoObra", "costoHoraManoObraSnapshot", "anuladoEn", "motivoAnulacion", "usuarioId", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000043', '2026-05-01', 10, 3500, now(), 'Cargado mal', NULL, now());
INSERT INTO trabajo_tiempos (id, "trabajoId", "maquinaId", minutos, "costoHoraSnapshot") VALUES
  ('00000000-0000-4000-8000-000000000092', '00000000-0000-4000-8000-000000000090', '00000000-0000-4000-8000-000000000021', 45.50, 2500),
  ('00000000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000021', 5, 2400);
INSERT INTO trabajo_consumos (id, "trabajoId", "materialId", cantidad, "costoUnitarioSnapshot") VALUES
  ('00000000-0000-4000-8000-000000000094', '00000000-0000-4000-8000-000000000090', '00000000-0000-4000-8000-000000000020', 2.750, 1200),
  ('00000000-0000-4000-8000-000000000095', '00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000020', 9.000, 1100);

-- Factura C emitida (lineas y total cierran; sin alicuotas) y otra A con alicuota.
INSERT INTO comprobantes (id, ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
  "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
  "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
  "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000070', 'SIMULADO', 'FACTURA_C', 11, 1, 1, '2026-05-01', 'PENDIENTE',
   'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
   'Cliente Uno', 99, '0', 'CONSUMIDOR_FINAL',
   1210, 0, 1210, '00000000-0000-4000-8000-000000000040', now());
INSERT INTO comprobante_items (id, "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto") VALUES
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000070', 1, 'Sticker', 1, 1210, 0, 1210, 0, 1210);
UPDATE comprobantes SET estado = 'EMITIDO', cae = '12345678901234', "caeVencimiento" = '2026-05-11'
  WHERE id = '00000000-0000-4000-8000-000000000070';

INSERT INTO comprobantes (id, ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
  "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
  "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
  "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn") VALUES
  ('00000000-0000-4000-8000-000000000072', 'SIMULADO', 'FACTURA_A', 1, 1, 1, '2026-05-02', 'PENDIENTE',
   'HL Laser', '20123456786', 'RESPONSABLE_INSCRIPTO', 'Calle 1', '2020-01-01',
   'Cliente Dos', 80, '30123456786', 'RESPONSABLE_INSCRIPTO',
   2000, 420, 2420, '00000000-0000-4000-8000-000000000041', now());
INSERT INTO comprobante_items (id, "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto") VALUES
  ('00000000-0000-4000-8000-000000000073', '00000000-0000-4000-8000-000000000072', 1, 'Sticker x2', 2, 1210, 21, 2000, 420, 2420);
INSERT INTO comprobante_iva (id, "comprobanteId", "alicuotaPct", "codigoArca", "baseImponible", importe) VALUES
  ('00000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000072', 21, 5, 2000, 420);

COMMIT;
