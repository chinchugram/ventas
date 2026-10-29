# Auditoría Ola 3 (3.3a, parte 2): accesibilidad y uso en celular

Solo reporte: no se modificó ningún archivo de `src/`. Base: `ola-3` en `55692a6`. Medición a 375 px de ancho (Chromium vía Playwright) contra la base `ventas` sembrada.

Severidad: **alta** bloquea una tarea o deja fuera a un usuario; **media** dificulta el uso o incumple un criterio WCAG AA; **baja** es pulido o consistencia. Tipo: **menor** = una o pocas líneas; **mayor** = requiere decidir diseño o reestructurar.

## Resumen

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

## Hallazgos transversales (estilos globales y patrones repetidos)

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

## Navbar

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

## Inicio (`src/app/page.tsx`)

**P1** · baja · menor — `src/app/page.tsx:202-206` ("Ver catálogo completo →"): enlace inline de 20 px de alto.
Arreglo: `inline-flex min-h-11 items-center` en lugar de `inline-block`.

**P2** · baja · menor — `src/app/page.tsx:110-116` (alertas "Para mirar"). La severidad (crítica o aviso) se comunica solo con rojo o ámbar.
Arreglo: prefijo de texto en el `span` del mensaje (`:116`), por ejemplo `<span className="sr-only">Crítico: </span>` o `Atención: `, para lectores de pantalla y para daltónicos.

## Gráfico y tarjetas (`src/components/tablero.tsx`, `src/components/ui.tsx`)

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

## Catálogo (`src/app/catalogo/page.tsx`, `src/app/catalogo/_componentes/articulo-form.tsx`)

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

## Materiales (`src/app/materiales/page.tsx`, `_componentes/`)

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

## Reposición (`src/app/reposicion/`)

**R1** · media · menor — `src/app/reposicion/_componentes/factor-form.tsx:33-43` y `:51-53`. El error de validación ("De 1 a 10") se muestra en un `p` que no está asociado al input: no hay `aria-invalid` ni `aria-describedby`.
Arreglo: pasar `error={errorFactor}` al `CampoDecimal` de `:33` y borrar el `p` de `:51-53`. Así el campo recibe `aria-invalid` y el mensaje queda asociado.

**R2** · baja · menor — `src/app/reposicion/page.tsx:83-85` (nombre del material como enlace, 20 px de alto).
Arreglo: `inline-flex min-h-11 items-center` en el `Link`.

## Reportes (`src/app/reportes/page.tsx`)

**RP1** · media · menor — `src/app/reportes/page.tsx:186-200` (selector de período). Las flechas "←" y "→" son `a` con el carácter como único contenido. Su nombre accesible es solo el símbolo. Miden 39×38 px.
Arreglo: `aria-label="Mes anterior"` y `aria-label="Mes siguiente"`, y `min-h-11 min-w-11 items-center justify-center` en cada enlace.

**RP2** · media · menor — `src/app/reportes/page.tsx:99` (número de ranking 1 a 5, `text-slate-400 font-bold text-sm`): 2.6:1.
Arreglo: `text-slate-500`.

**RP3** · baja · menor — `src/app/reportes/page.tsx:185` (`aria-label="Periodo"`). Falta la tilde.
Arreglo: `aria-label="Período"`.

**RP4** · baja · menor — `src/app/reportes/page.tsx:74,92,115,132` (títulos "2.", "5.", "3.", "4."). En pantalla aparecen fuera de orden: 2, 5, 3, 4.
Arreglo: reordenar las llamadas a `Reporte` para que la numeración quede 1 a 4, o quitar la numeración de los títulos.

## Configuración (`src/app/configuracion/`)

**F1** · baja · menor — `src/app/configuracion/page.tsx:54-59` (nombre de cada máquina como enlace, 24 px de alto).
Arreglo: `inline-flex min-h-11 items-center` en el `Link`.

**F2** · baja · mayor — `src/app/configuracion/_componentes/estado-maquina-boton.tsx:26`. Usa `window.confirm()` para dar de baja. El código de `catalogo/_componentes/boton-activo.tsx:9-10` descarta explícitamente ese diálogo nativo ("en el celular es feo y se descarta solo") y usa confirmación en el lugar. Esta pantalla queda inconsistente.
Arreglo: reproducir el patrón de `boton-activo.tsx` (estado `confirmando` y dos botones). Son unas 15 líneas.

## Cómo se midió

- Playwright (`chromium.launch()`) con viewport 375×812. Se recorrieron las 14 rutas auditadas y se midieron: desborde horizontal, áreas táctiles (`getBoundingClientRect`), contraste (colores resueltos con canvas, compuestos sobre el fondo real de cada ancestro y con la opacidad heredada), etiquetas de controles (`input.labels`), y Tab hasta 40 paradas para ver el indicador de foco.
- Desborde de texto dentro de cajas: sin resultados con los datos actuales.
- El navbar a 768 y 1024 px se midió aparte.
- No se usó un lector de pantalla real. Los hallazgos de nombre accesible y de anuncios (M4, RP1, TB2, N2) se verificaron por DOM y por código, no escuchando un lector.
- Lo que no se midió: la hoja "Más" abierta (N2 se verificó por código), el resto de rutas fuera de la lista y los datos de borde (montos muy largos).

## Entorno

- Rama de trabajo: `ola-3-3.3a-2`. La rama pedida, `ola-3/3.3a-2`, no se pudo crear porque `ola-3` ya existe y git no admite ambos nombres. La base quedó en `ola-3` por fast-forward (`55692a6`).
- Archivos locales que no se commitean: `node_modules` (copia por hard links), `.env`, `src/generated/` (cliente de Prisma copiado de la base), `AGENTS.md`, `CLAUDE.md` y `next-env.d.ts` (generados por `next dev`).
