# Colores

> **Copia del manual de marca de Kiwitt** (repo `kiwitt`, `docs/brand/`), traída a ventas para que el repo sea autosuficiente. El contenido es el original; solo cambian los enlaces a archivos de código. En ventas los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (Tailwind v4, no `tokens.css` de Astro). Cómo se aplica acá: [README.md, "Cómo se aplica en ventas"](README.md#cómo-se-aplica-en-ventas).

Los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (en Kiwitt: `src/styles/tokens.css`). Acá están los mismos, con su uso. Si alguno no coincide, manda el CSS.

## Reglas de uso

- Fondo: `surface`. Tarjetas: `surface-raised` con borde `line` de 1.5px. Campos y franjas: `surface-sunken`.
- Texto: `ink`. Secundario: `ink-muted`. Enlaces y palabras destacadas: `brand-text`.
- `brand` (mandarina) es de Kiwitt: isotipo, botón primario y festejos. Texto encima: `on-color`.
- Cada producto toma un acento: `c-sol`, `c-menta`, `c-cielo` o `c-frambuesa`. Se usa como relleno de stickers, etiquetas y fondos de festejo, siempre con `on-color` encima. Nunca como color de texto.
- Bordes de controles: `line-strong`. Foco: `focus`, anillo sólido de 2px separado 2px.
- Un color fuerte por pantalla además del mandarina. El resto es crema y verde bosque.
- El tema oscuro cambia el papel a verde bosque profundo; mandarina y acentos se mantienen.

## Tokens

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `surface` | `#fff8ee` | `#14201a` | Fondo de página, crema cálido. Sobre él van `ink`, `ink-muted` y `brand-text`. |
| `surface-raised` | `#ffffff` | `#1c2b23` | Tarjetas y paneles sobre `surface`, con borde `line`. |
| `surface-sunken` | `#f6ecdd` | `#0f1813` | Franjas, campos de formulario y fondos de captura. |
| `ink` | `#1e3328` | `#fff4e6` | Texto principal, verde bosque en claro. Sobre `surface`, `surface-raised` y `surface-sunken`. También es la sombra sólida de los stickers en tema claro. |
| `ink-muted` | `#5b6b60` | `#b5bfb6` | Texto secundario y metadatos. Sobre `surface` y `surface-raised`; sobre `surface-sunken` con menos margen. |
| `line` | `#eadfcd` | `#2a3a31` | Borde decorativo de tarjetas y divisores. No sirve como borde de un control. |
| `line-strong` | `#8a8478` | `#6e7e73` | Borde de inputs y checkboxes. |
| `brand` | `#ff6b35` | `#ff7a45` | Mandarina, el color de Kiwitt: isotipo, botón primario y festejos. Texto encima: `on-color`. No es color de texto. |
| `brand-text` | `#b8461b` | `#ff9a6b` | Enlaces y palabras destacadas en mandarina sobre `surface` y `surface-raised`. |
| `on-color` | `#1e3328` | `#1e3328` | Texto sobre `brand` y sobre cualquier acento `c-*`. Siempre verde bosque oscuro, también en tema oscuro. |
| `press` | `#1e3328` | `#060a08` | Color de la sombra sólida de botones y stickers. |
| `c-sol` | `#ffc233` | `#ffc233` | Acento de producto: amarillo sol. |
| `c-menta` | `#4cc9a0` | `#4cc9a0` | Acento de producto: menta. |
| `c-cielo` | `#6cb4f5` | `#6cb4f5` | Acento de producto: celeste. |
| `c-frambuesa` | `#f2668f` | `#f2668f` | Acento de producto: frambuesa. |
| `focus` | `#1e3328` | `#ff9a6b` | Anillo de foco sólido de 2px separado 2px. |

Los acentos `c-*` y `on-color` son iguales en claro y en oscuro.

## Pares de contraste

Lo que declara el design system:

- `ink-muted` sobre `surface` y `surface-raised`: mínimo 5.3:1; sobre `surface-sunken`: 4.8:1.
- `brand-text` sobre `surface` y `surface-raised`: mínimo 5:1.
- `line-strong` sobre `surface` y `surface-raised`: cumple 3:1 en ambos temas.
- `focus` tiene que verse sobre `surface`, `surface-raised`, `brand` y los acentos.

Las razones calculadas con la fórmula WCAG 2.x a partir de los valores de arriba (un decimal). El texto necesita 4.5:1, el texto grande (24px o más) y los controles necesitan 3:1.

| Par (texto / fondo) | Claro | Oscuro |
| --- | --- | --- |
| `ink` / `surface` | 12.8 | 15.5 |
| `ink` / `surface-raised` | 13.5 | 13.6 |
| `ink` / `surface-sunken` | 11.5 | 16.7 |
| `ink-muted` / `surface` | 5.4 | 8.9 |
| `ink-muted` / `surface-raised` | 5.7 | 7.8 |
| `ink-muted` / `surface-sunken` | 4.8 | 9.6 |
| `brand-text` / `surface` | 5.1 | 8.1 |
| `brand-text` / `surface-raised` | 5.3 | 7.1 |
| `line-strong` / `surface` | 3.5 | 3.9 |
| `line-strong` / `surface-raised` | 3.7 | 3.4 |
| `on-color` / `brand` | 4.7 | 5.2 |
| `on-color` / `c-sol` | 8.3 | 8.3 |
| `on-color` / `c-menta` | 6.5 | 6.5 |
| `on-color` / `c-cielo` | 6.1 | 6.1 |
| `on-color` / `c-frambuesa` | 4.5 | 4.5 |
| `focus` / `surface` | 12.8 | 8.1 |
| `focus` / `surface-raised` | 13.5 | 7.1 |
| `focus` / `brand` | 4.7 | 1.2 |

En tema oscuro `focus` sobre `brand` da 1.2:1 (y es igual de bajo sobre los acentos). Por eso el anillo siempre va separado del elemento y cae sobre el papel; dentro de un contenedor `brand` o `c-*` (clase `.sobre-color`) el anillo usa `focus-on-color`, que es `on-color`.
