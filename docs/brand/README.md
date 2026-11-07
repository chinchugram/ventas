# Marca Kiwitt

> **Copia del manual de marca de Kiwitt** (repo `kiwitt`, `docs/brand/`), traída a ventas para que el repo sea autosuficiente. El contenido es el original; solo cambian los enlaces a archivos de código. En ventas los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (Tailwind v4, no `tokens.css` de Astro). Cómo se aplica acá: ver "Cómo se aplica en ventas", al final.

Esta es la identidad de Kiwitt, copiada del design system **Kiwitt · Alternativa C** (cálida y con onda). Kiwitt es una fábrica de software con productos chicos, uno por rubro, que también funcionan como portfolio. La dirección es la más amigable de las tres: papel crema, tinta verde bosque, un mandarina que alegra y botones que parecen piezas que se aprietan. Sigue siendo prolija: nada de neón, nada de gradientes, nada de caos.

El design system original (privado): https://claude.ai/artifact/J3mKK5WvrKcqaTFPPoTJxk

## Principios

- Se siente como algo físico: botones con peso, stickers de color, papel cálido.
- Festeja con ganas, acompaña cuando algo falla. La guía está en [voz.md](voz.md) y [momentos.md](momentos.md).
- Un color fuerte por pantalla además del mandarina. El resto es crema y verde bosque.
- Juguetón en los momentos, serio en los números.

## Índice

| Documento | Qué tiene |
| --- | --- |
| [colores.md](colores.md) | Todos los tokens de color en claro y oscuro, su uso y los pares de contraste. |
| [tipografia.md](tipografia.md) | Las tres familias y la escala completa. |
| [forma.md](forma.md) | Espaciado, radios, sombras sólidas y el botón sticker. |
| [voz.md](voz.md) | El termómetro de tono y la tabla "Antes y después". |
| [momentos.md](momentos.md) | Catálogo de eventos con mensaje, animación y sonido, y sus reglas. |
| [productos.md](productos.md) | Arquitectura de marca y asignación de acentos. |
| [logo.md](logo.md) | El isotipo, el logotipo y cómo usarlos. |

## Fuente de verdad

Los valores (colores, tamaños, radios, sombras) viven en un solo lugar: [`src/app/globals.css`](../../src/app/globals.css) (en Kiwitt: `src/styles/tokens.css`). Estos documentos explican cómo usarlos. Si algo cambia, se cambia en el CSS y se actualiza la explicación.

---

## Cómo se aplica en ventas

Ventas es el ERP de la casa (acento `c-cielo`, productos.md). Está hecho en Next.js + Tailwind v4, así que el manual se implementa así:

| En Kiwitt (Astro) | En ventas |
| --- | --- |
| `src/styles/tokens.css` | `src/app/globals.css`: `:root` (valores, claro), `@media screen and (prefers-color-scheme: dark)` (oscuro, solo en pantalla: imprimir sale siempre claro), `@theme inline` (colores como utilidades) y `@theme static` (fuentes, escala, radios, sombras, animaciones). |
| `src/styles/global.css` | `@layer base` de `globals.css` (body, títulos, enlaces, foco, `::selection`, campos, tablas, movimiento reducido). |
| `src/styles/fonts.css` (Fontsource) | `next/font/google` en `src/app/layout.tsx` (se descargan en el build y se sirven desde la app). |
| `Boton.astro` | Clases `.boton` + `.boton-primario` / `-secundario` / `-peligro` / `-fantasma` (`globals.css`) y el componente `<Boton>` (`src/components/ui.tsx`). |
| `InterruptorSonido.astro` + `lib/sonido.ts` | `src/lib/sonido.ts` + `src/components/sonido.tsx` (`SonidoProvider`, `useSonido`, `InterruptorSonido`). |
| `assets/kiwitt-mark*.svg` | `public/marca/kiwitt-mark*.svg` (públicos: `/marca/` no pide sesión) y `<LogoKiwitt>` (`src/components/logo-kiwitt.tsx`). |

### Utilidades (Tailwind)

- Color: `bg-/text-/border-` + `surface`, `surface-raised`, `surface-sunken`, `ink`, `ink-muted`, `line`, `line-strong`, `brand`, `brand-text`, `brand-soft`, `on-color`, `press`, `focus`; acentos `sol`, `menta`, `cielo`, `frambuesa` (los `c-*` del manual).
- Estados: `ok`, `aviso`, `critico`, `info` (relleno = acento, con `text-on-color`), y `*-text`, `*-soft`, `*-line` de cada uno.
- Tipografía: `font-display`, `font-sans`, `font-mono`; `text-display-xl`, `text-display-lg`, `text-display-md`, `text-body-lg`, `text-body`, `text-body-sm`, `text-label`, `text-mono`, `text-eyebrow` (cada una trae su interlineado, peso y tracking); `tracking-logo`.
- Forma: `rounded-sm` (8), `rounded-md` (14), `rounded-lg` (24; `rounded-xl` y `rounded-2xl` valen lo mismo), `rounded-full`; `shadow-press`, `shadow-pressed`; `borde` (1.5px sólido, color aparte); `max-w-page`, `max-w-read`. El espaciado es el de Tailwind, que ya es la base de 4px del manual (`p-4` = `space-4`).
- Movimiento: `duration-(--dur-press)`, `duration-(--dur-rutina)`, `ease-momento`, `animate-salto`, `animate-sacudir`, `animate-latido`, `animate-entrada`.
- Clases: `.boton*`, `.tarjeta`, `.sticker` (+ `.sticker-girado`), `.eyebrow`, `.monto`, `.enlace`, `.sobre-color` (foco `on-color` dentro de un fondo de color), `.tema-documento`.

### Decisiones de ventas (no están en el manual de Kiwitt)

- **Marca de la app vs. marca del negocio.** La interfaz usa siempre la marca Kiwitt: colores, tipografía, botones y sonido. Del negocio (`src/lib/marca.ts`) queda solo lo que es suyo: su **nombre** y su **logo** en el encabezado y en `/login` (`<LogoMarca>`), y los **documentos para su cliente** (comprobante, presupuesto impreso), que van dentro de `.tema-documento`: papel blanco, neutros, siempre claro y sin la tipografía display. El naranja y negro de HL Laser ya no pintan la interfaz: estaban fijos en el CSS para todos los negocios. La subida, validación y servicio del logo (`marca-pura.ts`, `/marca/logo/[slug]`, `npm run test:marca`) no cambian.
- **Estados.** El manual no define colores de estado. Los rellenos usan acentos (`ok` = menta, `aviso` = sol, `critico` = frambuesa, `info` = cielo) con `on-color` encima, como un sticker. Para texto y fondos suaves se agregaron `*-text`, `*-soft` y `*-line` en claro y oscuro, con 4.5:1 o más de texto sobre `surface`, `surface-raised` y su fondo suave. También `brand-soft` (fondo de lo seleccionado) y `--input-size` (16px en campos para que iOS no haga zoom).
- **Sin capa de compatibilidad.** Todas las pantallas usan los tokens de `globals.css`; la paleta vieja (`slate`, `white`, `red`, `emerald`, `amber`, `sky`, `marca`, `tinta`) ya no se usa y el archivo que la traducía (`legado.css`) se borró. En código nuevo, ningún color, tamaño ni sombra escritos a mano: utilidades de arriba o `var(--…)`.
- **Confirmar en el lugar.** Nada usa `window.confirm`. Las acciones delicadas (anular una venta, dar de baja un usuario, una máquina o un negocio, cambiar un rol o una clave) usan `<ConfirmarAccion>` (`src/components/confirmar-accion.tsx`): un panel con la pregunta, las consecuencias y dos botones; el foco pasa a "Cancelar", Escape cancela. Para baja y reactivación de catálogo está `<BajaReactivar>`. Cuando el formulario ya es la confirmación (anular un trabajo pide el motivo; ajustar stock pide marcar una casilla), no se pregunta dos veces.
- **Reportes.** Los tres reportes comparten `src/app/reportes/_componentes/comunes.tsx`: `<Reporte>` (título, `Etiqueta` "Por período" o "A hoy", botón de exportar), `<FiltroFechas>` (formularios GET de mes y de rango, sin JavaScript) y `<AvisosFiltro>`. No hay gráficos: los números van en `Tarjeta` y tablas; si se suman barras, colores de tokens con 3:1 de contraste y el dato también como texto.
- **Sonido.** Apagado por defecto, se recuerda en el navegador (`localStorage`, clave `ventas:sonido`). `reproducir("cobro" | "turno" | "logro" | "offline" | "error" | "pop")`; `guardado` es silencioso a propósito. `prefers-reduced-motion` no lo apaga: el manual lo pide para el movimiento, no para el audio.
- **Momentos.** Se disparan desde un solo lugar: `useAccion` (`src/components/form/estado.tsx`) hace sonar `error` cuando la acción responde con un error (y `BloqueError` / la barra inferior se sacuden), `offline` cuando ni responde, y el `momento` que le pasa la pantalla cuando sale bien (por defecto `guardado`, mudo). Con `anuncio`, además muestra el aviso flotante de `src/components/momentos.tsx` (debajo del encabezado, sobrevive a `router.push`). Eventos de ventas: cobro registrado → `cobro` (caja, moneda que cae y monto que cuenta); venta guardada → `cobro` si entró plata, si no `turno` (el comprobante salta); compra, trabajo y el resto de los guardados → `guardado` (tilde que se dibuja, sin sonido); margen arriba de la meta del mes → estallido una vez por mes en el tablero, sin sonido porque aparece al cargar; se cortó internet → aviso con punto que late y `offline` (solo si un toque ya preparó el audio). Ventas no tiene turnos: `turno` es "acción completada".
