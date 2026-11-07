import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { fmtMoneda, fmtPorcentaje, Dinero } from "@/lib/money";

/*
 * Piezas de interfaz con la marca Kiwitt (docs/brand/). Todas usan tokens de globals.css: ningún
 * color, radio ni sombra escrito a mano. Sin estado ni hooks: sirven en server y client components.
 */

export type Tono = "neutro" | "ok" | "aviso" | "critico" | "info" | "marca";
export type Acento = "sol" | "menta" | "cielo" | "frambuesa" | "brand";

/** Tono de la etiqueta de cada estado de pago de una venta (el texto sale de `ETIQUETA_ESTADO_PAGO`). */
export const TONO_ESTADO_PAGO: Record<"AL_DIA" | "PARCIAL" | "PENDIENTE" | "PAGADA", Tono> = {
  AL_DIA: "ok",
  PARCIAL: "info",
  PENDIENTE: "aviso",
  PAGADA: "ok",
};

// ─── Botón sticker ───────────────────────────────────────────────────────

type VarianteBoton = "primario" | "secundario" | "peligro" | "fantasma" | "fantasma-peligro";

const CLASE_VARIANTE: Record<VarianteBoton, string> = {
  primario: "boton-primario",
  secundario: "boton-secundario",
  peligro: "boton-peligro",
  fantasma: "boton-fantasma",
  "fantasma-peligro": "boton-fantasma-peligro",
};

/** Clases del botón sticker, para usarlas en algo que no sea <Boton> (un <summary>, un <label>…). */
export function claseBoton({
  variante = "primario",
  chico = false,
  ancho = false,
}: { variante?: VarianteBoton; chico?: boolean; ancho?: boolean } = {}) {
  return ["boton", CLASE_VARIANTE[variante], chico ? "boton-chico" : "", ancho ? "boton-ancho" : ""].filter(Boolean).join(" ");
}

type PropsBotonBase = { variante?: VarianteBoton; chico?: boolean; ancho?: boolean; className?: string; children: ReactNode };

/**
 * Botón sticker (forma.md): píldora con sombra sólida que baja 3px al apretar. Primario en
 * mandarina (`brand` + `on-color`), igual en todos los productos. Con `href` es un <Link>.
 *
 *   <Boton type="submit">Guardar</Boton>
 *   <Boton href="/ventas/nueva" chico>Nueva venta</Boton>
 *   <Boton variante="secundario" onClick={…}>Cancelar</Boton>
 */
export function Boton(
  props:
    | (PropsBotonBase & { href: string } & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">)
    | (PropsBotonBase & { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">),
) {
  const { variante, chico, ancho, className = "", children, ...resto } = props;
  const clase = `${claseBoton({ variante, chico, ancho })} ${className}`;
  if (resto.href !== undefined) {
    const { href, ...enlace } = resto as { href: string } & Omit<ComponentProps<typeof Link>, "href">;
    return (
      <Link href={href} className={clase} {...enlace}>
        {children}
      </Link>
    );
  }
  const { type = "button", ...boton } = resto as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} className={clase} {...boton}>
      {children}
    </button>
  );
}

// ─── Etiquetas y stickers ────────────────────────────────────────────────

const CLASE_TONO: Record<Tono, string> = {
  neutro: "bg-surface-sunken text-ink-muted border-line",
  ok: "bg-ok-soft text-ok-text border-ok-line",
  aviso: "bg-aviso-soft text-aviso-text border-aviso-line",
  critico: "bg-critico-soft text-critico-text border-critico-line",
  info: "bg-info-soft text-info-text border-info-line",
  marca: "bg-brand-soft text-brand-text border-brand",
};

/**
 * Etiqueta de estado (píldora suave): "Pagada", "Vencido", "Sin stock". Para datos: sobria.
 *
 *   <Etiqueta tono="ok">Pagada</Etiqueta>
 */
export function Etiqueta({ tono = "neutro", className = "", children }: { tono?: Tono; className?: string; children: ReactNode }) {
  return (
    <span
      className={`borde inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-body-sm font-semibold whitespace-nowrap ${CLASE_TONO[tono]} ${className}`}
    >
      {children}
    </span>
  );
}

const CLASE_ACENTO: Record<Acento, string> = {
  sol: "bg-sol",
  menta: "bg-menta",
  cielo: "bg-cielo",
  frambuesa: "bg-frambuesa",
  brand: "bg-brand",
};

/**
 * Sticker (forma.md): bloque de acento con sombra sólida y texto `on-color`. Para lo destacado
 * ("Nuevo", "Hoy") y el monto de un festejo. Ventas usa `cielo` (productos.md). Puede ir girado.
 *
 *   <Sticker acento="cielo">Hoy</Sticker>
 */
export function Sticker({
  acento = "cielo",
  girado = false,
  className = "",
  children,
}: {
  acento?: Acento;
  girado?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`sticker sobre-color ${CLASE_ACENTO[acento]} ${girado ? "sticker-girado" : ""} ${className}`}>{children}</span>
  );
}

/** Epígrafe sobre un título (mono, ink-muted). */
export function Epigrafe({ className = "", children }: { className?: string; children: ReactNode }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

/** Título de un bloque dentro de una pantalla ("Pagos", "Últimas ventas"): display body-lg bold. */
export function TituloBloque({ id, className = "mb-3", children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <h2 id={id} className={`font-display text-body-lg font-bold text-ink ${className}`}>
      {children}
    </h2>
  );
}

/**
 * Chip elegible (artículo del catálogo, método de cobro, filtro): botón con `aria-pressed`. Seleccionado
 * se pinta con el acento cielo de ventas. Para un filtro que navega, usar `<Link className="chip" aria-current="page">`.
 *
 *   <Chip activo={metodo === "EFECTIVO"} onClick={…}>Efectivo</Chip>
 */
export function Chip({
  activo,
  className = "",
  children,
  ...resto
}: { activo: boolean; className?: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button type="button" aria-pressed={activo} className={`chip ${className}`} {...resto}>
      {children}
    </button>
  );
}

/** Lista de filas dentro de una tarjeta, separadas por `line` (el patrón del tablero, para reusar en las listas). */
export function ListaPanel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <ul className={`tarjeta divide-y-(length:--border-width) divide-line overflow-hidden ${className}`}>{children}</ul>;
}

// ─── Contenedores ────────────────────────────────────────────────────────

/**
 * Panel: la tarjeta base (surface-raised, borde `line` de 1.5px, radius-lg). Para formularios,
 * listas y bloques de contenido.
 *
 *   <Panel className="space-y-4">…</Panel>
 */
export function Panel({
  como: Etiqueta = "div",
  compacto = false,
  className = "",
  children,
}: {
  como?: "div" | "section" | "article" | "aside";
  compacto?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <Etiqueta className={`tarjeta ${compacto ? "p-3 sm:p-4" : "p-4 sm:p-6"} ${className}`}>{children}</Etiqueta>;
}

const CLASE_AVISO: Record<Exclude<Tono, "neutro">, string> = {
  ok: "bg-ok-soft text-ink border-ok-line",
  aviso: "bg-aviso-soft text-ink border-aviso-line",
  critico: "bg-critico-soft text-ink border-critico-line",
  info: "bg-info-soft text-ink border-info-line",
  marca: "bg-brand-soft text-ink border-brand",
};

const CLASE_AVISO_TITULO: Record<Exclude<Tono, "neutro">, string> = {
  ok: "text-ok-text",
  aviso: "text-aviso-text",
  critico: "text-critico-text",
  info: "text-info-text",
  marca: "text-brand-text",
};

/**
 * Aviso en bloque: mensaje con fondo suave del tono. El título va en el color del tono; el cuerpo,
 * en `ink`. Los errores dicen qué pasó, qué hicimos y qué hacer (voz.md).
 *
 *   <Aviso tono="aviso" titulo="Stock bajo">Quedan 2 planchas de MDF 3mm.</Aviso>
 */
export function Aviso({
  tono = "info",
  titulo,
  role,
  className = "",
  children,
}: {
  tono?: Exclude<Tono, "neutro">;
  titulo?: ReactNode;
  role?: "alert" | "status";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div role={role} className={`borde rounded-md p-3 text-body-sm ${CLASE_AVISO[tono]} ${className}`}>
      {titulo ? <p className={`font-bold ${CLASE_AVISO_TITULO[tono]}`}>{titulo}</p> : null}
      {children ? <div className={titulo ? "mt-0.5" : ""}>{children}</div> : null}
    </div>
  );
}

// ─── Indicadores ─────────────────────────────────────────────────────────

/**
 * Tarjeta de indicador. En mobile el grid es de una columna: el dueño mira
 * numeros grandes, en vertical, con el celular a la vista.
 */
export function Tarjeta({
  titulo,
  valor,
  detalle,
  tono = "neutro",
}: {
  titulo: string;
  valor: string;
  detalle?: React.ReactNode;
  tono?: "neutro" | "ok" | "critico" | "aviso";
}) {
  const colorValor =
    {
      neutro: "text-ink",
      ok: "text-ok-text",
      critico: "text-critico-text",
      aviso: "text-aviso-text",
    }[tono];

  // El numero se achica segun su largo para no desbordar la tarjeta en pantallas
  // angostas (dos tarjetas por fila en un celular de 375px).
  // `.monto` es display-md con números tabulares (tipografia.md); los muy largos bajan a body-lg.
  const tamano = valor.length > 14 ? "text-body-lg" : valor.length > 11 ? "text-body-lg sm:text-display-md" : "";

  return (
    <div className="tarjeta min-w-0 p-3 sm:p-4">
      <p className="eyebrow truncate">{titulo}</p>
      <p className={`monto mt-1 whitespace-nowrap ${tamano} ${colorValor}`}>{valor}</p>
      {detalle ? <p className="mt-1 text-body-sm text-ink-muted">{detalle}</p> : null}
    </div>
  );
}

/** Encabezado de seccion: título en Bricolage, epígrafe y bajada opcionales, acción a la derecha. */
export function Seccion({
  titulo,
  descripcion,
  accion,
  epigrafe,
}: {
  titulo: string;
  descripcion?: string;
  accion?: React.ReactNode;
  epigrafe?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {epigrafe ? <p className="eyebrow mb-1">{epigrafe}</p> : null}
        <h1 className="font-display text-display-md text-ink">{titulo}</h1>
        {descripcion ? <p className="mt-1 text-body text-ink-muted">{descripcion}</p> : null}
      </div>
      {accion}
    </div>
  );
}

/**
 * Semforo de margen. El color no es decorativo: dice si el articulo vale la
 * pena venderlo al precio actual. El detalle (markup) esta en el tooltip del
 * title para quien quiera el otro calculo.
 */
export function SemaforoMargen({ margenPct, metaPct }: { margenPct: Dinero; metaPct: Dinero }) {
  const pct = Number(margenPct.toString());
  const meta = Number(metaPct.toString());
  const tono: Tono = pct >= meta ? "ok" : pct > 0 ? "aviso" : "critico";

  return (
    <span title={`Markup sobre costo: ${fmtPorcentaje(margenPct)}`} className="inline-block">
      <Etiqueta tono={tono} className="tabular-nums">
        {fmtPorcentaje(margenPct)}
      </Etiqueta>
    </span>
  );
}

/** Pantalla vacía: con humor y una sugerencia (voz.md), nunca un "No hay registros" seco. */
export function Vacio({ mensaje, hint, accion }: { mensaje: string; hint?: string; accion?: ReactNode }) {
  return (
    <div className="rounded-lg border-(length:--border-width) border-dashed border-line-strong bg-surface-raised p-8 text-center">
      <p className="font-display text-body-lg font-bold text-ink">{mensaje}</p>
      {hint ? <p className="mt-1 text-body-sm text-ink-muted">{hint}</p> : null}
      {accion ? <div className="mt-4 flex justify-center">{accion}</div> : null}
    </div>
  );
}

/**
 * Tabla que en desktop es tabla y en mobile es una lista de tarjetas.
 *
 * Una tabla de 6 columnas en 360px no se lee: la fila se parte y los numeros
 * dejan de alinearse. En mobile cada celda pasa a ser un par etiqueta/valor.
 */
export function Tabla({ columnas, filas }: { columnas: string[]; filas: string[][] }) {
  return (
    <>
      {/* Desktop: tabla normal. */}
      <div className="tarjeta hidden overflow-x-auto sm:block">
        <table>
          <thead>
            <tr>
              {columnas.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => (
              <tr key={i}>
                {fila.map((celda, j) => (
                  <td key={j} className={j === 0 ? "font-semibold text-ink" : "tabular-nums"}>
                    {celda}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: tarjetas apiladas. Una tabla de 6 columnas en 360px no se lee. */}
      <div className="space-y-2 sm:hidden">
        {filas.map((fila, i) => (
          <div key={i} className="tarjeta p-3">
            <p className="font-semibold text-ink">{fila[0]}</p>
            <dl className="mt-2 space-y-1">
              {fila.slice(1).map((celda, j) => (
                <div key={j} className="flex items-baseline justify-between gap-3">
                  <dt className="eyebrow">{columnas[j + 1]}</dt>
                  <dd className="text-body-sm font-semibold tabular-nums text-ink">{celda}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

export { fmtMoneda };
