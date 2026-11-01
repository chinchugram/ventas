import { inicialesDe } from "@/lib/marca-pura";

/**
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
      className={`${alto} aspect-square inline-flex select-none items-center justify-center rounded-lg bg-marca text-sm font-bold text-tinta ${className}`}
    >
      <span aria-hidden="true">{inicialesDe(nombre)}</span>
    </span>
  );
}
