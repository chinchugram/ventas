"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icono, type NombreIcono } from "@/components/iconos";
import { salir } from "@/app/login/actions";
import type { Rol } from "@/lib/auth-pura";
import { puedeTodo, rutaDeInicio, type Accion } from "@/lib/permisos-pura";

type Seccion = {
  href: string;
  etiqueta: string;
  icono: NombreIcono;
  /** Permisos que hacen falta para ver la entrada (todos). Los mismos que exige la pagina. */
  acciones: readonly Accion[];
};

// Orden y agrupacion de la navegacion. En el celular, las primeras cuatro viven
// en la barra inferior y el resto en "Mas": son las que se usan todos los dias.
const INICIO: Seccion = { href: "/", etiqueta: "Inicio", icono: "inicio", acciones: ["verCostos", "verMargenes"] };
const VENTAS: Seccion = { href: "/ventas", etiqueta: "Ventas", icono: "ventas", acciones: ["verVentas"] };
const CLIENTES: Seccion = { href: "/clientes", etiqueta: "Clientes", icono: "clientes", acciones: ["verClientes"] };
const PRINCIPALES: Seccion[] = [INICIO, VENTAS, CLIENTES];
// Todas son arreglos de datos planos: cada entrada se filtra con los permisos del usuario antes de
// pintarse (ver `entradasVisibles`). Ocultar un enlace no protege nada: cada pagina lo vuelve a exigir.
const SECUNDARIAS: Seccion[] = [
  { href: "/catalogo", etiqueta: "Artículos", icono: "articulos", acciones: ["verCostos", "verMargenes"] },
  { href: "/cortes", etiqueta: "Cortes", icono: "articulos", acciones: ["verCostos"] },
  { href: "/materiales", etiqueta: "Materiales", icono: "materiales", acciones: ["verStock"] },
  { href: "/compras", etiqueta: "Compras", icono: "materiales", acciones: ["registrarCompra", "verCostos"] },
  { href: "/reposicion", etiqueta: "Reposición", icono: "materiales", acciones: ["verReposicion"] },
  { href: "/cobranzas", etiqueta: "Cobranzas", icono: "cobranzas", acciones: ["verCobranzas"] },
  { href: "/reportes", etiqueta: "Reportes", icono: "reportes", acciones: ["verReportes", "verCostos", "verMargenes"] },
];
// Se usan poco: en el celular van al final de "Mas". En escritorio, la configuracion es un icono
// junto a "Nueva venta" y "Usuarios" vive en el menu de la cuenta (la barra a 1024 px justo entra).
// La pagina `/usuarios` la arma la tarea 4.4; hasta entonces el enlace del dueno lleva a un 404.
const USUARIOS: Seccion = { href: "/usuarios", etiqueta: "Usuarios", icono: "clientes", acciones: ["gestionarUsuarios"] };
const CONFIGURACION: Seccion = {
  href: "/configuracion",
  etiqueta: "Configuración",
  icono: "configuracion",
  acciones: ["configuracion"],
};
const ADMINISTRACION: Seccion[] = [USUARIOS, CONFIGURACION];
const ICONOS_ESCRITORIO: Seccion[] = [CONFIGURACION];
const EN_MENU_USUARIO: Seccion[] = [USUARIOS];
const ACCIONES_NUEVA_VENTA: readonly Accion[] = ["cargarVenta"];
const ID_HOJA_MAS = "hoja-mas";
const ID_MENU_USUARIO = "menu-usuario";
const NUEVA_VENTA = "/ventas/nueva";

/** Las entradas que el rol puede usar. */
function entradasVisibles(rol: Rol, secciones: Seccion[]): Seccion[] {
  return secciones.filter((s) => puedeTodo({ rol }, s.acciones));
}

// Clases literales (Tailwind no ve las armadas con plantillas): la barra inferior tiene una columna
// por entrada principal, mas "Nueva venta" (al centro) y "Mas".
const COLUMNAS_BARRA: Record<number, string> = { 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" };

function estaActiva(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // "Nueva venta" tiene su propio boton: no debe encender "Ventas".
  if (href === "/ventas") return pathname === "/ventas";
  return pathname.startsWith(href);
}

/** Lo unico que el navegador sabe del usuario: nombre para mostrar y rol. */
export type UsuarioNavbar = { nombre: string; rol: Rol };

const ETIQUETA_ROL: Record<Rol, string> = { DUENO: "Dueño", EMPLEADO: "Empleado" };

/** Primera letra del nombre para mostrar (respeta acentos y emojis). */
function inicial(nombre: string): string {
  return ([...nombre.trim()][0] ?? "?").toLocaleUpperCase("es-AR");
}

export function Navbar({ nombre, logo, usuario }: { nombre: string; logo: string; usuario: UsuarioNavbar }) {
  const pathname = usePathname() ?? "/";
  const principales = entradasVisibles(usuario.rol, PRINCIPALES);
  const secundarias = entradasVisibles(usuario.rol, SECUNDARIAS);
  const administracion = entradasVisibles(usuario.rol, ADMINISTRACION);
  const iconosEscritorio = entradasVisibles(usuario.rol, ICONOS_ESCRITORIO);
  const enMenuUsuario = entradasVisibles(usuario.rol, EN_MENU_USUARIO);
  const puedeNuevaVenta = puedeTodo(usuario, ACCIONES_NUEVA_VENTA);
  // Escritorio ancho (lg): todas las secciones en la barra. Entre md y lg no entran: se muestran
  // las principales y el resto va en la hoja "Mas", la misma del celular.
  const enlacesEscritorio = [...principales, ...secundarias];
  const enHojaMas = [...secundarias, ...administracion];
  const columnasBarra = COLUMNAS_BARRA[principales.length + 1 + (puedeNuevaVenta ? 1 : 0)] ?? "grid-cols-5";
  const [masAbierto, setMasAbierto] = useState(false);
  const hojaRef = useRef<HTMLDialogElement>(null);
  // Boton que abrio la hoja (hay uno en la barra inferior y otro en el encabezado): a el vuelve el foco.
  const disparadorRef = useRef<HTMLElement | null>(null);

  function abrirMas(e: React.MouseEvent<HTMLElement>) {
    disparadorRef.current = e.currentTarget;
    setMasAbierto((v) => !v);
  }

  // <dialog> modal: showModal() mueve el foco adentro, atrapa Tab, deja inerte la pagina de atras
  // y Escape lo cierra. El estado de React solo refleja si esta abierto.
  useEffect(() => {
    const hoja = hojaRef.current;
    if (!hoja) return;
    if (masAbierto && !hoja.open) hoja.showModal();
    if (!masAbierto && hoja.open) hoja.close();
  }, [masAbierto]);

  // Al navegar la hoja se cierra, aunque el cambio de ruta no venga de un toque en la hoja.
  useEffect(() => {
    setMasAbierto(false);
  }, [pathname]);

  // Con la hoja abierta la pagina de atras no se desplaza.
  useEffect(() => {
    if (!masAbierto) return;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflowPrevio;
    };
  }, [masAbierto]);

  // Se dispara al cerrar por cualquier via (Escape, "Cerrar", fondo, navegar): devuelve el foco.
  function alCerrarHoja() {
    setMasAbierto(false);
    disparadorRef.current?.focus();
  }

  const masActivo = enHojaMas.some((s) => estaActiva(pathname, s.href));

  return (
    <>
      {/* Encabezado: negro del logo, igual en celular y escritorio. */}
      <header className="sticky top-0 z-40 w-full bg-tinta shadow-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center xl:max-w-6xl justify-between px-4">
          <div className="flex min-w-0 items-center gap-3 lg:gap-4">
            <Link
              href={rutaDeInicio(usuario.rol)}
              className="flex shrink-0 items-center rounded-lg p-1"
              aria-label={`${nombre}, ir al inicio`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt={nombre} className="h-10 w-auto" />
            </Link>

            {/* Desde md: las principales y "Más"; desde lg entran todas las secciones (y desde xl, el
                encabezado se ensancha para que "Nueva venta" conserve su texto). */}
            <nav className="hidden min-w-0 items-center gap-1 md:flex" aria-label="Principal">
              {enlacesEscritorio.map((s) => {
                const activa = estaActiva(pathname, s.href);
                // Las secundarias solo caben desde lg; antes se llega a ellas por "Mas".
                const esSecundaria = !PRINCIPALES.includes(s);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={activa ? "page" : undefined}
                    className={`${esSecundaria ? "hidden lg:block" : ""} whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                      activa
                        ? "bg-marca text-tinta"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {s.etiqueta}
                  </Link>
                );
              })}
              <button
                type="button"
                onClick={abrirMas}
                aria-haspopup="dialog"
                aria-expanded={masAbierto}
                aria-controls={ID_HOJA_MAS}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium transition-colors lg:hidden ${
                  masActivo
                    ? "bg-marca text-tinta"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Más
                <Icono nombre="mas" className="h-4 w-4" />
              </button>
            </nav>
          </div>

          {/* gap-1: con el menu del usuario, en lg las diez secciones justo entran. */}
          <div className="hidden shrink-0 items-center gap-1 md:flex">
            <MenuUsuario usuario={usuario} pathname={pathname} enlaces={enMenuUsuario} />
            {iconosEscritorio.map((s) => {
              const activa = estaActiva(pathname, s.href);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-label={s.etiqueta}
                  title={s.etiqueta}
                  aria-current={activa ? "page" : undefined}
                  className={`rounded-lg p-3 transition-colors ${
                    activa ? "bg-marca text-tinta" : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icono nombre={s.icono} className="h-5 w-5" />
                </Link>
              );
            })}
            {puedeNuevaVenta ? (
              <Link
                href={NUEVA_VENTA}
                className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-marca px-3 text-sm font-semibold text-tinta transition-transform hover:brightness-105 active:scale-95 xl:px-4"
              >
                <Icono nombre="nueva" className="h-4 w-4" grosor={2.5} />
                <span className="sr-only xl:not-sr-only">Nueva venta</span>
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {/* Hoja "Más": abajo en el celular, tarjeta centrada desde md. Al tocar el fondo se cierra. */}
      <dialog
        ref={hojaRef}
        id={ID_HOJA_MAS}
        aria-modal="true"
        aria-labelledby="hoja-mas-titulo"
        onClose={alCerrarHoja}
        onClick={(e) => {
          if (e.target === e.currentTarget) setMasAbierto(false);
        }}
        className="sheet-in fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm md:inset-0 md:m-auto md:h-fit md:max-w-sm md:rounded-3xl"
      >
        <div className="px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
          <div className="mb-2 flex items-center justify-between">
            <h2 id="hoja-mas-titulo" className="px-3 text-sm font-semibold text-slate-500">
              Más secciones
            </h2>
            <button
              type="button"
              onClick={() => setMasAbierto(false)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-slate-700 active:bg-slate-100"
            >
              Cerrar
            </button>
          </div>
          <ul className="space-y-1">
            {enHojaMas.map((s) => {
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
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 px-3 pt-3">
            <p className="min-w-0 text-sm text-slate-600">
              <span className="block truncate font-semibold text-slate-900">{usuario.nombre}</span>
              {ETIQUETA_ROL[usuario.rol]}
            </p>
            <BotonSalir className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 active:bg-slate-100">
              <IconoSalir className="h-5 w-5" />
              Cerrar sesión
            </BotonSalir>
          </div>
        </div>
      </dialog>

      {/* Barra inferior (solo celular): lo que se usa todos los dias, a un pulgar. */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className={`mx-auto grid max-w-md ${columnasBarra} items-end`}>
          {principales.includes(INICIO) ? <ItemBarra seccion={INICIO} activa={estaActiva(pathname, "/")} /> : null}
          {principales.includes(VENTAS) ? <ItemBarra seccion={VENTAS} activa={estaActiva(pathname, "/ventas")} /> : null}

          {puedeNuevaVenta ? (
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
          ) : null}

          {principales.includes(CLIENTES) ? <ItemBarra seccion={CLIENTES} activa={estaActiva(pathname, "/clientes")} /> : null}

          <li>
            <button
              type="button"
              onClick={abrirMas}
              aria-haspopup="dialog"
              aria-expanded={masAbierto}
              aria-controls={ID_HOJA_MAS}
              className={`flex w-full flex-col items-center gap-0.5 pt-2 pb-1.5 text-xs font-medium ${
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
        className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-xs font-medium ${
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

/**
 * Cierra la sesion con un formulario y una server action (POST, mismo origen):
 * anda aunque el JS no haya cargado y otro sitio no puede dispararlo.
 */
function BotonSalir({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <form action={salir}>
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}

/** Flecha saliendo de una puerta (mismo trazo que los iconos de la navegacion). */
function IconoSalir({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  );
}

/**
 * Menu del usuario en el encabezado de escritorio: la inicial (en la barra no
 * entra el nombre completo) abre un panel con el nombre, el rol y "Cerrar sesion".
 * Patron "disclosure": boton con aria-expanded; Escape o un clic afuera lo cierran.
 */
function MenuUsuario({
  usuario,
  pathname,
  enlaces,
}: {
  usuario: UsuarioNavbar;
  pathname: string;
  /** Secciones que el rol puede abrir desde el menu (hoy, "Usuarios" para el dueno). */
  enlaces: Seccion[];
}) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  useEffect(() => {
    if (!abierto) return;
    const alClicFuera = (e: MouseEvent) => {
      if (!contenedorRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAbierto(false);
      botonRef.current?.focus();
    };
    document.addEventListener("mousedown", alClicFuera);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("mousedown", alClicFuera);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  return (
    <div ref={contenedorRef} className="relative">
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls={ID_MENU_USUARIO}
        aria-label={`${usuario.nombre}: cuenta y cerrar sesión`}
        title={usuario.nombre}
        className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white"
        >
          {inicial(usuario.nombre)}
        </span>
      </button>
      {abierto ? (
        <div
          id={ID_MENU_USUARIO}
          className="absolute top-full right-0 z-50 mt-2 w-60 rounded-xl bg-white p-3 text-slate-900 shadow-xl ring-1 ring-slate-200"
        >
          <p className="px-1 text-sm text-slate-600">
            <span className="block truncate font-semibold text-slate-900">{usuario.nombre}</span>
            {ETIQUETA_ROL[usuario.rol]}
          </p>
          {enlaces.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={estaActiva(pathname, s.href) ? "page" : undefined}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Icono nombre={s.icono} className="h-5 w-5" />
              {s.etiqueta}
            </Link>
          ))}
          <BotonSalir className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <IconoSalir className="h-5 w-5" />
            Cerrar sesión
          </BotonSalir>
        </div>
      ) : null}
    </div>
  );
}
