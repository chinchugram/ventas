---
tags: [ventas, datos]
---

# Datos — Compras y stock

Parte de [[Modelo de datos]]. Funcionalidad en [[Compras y stock]].

## `Compra` + `CompraItem`
- `Compra`: `fecha`, `proveedor` (texto libre), `comprobante?`, `notas?`, `total`, `usuarioId?`.
- `CompraItem`: `materialId`, `cantidad` (> 0), `costoUnitario`, `subtotal`.

Al registrar, en una transacción: cabecera + líneas, suma de stock, un `MovimientoStock` por línea y, opcionalmente, el costo del material pasa a ser el de la compra (último precio = costo de reposición).

## `MovimientoStock` — libro, nunca se edita
| Campo | Notas |
|---|---|
| `tipo` | `COMPRA`, `VENTA`, `AJUSTE` |
| `cantidad` | con signo |
| `stockResultante` | CHECK ≥ 0 |
| `motivo?` | deja constancia de faltantes o del ajuste |
| `compraId?`, `ventaId?` | origen |
| `usuarioId?` | |

- `VENTA`: uno por material de las recetas al confirmar. Al anular, movimientos `VENTA` de signo contrario con **lo que realmente salió**.
- Si faltaba stock, se descuenta lo disponible (nunca negativo) y el motivo anota el faltante.
- `AJUSTE`: conteo físico o diferencia de producción (solo dueño).
