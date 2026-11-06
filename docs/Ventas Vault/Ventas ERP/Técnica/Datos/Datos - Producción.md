---
tags: [ventas, datos]
---

# Datos — Producción

Parte de [[Modelo de datos]]. Funcionalidad en [[Producción y margen real]]. Migración `20260401000000_produccion`.

| Tabla | Contenido |
|---|---|
| `trabajos_produccion` | un trabajo por **línea de venta** (`ventaItemId`, RESTRICT): `fecha`, `minutosManoObra`, `costoHoraManoObraSnapshot`, `notas`, `usuarioId`, `anuladoEn` + `motivoAnulacion` (siempre juntos) |
| `trabajo_tiempos` | minutos por máquina: `maquinaId`, `minutos`, `costoHoraSnapshot`; una fila por máquina y trabajo |
| `trabajo_consumos` | material realmente usado: `materialId`, `cantidad`, `costoUnitarioSnapshot`; una fila por material y trabajo |

- **Un vigente por línea**: índice único parcial `WHERE anuladoEn IS NULL`. Corregir = anular y recargar. Nunca se borra.
- CHECK: minutos, cantidades y costos ≥ 0. Todas las FK `RESTRICT`.
- Los snapshots los pone el servidor, nunca el cliente.
