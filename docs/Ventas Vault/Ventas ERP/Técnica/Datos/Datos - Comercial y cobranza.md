---
tags: [ventas, datos]
---

# Datos — Comercial y cobranza

Parte de [[Modelo de datos]]. Funcionalidad en [[Listas de precios y presupuestos]] y [[Cobranzas]].

## `ListaPrecio`
`nombre` (único), `descuentoPct` (0–100, CHECK), `activo` (una lista de baja no se aplica), `usuarioId?`.

## `ListaPrecioItem`
`listaPrecioId` (CASCADE), `articuloId` (RESTRICT), `precio` (con IVA, ≥ 0). Único `(listaPrecioId, articuloId)`.

## `Presupuesto`
| Campo | Notas |
|---|---|
| `numero` + `anio` | correlativo por año, lock propio (no espera a las ventas) |
| `clienteId`, `fecha` | |
| `validezDias` | 15 por defecto, > 0, hasta 365 en el dominio; vale hasta `fecha + validezDias` inclusive |
| `estado` | `ABIERTO`, `CONVERTIDO`, `ANULADO`. **"Vencido" no se guarda** |
| `ventaId?` | único; CHECK `(estado = CONVERTIDO) = (ventaId IS NOT NULL)` |
| `duplicadoDeId?` | presupuesto del que es copia |
| `usuarioId?` | quién lo creó (no cambia al editar) |

Los totales no se persisten: `totalizarPresupuesto`, el mismo motor que la venta.

## `PresupuestoItem`
`articuloId`, `descripcion` copiada, `cantidad` > 0, `precioUnitario` congelado (con IVA), `ivaPct`.

## `ContactoCobranza`
| Campo | Notas |
|---|---|
| `clienteId`, `fecha` | hoy en Argentina |
| `nota` | no vacía, ≤ 500 |
| `proximoContacto?` | no anterior a `fecha` |
| `usuarioId?`, `creadoEn` | `creadoEn` desempata contactos del mismo día |

No guarda saldo ni antigüedad: se derivan de ventas y pagos.
