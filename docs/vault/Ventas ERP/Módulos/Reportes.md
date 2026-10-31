---
tags: [ventas, modulo]
rutas: [/reportes, /reportes/stock, /reportes/margen-real]
permiso: verReportes (dueño)
---

# Reportes

Solo dueño. Filtro por **mes o rango de fechas en la URL** (zona Argentina, bordes de mes y bisiestos: `src/lib/rango-fechas.ts`).

## Los 5 reportes (`/reportes`)

1. **Resumen del mes**: cuánto entró, cuántas ventas, costo, margen y margen %.
2. **Ganancia por producto**: unidades, facturación, costo, margen $ y % — *"cuánto le sale, a cuánto lo vende, cuánto gana"*.
3. **Más rentables / más vendidos**: ranking por unidades y facturación.
4. **Deuda por cliente**: quién debe, cuánto y desde cuándo.
5. **Consumo de materiales**: cuánto se consumió, a qué costo y qué productos lo consumieron.

Cada uno con botón **Exportar CSV** (`/reportes/export/[reporte]`, exige `exportarCsv`, `verReportes`, `verCostos`, `verMargenes`).

### Formato CSV (`src/lib/csv.ts`)
Separador `;`, decimales con coma, BOM para Excel, escape y **neutralización de fórmulas** (evita inyección en planillas).

## Reporte de stock (`/reportes/stock`)
Valorización del stock, materiales sin movimiento, **consumo real (movimientos) vs teórico (recetas)** y rotación. Mismo filtro de fechas. Lógica: `src/lib/stock-reporte.ts`, `src/lib/consumo-teorico.ts`.

## Margen real (`/reportes/margen-real`)
Ver [[Producción y margen real]]. Permiso `verMargenReal`.

Pruebas: `test:rango-fechas`, `test:reportes-rango`, `test:csv`, `test:stock-reporte`, `test:consumo`.
