---
tags: [ventas, modulo]
rutas: [/compras, /compras/nueva, /reposicion, "/materiales/[id]"]
---

# Compras y stock (etapa 2)

Datos: [[Datos - Compras y stock]].

## Cómo se mueve el stock

| Evento | Movimiento | Efecto |
|---|---|---|
| Compra | `COMPRA` (+) por línea | suma stock; opcionalmente actualiza el costo del material |
| Venta | `VENTA` (−) por material de la receta | descuenta lo disponible, anota faltantes |
| Anulación de venta | `VENTA` (+) con lo que salió | vuelve exacto |
| Conteo físico | `AJUSTE` (±) con motivo | solo dueño |
| Diferencia de producción | `AJUSTE` explícito y confirmado | solo dueño, idempotente → [[Producción y margen real]] |

El libro nunca se edita y `stockResultante` nunca es negativo.

## Compras (`/compras`) — solo dueño
Historial con "Registrado por"; `/compras/nueva` registra una compra en una transacción.

## Reposición (`/reposicion`)
- Materiales en o bajo el mínimo.
- Cantidad sugerida hasta **mínimo × factor** configurable y costo estimado (el empleado no ve costos).
- Botón que abre **Nueva compra** con las líneas precargadas.

Código: `src/lib/dominio/compras.ts`, `src/lib/dominio/stock.ts`, `src/lib/stock.ts`, `src/lib/reposicion.ts`. Pruebas: `test:stock`, `test:reposicion`, `test:acciones`.
