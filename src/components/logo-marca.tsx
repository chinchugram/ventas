import { inicialesDe } from "@/lib/marca-pura";

/**
 * Logo DEL NEGOCIO (no de Kiwitt: ese es LogoKiwitt). Va en el encabezado de la app, en /login y en
 * los documentos para el cliente final. Es lo único del branding del negocio que se ve en la interfaz.
 *
 * Logo del negocio, o un placeholder neutro con sus iniciales si no cargo uno (F4.2).
 * Sin estado ni hooks: sirve en server y en client components. `alto` es la clase de alto
 * (`h-10`, `h-12`...); el logo mantiene su proporcion y el placeholder es un cuadrado de ese alto.
 */
export function LogoMarca({
  nombre,
  logo,
  alto = "h-10",
  className = "",
}: {
  nombre: string;
  logo: string | null;
  alto?: string;
  className?: string;
}) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={nombre} className={`${alto} w-auto ${className}`} />;
  }
  return (
    <span
      role="img"
      aria-label={nombre}
      className={`${alto} borde aspect-square inline-flex select-none items-center justify-center rounded-md border-line bg-surface-raised font-display text-label text-ink ${className}`}
    >
      <span aria-hidden="true">{inicialesDe(nombre)}</span>
    </span>
  );
}
