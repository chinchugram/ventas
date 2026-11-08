/**
 * Ícono de IA de la marca: un destello de cuatro puntas con una pieza redonda al lado, el mismo
 * vocabulario del isotipo (piezas que encastran). Se usa en TODA función con IA, sin texto.
 * Ver docs/brand/forma.md, "Íconos".
 *
 * - Por defecto toma `currentColor` (sobre un botón primario queda verde bosque sobre mandarina).
 * - `sticker`: dibuja también el fondo mandarina redondeado, como el isotipo (para usarlo suelto).
 */
export function IconoIA({ className = "h-6 w-6", sticker = false }: { className?: string; sticker?: boolean }) {
  const tinta = sticker ? "var(--on-color)" : "currentColor";
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {sticker ? <rect x="1" y="1" width="22" height="22" rx="7" fill="var(--brand)" /> : null}
      {/* Destello: cuatro puntas con lados cóncavos. */}
      <path d="M10.5 4.5Q11.5 11 18 12Q11.5 13 10.5 19.5Q9.5 13 3 12Q9.5 11 10.5 4.5Z" fill={tinta} />
      {/* Pieza redonda, como los círculos de la "k". */}
      <circle cx="18" cy="5.5" r="2.2" fill={tinta} />
    </svg>
  );
}
