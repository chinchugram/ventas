---
tags: [ventas, modulo]
rutas: [/ventas, /ventas/nueva, "/ventas/[id]"]
---

# Ventas

Datos: [[Datos - Ventas y cobros]]. Código: `src/app/ventas/`, `src/components/nueva-venta-form.tsx`, `src/lib/dominio/ventas.ts` (`registrarVentaEnTx`, `anularVentaEnTx`).

## Carga (`/ventas/nueva`)

En pantalla se ven costo, IVA y margen en vivo (el empleado no ve costos ni margen), pero **al confirmar el servidor recalcula todo desde la base**: precio (`resolverPrecio`), IVA y costo de receta del momento. El navegador solo informa qué, cuánto y a quién.

En **una sola transacción**:
1. Numera la venta correlativa por año.
2. Congela el costo de cada ítem (`costoUnitarioSnapshot`).
3. Descuenta el stock de los materiales de cada receta (un movimiento por material; los servicios no descuentan).
4. Registra el pago inicial, si lo hubo.

> [!note] Nunca se frena una venta por falta de stock
> El sistema puede estar desactualizado y el pedido ya está hecho. Se descuenta lo que hay, el movimiento deja constancia del faltante y la pantalla avisa.

Sin base de datos: **simulación** en modo demo, sin escribir nada.

## Detalle (`/ventas/[id]`)

- Pagos posteriores (varios, nunca más que el saldo), anulación de pago con motivo → [[Cobranzas]].
- **Marcar entregada** (`PENDIENTE → ENTREGADA`).
- **Anular** (solo dueño): la venta queda `ANULADA` (no se borra) y el stock vuelve exactamente como salió.
- Panel **Facturación**: facturar, resolver pendiente, emitir nota de crédito (solo dueño) → [[Facturación]].
- "Registrado por" en la venta y en cada cobro.
- Una venta con factura vigente no se anula hasta emitir la NC.

## Historial (`/ventas`)

Listado con margen (solo dueño) y estado de pago calculado.

## Origen desde presupuesto

"Convertir en venta" reusa `registrarVentaEnTx` con los precios congelados → [[Listas de precios y presupuestos]].

Pruebas: `test:acciones`, `test:precios:db`, `test:permisos`.
