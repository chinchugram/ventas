---
tags: [ventas, tecnica, convenciones]
---

# Reglas del proyecto

> Si alguna se rompe, el sistema empieza a mentir.

1. **El dinero es `Decimal`, siempre.** Prohibido `+`, `*` o template literals con números de dinero. Todo pasa por `src/lib/money.ts`. Un redondeo mal aplicado en un subtotal se propaga al margen, y el margen es el producto.
2. **Ningún saldo se persiste.** El saldo de un cliente y el estado de pago de una venta se *calculan* desde ventas y pagos. Lo mismo el vencimiento de un presupuesto y la antigüedad de una deuda.
3. **El costo se congela en la venta.** `VentaItem` guarda el costo del momento. Si no, un cambio de precio del vinilo reescribiría los márgenes del mes pasado.
4. **La base es la última línea de defensa.** Zod/Prisma validan en la app, pero los `CHECK` de `prisma/migrations/` validan siempre (`scripts/test-integridad.sql`).
5. **Baja lógica en todo catálogo.** `activo = false`. Nunca se borra algo con historial.
6. **Server Components finos.** Lecturas en `src/lib/queries/`; escrituras como Server Actions con Zod en `src/app/**/actions.ts`, que validan y delegan en `src/lib/dominio/` (funciones con `tx`). Piezas comunes en `src/lib/acciones.ts` y `src/components/form/`. Los componentes renderizan, no saben SQL.
7. **Código en inglés, dominio en español.** `costoTotalSnapshot`, `stockMinimo`, `saldoCliente`.
8. **El precio de una línea lo decide el servidor** con `resolverPrecio` (`src/lib/precios.ts`): precio específico del cliente → catálogo − descuento general de su lista → catálogo. Una lista inactiva se ignora. Única excepción: convertir un presupuesto usa sus precios congelados.
9. **El comprobante es una foto.** Emisor, receptor, líneas e importes se copian al emitir y no cambian. Lo que está mal se corrige con nota de crédito. Lo garantizan triggers de la base.

## Convenciones de trabajo

- Lógica pura en `src/lib/*.ts` + script `scripts/verificar-*.ts` + comando `npm run test:*`.
- Lógica con base en `src/lib/dominio/*.ts` + `scripts/test-*.ts` contra Postgres real, en transacciones que se deshacen o borrando lo creado.
- Cada página: `await requierePermisoPagina(...)` primero. Cada acción: `verificarPermiso(...)` como primera sentencia. Lo audita `AUTH_ESTRICTO=1 npm run test:auth`.
- Migraciones con formato `YYYYMMDDHHMMSS_nombre`; rango de timestamps reservado por ola; restricciones como `CHECK` en SQL.
- Errores de negocio con mensajes claros (`ErrorDeNegocio`), nunca un error crudo de unicidad.
- `next dev` regenera `AGENTS.md`/`CLAUDE.md` y toca `next-env.d.ts`: no commitearlos sin querer.

Relacionado: [[Arquitectura]], [[Modelo de datos]], [[Scripts y pruebas]].
