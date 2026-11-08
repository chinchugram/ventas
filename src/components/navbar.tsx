"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icono, type NombreIcono } from "@/components/iconos";
import { LogoMarca } from "@/components/logo-marca";
import { LogoKiwitt } from "@/components/logo-kiwitt";
import { InterruptorModo } from "@/components/interruptor-modo";
import { RUTAS_MODO_SIMPLE, type Modo } from "@/lib/modo";
import { claseBoton } from "@/components/ui";
import { salir } from "@/app/login/actions";
import type { Rol } from "@/lib/auth-pura";
import { puedeTodo, rutaDeInicio, type Accion } from "@/lib/permisos-pura";

type Seccion = {
  href: string;
  etiqueta: string;
  icono: NombreIcono;
  /** Permisos que hacen falta para ver la entrada (todos). Los mismos que exige la pagina. */
  acciones: readonly Accion[];
  /** Frase corta, en palabras de todos los dias, que explica para que sirve la seccion. */
  ayuda?: string;
};

// Orden y agrupacion de la navegacion. En el celular, las primeras cuatro viven
// en la barra inferior y el resto en "Mas": son las que se usan todos los dias.
const INICIO: Seccion = { href: "/", etiqueta: "Inicio", icono: "inicio", acciones: ["verCostos", "verMargenes"], ayuda: "Cómo va el mes" };
const VENTAS: Seccion = { href: "/ventas", etiqueta: "Ventas", icono: "ventas", acciones: ["verVentas"], ayuda: "Todo lo que vendiste" };
const CLIENTES: Seccion = { href: "/clientes", etiqueta: "Clientes", icono: "clientes", acciones: ["verClientes"], ayuda: "Tus clientes y sus datos" };
const PRINCIPALES: Seccion[] = [INICIO, VENTAS, CLIENTES];
// Todas son arreglos de datos planos: cada entrada se filtra con los permisos del usuario antes de
// pintarse (ver `entradasVisibles`). Ocultar un enlace no protege nada: cada pagina lo vuelve a exigir.
// Cuelga de /cobranzas pero tiene su propia entrada: "Cobranzas" no debe encenderse en ella.
const RUTA_RECORDATORIOS = "/cobranzas/hoy";
const PRESUPUESTOS: Seccion = { href: "/presupuestos", etiqueta: "Presupuestos", icono: "ventas", acciones: ["verPresupuestos"], ayuda: "Cotizaciones para tus clientes" };
const COBRANZAS: Seccion = { href: "/cobranzas", etiqueta: "Cobranzas", icono: "cobranzas", acciones: ["verCobranzas"], ayuda: "Quién te debe plata" };
const RECORDATORIOS: Seccion = { href: RUTA_RECORDATORIOS, etiqueta: "Recordatorios", icono: "cobranzas", acciones: ["verRecordatorios"], ayuda: "A quién llamar hoy" };
const ARTICULOS: Seccion = { href: "/catalogo", etiqueta: "Artículos", icono: "articulos", acciones: ["verCostos", "verMargenes"], ayuda: "Lo que vendés y sus precios" };
const CORTES: Seccion = { href: "/cortes", etiqueta: "Cortes", icono: "articulos", acciones: ["verCostos"], ayuda: "Calculá el precio de una medida" };
const MATERIALES: Seccion = { href: "/materiales", etiqueta: "Materiales", icono: "materiales", acciones: ["verStock"], ayuda: "Lo que hay en stock" };
const COMPRAS: Seccion = { href: "/compras", etiqueta: "Compras", icono: "materiales", acciones: ["registrarCompra", "verCostos"], ayuda: "Cargá lo que compraste" };
const REPOSICION: Seccion = { href: "/reposicion", etiqueta: "Reposición", icono: "materiales", acciones: ["verReposicion"], ayuda: "Qué falta comprar" };
const PRODUCCION: Seccion = { href: "/produccion", etiqueta: "Producción", icono: "articulos", acciones: ["cargarProduccion"], ayuda: "Cargá lo que se usó en cada trabajo" };
const COMPROBANTES: Seccion = { href: "/comprobantes", etiqueta: "Comprobantes", icono: "comprobantes", acciones: ["verComprobantes"], ayuda: "Facturas y notas de crédito" };
const REPORTES: Seccion = { href: "/reportes", etiqueta: "Reportes", icono: "reportes", acciones: ["verReportes", "verCostos", "verMargenes"], ayuda: "Cuánto ganaste y qué se vende" };
// Orden de la hoja "Mas" del celular.
const SECUNDARIAS: Seccion[] = [PRESUPUESTOS, COBRANZAS, RECORDATORIOS, ARTICULOS, CORTES, MATERIALES, COMPRAS, REPOSICION, PRODUCCION, COMPROBANTES, REPORTES];
// Se usan poco: en el celular van al final de "Mas". La pagina `/usuarios/mi-clave` la ve cualquier rol;
// la administracion (`/usuarios`) solo el dueno.
const MI_CLAVE = "/usuarios/mi-clave";
const USUARIOS: Seccion = { href: "/usuarios", etiqueta: "Usuarios", icono: "clientes", acciones: ["gestionarUsuarios"], ayuda: "Quién puede entrar al sistema" };
const CONFIGURACION: Seccion = {
  href: "/configuracion",
  etiqueta: "Configuración",
  icono: "configuracion",
  acciones: ["configuracion"],
  ayuda: "Datos del negocio",
};
const LISTAS_PRECIOS: Seccion = {
  href: "/listas-precios",
  etiqueta: "Listas de precios",
  icono: "articulos",
  acciones: ["gestionarListasPrecios"],
  ayuda: "Precios especiales por cliente",
};
// Cualquier usuario con sesion de un negocio puede cambiar su clave: es el permiso de "todos".
const AYUDA: Seccion = { href: "/ayuda", etiqueta: "Ayuda", icono: "ayuda", acciones: ["cambiarClavePropia"], ayuda: "Cómo usar la app" };
const ADMINISTRACION: Seccion[] = [LISTAS_PRECIOS, USUARIOS, CONFIGURACION, AYUDA];

// Escritorio ancho (xl): pocas secciones sueltas y el resto agrupado en menus con nombre, cada
// entrada con una frase que dice para que sirve. Ningun icono suelto sin texto.
type Grupo = { etiqueta: string; icono: NombreIcono; entradas: Seccion[] };
const DIRECTAS_ESCRITORIO: Seccion[] = [INICIO, VENTAS, CLIENTES, PRESUPUESTOS, COBRANZAS];
const GRUPOS_ESCRITORIO: Grupo[] = [
  { etiqueta: "Productos", icono: "articulos", entradas: [ARTICULOS, CORTES, PRODUCCION] },
  { etiqueta: "Stock y compras", icono: "materiales", entradas: [MATERIALES, COMPRAS, REPOSICION] },
  { etiqueta: "Más", icono: "mas", entradas: [COMPROBANTES, RECORDATORIOS, REPORTES, LISTAS_PRECIOS, USUARIOS, CONFIGURACION, AYUDA] },
];
const ACCIONES_NUEVA_VENTA: readonly Accion[] = ["cargarVenta"];
const ID_HOJA_MAS = "hoja-mas";
const ID_MENU_USUARIO = "menu-usuario";
const NUEVA_VENTA = "/ventas/nueva";

/** Las entradas que el rol puede usar y que el modo muestra (en simple, solo lo indispensable). */
function entradasVisibles(rol: Rol, secciones: Seccion[], modo: Modo): Seccion[] {
  return secciones.filter((s) => puedeTodo({ rol }, s.acciones) && (modo === "avanzado" || RUTAS_MODO_SIMPLE.has(s.href)));
}

// Clases literales (Tailwind no ve las armadas con plantillas): la barra inferior tiene una columna
// por entrada principal, mas "Nueva venta" (al centro) y "Mas".
const COLUMNAS_BARRA: Record<number, string> = { 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" };

function estaActiva(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // "Nueva venta" tiene su propio boton: no debe encender "Ventas".
  if (href === "/ventas") return pathname === "/ventas";
  // La entrada mas especifica gana: dentro de /cobranzas/hoy solo se enciende "Recordatorios".
  if (href === "/cobranzas") return pathname.startsWith(href) && !pathname.startsWith(RUTA_RECORDATORIOS);
  return pathname.startsWith(href);
}

/** Lo unico que el navegador sabe del usuario: nombre para mostrar y rol. */
export type UsuarioNavbar = { nombre: string; rol: Rol };

const ETIQUETA_ROL: Record<Rol, string> = { DUENO: "Dueño", EMPLEADO: "Empleado" };

/** Primera letra del nombre para mostrar (respeta acentos y emojis). */
function inicial(nombre: string): string {
  return ([...nombre.trim()][0] ?? "?").toLocaleUpperCase("es-AR");
}

export function Navbar({
  nombre,
  logo,
  usuario,
  modo,
}: {
  nombre: string;
  logo: string | null;
  usuario: UsuarioNavbar;
  modo: Modo;
}) {
  const pathname = usePathname() ?? "/";
  const principales = entradasVisibles(usuario.rol, PRINCIPALES, modo);
  const secundarias = entradasVisibles(usuario.rol, SECUNDARIAS, modo);
  const administracion = entradasVisibles(usuario.rol, ADMINISTRACION, modo);
  const directas = entradasVisibles(usuario.rol, DIRECTAS_ESCRITORIO, modo);
  // Un menu sin ninguna entrada permitida para el rol no se muestra.
  const grupos = GRUPOS_ESCRITORIO.map((g) => ({ ...g, entradas: entradasVisibles(usuario.rol, g.entradas, modo) })).filter(
    (g) => g.entradas.length > 0,
  );
  const puedeNuevaVenta = puedeTodo(usuario, ACCIONES_NUEVA_VENTA);
  // Escritorio ancho (xl): secciones sueltas y menus desplegables. Entre md y xl no entran: se muestran
  // las principales y el resto va en la hoja "Mas", la misma del celular.
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
      {/* Encabezado: papel con la tinta de Kiwitt, igual en celular y escritorio y en los dos temas. */}
      <header className="sticky top-0 z-40 w-full border-b-(length:--border-width) border-line bg-surface">
        <div className="mx-auto flex min-h-16 max-w-page items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <Link
              href={rutaDeInicio(usuario.rol)}
              className="flex min-h-11 min-w-0 shrink-0 items-center gap-2 rounded-md pr-1"
              aria-label={`${nombre}, ventas por Kiwitt: ir al inicio`}
            >
              {/* Marca de la app (Kiwitt) y, como marca secundaria, la del negocio. */}
              <LogoKiwitt variante="isotipo" />
              <span aria-hidden="true" className="h-6 w-(--border-width) shrink-0 bg-line" />
              <LogoMarca nombre={nombre} logo={logo} alto="h-8" className="max-w-20 rounded-sm object-contain" />
              <span className="max-w-32 truncate text-label text-ink md:hidden" aria-hidden="true">
                {nombre}
              </span>
            </Link>

            {/* Desde md: las principales y "Más" (hoja); desde xl (con el selector de modo
                al lado no entran antes), las secciones sueltas y los menús desplegables con nombre. */}
            <nav className="hidden min-w-0 items-center gap-1 md:flex" aria-label="Principal">
              {principales.map((s) => (
                <EnlaceBarra key={s.href} seccion={s} activa={estaActiva(pathname, s.href)} />
              ))}
              {directas
                .filter((s) => !PRINCIPALES.includes(s))
                .map((s) => (
                  <EnlaceBarra key={s.href} seccion={s} activa={estaActiva(pathname, s.href)} className="hidden xl:inline-flex" />
                ))}
              {grupos.map((g) => (
                <MenuDesplegable key={g.etiqueta} grupo={g} pathname={pathname} className="hidden xl:block" alDerecha={g.etiqueta === "Más"} />
              ))}
              <button
                type="button"
                onClick={abrirMas}
                aria-haspopup="dialog"
                aria-expanded={masAbierto}
                aria-controls={ID_HOJA_MAS}
                className={`${CLASE_ITEM_BARRA} gap-1 xl:hidden ${masActivo ? CLASE_ITEM_ACTIVO : CLASE_ITEM_INACTIVO}`}
              >
                Más
                <Icono nombre="mas" className="h-4 w-4" grosor={2} />
              </button>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Modo simple / avanzado: cuánto del menú se muestra. El sonido se prende y apaga en Configuración. */}
            <InterruptorModo modo={modo} />
            {puedeNuevaVenta ? (
              // Hasta 2xl no entra el texto junto a la navegación y el selector de modo: queda el "+" con su nombre accesible.
              <Link
                href={NUEVA_VENTA}
                aria-label="Nueva venta"
                className={`${claseBoton({ chico: true })} hidden min-h-11 min-w-11 whitespace-nowrap px-3 md:inline-flex 2xl:px-4`}
              >
                <Icono nombre="nueva" className="h-4 w-4" grosor={2.5} />
                <span className="hidden 2xl:inline">Nueva venta</span>
              </Link>
            ) : null}
            <div className="hidden md:block">
              <MenuUsuario usuario={usuario} pathname={pathname} />
            </div>
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
        className="animate-entrada fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-lg border-(length:--border-width) border-b-0 border-line bg-surface-raised p-0 text-ink backdrop:bg-press/60 md:inset-0 md:m-auto md:h-fit md:max-w-sm md:rounded-lg md:border-b-(length:--border-width) md:shadow-press"
      >
        <div className="px-4 pt-3 pb-[calc(--spacing(4)+env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong md:hidden" aria-hidden="true" />
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="hoja-mas-titulo" className="px-3 font-display text-body-lg font-bold text-ink">
              Más secciones
            </h2>
            <button type="button" onClick={() => setMasAbierto(false)} className={`${claseBoton({ variante: "fantasma", chico: true })} min-h-11`}>
              Cerrar
            </button>
          </div>
          <ul className="space-y-1">
            {enHojaMas.map((s) => (
              <li key={s.href}>
                <EntradaConAyuda seccion={s} activa={estaActiva(pathname, s.href)} alElegir={() => setMasAbierto(false)} />
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t-(length:--border-width) border-line px-3 pt-3">
            <p className="min-w-0 text-body-sm text-ink-muted">
              <span className="block truncate text-body font-bold text-ink">{usuario.nombre}</span>
              {ETIQUETA_ROL[usuario.rol]}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Link href={MI_CLAVE} onClick={() => setMasAbierto(false)} className="enlace inline-flex min-h-11 items-center text-label">
                Cambiar mi clave
              </Link>
              <BotonSalir className={`${claseBoton({ variante: "secundario", chico: true })} min-h-11`}>
                <IconoSalir className="h-5 w-5" />
                Cerrar sesión
              </BotonSalir>
            </div>
          </div>
        </div>
      </dialog>

      {/* Barra inferior (solo celular): lo que se usa todos los dias, a un pulgar. */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-[60] border-t-(length:--border-width) border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className={`mx-auto grid max-w-md ${columnasBarra} items-end`}>
          {principales.includes(INICIO) ? <ItemBarra seccion={INICIO} activa={estaActiva(pathname, "/")} /> : null}
          {principales.includes(VENTAS) ? <ItemBarra seccion={VENTAS} activa={estaActiva(pathname, "/ventas")} /> : null}

          {puedeNuevaVenta ? (
            <li className="flex justify-center">
              {/* Botón sticker redondo: el primario de la marca, a un pulgar. */}
              <Link
                href={NUEVA_VENTA}
                aria-label="Nueva venta"
                aria-current={pathname === NUEVA_VENTA ? "page" : undefined}
                className={`${claseBoton()} -mt-6 h-14 w-14 p-0 ring-4 ring-surface-raised`}
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
              className={`${CLASE_ITEM_INFERIOR} ${masActivo || masAbierto ? "text-ink" : "text-ink-muted"}`}
            >
              <FichaIcono nombre="mas" activa={masActivo} />
              Más
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

/*
 * Estado activo (productos.md): la pestaña seleccionada lleva el acento de ventas, `cielo`, como un
 * sticker (relleno + texto on-color + sombra sólida). El resto, tinta suave sobre el papel.
 * Todas las piezas tocables miden 44px o más.
 */
const CLASE_ITEM_BARRA =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-2 text-label transition-colors duration-(--dur-rutina)";
const CLASE_ITEM_ACTIVO = "bg-cielo text-on-color shadow-press";
const CLASE_ITEM_INACTIVO = "text-ink-muted hover:bg-surface-sunken hover:text-ink";
const CLASE_ITEM_INFERIOR = "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-body-sm font-semibold";

/** Enlace suelto de la barra de escritorio. */
function EnlaceBarra({ seccion, activa, className = "" }: { seccion: Seccion; activa: boolean; className?: string }) {
  return (
    <Link
      href={seccion.href}
      aria-current={activa ? "page" : undefined}
      className={`${className} ${CLASE_ITEM_BARRA} ${activa ? CLASE_ITEM_ACTIVO : CLASE_ITEM_INACTIVO}`}
    >
      {seccion.etiqueta}
    </Link>
  );
}

/** Entrada con icono y frase de ayuda: la usan la hoja "Más" y los menús desplegables. */
function EntradaConAyuda({ seccion, activa, alElegir }: { seccion: Seccion; activa: boolean; alElegir?: () => void }) {
  return (
    <Link
      href={seccion.href}
      onClick={alElegir}
      aria-current={activa ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 transition-colors duration-(--dur-rutina) ${
        activa ? "bg-brand-soft" : "hover:bg-surface-sunken"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${
          activa ? "bg-cielo text-on-color" : "bg-surface-sunken text-ink"
        }`}
      >
        <Icono nombre={seccion.icono} className="h-5 w-5" grosor={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-label text-ink">{seccion.etiqueta}</span>
        {seccion.ayuda ? <span className="block text-body-sm text-ink-muted">{seccion.ayuda}</span> : null}
      </span>
    </Link>
  );
}

const FLECHA_ABAJO = "M19.5 8.25l-7.5 7.5-7.5-7.5";

/**
 * Menu desplegable de la barra de escritorio: un boton con nombre y flecha que abre un panel con las
 * secciones del grupo, cada una con su icono y una frase que explica para que sirve.
 * Patron "disclosure": aria-expanded; Escape o un clic afuera lo cierran.
 */
function MenuDesplegable({
  grupo,
  pathname,
  className = "",
  alDerecha = false,
}: {
  grupo: Grupo;
  pathname: string;
  className?: string;
  /** El panel se abre hacia la izquierda: para el ultimo menu, que queda pegado al borde. */
  alDerecha?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const idPanel = `menu-${grupo.etiqueta.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  const activo = grupo.entradas.some((s) => estaActiva(pathname, s.href));

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
    <div ref={contenedorRef} className={`relative ${className}`}>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls={idPanel}
        className={`${CLASE_ITEM_BARRA} gap-1 ${activo ? CLASE_ITEM_ACTIVO : abierto ? "bg-surface-sunken text-ink" : CLASE_ITEM_INACTIVO}`}
      >
        {grupo.etiqueta}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform duration-(--dur-rutina) ${abierto ? "rotate-180" : ""}`}
        >
          <path d={FLECHA_ABAJO} />
        </svg>
      </button>
      {abierto ? (
        <ul
          id={idPanel}
          className={`tarjeta absolute top-full ${alDerecha ? "right-0" : "left-0"} z-50 mt-2 w-72 space-y-1 p-2 shadow-press`}
        >
          {grupo.entradas.map((s) => (
            <li key={s.href}>
              <EntradaConAyuda seccion={s} activa={estaActiva(pathname, s.href)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ItemBarra({ seccion, activa }: { seccion: Seccion; activa: boolean }) {
  return (
    <li>
      <Link
        href={seccion.href}
        aria-current={activa ? "page" : undefined}
        className={`${CLASE_ITEM_INFERIOR} ${activa ? "text-ink" : "text-ink-muted"}`}
      >
        <FichaIcono nombre={seccion.icono} activa={activa} />
        {seccion.etiqueta}
      </Link>
    </li>
  );
}

/**
 * Icono de la barra inferior. En la sección activa va dentro de una píldora `cielo` (el acento de
 * ventas, como un sticker, con su sombra sólida: el cielo solo no llega a 3:1 sobre la barra); la
 * etiqueta pasa a `ink`. La píldora siempre ocupa su lugar: nada salta.
 */
function FichaIcono({ nombre, activa }: { nombre: NombreIcono; activa: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-(--dur-rutina) ${
        activa ? "bg-cielo text-on-color shadow-press" : ""
      }`}
    >
      <Icono nombre={nombre} className="h-5 w-5" grosor={2} />
    </span>
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
      strokeWidth={2}
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
 * entra el nombre completo; está en `title` y en el nombre accesible) abre un panel con el nombre, el rol y "Cerrar sesion".
 * Patron "disclosure": boton con aria-expanded; Escape o un clic afuera lo cierran.
 */
function MenuUsuario({ usuario, pathname }: { usuario: UsuarioNavbar; pathname: string }) {
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
        className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-1 transition-colors duration-(--dur-rutina) hover:bg-surface-sunken ${
          abierto ? "bg-surface-sunken" : ""
        }`}
      >
        <span
          aria-hidden="true"
          className="borde flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-line-strong bg-surface-sunken font-display text-label text-ink"
        >
          {inicial(usuario.nombre)}
        </span>
      </button>
      {abierto ? (
        <div id={ID_MENU_USUARIO} className="tarjeta absolute top-full right-0 z-50 mt-2 w-64 p-4 shadow-press">
          <p className="text-body-sm text-ink-muted">
            <span className="block truncate text-body font-bold text-ink">{usuario.nombre}</span>
            {ETIQUETA_ROL[usuario.rol]}
          </p>
          <Link
            href={MI_CLAVE}
            aria-current={estaActiva(pathname, MI_CLAVE) ? "page" : undefined}
            className={`${claseBoton({ variante: "secundario", chico: true, ancho: true })} mt-4 min-h-11`}
          >
            Cambiar mi clave
          </Link>
          <BotonSalir className={`${claseBoton({ variante: "secundario", chico: true, ancho: true })} mt-3 min-h-11`}>
            <IconoSalir className="h-5 w-5" />
            Cerrar sesión
          </BotonSalir>
        </div>
      ) : null}
    </div>
  );
}
