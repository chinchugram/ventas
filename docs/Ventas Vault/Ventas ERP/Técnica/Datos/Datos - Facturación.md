---
tags: [ventas, datos, fiscal]
---

# Datos — Facturación

Parte de [[Modelo de datos]]. Funcionalidad en [[Facturación]]. Migración `20260301000000_comprobantes`.

## Enums
| Enum | Valores |
|---|---|
| `TipoComprobante` | `FACTURA_A/B/C`, `NOTA_CREDITO_A/B/C` |
| `AmbienteFiscal` | `SIMULADO`, `HOMOLOGACION`, `PRODUCCION` |
| `EstadoComprobante` | `PENDIENTE` (número reservado, sin CAE), `EMITIDO`, `RECHAZADO` |
| `CondicionIva` | `CONSUMIDOR_FINAL`, `RESPONSABLE_INSCRIPTO`, `MONOTRIBUTO`, `EXENTO` |

## `Comprobante`
- Serie: `ambiente`, `tipo`, `codigoArca` (A 1, B 6, C 11; NC A 3, B 8, C 13), `puntoVenta`, `numero`, `fecha`, `estado`.
- **Foto del emisor**: razón social, CUIT, condición IVA (RI o monotributo), domicilio, inicio de actividades, IIBB.
- **Foto del receptor**: nombre, `receptorDocTipo` (80 CUIT, 96 DNI, 99 sin identificar), `receptorDocNro`, condición IVA, domicilio.
- Importes: `importeNeto`, `importeIva`, `importeTotal` (total = neto + IVA; en la C, IVA = 0).
- `cae` (14 dígitos) y `caeVencimiento`: solo y siempre en `EMITIDO`.
- `observaciones`: motivo obligatorio en `RECHAZADO`.
- `comprobanteAsociadoId`: obligatorio en NC, prohibido en factura.
- `ventaId` (RESTRICT), `usuarioId?`.

## `ComprobanteItem`
Copia ordenada de cada línea de la venta (sin costos). Bruto = neto + IVA.

## `ComprobanteIva`
Una fila por alícuota (como el arreglo `Iva` de ARCA). Alícuotas: 0 (3), 2,5 (9), 5 (8), 10,5 (4), 21 (5), 27 (6). La C no tiene filas.

## Índices únicos parciales
| Índice | Para qué |
|---|---|
| número vigente por serie (`PENDIENTE`/`EMITIDO`) | un `RECHAZADO` no ocupa número |
| un `PENDIENTE` por serie | no se emite mientras no se sepa el anterior |
| una factura vigente por venta | |
| una NC vigente por factura | la NC es total |

## Triggers
- **Alta**: nace `PENDIENTE`; no se factura una venta `ANULADA`; una NC solo anula una factura `EMITIDA` de la misma venta, ambiente y letra.
- **Cambio**: de un `PENDIENTE` solo cambian estado, CAE, vencimiento, observaciones. `EMITIDO` y `RECHAZADO` inmutables.
- **Baja**: solo `SIMULADO`. Homologación/producción nunca (el seed falla a propósito).
- **Detalle**: líneas y alícuotas solo con el comprobante `PENDIENTE`.
- **Importes (diferido)**: líneas y alícuotas cierran con los totales.
- **Venta**: no se anula con factura vigente.
