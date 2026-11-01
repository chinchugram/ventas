---
tags: [ventas, modulo, produccion]
rutas: [/produccion, /produccion/estimar, /reportes/margen-real]
ola: 6
---

# Producción y margen real (ola 6, etapa 5)

Pasa de **margen estimado** (costo de receta) a **margen real**. Datos: [[Datos - Producción]].

## Registro de producción (`/produccion`) — dueño y empleado, sin costos

- Lista líneas de venta sin cargar y trabajos cargados. **Mobile-first**: se carga en el taller con el celular.
- `/produccion/cargar/[ventaItemId]`: precargado con la receta; se cargan minutos de máquina, minutos de mano de obra y materiales realmente usados.
- Un trabajo vigente por línea; **corregir = anular (con motivo) y recargar**.
- Los costos unitarios se **congelan al cargar** (los pone el servidor).
- `/produccion/trabajo/[id]`: real contra receta; anular; **ajustar stock por la diferencia** (solo dueño).

> [!important] El consumo real no mueve el stock
> El stock sigue bajando por receta al vender. El dueño puede ajustar la diferencia con un movimiento `AJUSTE` explícito y confirmado, **idempotente**: nunca doble descuento.

## Margen real (`/reportes/margen-real`) — solo dueño

- Costo real contra costo de receta **por artículo y por período**, y los trabajos con más desvío.
- Filtro de fechas, excluye anulados. CSV en `/reportes/margen-real/export`.

```
costo_real = Σ cantidad × costoUnitarioSnapshot
           + Σ minutos/60 × costoHoraSnapshot
           + minutosManoObra/60 × costoHoraManoObraSnapshot
desvío     = costo_real − costo de receta de la línea
```

## Estimación de tiempos (`/produccion/estimar`)

Minutos de máquina y de mano de obra de un pedido con la **mediana de los últimos 10 trabajos** del mismo artículo, con un **mínimo de 3**. Con menos: "sin datos suficientes" — no inventa. No es un presupuesto automático.

## No hace
Paradas, merma por causa, medición por operario.

Permisos: `cargarProduccion` (ambos), `verMargenReal` (dueño).
Código: `src/lib/produccion.ts`, `src/lib/margen-real.ts`, `src/lib/estimacion-tiempos.ts`, `src/lib/dominio/produccion.ts`.
Pruebas: `test:produccion(:db)`, `test:margen-real(:db)`, `test:estimacion-tiempos(:db)`.

> [!warning] Despliegue
> La migración `20260401000000_produccion` se aplica a mano en Neon antes de redeployar. Ver [[Despliegue]].
