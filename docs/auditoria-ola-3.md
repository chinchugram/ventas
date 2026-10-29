# Auditoría Ola 3 (tarea 3.3)

Unificación de tres informes de subagentes (Haiku) más el estado de cada hallazgo después de la ola.
Los detalles completos están en las partes 1, 2 y 3 más abajo; los números de línea citan la base previa a las correcciones.

## Estado al cierre de la ola

**Aplicado por el orquestador** (correcciones menores, un solo commit):

- Zoom por pellizco habilitado (se quitó `maximumScale`), enlace "Saltar al contenido" y fondo de página unificado.
- Bordes de inputs `slate-500` (3:1) y foco `marca-texto` en `globals.css`.
- Contraste: texto secundario `slate-500/400` → `slate-600/500` en descripciones, títulos de sección, pagos anulados y rótulos del gráfico.
- Áreas táctiles de 44 px (`min-h-11`) en botones "Volver / Nuevo / Editar / Agregar", nombres de artículos, materiales, máquinas y ventas, "Quitar", "Anular", "Ver receta", "Ver cliente", pestañas de cobranzas, teléfono.
- Nueva venta: nombre accesible del select de cliente y del buscador, `aria-pressed` en botones de método y modo de cobro, métodos de pago en 2 columnas a 375 px, "Quitar" con el nombre del artículo, etiquetas sin control convertidas a `span`, colores de aviso con contraste AA.
- `th scope="col"` en las tablas, barra inferior en 12 px, `aria-live` fuera de la lista de impacto de margen.
- `/reportes`: numeración 1 a 5 en orden de pantalla, contraste, enlace a `/reportes/stock`.

**Pendiente (mayor o decisión de diseño):**

- N2 / hoja "Más" del navbar: mover el foco al abrir, atrapar Tab, botón "Cerrar", `aria-modal` (conviene `<dialog>` con `showModal()`).
- N1: entre 768 y 1023 px el menú de escritorio oculta Cobranzas y Reportes (scroll lateral sin indicador).
- N5: "Reposición" no aparece en el menú de escritorio (decisión de navegación).
- F2: `window.confirm()` al dar de baja una máquina; unificar con la confirmación en el lugar de `boton-activo.tsx`.
- Obligatorio visible (`*`) en formularios (WCAG 3.3.2) y títulos `h3` en las líneas de receta.
- TB2: el gráfico de ventas por día no expone los montos a lectores de pantalla ni en celular.
- Baja prioridad no aplicada: avisos `sr-only` de severidad (P2) y de semáforo (U2), `aria-controls` en "Más", h2 en el listado de ventas, `min-w-0 truncate` en tarjetas con montos muy largos (U3, no reproducido), error del factor de reposición asociado al input (R1), autocompletado del formulario de clientes.
- No se aplicó el `autoComplete` de los formularios de cliente (hallazgo de la parte 1): ahí se cargan datos de terceros, no del usuario, y autocompletar con los propios sería un error.
- No auditado: `/cortes`, `/reportes/stock` (solo se midió el desborde a 375 px: sin desborde), lector de pantalla real, escritorio.

**Build y dependencias:** `npm run build` y `npm run typecheck` limpios en el árbol principal (el fallo de Turbopack de la parte 3 era del symlink de `node_modules` en el worktree). Las vulnerabilidades de `next` y `zod` (runtime) siguen **sin corregir**: ver la parte 3, secciones 4 a 5. Son actualizaciones no breaking dentro de los rangos de `package.json`; queda pendiente la decisión de aplicarlas.

---

# Parte 1 — ventas, clientes, cobranzas

Solo reporte: no se modificó nada en `src/`. Las líneas citan la rama `ola-3` (cf861c9).

### Resumen

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

### Alcance y método

- **Pantallas:** `/ventas`, `/ventas/nueva` (vacía, con 2 líneas y cobro parcial), `/ventas/[id]` (con saldo y con "Anular" pago abierto), `/clientes`, `/clientes/nuevo`, `/clientes/[id]`, `/clientes/[id]/editar`, `/cobranzas` (por cliente y por antigüedad) y la hoja "Más".
- **Medición:** Playwright con Chromium a 375 × 812, base `ventas` sembrada, `npm run dev -- -p 3101`. Se midieron desborde horizontal, labels, nombres accesibles, objetivos menores de 44 px, contraste (con colores computados convertidos a sRGB), orden de tabulación y foco, y la hoja "Más". Se revisó visualmente una captura de Nueva venta con líneas.
- **No cubierto:** lector de pantalla real, escritorio (≥ 768 px), modo demo sin base, montos de 8 o más cifras.

### Hallazgos por archivo

Leyenda: **Tipo** = Menor (una o pocas líneas) o Mayor (cambio de comportamiento o de estructura).

#### `src/app/layout.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 23 | Alta | Menor | `maximumScale: 1` en el viewport bloquea el zoom por pellizco (WCAG 1.4.4). Una persona con baja visión no puede ampliar. El zoom automático de iOS al enfocar ya se evita con el `font-size: 16px` de los inputs. | Borrar la línea 23 y ajustar el comentario de la línea 22. |
| 35-37 | Media | Menor | No hay enlace "Saltar al contenido". Antes del contenido el Tab recorre logo, Inicio, Ventas, Nueva venta, Clientes y Más (medido). `<main>` no tiene `id`. | Antes de `<Navbar>`: `<a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:bg-marca focus:px-3 focus:py-2 focus:font-semibold focus:text-tinta">Saltar al contenido</a>`. En `<main>`: `id="contenido"`. |

#### `src/app/globals.css`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 34 | Media | Menor | El borde de inputs `slate-300` tiene 1,5:1 sobre blanco. WCAG 1.4.11 pide 3:1 para identificar el control. | `border-slate-300` → `border-slate-500` (4,8:1). |
| 35 | Media | Menor | Foco de inputs débil: ring de 2 px al 30 % (`ring-marca/30`, medido) y borde naranja de 2,4:1. Los botones y links conservan el outline del navegador, pero los inputs no se ven bien al foco. | `focus:border-marca focus:ring-marca/30` → `focus:border-marca-texto focus:ring-marca-texto` (4,7:1). |

#### `src/components/ui.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 60 | Media | Menor | La descripción de cada sección (`text-slate-500`) queda sobre el fondo de página `slate-100` con 4,35:1. Aparece en todas las pantallas. | `text-slate-500` → `text-slate-600` (≈ 6,9:1). |

#### `src/components/navbar.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 123-163 | Alta | Mayor | Hoja "Más": al abrirla el foco no se mueve y queda en el botón "Más". El Tab siguiente sale a los links de la página de atrás (medido: los 6 Tab seguidos caen en links del fondo). No tiene `aria-modal` ni botón "Cerrar"; solo cierra con el fondo o Escape. | Opción simple: usar `<dialog>` con `showModal()`, que da foco, atrapado de Tab y Escape nativos, y devuelve el foco al cerrar. Alternativa: `useRef` en el primer link con `.focus()` en un efecto, `aria-modal="true"`, atrapar Tab dentro y devolver el foco a "Más" al cerrar. Agregar un botón "Cerrar" de 44 px. |
| 188-191 | Baja | Menor | El botón "Más" tiene `aria-expanded` pero no `aria-controls`. | `aria-controls="hoja-mas"` en el botón y `id="hoja-mas"` en el dialog. |
| 192, 213 | Baja | Menor | Etiquetas de la barra inferior en `text-[11px]`, muy chicas para leer en la calle. | `text-[11px]` → `text-xs` (12 px). Verificar que "Clientes" entre en 75 px. |

#### `src/components/nueva-venta-form.tsx`

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

#### `src/app/ventas/nueva/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 50-56 | Media | Menor | "Volver" mide 69 × 38 px (link con `py-2`). | En la clase (línea 52) agregar `inline-flex min-h-11 items-center`. |

#### `src/app/ventas/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 41 | Baja | Menor | El nombre de cada venta es `<p>`: la lista no tiene encabezados y el lector no permite saltar de una venta a otra. | `<p className="font-medium text-slate-900">` → `<h2 className="font-medium text-slate-900">` (el estilo no cambia). |
| 43-45 | Media | Menor | El número de venta, único acceso al detalle, es un link inline de 65 × 20 px y sin subrayado en reposo: se confunde con el texto. | Línea 43: `inline-flex min-h-11 items-center underline underline-offset-2`. |
| 82 | Media | Menor | "al día" en `text-slate-400` sobre blanco: 2,6:1. | `text-slate-400` → `text-slate-500` (4,8:1). |

#### `src/app/ventas/[id]/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 45 | Media | Menor | "Volver" mide 69 × 38 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |
| 61-63 | Media | Menor | "Ver cliente" mide 61 × 20 px. | Clase: `inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline underline-offset-2`. |
| 117, 129 | Media | Menor | Pagos anulados y montos de venta anulada en `text-slate-400 line-through`: 2,6:1. | `text-slate-400` → `text-slate-500` (el tachado se mantiene). |

#### `src/app/ventas/[id]/_componentes/anular-pago-boton.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 23 | Media | Menor | "Anular" (acción destructiva sobre un pago) mide 54 × 24 px. | Clase: `inline-flex min-h-11 items-center rounded-md px-3 text-xs font-semibold text-red-700 underline-offset-2 hover:underline`. |

#### `src/app/clientes/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 14 | Media | Menor | "Nuevo cliente" mide 117 × 36 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |
| 89 | Media | Menor | El `<summary>` "Dados de baja" tiene unos 20 px de alto. | Clase: `inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-600`. |
| 97 | Media | Menor | Datos de clientes dados de baja en `text-slate-400`: 2,6:1. | `text-slate-400` → `text-slate-500`. |

#### `src/app/clientes/[id]/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 42, 49 | Media | Menor | "Volver" (69 × 38 px) y "Editar" (63 × 38 px) de la cabecera. | Agregar `inline-flex min-h-11 items-center` a ambas clases. |
| 105, 111, 155 | Media | Menor | Ventas y pagos anulados en `text-slate-400`: 2,6:1. | `text-slate-400` → `text-slate-500`. |

#### `src/app/clientes/[id]/editar/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 23 | Media | Menor | "Volver" mide 69 × 38 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |

#### `src/app/clientes/nuevo/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 19 | Media | Menor | "Volver" mide 69 × 38 px. | Agregar `inline-flex min-h-11 items-center` a la clase. |

#### `src/app/clientes/_componentes/cliente-form.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 67, 88, 96, 104 | Media | Menor | `autoComplete="off"` en nombre, teléfono, email y dirección. Impide el autocompletado del navegador y no cumple WCAG 1.3.5 (propósito del campo identificable). | Línea 67: `autoComplete="organization"`. Línea 88: `autoComplete="tel"`. Línea 96: `autoComplete="email"`. Línea 104: `autoComplete="street-address"`. |

#### `src/app/cobranzas/page.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 69 | Media | Menor | Pestañas "Por cliente" y "Por antigüedad" con `py-2`: 36 px de alto. | `py-2` → `py-3`. |
| 84 | Baja | Menor | El nombre del cliente es link pero el subrayado aparece solo al pasar el mouse: no se distingue del texto. | Agregar `underline underline-offset-2` fijo en el Link. |
| 96 | Media | Menor | Teléfono como `tel:` inline de 17 px de alto. | Agregar `inline-flex min-h-11 items-center` al `<a>`. |
| 125, 154, 168 | Media | Menor | "Sin deuda en este tramo" y pagos o ventas anulados en `text-slate-400`: 2,6:1. | `text-slate-400` → `text-slate-500`. |

#### `src/components/form/campos.tsx`

| Línea | Sev. | Tipo | Qué pasa | Arreglo |
|-------|------|------|----------|---------|
| 30 | Baja | Menor | Los campos obligatorios solo tienen el atributo `required`: no se ven en pantalla (WCAG 3.3.2). | Pasar `requerido` a `Envoltura` y mostrar `<span aria-hidden="true" className="text-red-700"> *</span>` después de la etiqueta. Pasar `requerido={resto.required}` desde `CampoTexto`, `CampoDecimal`, `CampoSelect` y `CampoNotas`. Agregar "* obligatorio" en el pie de cada formulario. |

### Verificado sin hallazgos

- **Desborde horizontal de página:** ninguna de las 13 escenarios supera los 375 px (`scrollWidth` = 375). El único desborde es interno, el de "Transferencia".
- **Tablas:** no hay tablas visibles a 375 px. Las listas usan tarjetas.
- **Jerarquía de títulos:** un `h1` por pantalla y `h2` para las secciones, sin saltos de nivel.
- **Formularios de cliente y pago:** los labels están asociados (`campos.tsx` usa `useId` y `htmlFor`). Los errores tienen `aria-invalid` y `aria-describedby`. Los avisos usan `role="alert"` o `role="status"`.
- **Textos alternativos e íconos:** el logo tiene `alt`, los íconos decorativos tienen `aria-hidden`, y el botón flotante "Nueva venta" tiene `aria-label`.
- **Foco:** todos los elementos de tabulación muestran indicador (outline en botones y links; ring en inputs, con el problema de la línea 35 de `globals.css`). El orden es lógico en Nueva venta y en el detalle de venta.
- **Objetivos grandes:** las tarjetas de cliente y de cobranza son links de bloque completo. Los botones principales (`py-3`) cumplen 44 px.
- **Barra "Guardar venta":** no se solapa con la barra inferior (medido: barra entre 669 y 748 px, barra inferior desde 749 px).

### Limitaciones

- Los nombres accesibles se midieron con reglas (labels, `aria-label`, texto), no con el árbol de accesibilidad de un lector de pantalla real.
- El contraste se midió sobre fondo sólido con colores computados. Estas pantallas no usan gradientes ni imágenes de fondo.
- El modo demo (sin base de datos) no se midió en vivo; los banners demo se revisaron por código.
- Montos de 8 o más cifras en las listas (`ventas/page.tsx:65` y `clientes/page.tsx:67`, grillas de 3 columnas): posible desborde, no verificado porque el seed tiene montos chicos.
- Escritorio (≥ 768 px) queda fuera del alcance de esta parte.

### Entorno y desvíos respecto de la tarea

- **Nombre de la rama:** `ola-3/3.3a-1` no se puede crear porque existe la ref `ola-3`. Se usó `ola-3.3a-1`.
- **Base de la rama:** la worktree estaba en `d090ce6`, anterior a `ola-3` (cf861c9). Se reubicó la rama en `ola-3`, porque las pantallas de cobranzas, `/ventas/[id]` y `/clientes/[id]` solo existen ahí.
- **node_modules:** el symlink hacia la raíz fue rechazado por Turbopack ("points out of the filesystem root"). Se usó una copia con hard links (`cp -al`, sin duplicar espacio) y se corrió `prisma generate` en la worktree.

---

# Parte 2 — resto de pantallas

Solo reporte: no se modificó ningún archivo de `src/`. Base: `ola-3` en `55692a6`. Medición a 375 px de ancho (Chromium vía Playwright) contra la base `ventas` sembrada.

Severidad: **alta** bloquea una tarea o deja fuera a un usuario; **media** dificulta el uso o incumple un criterio WCAG AA; **baja** es pulido o consistencia. Tipo: **menor** = una o pocas líneas; **mayor** = requiere decidir diseño o reestructurar.

### Resumen

Hallazgos: **38** (alta 0, media 18, baja 20). Correcciones menores: 34. Mayores: 4 (N1, N2, N5, F2).

Los tres más importantes:

1. **Áreas táctiles menores a 44 px en acciones principales** (G3, C1 a C4, M1, M2, A1, RP1). "Volver", "Nuevo…", "Editar" y "Nueva compra" miden 36 a 38 px de alto. "Ver receta", nombres de artículos y de materiales, y la flecha de período miden 20 a 24 px. El dueño opera con guantes, así que es lo que más pesa.
2. **Contraste insuficiente.** El texto secundario `text-slate-500` sobre el fondo real de la página (slate-100) da 4.35:1 en la descripción de cada pantalla (G1). Las etiquetas del gráfico de ventas y los números de ranking dan 2.6:1 (TB1, RP2).
3. **Foco de teclado débil y hoja "Más" sin manejo de foco.** El borde y el anillo de foco de los inputs son naranja a 2.4:1 y el anillo es 30 % de opacidad (G2). Al abrir la hoja "Más" el foco queda detrás de ella (N2).

Verificado sin hallazgos a 375 px:

- **Desborde horizontal:** `scrollWidth` = 375 en las 14 rutas auditadas.
- **Etiquetas de formulario:** los 33 controles de las rutas con formularios tienen `label` asociado por `htmlFor` o `aria-label`. Incluye `/catalogo/nuevo`, `/materiales/nuevo`, `/materiales/[id]/editar`, `/compras/nueva`, `/reposicion`, `/configuracion` y `/configuracion/maquinas/nueva`.
- **Foco visible:** todas las paradas de Tab en las 14 rutas muestran contorno o anillo.
- **Tablas en celular:** el componente `Tabla` (`src/components/ui.tsx`) pasa a tarjetas apiladas bajo `sm`. No hay scroll horizontal.
- **Botones de solo ícono:** el de configuración, "Nueva venta" y "Más" de la barra tienen `aria-label`. "Quitar" también.
- **Jerarquía de títulos:** un `h1` por pantalla y `h2` por sección. Verificado por DOM en inicio, catálogo, materiales y reportes.

Alcance de pantallas: todas las pedidas existen en esta base, incluidas `/catalogo/nuevo`, `/catalogo/[id]`, `/materiales/nuevo`, `/materiales/[id]`, `/materiales/[id]/editar`, `/reposicion`, `/compras`, `/compras/nueva` y `/configuracion`. Se excluyó `/reportes/stock` según lo pedido. No se auditaron `/ventas`, `/ventas/nueva`, `/clientes`, `/cobranzas`, `/cortes` ni `/configuracion/maquinas/[id]`, aunque figuran en el navbar.

### Hallazgos transversales (estilos globales y patrones repetidos)

**G1** · media · menor — `src/components/ui.tsx:60` (descripción de `Seccion`), `src/app/page.tsx:103,125,161,185` (encabezados de sección), `src/app/materiales/page.tsx:165` (enlace "Ver … dados de baja"), `src/app/reportes/page.tsx:169` (descripción de cada reporte).
Qué pasa: `text-slate-500` sobre el fondo real de la página, que es slate-100 (`globals.css:21` gana sobre `bg-slate-50` de `layout.tsx:34`). Da 4.35:1 para texto de 14 px, por debajo de 4.5:1. Se ve en todas las pantallas.
Arreglo: cambiar `text-slate-500` por `text-slate-600` (6.9:1) en esos cuatro lugares. Alternativa global: `bg-slate-50` en `body` de `globals.css:21`, que da 4.6:1.

**G2** · media · menor — `src/app/globals.css:35` (`focus:border-marca focus:ring-2 focus:ring-marca/30`).
Qué pasa: el borde naranja `#f09102` sobre blanco da 2.4:1 y el anillo al 30 % queda casi invisible. Afecta a todos los inputs, selects y textarea (WCAG 1.4.11 pide 3:1 para el indicador de foco).
Arreglo: `@apply focus:border-tinta focus:ring-2 focus:ring-marca focus:outline-none;` El borde negro da más de 15:1 y el anillo naranja al 100 % queda visible.

**G3** · media · menor — patrón de botones y enlaces de acción con `px-3 py-2 text-sm`, que miden 36 a 38 px de alto. Ocurrencias:
- `src/app/materiales/page.tsx:21` (`BOTON_SECUNDARIO`: "Reposición", "Registrar compra", "Volver") y `:35` ("Nuevo material").
- `src/app/catalogo/[id]/page.tsx:30` y `src/app/catalogo/nuevo/page.tsx:23` ("Volver").
- `src/app/materiales/[id]/page.tsx:29,35` ("Editar", "Volver") y `src/app/materiales/nuevo/page.tsx:21`.
- `src/app/materiales/[id]/editar/page.tsx:22` (constante `boton`).
- `src/app/compras/nueva/page.tsx:37` ("Volver") y `src/app/compras/page.tsx:17` ("Nueva compra").
- `src/app/configuracion/page.tsx:41` ("Agregar máquina"), `src/app/configuracion/maquinas/nueva/page.tsx:19` y `src/app/configuracion/maquinas/[id]/page.tsx:24`.
- `src/app/reposicion/page.tsx:24` ("Materiales").
Arreglo: cambiar `py-2` por `py-3` (20 px de línea + 24 px = 44 px). Alternativa: añadir `inline-flex min-h-11 items-center` a la clase.

**G4** · baja · menor — `src/app/layout.tsx:34` (`bg-slate-50`) contradice `src/app/globals.css:21` (`bg-slate-100`). Gana slate-100, así que la intención del layout no se cumple.
Arreglo: dejar un solo fondo. Quitar `bg-slate-50` del layout, o cambiar el global a `bg-slate-50` si se quiere el fondo más claro. Ajustar G1 según el elegido.

**G5** · baja · menor — `src/app/layout.tsx:35-37`. No hay enlace "Saltar al contenido". Con el navbar, un usuario de teclado necesita unas 7 pulsaciones para llegar a `<main>`.
Arreglo: al inicio de `<body>`, `<a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Saltar al contenido</a>`, y `id="contenido"` en el `<main>` de `:37`.

### Navbar

**N1** · media · mayor — `src/components/navbar.tsx:76` (`nav` del escritorio con `overflow-x-auto`).
Qué pasa: entre 768 y 1023 px la fila de enlaces se desplaza de costado sin indicador. A 768 px, "Cobranzas" y "Reportes" quedan fuera de vista. A 1024 px, "Reportes" sale del contenedor. Medido: `scrollWidth` 680 contra `clientWidth` 585 a 768 px.
Arreglo: decisión de diseño. Opción A: en `md` mostrar solo `PRINCIPALES` más un botón "Más" que abra la misma hoja de celular, y pasar la fila completa a `xl:flex`. Opción B: subir el punto de corte de la barra inferior a `lg` (`md:hidden` a `lg:hidden` en `:166` y `md:flex` a `lg:flex` en `:76`).

**N2** · media · mayor — `src/components/navbar.tsx:123-163` (hoja "Más").
Qué pasa: al abrirla, el foco no se mueve dentro del diálogo. Falta `aria-modal="true"` en `:129`. No hay botón "Cerrar" visible; solo se cierra tocando el fondo o con Escape. La página de atrás sigue en el orden de Tab.
Arreglo: `aria-modal="true"` en el `div role="dialog"` (`:129`); `autoFocus` en el primer enlace de la lista (`:140`); botón de cierre con `aria-label="Cerrar"` en la cabecera de la hoja; y un tramo de `useEffect` que devuelva el foco al botón "Más" al cerrar (`:191`). El atrapado de foco completo es un cambio mayor.

**N3** · baja · menor — `src/components/navbar.tsx:192` y `:213`. Texto de la barra inferior en `text-[11px]`.
Arreglo: `text-xs` (12 px). Hay espacio en la barra de 5 columnas.

**N4** · baja · menor — `src/components/navbar.tsx:70` (logo: 51×40 px) y `:103` (ícono de configuración: `p-2` con ícono de 20 px, 36 px de área).
Arreglo: en `:103`, `p-3` (44 px). En `:70`, agregar `p-1` al enlace del logo para llegar a 44 px de alto sin cambiar el logo.

**N5** · baja · mayor — `src/components/navbar.tsx:27`. "Reposición" tiene `soloCelular: true`, así que en escritorio no hay enlace desde el menú (solo desde Materiales). Es una decisión de navegación, no un error de código.
Arreglo: confirmar con el dueño. Si debe verse en escritorio, quitar `soloCelular` y dejar que N1 resuelva el espacio.

### Inicio (`src/app/page.tsx`)

**P1** · baja · menor — `src/app/page.tsx:202-206` ("Ver catálogo completo →"): enlace inline de 20 px de alto.
Arreglo: `inline-flex min-h-11 items-center` en lugar de `inline-block`.

**P2** · baja · menor — `src/app/page.tsx:110-116` (alertas "Para mirar"). La severidad (crítica o aviso) se comunica solo con rojo o ámbar.
Arreglo: prefijo de texto en el `span` del mensaje (`:116`), por ejemplo `<span className="sr-only">Crítico: </span>` o `Atención: `, para lectores de pantalla y para daltónicos.

### Gráfico y tarjetas (`src/components/tablero.tsx`, `src/components/ui.tsx`)

**TB1** · media · menor — `src/components/tablero.tsx:104`. Rótulos del eje (16, 23, "hoy") en `text-[11px] text-slate-400`: 2.6:1 sobre blanco.
Arreglo: `text-xs text-slate-500`.

**TB2** · media · menor — `src/components/tablero.tsx:86-91`. El gráfico tiene `role="img"` con `aria-label="Ventas por día"`, sin datos. Los montos solo están en el `title` de cada barra (`:91`), que en celular no se ve.
Arreglo: `aria-label` con el resumen (por ejemplo, "Últimos 14 días: total $X, mejor día $Y"), y una lista `sr-only` con un ítem por día fuera del elemento `role="img"`. Sin eso, el dato no llega ni a lectores de pantalla ni a quien toca el celular.

**U1** · baja · menor — `src/components/ui.tsx:111`. Los `th` de la tabla de escritorio no tienen `scope`.
Arreglo: `<th key={c} scope="col">`.

**U2** · baja · menor — `src/components/ui.tsx:80` (`SemaforoMargen`). El detalle del margen solo está en `title`, que en celular no se ve.
Arreglo: texto `sr-only` dentro del `span` con el mismo contenido de `title`, o mostrar el detalle en el lugar donde se usa el semáforo.

**U3** · baja · menor — `src/components/ui.tsx:38` (`whitespace-nowrap` en los valores de `Tarjeta`). No se reprodujo con los datos actuales, pero un monto muy largo en una tarjeta de 2 columnas a 375 px puede salirse. Medir con un valor de prueba antes de cerrarlo.
Arreglo: `min-w-0 truncate` en el `p` del valor, o un tramo de `tamano` más chico para `valor.length > 14`.

### Catálogo (`src/app/catalogo/page.tsx`, `src/app/catalogo/_componentes/articulo-form.tsx`)

**C1** · media · menor — `src/app/catalogo/page.tsx:86` ("Ver receta (N componentes)"). El `summary` mide 309×20 px.
Arreglo: `flex min-h-11 items-center` en lugar de `cursor-pointer`. Mismo cambio en `:149` (ver C5).

**C2** · media · menor — `src/app/catalogo/page.tsx:52` (nombre del artículo como enlace al detalle). Mide 193×20 px. Es el camino principal al detalle y casi no tiene área táctil.
Arreglo: `inline-flex min-h-11 items-center` en el `Link`.

**C3** · media · menor — `src/app/catalogo/page.tsx:122` ("Editar artículo y receta" / "Cargar receta"). 309×38 px.
Arreglo: `py-3` en lugar de `py-2`.

**C4** · media · menor — `src/app/catalogo/page.tsx:138` ("+ Nuevo artículo"). 136×36 px.
Arreglo: `inline-flex min-h-11 items-center` en el `Link` de `BotonNuevo`.

**C5** · baja · menor — `src/app/catalogo/page.tsx:149` ("Dados de baja (N)", `summary`) y `:155` (enlaces de la lista, `block py-2`, unos 36 px).
Arreglo: `flex min-h-11 items-center` en el `summary`; `py-3` en los enlaces.

**A1** · media · menor — `src/app/catalogo/_componentes/articulo-form.tsx:340` ("Quitar" de cada línea de receta). `py-1.5 text-sm`, unos 32 px de alto.
Arreglo: `min-h-11 px-3` en lugar de `px-3 py-1.5`. El `aria-label` ya dice qué línea.

**A2** · baja · menor — `src/app/catalogo/_componentes/articulo-form.tsx:334` ("1. Material", etc.). Los títulos de cada línea son `p`, así que la estructura de encabezados salta de `h2` (Receta) a nada.
Arreglo: `<h3>` en lugar de `<p>`, con las mismas clases.

### Materiales (`src/app/materiales/page.tsx`, `_componentes/`)

**M1** · media · menor — `src/app/materiales/page.tsx:102` (nombre del material como enlace). Mide 161×24 px.
Arreglo: `inline-flex min-h-11 items-center` en el `Link`.

**M2** · media · menor — `src/app/materiales/page.tsx:112` (y `:184`, "Editar" / "Ver / reactivar"). `-my-2 px-2 py-2` con texto de 14 px: 36 a 38 px.
Arreglo: `py-3` y dejar el `-my-3` para no cambiar el alto de la fila.

**M3** · baja · menor — `src/app/materiales/page.tsx:90` ("Ver qué comprar", dentro de la tarjeta) y `:165` ("Ver N dados de baja"). Enlaces de texto de 20 px.
Arreglo: `inline-flex min-h-11 items-center` en cada uno.

**M4** · media · menor — `src/app/materiales/_componentes/impacto-margen.tsx:58`. `aria-live="polite"` en la sección completa. Cada tecla en el costo hace que el lector anuncie toda la lista de artículos.
Arreglo: quitar `aria-live` de `<section>` y ponerlo en un `<p aria-live="polite">` que solo contenga el resumen de `:62-66`.

**M5** · baja · menor — `src/app/materiales/_componentes/impacto-margen.tsx:85` (flecha " → " en `text-slate-400`): 2.6:1.
Arreglo: `text-slate-500 aria-hidden="true"` en el `span`, o quitarla y dejar el texto "pasa a".

**M6** · baja · menor — `src/app/materiales/_componentes/material-form.tsx:113` ("Stock actual"). Es un `p` con el estilo de etiqueta, sin asociar a nada. No es un campo, pero los lectores de pantalla lo tratan como texto suelto.
Arreglo: `<span className="mb-1 block text-sm font-medium text-slate-700">` dentro de un `dl` con `dt`/`dd`, o asociarlo al valor con `aria-labelledby`.

### Reposición (`src/app/reposicion/`)

**R1** · media · menor — `src/app/reposicion/_componentes/factor-form.tsx:33-43` y `:51-53`. El error de validación ("De 1 a 10") se muestra en un `p` que no está asociado al input: no hay `aria-invalid` ni `aria-describedby`.
Arreglo: pasar `error={errorFactor}` al `CampoDecimal` de `:33` y borrar el `p` de `:51-53`. Así el campo recibe `aria-invalid` y el mensaje queda asociado.

**R2** · baja · menor — `src/app/reposicion/page.tsx:83-85` (nombre del material como enlace, 20 px de alto).
Arreglo: `inline-flex min-h-11 items-center` en el `Link`.

### Reportes (`src/app/reportes/page.tsx`)

**RP1** · media · menor — `src/app/reportes/page.tsx:186-200` (selector de período). Las flechas "←" y "→" son `a` con el carácter como único contenido. Su nombre accesible es solo el símbolo. Miden 39×38 px.
Arreglo: `aria-label="Mes anterior"` y `aria-label="Mes siguiente"`, y `min-h-11 min-w-11 items-center justify-center` en cada enlace.

**RP2** · media · menor — `src/app/reportes/page.tsx:99` (número de ranking 1 a 5, `text-slate-400 font-bold text-sm`): 2.6:1.
Arreglo: `text-slate-500`.

**RP3** · baja · menor — `src/app/reportes/page.tsx:185` (`aria-label="Periodo"`). Falta la tilde.
Arreglo: `aria-label="Período"`.

**RP4** · baja · menor — `src/app/reportes/page.tsx:74,92,115,132` (títulos "2.", "5.", "3.", "4."). En pantalla aparecen fuera de orden: 2, 5, 3, 4.
Arreglo: reordenar las llamadas a `Reporte` para que la numeración quede 1 a 4, o quitar la numeración de los títulos.

### Configuración (`src/app/configuracion/`)

**F1** · baja · menor — `src/app/configuracion/page.tsx:54-59` (nombre de cada máquina como enlace, 24 px de alto).
Arreglo: `inline-flex min-h-11 items-center` en el `Link`.

**F2** · baja · mayor — `src/app/configuracion/_componentes/estado-maquina-boton.tsx:26`. Usa `window.confirm()` para dar de baja. El código de `catalogo/_componentes/boton-activo.tsx:9-10` descarta explícitamente ese diálogo nativo ("en el celular es feo y se descarta solo") y usa confirmación en el lugar. Esta pantalla queda inconsistente.
Arreglo: reproducir el patrón de `boton-activo.tsx` (estado `confirmando` y dos botones). Son unas 15 líneas.

### Cómo se midió

- Playwright (`chromium.launch()`) con viewport 375×812. Se recorrieron las 14 rutas auditadas y se midieron: desborde horizontal, áreas táctiles (`getBoundingClientRect`), contraste (colores resueltos con canvas, compuestos sobre el fondo real de cada ancestro y con la opacidad heredada), etiquetas de controles (`input.labels`), y Tab hasta 40 paradas para ver el indicador de foco.
- Desborde de texto dentro de cajas: sin resultados con los datos actuales.
- El navbar a 768 y 1024 px se midió aparte.
- No se usó un lector de pantalla real. Los hallazgos de nombre accesible y de anuncios (M4, RP1, TB2, N2) se verificaron por DOM y por código, no escuchando un lector.
- Lo que no se midió: la hoja "Más" abierta (N2 se verificó por código), el resto de rutas fuera de la lista y los datos de borde (montos muy largos).

### Entorno

- Rama de trabajo: `ola-3-3.3a-2`. La rama pedida, `ola-3/3.3a-2`, no se pudo crear porque `ola-3` ya existe y git no admite ambos nombres. La base quedó en `ola-3` por fast-forward (`55692a6`).
- Archivos locales que no se commitean: `node_modules` (copia por hard links), `.env`, `src/generated/` (cliente de Prisma copiado de la base), `AGENTS.md`, `CLAUDE.md` y `next-env.d.ts` (generados por `next dev`).

---

# Parte 3 — build y dependencias

Fecha: 2026-10-29. Rama: `ola-3.3b`, creada desde `ola-3` (commit `55692a6`, "Merge 3.1a Lógica de rango de fechas").
Alcance: solo reporte. No se modificó código, no se ejecutó `npm audit fix` y no se tocaron `package.json` ni `package-lock.json`.

### Entorno de la corrida

- La rama pedida `ola-3/3.3b` no se pudo crear: git no admite `ola-3/3.3b` mientras existe `refs/heads/ola-3`, que está checked out en `/home/user/ventas`. No se renombró ni borró esa rama. Se usó `ola-3.3b`.
- Primera corrida hecha sobre `d090ce6`, base vieja sin olas 1 y 2. Se rehizo todo sobre `ola-3` (`55692a6`) con `git reset --hard ola-3`, sin commits propios que perder. Los resultados de abajo son de la base nueva.
- `node_modules` es un symlink a `/home/user/ventas/node_modules` y `.env` es copia de la principal. Las dependencias de `package.json` y del lock son iguales entre la base vieja y la nueva (solo cambiaron scripts), así que el `node_modules` sirve.
- `src/generated/prisma` no existe en el worktree. Se generó con `npx prisma generate` (carpeta ignorada por git).
- Verificado en la base nueva: existen `src/app/cobranzas` y `src/lib/acciones.ts`.

### 1. Build

| Corrida | Resultado |
|---|---|
| `npm run build` (Turbopack, por defecto) | **Falla.** `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`. Causa: el symlink de `node_modules` apunta fuera del root del worktree. Es un problema del entorno, no del código. |
| `npx next build --webpack` (diagnóstico) | **Pasa.** Compiló, TypeScript OK, páginas generadas. Sin warnings en el log. |

Rutas generadas (webpack): `/`, `/catalogo`, `/catalogo/[id]`, `/catalogo/nuevo`, `/clientes`, `/clientes/[id]`, `/clientes/[id]/editar`, `/clientes/nuevo`, `/cobranzas`, `/compras`, `/compras/nueva`, `/configuracion`, `/configuracion/maquinas/[id]`, `/configuracion/maquinas/nueva`, `/materiales`, `/materiales/[id]`, `/materiales/[id]/editar`, `/materiales/nuevo`, `/reportes`, `/reposicion`, `/ventas`, `/ventas/[id]`, `/ventas/nueva` (dinámicas); `/cortes`, `/icon.png`, `/apple-icon.png`, `/manifest.webmanifest` (estáticas); `/_not-found`.

Pendiente: no verifiqué que el build con Turbopack pase con un `node_modules` real (sin symlink). Eso hace falta para que el build por defecto quede verde en un worktree.

### 2. Typecheck (`npm run typecheck`)

- Sin cliente de Prisma generado: **falla** con 18 errores. `src/lib/prisma.ts` y `prisma/seed.ts` no encuentran `src/generated/prisma/client`, y en cascada aparecen TS7006 (`any` implícito) en las queries. Causa: falta el cliente generado en el worktree, no código.
- Con `npx prisma generate` previo, sobre la base `ola-3`: **pasa** (exit 0).

### 3. npm audit (sin fix)

Resumen de `npm audit`: 9 hallazgos, 1 crítico (next), 7 altos, 1 moderado. Mismo resultado en la base vieja y en la nueva. Clasificación según `package-lock.json`.

| Paquete | Severidad | Camino en el árbol | Runtime o dev | ¿Aplica a la app? | Decisión |
|---|---|---|---|---|---|
| `prisma` 7.10.0 | high | devDependency directa. El lock la marca prod porque `@prisma/client` la declara como peer opcional | CLI de Prisma, no se carga en runtime | No | **Aceptado** mientras se aplica el patch 7.10.1 (ver sección 4). No se acepta bajar a Prisma 6. |
| `@prisma/config` 7.10.0 | high | prisma → @prisma/config | CLI | No | Igual que `prisma`. Corregido por 7.10.1. |
| `deepmerge-ts` <8.0.0 | high | @prisma/config → deepmerge-ts | CLI (lectura de `prisma.config.ts`) | No. La vulnerabilidad es por objetos recursivos; no se mergea input externo | **Aceptado**. Corregido por 7.10.1 (que trae deepmerge-ts 8.0.2). |
| `mysql2` <=3.23.0 | high (auth plugin) y moderate (zlib) | prisma → mysql2 | CLI | No. El proyecto usa `@prisma/adapter-pg` y ningún archivo importa `mysql2` | **Aceptado**. Corregido por 7.10.1 (que trae mysql2 3.24.4). |
| `next` 16.0.0 a 16.4.0 | **critical** (2), high (2), moderate y low | dependencia directa de runtime | Runtime | **Sí, en parte**, ver tabla 4.1 | **No aceptado.** Corrección: next >=16.4.1. |
| `zod` <4.6.6 | high (memoria con colecciones grandes) | dependencia directa de runtime | Runtime | **Sí.** zod valida colecciones (líneas de ventas, compras y recetas) dentro de Server Actions | **No aceptado.** Corrección no breaking: zod 4.6.6 (dentro de `^4.6.5`). |
| `sharp` <0.35.5 | high (librsvg CVE-2026-96889) | optional de `next`, usado por el optimizador de imágenes | Runtime (optional) | Solo si se procesan SVG. `dangerouslyAllowSVG` no está configurado (default `false`) | **Aceptado temporalmente**. Se corrige al subir next/sharp. |
| `source-map-js` 1.0.0 a 1.2.1 | high (DoS por source maps indexados) | postcss → source-map-js (prod, vía next) y @tailwindcss/node (dev) | Build y tooling | No. Solo parsea source maps propios en build | **Aceptado**. Corrección no breaking: >=1.2.2. |
| `fast-uri` 3.0.0 a 3.1.8 | moderate (x2) y low (x2) | ajv → fast-uri, dentro del árbol de Prisma | Árbol de Prisma | No. La app no procesa URIs de usuarios | **Aceptado**. Corrección no breaking: >=3.1.9. |

#### 4.1 Detalle de las advisories de next

| Advisory | Severidad | Condición para explotar | ¿Aplica hoy? |
|---|---|---|---|
| RCE no autenticada en Image Optimization con SVG | critical | Requiere `images.dangerouslyAllowSVG: true` | No, por config. Pero ver hallazgo 4.2. |
| RCE no autenticada en funciones `use cache` que devuelven typed arrays | critical | Usar `use cache` | No. No hay `use cache` en `src`. |
| SSRF en Image Optimization | high | Requiere `images.remotePatterns` o `domains` | No. No están configurados. |
| DoS en App Router con Server Actions | high | Tener Server Actions | **Sí.** Hay 9 archivos con `"use server"` (`src/app/*/actions.ts`, `reposicion/actions.ts`). `experimental.serverActions.bodySizeLimit` está en 2mb, lo que acota pero no elimina el riesgo. |
| Cache poisoning de SSG/ISR en self-hosted | moderate | `next start` en un VPS | Sí, en teoría. La app se sirve con `next start`. Rutas estáticas: `/cortes`, íconos y manifest. Riesgo bajo en una app de un usuario. |
| Fuga de Draft Mode y de cache entre root params con `use cache`; bypass de `dynamicParams` en rutas de metadata | moderate | `use cache`, `draftMode` o rutas de metadata dinámicas | No. No se usan (`use cache`, `draftMode` y `unstable_cache` sin resultados en `src`; solo hay `icon.png` estático). |
| Fuga de información en el endpoint MCP del dev server | low | Solo `next dev` | No, no es producción. |

#### 4.2 Hallazgo nuevo (no es una advisory, pero afecta a la superficie de next)

`src/proxy.ts` excluye `_next/image` del matcher del Basic Auth. Next sirve `/_next/image` por defecto en `next start`, así que el optimizador de imágenes queda accesible sin contraseña. La app no usa `next/image` (solo hay un `<img>` en la navbar), así que el endpoint no hace falta y solo amplía la superficie de las advisories de Image Optimization. Sugerencia para quien corresponda: `images: { unoptimized: true }` en `next.config.ts`, o quitar la exclusión del matcher. No se modificó.

### 4. Corrección a la nota del README

La nota del README dice que la única corrección que ofrece npm para las altas de Prisma es bajar a Prisma 6. **Eso no es correcto para la versión actual.** Consulta de solo lectura al registro:

- `prisma@7.10.1` (patch dentro de `^7.10.0`) depende de `mysql2@3.24.4` y de `@prisma/config@7.10.1`.
- `@prisma/config@7.10.1` depende de `deepmerge-ts@8.0.2`.

Las tres versiones están fuera de los rangos vulnerables. La corrección es un patch no breaking dentro de Prisma 7, sin retroceso. Lo que sigue sin aceptarse es bajar a Prisma 6. Este punto no se aplicó: queda como recomendación.

Otras dos correcciones a la nota:

- Dice que las dependencias son devDependency. En el lock, `prisma`, `@prisma/config`, `mysql2` y `deepmerge-ts` aparecen como prod porque `@prisma/client` declara `prisma` como peer opcional. Se instalan con `npm ci --omit=dev`, aunque la app no las carga en runtime.
- La nota habla de 4 altas. Hoy son 7 altas y 1 crítica. Las 4 de la nota son `@prisma/config`, `deepmerge-ts`, `mysql2` y `prisma`. Lo nuevo es `next` (crítico y altas), `zod`, `sharp` y `source-map-js` (altas), más `fast-uri` (moderada).

### 5. Resumen de decisiones

- **Aceptado, sin impacto en runtime**: `prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2`, `fast-uri`, `source-map-js`. Se corrigen con `prisma@7.10.1` (cubre los primeros cuatro) y con updates no breaking de `source-map-js` (>=1.2.2) y `fast-uri` (>=3.1.9).
- **Aceptado temporalmente con condición**: `sharp` (solo si se procesan SVG).
- **No aceptado, corregir**:
  - `next` a >=16.4.1. Es semver-compatible con `^16.3.6`. 16.4.1 existe en el registro, y el rango crítico termina en 16.4.0. No verifiqué su changelog. Corrige las advisories de Server Actions y las de Image Optimization.
  - `zod` a 4.6.6 (dentro de `^4.6.5`, no breaking). Corrige la advisory de memoria con colecciones grandes, que sí aplica porque zod valida las líneas de las Server Actions.
- **Rechazado**: bajar a Prisma 6. Se mantiene la decisión de la nota.

### 6. Otros hallazgos

- `docs/03-stack-y-decisiones.md` dice Prisma 6, mientras `package.json` tiene Prisma 7. Conviene resolver esa discrepancia.
- Quedó sin verificar el build con Turbopack sin symlink y el changelog de next 16.4.1.
