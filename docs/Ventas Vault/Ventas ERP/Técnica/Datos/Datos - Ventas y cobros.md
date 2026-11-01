---
tags: [ventas, datos]
---

# Datos — Ventas y cobros

Parte de [[Modelo de datos]]. Funcionalidad en [[Ventas]] y [[Cobranzas]].

## `Venta`
| Campo | Tipo | Notas |
|---|---|---|
| `numero` + `anio` | int | correlativo **por año** (único compuesto), generado en la transacción |
| `clienteId` | FK | |
| `fecha` | date | |
| `estado` | enum | `PENDIENTE` · `ENTREGADA` · `ANULADA` |
| `observaciones` | text? | |
| `totalNeto`, `totalIVA`, `totalBruto` | decimal(14,2) | bruto = neto + IVA |
| `costoTotal` | decimal(14,2) | suma de snapshots |
| `usuarioId` | uuid? FK | quién la cargó |

Trigger `ventas_validar_anulacion_facturada`: una venta con factura vigente no se anula hasta que una NC `EMITIDA` la anule.

## `VentaItem`
| Campo | Notas |
|---|---|
| `articuloId`, `descripcion` | descripción copiada al momento |
| `cantidad` decimal(14,3) | |
| `precioUnitario` decimal(14,4) | con IVA; lo decide el servidor (`resolverPrecio`) o viene congelado del presupuesto |
| `ivaPct` | copia del artículo |
| `subtotalNeto`, `subtotalIVA`, `subtotalBruto` | guardados para auditoría |
| `costoUnitarioSnapshot`, `costoTotalSnapshot` | **costo congelado** |

`costoTotalSnapshot = 0` + receta vacía ⇒ margen no confiable (el dashboard lo señala).

## `Pago`
| Campo | Notas |
|---|---|
| `ventaId` | imputado a una venta concreta |
| `clienteId` | desnormalizado para listar deudas rápido |
| `fecha`, `monto` (> 0) | |
| `metodo` | `EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `OTRO` |
| `anuladoEn`, `motivoAnulacion` | baja lógica; motivo obligatorio (CHECK); el anulado no cuenta |
| `usuarioId` | quién cobró |

No hay pagos sin venta (anticipos a cuenta).
