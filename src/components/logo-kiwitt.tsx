/**
 * Logo de Kiwitt (docs/brand/logo.md y productos.md). Sin estado: sirve en server y client components.
 *
 *  - `variante="isotipo"`: solo el sticker mandarina con la "k".
 *  - `variante="kiwitt"`: isotipo + logotipo "kiwitt".
 *  - `variante="producto"` (por defecto): isotipo + "ventas" + la firma "por Kiwitt" en mono.
 *
 * El isotipo es un <img> de /marca/kiwitt-mark.svg (colores fijos, no hereda `currentColor`). En el
 * tamaño `sm` (< 32px) va el plano, sin sombra, como pide el manual. /marca/ es público: el proxy
 * no lo protege, así que se ve también en /login.
 *
 * Tamaños: la "k" del isotipo mide lo mismo que la altura de mayúsculas del logotipo.
 */
const TAMANOS = {
  sm: { iso: "h-5", texto: "text-body-lg", firma: "text-eyebrow", plano: true },
  md: { iso: "h-8", texto: "text-display-md", firma: "text-eyebrow", plano: false },
  lg: { iso: "h-14", texto: "text-display-lg", firma: "text-mono", plano: false },
} as const;

export function LogoKiwitt({
  variante = "producto",
  tamano = "md",
  producto = "ventas",
  className = "",
}: {
  variante?: "isotipo" | "kiwitt" | "producto";
  tamano?: keyof typeof TAMANOS;
  /** Nombre del producto, en minúsculas en el logotipo (productos.md). */
  producto?: string;
  className?: string;
}) {
  const t = TAMANOS[tamano];
  const iso = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={t.plano ? "/marca/kiwitt-mark-flat.svg" : "/marca/kiwitt-mark.svg"}
      alt={variante === "isotipo" ? "Kiwitt" : ""}
      className={`${t.iso} w-auto shrink-0`}
    />
  );
  if (variante === "isotipo") return <span className={`inline-flex ${className}`}>{iso}</span>;

  const nombre = variante === "kiwitt" ? "kiwitt" : producto.toLocaleLowerCase("es-AR");
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {iso}
      <span className="flex flex-col">
        <span className={`font-display ${t.texto} font-extrabold tracking-logo text-ink`}>{nombre}</span>
        {variante === "producto" ? <span className={`font-mono ${t.firma} text-ink-muted`}>por Kiwitt</span> : null}
      </span>
    </span>
  );
}
