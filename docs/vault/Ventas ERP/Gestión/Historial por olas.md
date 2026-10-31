---
tags: [ventas, gestion, historial]
fuente: docs/04-checklist-olas.md
---

# Historial por olas

El trabajo se organizó en **olas**: conjuntos de tareas independientes (no tocan los mismos archivos) que un orquestador reparte a subagentes en paralelo, cada uno en su worktree y rama `ola-N-<tarea>`. Se integra de a una, con `typecheck` y tests después de cada merge. Las tareas `(R)` tocan archivos compartidos y no corren en paralelo entre sí. Cada ola tiene un rango de timestamps de migración reservado.

Repo creado el **28/10/2026**; 141 commits a la fecha. Ramas: `main`, `staging` (la más actualizada), `ola-0`…`ola-7`, `etapa-2-stock-real`, `integracion-4-7`.

| Ola | Tema | Tareas principales | Estado |
|---|---|---|---|
| — | MVP (etapa 1) | Clientes, catálogo, materiales, recetas, ventas, 5 reportes, dashboard, calculadora de cortes, HTTP Basic | ✅ |
| — | Etapa 2 inicial | Compras con costo, libro de movimientos, ajuste, ventas persistidas con descuento de stock | ✅ |
| 0 | Fundaciones | Navbar con rutas stub, biblioteca de formularios + `acciones.ts`, `test:acciones` con lógica en `tx`, seed de stock coherente | ✅ |
| 1 | Altas y ediciones | 1.1 clientes · 1.2 materiales · 1.3 artículos y recetas · 1.4 configuración y máquinas | ✅ |
| 2 | Cobranzas y reposición | 2.1 cobros y anulación de pagos · 2.2 reposición · 2.3 respaldo automático | ✅ |
| 3 | Reportes y calidad | 3.1 filtros de fecha + CSV · 3.2 reporte de stock · 3.3 auditoría de accesibilidad/mobile/build/audit | ✅ |
| 4 | Multi-usuario (etapa 3) | 4.0a deps (audit 9→0) · 4.0b navbar accesible · 4.1 auth · 4.2 trazabilidad · 4.3 permisos · 4.4 usuarios · 4.5 docs | ✅ |
| 5 | Facturación (etapa 4) | 5.0 rutas/permisos · 5.1 modelo y emisor abstracto · 5.1b datos fiscales · 5.3 imprimible con QR · 5.4 NC · 5.5 facturar y listado · 5.6 guía ARCA · 5.7 docs | ✅ salvo **5.2 ARCA (diferida)** |
| 6 | Productividad (etapa 5) | 6.0 modelo · 6.1 registro · 6.2 margen real · 6.3 tiempos por arte · 6.4 accesibilidad · 6.5 docs | ✅ |
| 7 | Comercial (etapa 6) | 7.1 listas de precios · 7.2 presupuestos · 7.3 recordatorios · 7.4 docs | ✅ |
| 4+7 | Integración | 8.1 permisos ola 7 · 8.2 trazabilidad ola 7 · 8.3 `test:acceso` · 8.4 docs | ✅ |

## Últimos commits en `staging`
- `c7a65d8` Docs: actualiza stack (Next 16, Prisma 7), estructura, etapa 4 y olas 0 a 7
- `2b3af97` Quita el tooling del video de demo (script, grabaciones y dependencias)
- `00524d5` Merge origin/staging (navbar con menús de escritorio y entrada Producción)
- `6e33307` Merge ola 6: productividad (producción, margen real, tiempos por arte)
- `13a6685` Ola 6 (6.5): documentación, navbar, scripts npm y clasificación de rutas en las pruebas de acceso

## Rangos de migración por ola
| Ola | Rango |
|---|---|
| 0 | `20260110…` |
| 1 | `20260120…` |
| 2 | `20260130…` |
| 4 | `20260210…`, `20260215…` |
| 5 | `20260301…` |
| 6 | `20260401…` |
| 7 | `20260501…`–`20260520…` |

Ver [[Pendientes y deuda técnica]] para lo que queda.
