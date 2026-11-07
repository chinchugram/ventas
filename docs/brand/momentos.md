# Momentos: animación y sonido

> **Copia del manual de marca de Kiwitt** (repo `kiwitt`, `docs/brand/`), traída a ventas para que el repo sea autosuficiente. El contenido es el original; solo cambian los enlaces a archivos de código. En ventas los valores viven en [`src/app/globals.css`](../../src/app/globals.css) (Tailwind v4, no `tokens.css` de Astro). Cómo se aplica acá: [README.md, "Cómo se aplica en ventas"](README.md#cómo-se-aplica-en-ventas).

Un momento es un evento que merece algo más que un texto: un mensaje con voz propia, un movimiento y, a veces, un sonido. Se aplica en la landing (KIW-7) y en los productos.

## Catálogo

| Momento | Evento | Mensaje | Animación | Sonido |
| --- | --- | --- | --- | --- |
| Cobro registrado | `cobro` | ¡Cobrado! $12.500 ya están en caja. | El monto cuenta de 0 al total y cae una moneda | Caja registradora |
| Turno agendado | `turno` | Listo, Martina viene el jueves a las 10. | La tarjeta del turno aparece con un salto chico | Pop doble |
| Guardado | `guardado` | Guardado. | Se dibuja un tilde | Ninguno |
| Logro (primer cliente, meta del día, racha) | `logro` | Tu primer cliente. Esto recién empieza. | Estallido de puntos de color | Acorde ascendente |
| Sin conexión | `offline` | Se cortó la conexión. Guardamos todo acá. | Un punto que late suave | Aviso grave y corto |
| Error del usuario | `error` | Falta el teléfono para poder avisarle. | El campo se sacude | Dos notas que bajan |

Los nombres de evento son los sugeridos por el design system.

## Reglas de sonido

- El sonido es para plata y logros. Lo rutinario (guardar, editar, navegar) es silencioso.
- Cuanto más frecuente el evento, más discreto. Si pasa más de 20 veces por día, sin sonido.
- Volumen bajo, menos de 600 ms, y nunca dos sonidos encimados.
- Siempre hay un interruptor en la configuración y se recuerda por usuario. En la landing, el interruptor va en el encabezado. En un negocio con público (caja de un local), el sonido tiene que poder apagarse en un toque.
- El sonido nunca es la única señal: siempre va acompañado de texto y animación.
- Los errores graves (plata, datos) no tienen sonido simpático: o el aviso grave, o nada.
- Excepción: tocar un producto en la landing es un momento (salto de sticker + pop), y el pop suena solo con el sonido encendido.

## Reglas de animación

- Rutina: transiciones de color y opacidad de 120 a 180 ms.
- Momentos: duran `dur-momento` con el rebote suave de `ease-momento`; máximo 600 ms.
- Solo se anima el elemento que cambió; la pantalla no se mueve.
- Con `prefers-reduced-motion` activo, todo pasa sin movimiento: el monto aparece directo y el tilde ya está dibujado.
- Los festejos grandes (estallido) se reservan para logros que pasan pocas veces.

## Implementación

- El design system genera los sonidos con Web Audio, sin archivos. Sirve como referencia; para producción conviene grabar o licenciar sonidos propios y mantener los mismos nombres de evento.
- Sin sonido automático al cargar una página.

