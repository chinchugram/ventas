"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icono, type NombreIcono } from "@/components/iconos";

type Seccion = { href: string; etiqueta: string; icono: NombreIcono };

// Orden y agrupacion de la navegacion. En el celular, las primeras cuatro viven
// en la barra inferior y el resto en "Mas": son las que se usan todos los dias.
const INICIO: Seccion = { href: "/", etiqueta: "Inicio", icono: "inicio" };
const VENTAS: Seccion = { href: "/ventas", etiqueta: "Ventas", icono: "ventas" };
const CLIENTES: Seccion = { href: "/clientes", etiqueta: "Clientes", icono: "clientes" };
const PRINCIPALES: Seccion[] = [INICIO, VENTAS, CLIENTES];
const SECUNDARIAS: Seccion[] = [
  { href: "/catalogo", etiqueta: "Artículos", icono: "articulos" },
  { href: "/materiales", etiqueta: "Materiales", icono: "materiales" },
  { href: "/reportes", etiqueta: "Reportes", icono: "reportes" },
];
const NUEVA_VENTA = "/ventas/nueva";

function estaActiva(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // "Nueva venta" tiene su propio boton: no debe encender "Ventas".
  if (href === "/ventas") return pathname === "/ventas";
  return pathname.startsWith(href);
}

export function Navbar({ nombre, logo }: { nombre: string; logo: string }) {
  const pathname = usePathname() ?? "/";
  const [masAbierto, setMasAbierto] = useState(false);

  // Con la hoja abierta la pagina de atras no se desplaza, y Escape la cierra.
  useEffect(() => {
    if (!masAbierto) return;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMasAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => {
      document.body.style.overflow = overflowPrevio;
      window.removeEventListener("keydown", alTeclear);
    };
  }, [masAbierto]);

  const masActivo = SECUNDARIAS.some((s) => estaActiva(pathname, s.href));

  return (
    <>
      {/* Encabezado: negro del logo, igual en celular y escritorio. */}
      <header className="sticky top-0 z-40 w-full bg-tinta shadow-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center" aria-label={`${nombre}, ir al inicio`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt={nombre} className="h-10 w-auto" />
            </Link>

            <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
              {[...PRINCIPALES, ...SECUNDARIAS].map((s) => {
                const activa = estaActiva(pathname, s.href);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={activa ? "page" : undefined}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      activa
                        ? "bg-marca text-tinta"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {s.etiqueta}
                  </Link>
                );
              })}
            </nav>
          </div>

          <Link
            href={NUEVA_VENTA}
            className="hidden items-center gap-1.5 rounded-lg bg-marca px-4 py-2 text-sm font-semibold text-tinta transition-transform hover:brightness-105 active:scale-95 md:flex"
          >
            <Icono nombre="nueva" className="h-4 w-4" grosor={2.5} />
            Nueva venta
          </Link>
        </div>
      </header>

      {/* Hoja "Más" (solo celular). */}
      {masAbierto && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setMasAbierto(false)}
          />
          <div
            role="dialog"
            aria-label="Más secciones"
            className="sheet-in absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300" />
            <ul className="space-y-1">
              {SECUNDARIAS.map((s) => {
                const activa = estaActiva(pathname, s.href);
                return (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      onClick={() => setMasAbierto(false)}
                      aria-current={activa ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-3.5 text-base font-medium ${
                        activa ? "bg-marca-claro text-tinta" : "text-slate-700 active:bg-slate-100"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                          activa ? "bg-marca text-tinta" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <Icono nombre={s.icono} className="h-5 w-5" />
                      </span>
                      {s.etiqueta}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Barra inferior (solo celular): lo que se usa todos los dias, a un pulgar. */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5 items-end">
          <ItemBarra seccion={INICIO} activa={estaActiva(pathname, "/")} />
          <ItemBarra seccion={VENTAS} activa={estaActiva(pathname, "/ventas")} />

          <li className="flex justify-center">
            <Link
              href={NUEVA_VENTA}
              aria-label="Nueva venta"
              aria-current={pathname === NUEVA_VENTA ? "page" : undefined}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-marca text-tinta shadow-lg ring-4 ring-white transition-transform active:scale-90"
            >
              <Icono nombre="nueva" className="h-7 w-7" grosor={2.5} />
            </Link>
          </li>

          <ItemBarra seccion={CLIENTES} activa={estaActiva(pathname, "/clientes")} />

          <li>
            <button
              type="button"
              onClick={() => setMasAbierto((v) => !v)}
              aria-expanded={masAbierto}
              className={`flex w-full flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${
                masActivo || masAbierto ? "text-tinta" : "text-slate-500"
              }`}
            >
              <Icono nombre="mas" />
              Más
              <Indicador visible={masActivo} />
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

function ItemBarra({ seccion, activa }: { seccion: Seccion; activa: boolean }) {
  return (
    <li>
      <Link
        href={seccion.href}
        aria-current={activa ? "page" : undefined}
        className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${
          activa ? "text-tinta" : "text-slate-500"
        }`}
      >
        <Icono nombre={seccion.icono} />
        {seccion.etiqueta}
        <Indicador visible={activa} />
      </Link>
    </li>
  );
}

/** Punto naranja bajo la seccion activa. Reserva su espacio para que nada salte. */
function Indicador({ visible }: { visible: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-1 w-1 rounded-full ${visible ? "bg-marca" : "bg-transparent"}`}
    />
  );
}
