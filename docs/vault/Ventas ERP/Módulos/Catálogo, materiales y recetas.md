---
tags: [ventas, modulo]
rutas: [/catalogo, /materiales, /configuracion, /cortes]
---

# Catálogo, materiales y recetas

Datos: [[Datos - Catálogo y costos]]. Lógica: [[Costeo por receta]].

## Catálogo (`/catalogo`) — solo dueño
- Por artículo: costo por receta, precio, margen y **precio necesario para el margen objetivo**.
- Alta/edición con **editor de receta** (materiales, máquinas, mano de obra, override de costo) y costo/margen en vivo con `costing.ts`.
- Marca "sin receta" cuando el costo es desconocido.

## Materiales (`/materiales`)
- Stock, valorización y avisos de reposición. El empleado ve **solo cantidades**.
- Alta/edición (dueño): unidad, mínimo, costo, precio de venta suelto. **Al cambiar el costo muestra qué artículos cambian de margen.**
- `/materiales/[id]`: libro de movimientos y ajuste por conteo físico (dueño) → [[Compras y stock]].

## Configuración (`/configuracion`) — solo dueño
- Nombre del negocio, costo/hora de mano de obra, IVA por defecto, margen objetivo.
- ABM de máquinas con costo por hora (baja con confirmación en el lugar, sin `window.confirm`).
- Datos fiscales del negocio → [[Facturación]].

## Calculadora de cortes (`/cortes`) — solo dueño
Precio de una medida a partir del precio de la plancha entera (`src/lib/cortes.ts`). Usa costos.

Pruebas: `test:costeo`, `test:recetas`, `test:materiales(:db)`, `test:articulos`, `test:configuracion(:db)`.
