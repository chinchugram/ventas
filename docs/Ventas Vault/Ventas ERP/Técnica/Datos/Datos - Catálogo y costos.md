---
tags: [ventas, datos]
---

# Datos — Catálogo y costos

Parte de [[Modelo de datos]]. Lógica en [[Costeo por receta]].

## `Material`
| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | text | |
| `unidad` | enum | `M2`, `M`, `KG`, `L`, `U`, `HOJA`, `ROLLO` |
| `stockActual` | decimal(14,3) | coincide con el libro de movimientos |
| `stockMinimo` | decimal(14,3) | 0 = sin alerta |
| `costoUnitario` | decimal(14,4) | por unidad de medida |
| `precioVenta` | decimal(14,4)? | si se vende suelto; null = solo insumo |
| `activo` | bool | |

## `Maquina`
`nombre`, `costoHora` decimal(14,2) (incluye amortización y consumibles), `activo`.

## `Articulo`
| Campo | Tipo | Notas |
|---|---|---|
| `nombre`, `descripcion?` | text | |
| `precioVenta` | decimal(14,4) | **con IVA incluido** |
| `ivaPct` | decimal(5,2) | 21, 10.5, 0 (27 admitido) |
| `esServicio` | bool | servicio = no descuenta stock |
| `activo` | bool | |

## `Receta` + `RecetaComponente`
- `Receta`: 1:1 con `Articulo` (`articuloId` único), `notas`.
- `RecetaComponente`: `tipo` (`MATERIAL` | `MAQUINA` | `MANO_OBRA`), `materialId?`, `maquinaId?`, `cantidad` decimal(14,4), `costoUnitarioOverride?`, `notas?`.
- Una sola tabla con tipo discriminado; CHECK de coherencia por tipo.

## `Configuracion` (clave-valor)
Todo como texto, casteado al leer; una clave faltante vale su default (`src/lib/configuracion.ts`), así que una clave nueva no necesita migración.

**Negocio:** `nombreNegocio`, `costoHoraManoObra`, `ivaPorDefecto`, `margenObjetivo` (40 % por defecto).

**Fiscales** (`src/lib/datos-fiscales.ts`, solo dueño):

| Clave | Valor |
|---|---|
| `fiscalRazonSocial` | obligatoria, ≤ 200 |
| `fiscalCuit` | obligatoria, 11 dígitos válidos |
| `fiscalCondicionIva` | `RESPONSABLE_INSCRIPTO` (vacía) o `MONOTRIBUTO` |
| `fiscalDomicilio` | obligatoria, ≤ 200 |
| `fiscalInicioActividades` | ISO; se tipea dd/mm/aaaa; ni futura ni < 1900 |
| `fiscalIibb` | opcional, ≤ 30 |
| `fiscalPuntoVenta` | obligatoria, 1–99999 |
| `fiscalUmbralIdentificacion` | opcional; default $ 10.000.000 (a confirmar) |
