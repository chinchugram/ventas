---
tags: [ventas, datos]
---

# Datos — Clientes

Parte de [[Modelo de datos]]. Funcionalidad en [[Cobranzas]] y [[Facturación]].

## `Cliente` (`clientes`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre` | text | nombre comercial o razón social |
| `cuit` | text? | como texto (conserva ceros); único parcial cuando no es null; validado con `src/lib/cuit.ts` |
| `telefono`, `email`, `direccion`, `notas` | text? | |
| `activo` | bool | baja lógica |
| `listaPrecioId` | uuid? FK | null = precio de catálogo; FK `RESTRICT`. Solo el dueño la asigna |
| `condicionIva` | enum `CondicionIva` | por defecto `CONSUMIDOR_FINAL`; decide la letra de la factura |
| `dni` | text? | CHECK `^[0-9]{7,8}$` |
| `creadoEn`, `actualizadoEn` | timestamptz | |

`CondicionIva`: `CONSUMIDOR_FINAL`, `RESPONSABLE_INSCRIPTO`, `MONOTRIBUTO`, `EXENTO`.

El saldo del cliente **no es una columna**: `Σ (totalBruto − pagos)` de sus ventas no anuladas.
