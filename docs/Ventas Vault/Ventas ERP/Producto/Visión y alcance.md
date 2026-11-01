---
tags: [ventas, producto]
---

# Visión y alcance

## Contexto

Comercio de corte láser e insumos de marca. El problema no es el stock: es el **control de pedidos, ventas, cobranzas y clientes**.

Decisión de producto: ERP **mínimo y deliberadamente acotado**. Tres objetivos, en orden:

1. Saber **qué** se vendió.
2. Saber **cuánto dinero** entró.
3. Saber **cuánto se ganó** realmente (no lo que se cree que se ganó).

El dueño atiende el mostrador con el celular en la mano: todo es **mobile-first** (en celular las tablas se convierten en tarjetas apiladas).

## Etapas

| Etapa | Qué resuelve | Estado | Ola |
|---|---|---|---|
| 1 — MVP | Clientes, catálogo, materiales, recetas, ventas, cobranzas, 5 reportes, dashboard | Hecha | — |
| 2 — Stock real | Compras, libro de movimientos, ajuste por conteo, reposición sugerida | Hecha | 0–2 |
| 3 — Multi-usuario | Login, roles `DUENO`/`EMPLEADO`, permisos, trazabilidad | Hecha | 4 |
| 4 — Facturación electrónica | Facturas A/B/C, notas de crédito, CAE | Hecha **con emisor simulado**; ARCA real diferida (5.2) | 5 |
| 5 — Productividad | Producción real, margen real, tiempos por arte | Hecha | 6 |
| 6 — Comercial | Listas de precios, presupuestos, recordatorios de cobranza | Hecha | 7 |

Detalle cronológico en [[Historial por olas]].

## MVP (etapa 1)

1. **Clientes** — alta, edición, baja lógica; ficha con ventas, saldo y pagos. → [[Cobranzas]]
2. **Catálogo de artículos** — lo que se vende; precio, IVA, producto o servicio. → [[Catálogo, materiales y recetas]]
3. **Materiales e insumos** — lo que se consume; un solo catálogo para insumo y reventa.
4. **Costeo por receta** — el corazón del sistema. → [[Costeo por receta]]
5. **Ventas** — costo congelado, numeración por año, descuento de stock. → [[Ventas]]
6. **Cobranzas** — varios pagos por venta; el saldo siempre se calcula.
7. **Reportes** — exactamente 5. → [[Reportes]]
8. **Dashboard** — "¿cómo va el mes?". → [[Dashboard]]

## Lo que cada módulo NO hace (a propósito)

- **Listas de precios**: sin vigencia por fechas, escalas por cantidad ni otra moneda.
- **Presupuestos**: no registra aceptación/rechazo, no reserva stock, no guarda costos, no manda WhatsApp solo.
- **Recordatorios de cobranza**: no envía mensajes ni llama; la lista se arma al abrir la pantalla.
- **Producción**: no registra paradas ni merma por causa, no mide por operario; la estimación no es un presupuesto automático.
- **Facturación**: sin NC parciales, nota de débito, otras monedas, percepciones, FCE MiPyME, CAEA. Ver [[Facturación]].
- **Pagos**: no hay pagos sin venta (anticipos a cuenta).

## Fuera de alcance permanente

Stock por depósito/multi-sucursal, multi-idioma, marketplace propio, liquidación de sueldos, contabilidad completa (asientos, balances, libro diario). Si alguna vez se pide, es **otro producto**, no una extensión de este.

## Riesgos asumidos

| Riesgo | Mitigación |
|---|---|
| El dueño no carga recetas completas | El dashboard marca "artículos sin receta" con costo desconocido |
| Costo real ≠ estimado por receta | Resuelto en la etapa 5: [[Producción y margen real]] |
| Pérdida de datos | Respaldo diario automático: [[Respaldos]] |

Fuente: `docs/01-alcance-funcional.md`.
