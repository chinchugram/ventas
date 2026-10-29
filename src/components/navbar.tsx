"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES = [
  { href: "/", etiqueta: "Mes" },
  { href: "/ventas", etiqueta: "Ventas" },
  { href: "/clientes", etiqueta: "Clientes" },
  { href: "/catalogo", etiqueta: "Artículos" },
  { href: "/materiales", etiqueta: "Materiales" },
  { href: "/reportes", etiqueta: "Reportes" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Con el menu abierto la pagina de atras no se desplaza, y Escape lo cierra.
  useEffect(() => {
    if (!abierto) return;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => {
      document.body.style.overflow = overflowPrevio;
      window.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              type="button"
              onClick={() => setAbierto(!abierto)}
              className="md:hidden -ml-2 rounded-lg p-2 text-slate-600 hover:bg-slate-100 active:bg-slate-200 cursor-pointer touch-manipulation"
              aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={abierto}
            >
              <svg
                className="h-6 w-6 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                {abierto ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 font-bold text-slate-800">
              <span className="text-xl">📊</span> Ventas
            </Link>

            {/* Desktop Nav - Pegado a la izquierda junto al logo */}
            <nav className="hidden md:flex items-center gap-1 ml-4">
              {SECCIONES.map((s) => {
                const activo = s.href === "/" ? pathname === "/" : (pathname || "").startsWith(s.href);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      activo
                        ? "bg-marca text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {s.etiqueta}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Desktop Right Side - Accion Rapida */}
          <div className="hidden md:flex items-center">
            <Link
              href="/ventas/nueva"
              className="rounded-lg bg-marca px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-marca/90 active:scale-95 transition-transform"
            >
              + Nueva Venta
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile Drawer (Sidebar izquierdo) */}
      {abierto && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop overlay */}
          <div 
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" 
            onClick={() => setAbierto(false)} 
          />
          
          <nav className="relative flex w-64 max-w-[80vw] flex-col bg-white shadow-2xl h-full drawer-in">
            <div className="flex h-14 items-center px-4 border-b border-slate-200">
              <span className="flex items-center gap-2 font-bold text-slate-800">
                <span className="text-xl">📊</span> Ventas
              </span>
            </div>

            <div className="flex flex-col gap-1 p-3 overflow-y-auto">
              {SECCIONES.map((s) => {
                const activo = s.href === "/" ? pathname === "/" : (pathname || "").startsWith(s.href);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    onClick={() => setAbierto(false)}
                    className={`flex items-center rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                      activo
                        ? "bg-marca/10 text-marca font-semibold"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {s.etiqueta}
                  </Link>
                );
              })}
              
              <div className="mt-4 border-t border-slate-200 pt-4">
                <Link
                  href="/ventas/nueva"
                  onClick={() => setAbierto(false)}
                  className="flex w-full items-center justify-center rounded-lg bg-marca py-3 text-sm font-bold text-white shadow-sm active:scale-95"
                >
                  + Nueva Venta
                </Link>
              </div>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
