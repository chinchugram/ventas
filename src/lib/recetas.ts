import { z } from "zod";
import { d, type Dinero } from "@/lib/money";
import { esDecimal, normalizarDecimal, primerError, textoOpcional } from "@/lib/acciones";
import { calcularMargen, type Margen, type ResultadoReceta, type TipoComponente } from "@/lib/costing";
import { recetaResuelta, type ComponenteDb } from "@/lib/receta";

// Logica pura del editor de articulos y recetas. Sin Prisma ni Next: la usa el
// formulario (costo y margen en vivo), la server action (validacion) y
// `scripts/verificar-recetas.ts`.

/** Alicuotas de IVA que maneja el comercio. */
export const ALICUOTAS_IVA = ["21", "10.5", "0"] as const;

export const NOMBRE_TIPO: Record<TipoComponente, string> = {
  MATERIAL: "Material",
  MAQUINA: "Máquina",
  MANO_OBRA: "Mano de obra",
};

/** Linea de receta tal como la tipea el usuario: todo texto. */
export type LineaBorrador = {
  tipo: TipoComponente;
  /** Solo para MATERIAL; "" si no aplica o no se eligio. */
  materialId: string;
  /** Solo para MAQUINA; "" si no aplica o no se eligio. */
  maquinaId: string;
  cantidad: string;
  /** Costo unitario fijado a mano. "" = usar el costo vigente. */
  override: string;
  notas: string;
};

/** Material o maquina elegible en el editor, con su costo vigente como texto. */
export type OpcionCosto = {
  id: string;
  nombre: string;
  /** Costo unitario del material o costo/hora de la maquina. */
  costo: string;
  /** Unidad del material ("m²", "u"…); las maquinas van por hora. */
  unidad: string;
  /** false = dado de baja: se muestra si ya estaba en la receta, pero no se puede guardar. */
  activo: boolean;
};

export type CatalogoCostos = {
  materiales: OpcionCosto[];
  maquinas: OpcionCosto[];
};

/** Linea completa: tiene elegido su material o maquina (la mano de obra siempre lo esta). */
export function lineaCompleta(l: LineaBorrador): boolean {
  if (l.tipo === "MATERIAL") return l.materialId !== "";
  if (l.tipo === "MAQUINA") return l.maquinaId !== "";
  return true;
}

const decimalOVacio = (v: string): Dinero | null => (esDecimal(v) ? d(normalizarDecimal(v)) : null);

/**
 * Costo de una receta en borrador, con el mismo motor que el listado del
 * catalogo (`recetaResuelta`): lo que se ve en vivo es lo que se ve despues de
 * guardar. Las lineas sin material o maquina elegidos no cuentan; una cantidad
 * mal tipeada cuenta como 0 y un override mal tipeado como vacio.
 */
export function costearBorrador(
  lineas: LineaBorrador[],
  catalogo: CatalogoCostos,
  costoHoraManoObra: Dinero,
): ResultadoReceta {
  const materiales = new Map(catalogo.materiales.map((m) => [m.id, m]));
  const maquinas = new Map(catalogo.maquinas.map((m) => [m.id, m]));

  const componentes: ComponenteDb[] = lineas
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => lineaCompleta(l))
    .map(({ l, i }) => {
      const material = l.tipo === "MATERIAL" ? materiales.get(l.materialId) : undefined;
      const maquina = l.tipo === "MAQUINA" ? maquinas.get(l.maquinaId) : undefined;
      return {
        id: String(i),
        tipo: l.tipo,
        cantidad: decimalOVacio(l.cantidad) ?? d(0),
        costoUnitarioOverride: decimalOVacio(l.override),
        notas: l.notas.trim() || null,
        material: material ? { nombre: material.nombre, costoUnitario: d(material.costo), unidad: material.unidad } : null,
        maquina: maquina ? { nombre: maquina.nombre, costoHora: d(maquina.costo) } : null,
      };
    });

  return recetaResuelta(componentes, costoHoraManoObra);
}

/** Margen en vivo: precio tipeado (con IVA) contra el costo de la receta. */
export function margenBorrador(precioVenta: string, ivaPct: string, receta: ResultadoReceta): Margen {
  return calcularMargen({
    precioBruto: decimalOVacio(precioVenta) ?? d(0),
    costo: receta.costoTotal,
    ivaPct: decimalOVacio(ivaPct) ?? d(0),
    costoConfiable: receta.confiable,
  });
}

// ─── Validacion (servidor) ────────────────────────────────────────────────────

export type DatosArticulo = {
  /** Ausente = alta. */
  id?: string;
  nombre: string;
  descripcion: string;
  precioVenta: string;
  ivaPct: string;
  esServicio: boolean;
  lineas: LineaBorrador[];
};

export type ComponenteValidado = {
  tipo: TipoComponente;
  materialId: string | null;
  maquinaId: string | null;
  cantidad: Dinero;
  costoUnitarioOverride: Dinero | null;
  notas: string | null;
};

export type ArticuloValidado = {
  id: string | null;
  nombre: string;
  descripcion: string | null;
  precioVenta: Dinero;
  ivaPct: Dinero;
  esServicio: boolean;
  componentes: ComponenteValidado[];
};

/** Tope de lineas por receta: una receta real tiene 3 a 8; mas de 50 es un error de carga. */
export const MAX_LINEAS = 50;

const esquemaCabecera = z.object({
  id: z.uuid("Artículo inválido").optional(),
  nombre: z.string().trim().min(1, "Falta el nombre del artículo").max(120, "El nombre admite hasta 120 caracteres"),
  descripcion: textoOpcional(500),
  precioVenta: z
    .string()
    .trim()
    .refine((v) => esDecimal(v) && d(normalizarDecimal(v)).gt(0), "El precio de venta debe ser un número mayor a 0")
    .transform(normalizarDecimal)
    .refine((v) => d(v).decimalPlaces() <= 4, "El precio admite hasta 4 decimales"),
  ivaPct: z
    .string()
    .trim()
    .transform(normalizarDecimal)
    .refine((v) => ALICUOTAS_IVA.some((a) => esDecimal(v) && d(v).eq(a)), "El IVA debe ser 21%, 10,5% o 0%"),
  esServicio: z.boolean(),
  lineas: z.array(z.any()).max(MAX_LINEAS, `La receta admite hasta ${MAX_LINEAS} líneas`),
});

const esquemaLinea = z.object({
  tipo: z.enum(["MATERIAL", "MAQUINA", "MANO_OBRA"]),
  materialId: z.string(),
  maquinaId: z.string(),
  cantidad: z.string(),
  override: z.string(),
  notas: z.string(),
});

/**
 * Valida el formulario completo y lo convierte a Decimal. No consulta la base:
 * que los materiales y maquinas existan y esten activos lo controla la
 * transaccion (`guardarArticuloEnTx`).
 */
export function validarArticulo(
  datos: unknown,
): { ok: true; valor: ArticuloValidado } | { ok: false; error: string } {
  const cabecera = esquemaCabecera.safeParse(datos);
  if (!cabecera.success) return { ok: false, error: primerError(cabecera.error) };
  const c = cabecera.data;

  const componentes: ComponenteValidado[] = [];
  for (const [i, crudo] of c.lineas.entries()) {
    const parsed = esquemaLinea.safeParse(crudo);
    const prefijo = `Línea ${i + 1}`;
    if (!parsed.success) return { ok: false, error: `${prefijo}: datos inválidos` };
    const l = parsed.data;
    const que = `${prefijo} (${NOMBRE_TIPO[l.tipo].toLowerCase()})`;

    if (l.tipo === "MATERIAL" && !l.materialId) return { ok: false, error: `${que}: elegí un material` };
    if (l.tipo === "MAQUINA" && !l.maquinaId) return { ok: false, error: `${que}: elegí una máquina` };

    if (!esDecimal(l.cantidad) || !d(normalizarDecimal(l.cantidad)).gt(0)) {
      return { ok: false, error: `${que}: la cantidad debe ser un número mayor a 0` };
    }
    const cantidad = d(normalizarDecimal(l.cantidad));
    // decimal(14,4): mas de 4 decimales se perderian en silencio al guardar.
    if (cantidad.decimalPlaces() > 4) return { ok: false, error: `${que}: la cantidad admite hasta 4 decimales` };

    let override: Dinero | null = null;
    if (l.override.trim() !== "") {
      if (!esDecimal(l.override)) return { ok: false, error: `${que}: el costo fijado debe ser un número, 0 o más` };
      override = d(normalizarDecimal(l.override));
      if (override.decimalPlaces() > 4) return { ok: false, error: `${que}: el costo fijado admite hasta 4 decimales` };
    }

    const notas = l.notas.trim();
    if (notas.length > 200) return { ok: false, error: `${que}: la nota admite hasta 200 caracteres` };

    componentes.push({
      tipo: l.tipo,
      materialId: l.tipo === "MATERIAL" ? l.materialId : null,
      maquinaId: l.tipo === "MAQUINA" ? l.maquinaId : null,
      cantidad,
      costoUnitarioOverride: override,
      notas: notas || null,
    });
  }

  return {
    ok: true,
    valor: {
      id: c.id ?? null,
      nombre: c.nombre,
      descripcion: c.descripcion,
      precioVenta: d(c.precioVenta),
      ivaPct: d(c.ivaPct),
      esServicio: c.esServicio,
      componentes,
    },
  };
}
