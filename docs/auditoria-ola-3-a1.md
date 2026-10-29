# Auditoría Ola 3 · tarea 3.3a (parte 1): accesibilidad y mobile a 375 px

Solo reporte: no se modificó nada en `src/`. Las líneas citan la rama `ola-3` (cf861c9).

## Resumen

| Severidad | Cantidad | De las cuales mayores |
|-----------|----------|-----------------------|
| Alta      | 6        | 1                     |
| Media     | 30       | 0                     |
| Baja      | 6        | 0                     |
| **Total** | **42**   | **1**                 |

Los 3 más importantes:

1. **Zoom bloqueado** (`src/app/layout.tsx:23`): `maximumScale: 1` impide ampliar la página por pellizco. Corrección de una línea.
2. **Hoja "Más" sin manejo de foco** (`src/components/navbar.tsx:123-163`): al abrirla el foco queda en el botón "Más" y el Tab siguiente sale a los links de la página de atrás. Es la única corrección mayor.
3. **Métodos de pago desbordados y campos sin nombre en Nueva venta** (`src/components/nueva-venta-form.tsx:463`, `:269`, `:283-289`): "Transferencia" se sale de su botón a 375 px (confirmado en captura), y el select de cliente y el buscador no tienen nombre accesible.

## Alcance y método

- **Pantallas:** `/ventas`, `/ventas/nueva` (vacía, con 2 líneas y cobro parcial), `/ventas/[id]` (con saldo y con "Anular" pago abierto), `/clientes`, `/clientes/nuevo`, `/clientes/[id]`, `/clientes/[id]/editar`, `/cobranzas` (por cliente y por antigüedad) y la hoja "Más".
- **Medición:** Playwright con Chromium a 375 × 812, base `ventas` sembrada, `npm run dev -- -p 3101`. Se midieron desborde horizontal, labels, nombres accesibles, objetivos menores de 44 px, contraste (con colores computados convertidos a sRGB), orden de tabulación y foco, y la hoja "Más". Se revisó visualmente una captura de Nueva venta con líneas.
- **No cubierto:** lector de pantalla real, escritorio (≥ 768 px), modo demo sin base, montos de 8 o más cifras.

## Hallazgos por archivo

Leyenda: **Tipo** = Menor (una o pocas líneas) o Mayor (cambio de comportamiento o de estructura).

### `src/app/layout.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 23 | Alta | Menor | `maximumScale: 1` en el viewport bloquea el zoom por pellizco (WCAG 1.4.4). Una persona con baja visión no puede ampliar. El zoom automático de iOS al enfocar ya se evita con el `font-size: 16px` de los inputs. | Borrar la línea 23 y ajustar el comentario de la línea 22. |
| 35-37 | Media | Menor | No hay enlace "Saltar al contenido". Antes del contenido el Tab recorre logo, Inicio, Ventas, Nueva venta, Clientes y Más (medido). `<main>` no tiene `id`. | Antes de `<Navbar>`: `<a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:bg-marca focus:px-3 focus:py-2 focus:font-semibold focus:text-tinta">Saltar al contenido</a>`. En `<main>`: `id="contenido"`. |

### `src/app/globals.css`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 34 | Media | Menor | El borde de inputs `slate-300` tiene 1,5:1 sobre blanco. WCAG 1.4.11 pide 3:1 para identificar el control. | `border-slate-300` → `border-slate-500` (4,8:1). |
| 35 | Media | Menor | Foco de inputs débil: ring de 2 px al 30 % (`ring-marca/30`, medido) y borde naranja de 2,4:1. Los botones y links conservan el outline del navegador, pero los inputs no se ven bien al foco. | `focus:border-marca focus:ring-marca/30` → `focus:border-marca-texto focus:ring-marca-texto` (4,7:1). |

### `src/components/ui.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 60 | Media | Menor | La descripción de cada sección (`text-slate-500`) queda sobre el fondo de página `slate-100` con 4,35:1. Aparece en todas las pantallas. | `text-slate-500` → `text-slate-600` (≈ 6,9:1). |

### `src/components/navbar.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 123-163 | Alta | Mayor | Hoja "Más": al abrirla el foco no se mueve y queda en el botón "Más". El Tab siguiente sale a los links de la página de atrás (medido: los 6 Tab seguidos caen en links del fondo). No tiene `aria-modal` ni botón "Cerrar"; solo cierra con el fondo o Escape. | Opción simple: usar `<dialog>` con `showModal()`, que da foco, atrapado de Tab y Escape nativos, y devuelve el foco al cerrar. Alternativa: `useRef` en el primer link con `.focus()` en un efecto, `aria-modal="true"`, atrapar Tab dentro y devolver el foco a "Más" al cerrar. Agregar un botón "Cerrar" de 44 px. |
| 188-191 | Baja | Menor | El botón "Más" tiene `aria-expanded` pero no `aria-controls`. | `aria-controls="hoja-mas"` en el botón y `id="hoja-mas"` en el dialog. |
| 192, 213 | Baja | Menor | Etiquetas de la barra inferior en `text-[11px]`, muy chicas para leer en la calle. | `text-[11px]` → `text-xs` (12 px). Verificar que "Clientes" entre en 75 px. |

### `src/components/nueva-venta-form.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 269 | Alta | Menor | El `<select>` del cliente no tiene nombre accesible: el `<h2>` "Cliente" no está asociado. | `<select aria-label="Cliente" ...>` (o `id` y `<label htmlFor>`). |
| 283-289 | Alta | Menor | El buscador de artículos solo tiene placeholder, que desaparece al escribir. | Agregar `aria-label="Buscar artículo en el catálogo"`. |
| 301 | Alta | Menor | Chip de artículo ya cargado: `text-marca` (#f09102) sobre `bg-marca-claro` = 2,2:1 (medido). El estado "ya está en la venta" se ve solo por color. | `text-marca` → `text-marca-texto` (4,7:1). |
| 463-468 | Alta | Menor | Métodos de pago en `grid-cols-4` a 375 px: "Transferencia" necesita 104 px de texto en una caja de 78 px y se sale encima de "Tarjeta" (confirmado en la captura). | `grid grid-cols-2 gap-2 sm:grid-cols-4` en la línea 463. |
| 299 | Media | Menor | Chips de artículos con `py-2.5`: 42 px de alto. | `py-2.5` → `py-3` (≥ 44 px). |
| 266, 280, 323, 326, 333, 393, 435 | Media | Menor | Títulos de sección, contador de líneas, aviso "Todavía no agregaste nada" y texto de costo en `text-slate-500` sobre `slate-100` (4,35:1). | `text-slate-500` → `text-slate-600` en esas líneas. |
| 308, 382 | Media | Menor | "sin receta" y "costo desconocido" en `text-amber-600` = 3,2:1. | `text-amber-600` → `text-amber-700` (5,0:1). |
| 345-347 | Media | Menor | "Quitar" mide 52 × 24 px y no dice qué artículo quita (hay dos "Quitar" en el detalle). | Clase: `shrink-0 inline-flex min-h-11 items-center rounded-md px-3 text-xs font-semibold text-red-600`. Agregar `aria-label={`Quitar ${l.articulo.nombre}`}`. |
| 367, 373, 379 | Media | Menor | `<label className="text-xs">` (Unitario, Total, Ganancia) no está asociado a ningún control: el lector lo anuncia como etiqueta sin campo. | Cambiar a `<span className="mb-1 block text-xs font-medium text-slate-700">` (tres veces). |
| 412 | Media | Menor | "Ver receta" mide 82 × 16 px. | Clase: `inline-flex min-h-11 items-center text-sm font-medium text-marca-texto`. |
| 440-446, 465-467, 785-790 | Media | Menor | Botones de cobro y de método (`Boton` con `toggle`) no exponen cuál está activo (sin `aria-pressed`): el estado es solo color. Miden 42 px. | En el `<button>` de `Boton`: `aria-pressed={toggle ? !!activo : undefined}` y `py-2.5` → `py-3`. |
| 666-669 | Media | Menor | "Volver a editar la venta" es texto de 20 px de alto en gris de 4,35:1. | Clase del botón: `w-full min-h-11 text-sm text-slate-600 hover:underline`. |
| 707, 715 | Media | Menor | Botones del banner demo (solo se ve sin base de datos): `py-2` (≈ 32 px) y `py-1.5` (≈ 28 px). | Agregar `min-h-11` a ambos. |
| 709 | Baja | Menor | El emoji "⚡" del botón se anuncia en el lector ("rayo"). | `<span aria-hidden="true">⚡</span> Cargar ejemplo demo`. |

### `src/app/ventas/nueva/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 50-56 | Media | Menor | "Volver" mide 69 × 38 px (link con `py-2`). | En la clase (línea 52) agregar `inline-flex min-h-11 items-center`. |

### `src/app/ventas/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 41 | Baja | Menor | El nombre de cada venta es `<p>`: la lista no tiene encabezados y el lector no permite saltar de una venta a otra. | `<p className="font-medium text-slate-900">` → `<h2 className="font-medium text-slate-900">` (el estilo no cambia). |
| 43-45 | Media | Menor | El número de venta, único acceso al detalle, es un link inline de 65 × 20 px y sin subrayado en reposo: se confunde con el texto. | Línea 43: `inline-flex min-h-11 items-center underline underline-offset-2`. |
| 82 | Media | Menor | "al día" en `text-slate-400` sobre blanco: 2,6:1. | `text-slate-400` → `text-slate-500` (4,8:1). |

### `src/app/ventas/[id]/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 45 | Media | Menor | "Volver" mide 69 × 38 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |
| 61-63 | Media | Menor | "Ver cliente" mide 61 × 20 px. | Clase: `inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline underline-offset-2`. |
| 117, 129 | Media | Menor | Pagos anulados y montos de venta anulada en `text-slate-400 line-through`: 2,6:1. | `text-slate-400` → `text-slate-500` (el tachado se mantiene). |

### `src/app/ventas/[id]/_componentes/anular-pago-boton.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 23 | Media | Menor | "Anular" (acción destructiva sobre un pago) mide 54 × 24 px. | Clase: `inline-flex min-h-11 items-center rounded-md px-3 text-xs font-semibold text-red-700 underline-offset-2 hover:underline`. |

### `src/app/clientes/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 14 | Media | Menor | "Nuevo cliente" mide 117 × 36 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |
| 89 | Media | Menor | El `<summary>` "Dados de baja" tiene unos 20 px de alto. | Clase: `inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-600`. |
| 97 | Media | Menor | Datos de clientes dados de baja en `text-slate-400`: 2,6:1. | `text-slate-400` → `text-slate-500`. |

### `src/app/clientes/[id]/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 42, 49 | Media | Menor | "Volver" (69 × 38 px) y "Editar" (63 × 38 px) de la cabecera. | Agregar `inline-flex min-h-11 items-center` a ambas clases. |
| 105, 111, 155 | Media | Menor | Ventas y pagos anulados en `text-slate-400`: 2,6:1. | `text-slate-400` → `text-slate-500`. |

### `src/app/clientes/[id]/editar/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 23 | Media | Menor | "Volver" mide 69 × 38 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |

### `src/app/clientes/nuevo/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 19 | Media | Menor | "Volver" mide 69 × 38 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |

### `src/app/clientes/_componentes/cliente-form.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 67, 88, 96, 104 | Media | Menor | `autoComplete="off"` en nombre, teléfono, email y dirección. Impide el autocompletado del navegador y no cumple WCAG 1.3.5 (propósito del campo identificable). | Línea 67: `autoComplete="organization"`. Línea 88: `autoComplete="tel"`. Línea 96: `autoComplete="email"`. Línea 104: `autoComplete="street-address"`. |

### `src/app/cobranzas/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 69 | Media | Menor | Pestañas "Por cliente" y "Por antigüedad" con `py-2`: 36 px de alto. | `py-2` → `py-3`. |
| 84 | Baja | Menor | El nombre del cliente es link pero el subrayado aparece solo al pasar el mouse: no se distingue del texto. | Agregar `underline underline-offset-2` fijo en el Link. |
| 96 | Media | Menor | Teléfono como `tel:` inline de 17 px de alto. | Agregar `inline-flex min-h-11 items-center` al `<a>`. |
| 125, 154, 168 | Media | Menor | "Sin deuda en este tramo" y pagos o ventas anulados en `text-slate-400`: 2,6:1. | `text-slate-400` → `text-slate-500`. |

### `src/components/form/campos.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 30 | Baja | Menor | Los campos obligatorios solo tienen el atributo `required`: no se ven en pantalla (WCAG 3.3.2). | Pasar `requerido` a `Envoltura` y mostrar `<span aria-hidden="true" className="text-red-700"> *</span>` después de la etiqueta. Pasar `requerido={resto.required}` desde `CampoTexto`, `CampoDecimal`, `CampoSelect` y `CampoNotas`. Agregar "* obligatorio" en el pie de cada formulario. |

## Verificado sin hallazgos

- **Desborde horizontal de página:** ninguna de las 13 escenarios supera los 375 px (`scrollWidth` = 375). El único desborde es interno, el de "Transferencia".
- **Tablas:** no hay tablas visibles a 375 px. Las listas usan tarjetas.
- **Jerarquía de títulos:** un `h1` por pantalla y `h2` para las secciones, sin saltos de nivel.
- **Formularios de cliente y pago:** los labels están asociados (`campos.tsx` usa `useId` y `htmlFor`). Los errores tienen `aria-invalid` y `aria-describedby`. Los avisos usan `role="alert"` o `role="status"`.
- **Textos alternativos e íconos:** el logo tiene `alt`, los íconos decorativos tienen `aria-hidden`, y el botón flotante "Nueva venta" tiene `aria-label`.
- **Foco:** todos los elementos de tabulación muestran indicador (outline en botones y links; ring en inputs, con el problema de la línea 35 de `globals.css`). El orden es lógico en Nueva venta y en el detalle de venta.
- **Objetivos grandes:** las tarjetas de cliente y de cobranza son links de bloque completo. Los botones principales (`py-3`) cumplen 44 px.
- **Barra "Guardar venta":** no se solapa con la barra inferior (medido: barra entre 669 y 748 px, barra inferior desde 749 px).

## Limitaciones

- Los nombres accesibles se midieron con reglas (labels, `aria-label`, texto), no con el árbol de accesibilidad de un lector de pantalla real.
- El contraste se midió sobre fondo sólido con colores computados. Estas pantallas no usan gradientes ni imágenes de fondo.
- El modo demo (sin base de datos) no se midió en vivo; los banners demo se revisaron por código.
- Montos de 8 o más cifras en las listas (`ventas/page.tsx:65` y `clientes/page.tsx:67`, grillas de 3 columnas): posible desborde, no verificado porque el seed tiene montos chicos.
- Escritorio (≥ 768 px) queda fuera del alcance de esta parte.

## Entorno y desvíos respecto de la tarea

- **Nombre de la rama:** `ola-3/3.3a-1` no se puede crear porque existe la ref `ola-3`. Se usó `ola-3.3a-1`.
- **Base de la rama:** la worktree estaba en `d090ce6`, anterior a `ola-3` (cf861c9). Se reubicó la rama en `ola-3`, porque las pantallas de cobranzas, `/ventas/[id]` y `/clientes/[id]` solo existen ahí.
- **node_modules:** el symlink hacia la raíz fue rechazado por Turbopack ("points out of the filesystem root"). Se usó una copia con hard links (`cp -al`, sin duplicar espacio) y se corrió `prisma generate` en la worktree.
