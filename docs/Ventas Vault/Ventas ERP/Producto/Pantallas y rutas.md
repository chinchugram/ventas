---
tags: [ventas, producto, rutas]
---

# Pantallas y rutas

App Router de Next.js: cada carpeta de `src/app/` es una ruta. **Todas mobile-first.** Solo `/login` se ve sin sesión. Permisos en [[Seguridad y permisos]].

## Inicio y ventas

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/` | Cómo va el mes: facturado, cobrado, costo, ganancia, márgenes, alertas → [[Dashboard]] | Dueño |
| `/ventas` | Historial de ventas con margen y estado de pago | Ambos (empleado sin margen) |
| `/ventas/nueva` | Carga de venta: calcula en vivo y guarda (descuenta stock). **Inicio del empleado** | Ambos |
| `/ventas/[id]` | Detalle, pagos, anulación, entrega, facturación y nota de crédito | Ambos (anular y NC: dueño) |

## Clientes y cobranzas

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/clientes` | Lista, alta, edición, baja; CUIT validado, condición IVA, DNI, lista de precios (solo dueño la asigna) | Ambos |
| `/clientes/[id]` | Ficha: ventas, pagos y saldo | Ambos |
| `/cobranzas` | Quién debe, cuánto y desde cuándo; pagos recientes | Ambos |
| `/cobranzas/hoy` | A quién llamar hoy, registrar contacto, enlace de WhatsApp | Ambos |

## Catálogo, materiales y stock

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/catalogo` | Costo por receta, precio, margen, precio necesario para la meta | Dueño |
| `/catalogo/nuevo`, `/catalogo/[id]` | Alta/edición de artículo con editor de receta en vivo | Dueño |
| `/materiales` | Stock, valorización y avisos de reposición | Ambos (empleado: solo cantidades) |
| `/materiales/nuevo`, `/materiales/[id]/editar` | Alta/edición; al cambiar el costo muestra qué artículos cambian de margen | Dueño |
| `/materiales/[id]` | Libro de movimientos y ajuste por conteo físico | Ambos (ajuste: dueño) |
| `/reposicion` | Materiales bajo mínimo: cuánto comprar y botón que arma la compra | Ambos (empleado sin costos) |
| `/compras`, `/compras/nueva` | Historial y registro de compras (suma stock, actualiza costo) | Dueño |
| `/cortes` | Calculadora de cortes: precio de una medida desde el precio de la plancha | Dueño |

## Comercial

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/listas-precios`, `/nueva`, `/[id]` | ABM de listas, advertencia de precios bajo costo | Dueño |
| `/presupuestos` | Listado con filtro por estado | Ambos |
| `/presupuestos/nuevo`, `/[id]`, `/[id]/editar`, `/[id]/imprimir` | Alta, detalle (convertir, duplicar, anular), edición, impresión/WhatsApp | Ambos |

## Reportes

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/reportes` | 5 reportes con filtro de fechas en la URL y CSV | Dueño |
| `/reportes/export/[reporte]` | Route handler del CSV | Dueño |
| `/reportes/stock` | Valorización, sin movimiento, real vs teórico, rotación | Dueño |
| `/reportes/margen-real` (+ `/export`) | Costo real vs receta por artículo y período | Dueño |

## Producción

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/produccion` | Líneas sin cargar y trabajos cargados | Ambos, sin costos |
| `/produccion/cargar/[ventaItemId]` | Carga precargada con la receta | Ambos |
| `/produccion/trabajo/[id]` | Detalle (real vs receta), anular, ajustar stock (dueño) | Ambos |
| `/produccion/estimar` | Estimación de minutos con la mediana de trabajos anteriores | Ambos |

## Facturación

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/comprobantes` | Facturas y NC con filtros en la URL | Ambos |
| `/comprobantes/[id]` | Estado y CAE, emisor, receptor, líneas, IVA, venta de origen | Ambos |
| `/comprobantes/[id]/imprimir` | A4 con QR fiscal y marca SIN VALIDEZ FISCAL | Ambos |

## Configuración y usuarios

| Ruta | Qué resuelve | Rol |
|---|---|---|
| `/configuracion` | Negocio, costo/hora MO, IVA, margen objetivo, máquinas, datos fiscales | Dueño |
| `/configuracion/maquinas/nueva`, `/[id]` | ABM de máquinas | Dueño |
| `/usuarios`, `/nuevo`, `/[id]` | Administración de usuarios | Dueño |
| `/usuarios/mi-clave` | Cambiar la clave propia | Ambos |
| `/login` | Entrar | Público |

## Trazabilidad visible

"Registrado por" en venta, cobro, movimiento de stock, compras, presupuesto y contacto de cobranza; "Creada por" en listas de precios; "Emitido por" en comprobantes. Lo anterior a los usuarios muestra "—".
