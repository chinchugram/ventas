---
tags: [ventas, modulo]
ruta: /
permiso: verCostos, verMargenes (dueño)
---

# Dashboard (`/`)

Respuesta directa a **"¿cómo va el mes?"**. Es la pantalla de inicio del dueño (el empleado entra a `/ventas/nueva`).

- Facturado del mes, cobrado del mes, pendiente de cobro, costo, ganancia y márgenes.
- Gráfico de ventas por día (con tabla oculta para lectores de pantalla, ola 6.4).
- Últimas ventas y top 5 productos.
- **Alertas**: materiales con stock bajo y artículos **sin receta** (margen desconocido).
- **Aviso de respaldo** (`src/components/aviso-respaldo.tsx`): cartel ámbar si el último respaldo tiene más de 48 h o no hay ninguno → [[Respaldos]].

Código: `src/app/page.tsx`, `src/components/tablero.tsx`, `src/lib/queries/dashboard.ts`.
