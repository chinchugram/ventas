"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PARTES = [
  { href: "/configuracion", etiqueta: "Negocio" },
  { href: "/configuracion/datos-fiscales", etiqueta: "Datos fiscales" },
  { href: "/configuracion/maquinas", etiqueta: "Máquinas" },
  { href: "/configuracion/otros", etiqueta: "Otros" },
] as const;

function activa(pathname: string, href: string): boolean {
  if (href === "/configuracion") return pathname === href;
  return pathname.startsWith(href);
}

/** Pestañas de Configuración: cada parte es su propia página. Si no entran en una línea, bajan a la siguiente. */
export function SubnavConfiguracion() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Partes de la configuración" className="mb-6">
      <ul className="flex flex-wrap gap-2">
        {PARTES.map((p) => {
          const actual = activa(pathname, p.href);
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={actual ? "page" : undefined}
                className={`borde inline-flex min-h-11 items-center rounded-full px-3.5 text-label font-bold whitespace-nowrap transition-colors ${
                  actual ? "border-brand bg-brand text-on-color" : "border-line-strong text-ink-muted hover:text-ink"
                }`}
              >
                {p.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
