---
tags: [ventas, tecnica, dominio, costeo]
---

# Costeo por receta

**El corazón del sistema.** El costo de un producto no se tipea: se calcula como
*materiales consumidos + horas de máquina + horas de mano de obra*.

## Ejemplo

```
Sticker en vinil 10x15 cm
  0,02 m2  vinil adhesivo        × $4.200   =   $84,00
  0,02 m2  transportador         × $1.400   =   $28,00
  0,10 h   plotter de impresión  × $2.500   =  $250,00
  0,17 h   viniladora            × $1.500   =  $255,00
  0,25 h   mano de obra          × $3.500   =  $875,00
                                    costo   = $1.492,00
                        se vende a          $3.500,00   margen 57,4%
```

Si mañana el vinilo sube de $4.200 a $5.100, **el costo se recalcula solo**. El margen deja de depender de la memoria del dueño.

## Tipos de línea (`RecetaComponente.tipo`)

| Tipo | Cálculo | Integridad (CHECK) |
|---|---|---|
| `MATERIAL` | cantidad × costo unitario del material | `materialId` NOT NULL, `maquinaId` NULL |
| `MAQUINA` | horas × costo/hora de la máquina | `maquinaId` NOT NULL, `materialId` NULL |
| `MANO_OBRA` | horas × `Configuracion.costoHoraManoObra` | ambos NULL |

`costo_componente = cantidad × COALESCE(costoUnitarioOverride, costo vigente)`.

## Motor: `src/lib/costing.ts`

- `costearReceta(componentes, costoHoraManoObra)` → `{ costoTotal, costoMateriales, costoMaquinas, costoManoObra, componentes, confiable, advertencias }`.
- **Puro, sin Prisma ni Next**: es la función más importante y tiene que probarse sin levantar nada (`npm run test:costeo`, 15 números conocidos).
- `confiable = false` si no hay receta o está vacía → el artículo se muestra **"sin receta"** en vez de un margen falso del 100 %.
- Advertencias (no errores): override en 0, componente sin costo cargado.

## Cálculos derivados

```
neto            = bruto / (1 + ivaPct/100)
margen_item     = (bruto − costoTotalSnapshot) / bruto
costo_receta    = Σ cantidad × costo_efectivo      (overrides primero)
precio_sugerido = costo_receta / (1 − margenObjetivo)   (margen objetivo por defecto 40 %)
```

## Dónde se usa

- **Catálogo** — margen esperado y precio necesario para la meta → [[Catálogo, materiales y recetas]].
- **Venta** — se **congela** el costo en `VentaItem.costoUnitarioSnapshot` / `costoTotalSnapshot` y se descuenta stock por receta → [[Ventas]].
- **Margen real** — se compara contra el costo realmente usado → [[Producción y margen real]].
- **Consumo teórico** — `src/lib/consumo-teorico.ts`, para el reporte de stock real vs teórico → [[Reportes]].
- **Edición de material** — al cambiar el costo se muestra qué artículos cambian de margen.

La receta es un **estándar estimado**; desde la ola 6 se mide también el real.
