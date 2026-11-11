# Tipografía

> **Copia del manual de marca de Kiwitt** (repo `kiwitt`, `docs/brand/`), traída a ventas para que el repo sea autosuficiente. El contenido es el original; solo cambian los enlaces a archivos de código. En ventas los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (Tailwind v4, no `tokens.css` de Astro). Cómo se aplica acá: [README.md, "Cómo se aplica en ventas"](README.md#cómo-se-aplica-en-ventas).

Los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (en Kiwitt: `src/styles/tokens.css`).

## Familias

| Token | Familia | Fuentes de respaldo | Para qué |
| --- | --- | --- | --- |
| `--font-display` | Bricolage Grotesque | `ui-rounded`, `system-ui`, `sans-serif` | Títulos |
| `--font-sans` | Figtree | `ui-sans-serif`, `system-ui`, `-apple-system`, `Segoe UI`, `sans-serif` | Interfaz y lectura |
| `--font-mono` | IBM Plex Mono | `ui-monospace`, `Menlo`, `Consolas`, `monospace` | Datos técnicos y epígrafes |

El design system no trae archivos de fuente. El sitio las sirve desde sus propios archivos con Fontsource (Bricolage Grotesque y Figtree en versión variable, IBM Plex Mono en 400 y 500): en Kiwitt, `src/styles/fonts.css`. En ventas las sirve `next/font` (autoalojadas en el build): ver [`src/app/layout.tsx`](../../src/app/layout.tsx).

## Escala

### Display (Bricolage Grotesque)

| Estilo | Tamaño | Interlineado | Peso | Tracking | Uso |
| --- | --- | --- | --- | --- | --- |
| `display-xl` | 72px | 72px | 800 | -0.03em | Titular de portada. Una vez por página. |
| `display-lg` | 48px | 52px | 700 | -0.025em | Títulos de sección y de festejo grande. |
| `display-md` | 28px | 34px | 700 | -0.015em | Títulos de tarjeta y mensajes de logro. |

### Texto (Figtree)

| Estilo | Tamaño | Interlineado | Peso | Uso |
| --- | --- | --- | --- | --- |
| `body-lg` | 18px | 28px | 400 | Bajadas y párrafos de caso. |
| `body` | 15px | 24px | 400 | Texto de interfaz por defecto. |
| `body-sm` | 13px | 20px | 400 | Ayudas y metadatos. |
| `label` | 14px | 18px | 700 | Botones, pestañas y etiquetas. Más pesado que en otras direcciones para que los botones se vean como piezas. |

### Mono (IBM Plex Mono)

| Estilo | Tamaño | Interlineado | Peso | Tracking | Uso |
| --- | --- | --- | --- | --- | --- |
| `mono` | 13px | 20px | 400 | — | Código, versiones y datos técnicos. |
| `eyebrow` | 12px | 16px | 500 | 0.04em | Epígrafe sobre un título, en `ink-muted`. |

## Reglas

- Sentence case.
- Los montos van en `display-md` con números tabulares.
- Botones en `label`, peso 700.
- La firma "por Kiwitt" va en `mono`, color `ink-muted`.
