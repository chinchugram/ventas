# Forma: espacio, radios y sombras

> **Copia del manual de marca de Kiwitt** (repo `kiwitt`, `docs/brand/`), traída a ventas para que el repo sea autosuficiente. El contenido es el original; solo cambian los enlaces a archivos de código. En ventas los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (Tailwind v4, no `tokens.css` de Astro). Cómo se aplica acá: [README.md, "Cómo se aplica en ventas"](README.md#cómo-se-aplica-en-ventas).

Los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (en Kiwitt: `src/styles/tokens.css`).

## Espaciado

Base de 4px. Secciones separadas por `space-16`.

| Token | Valor | Uso |
| --- | --- | --- |
| `space-1` | 4px | Separación mínima entre ícono y texto. |
| `space-2` | 8px | Relleno de chips y separación en una fila. |
| `space-3` | 12px | Relleno vertical de botones e inputs. |
| `space-4` | 16px | Relleno de tarjetas compactas y gutter en móvil. |
| `space-6` | 24px | Relleno de tarjetas y separación entre campos. |
| `space-8` | 32px | Separación entre grupos. |
| `space-12` | 48px | Margen lateral de portada. |
| `space-16` | 64px | Separación entre secciones. |
| `space-24` | 96px | Aire de portada. |

Anchos máximos: `width-read` para lectura y `width-page` para la página.

## Radios

Esquinas generosas.

| Token | Valor | Uso |
| --- | --- | --- |
| `radius-sm` | 8px | Chips, etiquetas y checkboxes. |
| `radius-md` | 14px | Inputs, capturas y stickers chicos. |
| `radius-lg` | 24px | Tarjetas, paneles y el isotipo. |
| `radius-full` | 999px | Botones (siempre píldora) y estados. |

Las tarjetas llevan borde `line` de `border-width`.

## Sombras sólidas

La única sombra de la marca es sólida: sin desenfoque y sin degradado.

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `shadow-press` | `0 3px 0 #1e3328` | `0 3px 0 #060a08` | Sombra de botones y stickers en reposo. |
| `shadow-pressed` | `0 0 0 #1e3328` | `0 0 0 #060a08` | Estado apretado: sin sombra, el elemento baja `press-depth`. |

## Botón sticker

La firma táctil de la marca: se siente como una pieza que se aprieta.

- Es una píldora (`radius-full`) con `shadow-press`.
- Al apretar, el botón **baja `press-depth`** y queda en `shadow-pressed`. La transición dura `dur-press`.
- Primario: relleno `brand`, texto `on-color`, estilo `label`. Es el mismo en todos los productos, así se nota que son de la misma casa.
- Secundario: relleno `surface-raised`, borde `line-strong`, texto `ink`.
- Secundario y primario llevan borde de `border-width` (transparente en el primario) para medir lo mismo.
- Foco: anillo `focus` sólido de `focus-width`, separado `focus-offset`. Dentro de un fondo de color, `focus-on-color`.

Esqueleto de referencia (no es código del sitio; los componentes reales se arman en KIW-2):

```css
.boton {
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-press);
  transition: transform var(--dur-press), box-shadow var(--dur-press);
}
.boton:active {
  transform: translateY(var(--press-depth));
  box-shadow: var(--shadow-pressed);
}
```

## Sticker

Un bloque de acento con `radius-md`, `shadow-press` y texto `on-color`. Se usa para etiquetas destacadas ("Nuevo", "Hoy") y para el monto en un festejo. Puede ir girado `sticker-tilt` como máximo.

## Imágenes e ilustración

- Capturas reales del producto en marcos `radius-md` sobre `surface-sunken`.
- Se permiten formas simples en color de acento (círculos, píldoras, medias lunas) como decoración de portada. Sin personajes, sin mascotas, sin 3D.

## Íconos

- Línea de 2px, puntas redondeadas, 20px, en `ink`. Sin emojis en la interfaz.
- Todavía no hay set propio. Mientras tanto, Phosphor en su variante Bold, que acompaña el peso de los botones.

## Movimiento

- Rutina: color y opacidad de 120 a 180 ms; los botones bajan `press-depth` en `dur-press`.
- Momentos: duran `dur-momento`, con rebote `ease-momento`; el tope está en [momentos.md](momentos.md).
- Respetá `prefers-reduced-motion`.
