---
tags: [ventas, operacion, pruebas]
---

# Scripts y pruebas

No hay framework de tests: cada prueba es un script `tsx` en `scripts/`. Convención: `verificar-*.ts` = lógica pura sin base; `test-*.ts` = contra Postgres real, sin dejar rastro.

## Desarrollo y base

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run build` / `npm start` | build y arranque de producción |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:up` / `db:down` / `db:logs` | Postgres en Docker |
| `npm run db:migrate` | crear y aplicar migración (dev) |
| `npm run db:deploy` | aplicar migraciones (producción) |
| `npm run db:seed` | datos de ejemplo |
| `npm run db:reset` | ⚠ **borra todo**, migra y siembra |
| `npm run db:studio` | Prisma Studio |
| `npm run db:backup` / `db:restore -- ARCHIVO` | [[Respaldos]] |
| `npm run usuarios:crear-dueno` | primer dueño |

## Pruebas por área

| Área | Sin base | Con base |
|---|---|---|
| Costeo | `test:costeo` (15 números) | — |
| Stock y compras | `test:stock`, `test:stock-reporte`, `test:consumo` | `test:acciones` |
| Integridad | — | `test:integridad` (12 errores esperados + 1 INSERT aceptado) |
| Altas | `test:cuit`, `test:recetas`, `test:materiales`, `test:configuracion` | `test:clientes`, `test:articulos`, `test:materiales:db`, `test:configuracion:db` |
| Fechas y reportes | `test:rango-fechas`, `test:csv` | `test:reportes-rango` |
| Precios | `test:precios` | `test:precios:db` |
| Presupuestos | `test:presupuestos` | `test:presupuestos:db` (incluye concurrencia) |
| Cobranzas | `test:cobranzas`, `test:reposicion`, `test:recordatorios` | `test:cobranzas:db`, `test:recordatorios:db` |
| Respaldos | `test:respaldo` | `test:respaldo:restaurar` |
| Auth | `test:auth` (`AUTH_ESTRICTO=1` audita el código) | `test:auth:db` |
| Permisos | `test:permisos` (matriz + acciones reales con empleado) | |
| Usuarios | — | `test:usuarios` (se niega con `NODE_ENV=production`) |
| Acceso HTTP | — | `test:acceso` (`next build && next start` en puerto 3103, base `ventas_acceso`; reconstruye `.next`) |
| Producción | `test:produccion`, `test:margen-real`, `test:estimacion-tiempos` | sus variantes `:db` |
| Facturación | `test:datos-fiscales`, `test:comprobantes`, `test:qr`, `test:facturar` | `test:comprobantes:db` (+80 casos), `test:facturar:db`, `test:notas-credito` |

## Otros scripts
- `scripts/auditoria-permisos.ts`, `scripts/check-seed.sql`.
- `scripts/backup.sh`, `restaurar.sh`, `probar-restauracion.sh`, `respaldo-programado.sh`, `respaldo-comun.sh`.

Antes de integrar cualquier cambio: `npm run typecheck` + los `test:*` que correspondan + prueba en navegador contra Postgres local.
