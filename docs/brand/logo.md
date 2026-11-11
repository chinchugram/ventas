# Logo

> **Copia del manual de marca de Kiwitt** (repo `kiwitt`, `docs/brand/`), traída a ventas para que el repo sea autosuficiente. El contenido es el original; solo cambian los enlaces a archivos de código. En ventas los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (Tailwind v4, no `tokens.css` de Astro). Cómo se aplica acá: [README.md, "Cómo se aplica en ventas"](README.md#cómo-se-aplica-en-ventas).

## Isotipo

Un sticker mandarina con una "k" armada con piezas: una barra y dos círculos en verde bosque. Se lee como letra y como juguete de encastre, que es lo que hace la fábrica: arma productos con piezas.

| Archivo | Cuándo usarlo |
| --- | --- |
| [`assets/kiwitt-mark.svg`](assets/kiwitt-mark.svg) | Principal, con su sombra sólida. Sobre `surface` y `surface-raised`. |
| [`assets/kiwitt-mark-flat.svg`](assets/kiwitt-mark-flat.svg) | Plano, sin sombra, para favicon y tamaños menores a 32px. |

- Los SVG tienen los colores fijados (`#ff6b35` y `#1e3328`) y no heredan `currentColor`: se muestran con `<img>`.
- Funciona igual en tema oscuro: el mandarina se lee sobre verde bosque.

## Logotipo

- "kiwitt" en minúsculas, Bricolage Grotesque 800, tracking -0.03em, en `ink`. En texto corrido: "Kiwitt".
- El logotipo escrito no es un archivo: se arma con texto.
- Con el isotipo: a la izquierda, misma altura que la altura de mayúsculas.
- Espacio libre: el ancho de la barra de la "k" multiplicado por dos, en todos los lados.

## Qué no hacer

- No cambies el mandarina por un acento de producto.
- No le pongas sombra difusa ni degradado: la única sombra es la sólida.
- Puede girarse hasta -6° en piezas de festejo o redes. En la interfaz, recto.
