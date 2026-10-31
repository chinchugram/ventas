---
tags: [ventas, moc]
proyecto: ventas
repo: chinchugram/ventas
rama_base: main
actualizado: 2026-10-31
---

# Ventas ERP — Inicio

ERP mínimo para un **comercio de corte láser e insumos de marca** (stickers, cartelería, rotulación, señalética).

> El dueño no sabe **qué** vende, **cuánto** cobró en el mes ni **cuánto margen** tiene. Este sistema resuelve exactamente eso, sin convertirse en un ERP genérico.

La idea central: **el costo no se tipea, se calcula** desde la receta de cada artículo. Ver [[Costeo por receta]].

## Mapa de la documentación

### Producto
- [[Visión y alcance]]: objetivos, qué hace y qué NO hace
- [[Pantallas y rutas]]: todas las rutas de la app y quién las ve
- [[Glosario]]

### Módulos funcionales
- [[Dashboard]]
- [[Ventas]]
- [[Cobranzas]]
- [[Catálogo, materiales y recetas]]
- [[Compras y stock]]
- [[Listas de precios y presupuestos]]
- [[Reportes]]
- [[Producción y margen real]]
- [[Facturación]]
- [[Usuarios y acceso]]

### Técnica
- [[Arquitectura]]: stack, capas y estructura de carpetas
- [[Reglas del proyecto]]: las 9 reglas que sostienen el código
- [[Modelo de datos]]: entidades, restricciones y migraciones
- [[Seguridad y permisos]]: login, sesiones, matriz de permisos
- [[Integración ARCA (tarea 5.2)]]: plan para la facturación real

### Operación
- [[Arranque y entorno local]]
- [[Scripts y pruebas]]
- [[Respaldos]]
- [[Despliegue]]

### Gestión
- [[Historial por olas]]
- [[Pendientes y deuda técnica]]
- [[Dudas para el contador]]

## Estado en una línea

Etapas 1, 2, 3, 5 y 6 **hechas**; etapa 4 (facturación) hecha con **emisor simulado**. Lo único pendiente del plan es la **5.2: integración real con ARCA** (diferida). Rama actual de trabajo: `staging`.
