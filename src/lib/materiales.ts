import { d, type Dinero } from "@/lib/money";
import { calcularMargen, precioParaMargen } from "@/lib/costing";
import { recetaResuelta, type ComponenteDb } from "@/lib/receta";

// Logica pura del ABM de materiales. Sin Prisma ni Next: la usan la pantalla de
// edicion (en vivo, en el navegador), las acciones y `scripts/verificar-materiales.ts`.

/** Componente de receta con el material al que apunta (para saber cual cambia). */
export type ComponenteConMaterial = ComponenteDb & { materialId: string | null };

/** Articulo activo cuya receta usa el material que se esta editando. */
export type ArticuloConReceta = {
  id: string;
  nombre: string;
  precioVenta: Dinero;
  ivaPct: Dinero;
  componentes: ComponenteConMaterial[];
};

export type ImpactoArticulo = {
  id: string;
  nombre: string;
  precioVenta: Dinero;
  costoActual: Dinero;
  costoNuevo: Dinero;
  margenActualPct: Dinero;
  margenNuevoPct: Dinero;
  /** Todas las lineas del material tienen override: el cambio no lo toca. */
  soloOverride: boolean;
  /** Estaba en la meta (o arriba) y con el costo nuevo queda abajo. */
  quedaBajoMeta: boolean;
  /** Estaba abajo de la meta y con el costo nuevo la alcanza. */
  alcanzaMeta: boolean;
  /** Precio para volver a la meta con el costo nuevo. */
  precioSugerido: Dinero;
};

/**
 * Que pasa con el costo y el margen de cada articulo si el material pasa a
 * costar `costoNuevo`.
 *
 * Se recalcula la receta completa con `recetaResuelta` (el mismo camino que usa
 * el catalogo), cambiando solo el costo de las lineas de este material: asi el
 * redondeo es identico al que se va a ver despues de guardar. Las lineas con
 * override no cambian, igual que en el costeo real.
 *
 * Orden: primero los que mas margen pierden (o menos ganan).
 */
export function impactoDeCambioDeCosto(params: {
  articulos: ArticuloConReceta[];
  materialId: string;
  costoNuevo: Dinero;
  costoHoraManoObra: Dinero;
  margenObjetivoPct: Dinero;
}): ImpactoArticulo[] {
  const { articulos, materialId, costoNuevo, costoHoraManoObra, margenObjetivoPct } = params;

  const impactos = articulos
    .filter((a) => a.componentes.some((c) => usaMaterial(c, materialId)))
    .map((a) => {
      const conCostoNuevo = a.componentes.map((c) =>
        usaMaterial(c, materialId) && c.material ? { ...c, material: { ...c.material, costoUnitario: costoNuevo } } : c,
      );
      const antes = recetaResuelta(a.componentes, costoHoraManoObra);
      const despues = recetaResuelta(conCostoNuevo, costoHoraManoObra);
      const margenAntes = calcularMargen({ precioBruto: a.precioVenta, costo: antes.costoTotal, ivaPct: a.ivaPct });
      const margenDespues = calcularMargen({ precioBruto: a.precioVenta, costo: despues.costoTotal, ivaPct: a.ivaPct });

      const enMetaAntes = margenAntes.margenPct.gte(margenObjetivoPct);
      const enMetaDespues = margenDespues.margenPct.gte(margenObjetivoPct);

      return {
        id: a.id,
        nombre: a.nombre,
        precioVenta: a.precioVenta,
        costoActual: antes.costoTotal,
        costoNuevo: despues.costoTotal,
        margenActualPct: margenAntes.margenPct,
        margenNuevoPct: margenDespues.margenPct,
        soloOverride: a.componentes
          .filter((c) => usaMaterial(c, materialId))
          .every((c) => c.costoUnitarioOverride !== null),
        quedaBajoMeta: enMetaAntes && !enMetaDespues,
        alcanzaMeta: !enMetaAntes && enMetaDespues,
        precioSugerido: precioParaMargen(despues.costoTotal, margenObjetivoPct),
      };
    });

  return impactos.sort((x, y) => {
    const caidaX = x.margenNuevoPct.minus(x.margenActualPct);
    const caidaY = y.margenNuevoPct.minus(y.margenActualPct);
    return caidaX.cmp(caidaY) || x.nombre.localeCompare(y.nombre, "es");
  });
}

function usaMaterial(c: ComponenteConMaterial, materialId: string): boolean {
  return c.tipo === "MATERIAL" && c.materialId === materialId;
}

// ─── Cruce servidor → cliente ─────────────────────────────────────────────────
// Un Decimal no se puede pasar como prop a un componente cliente: viaja como
// texto y se reconstruye del otro lado, sin pasar nunca por `number`.

export type ComponenteSerial = {
  id: string;
  tipo: ComponenteDb["tipo"];
  materialId: string | null;
  cantidad: string;
  costoUnitarioOverride: string | null;
  notas: string | null;
  material: { nombre: string; costoUnitario: string; unidad: string } | null;
  maquina: { nombre: string; costoHora: string } | null;
};

export type ArticuloSerial = {
  id: string;
  nombre: string;
  precioVenta: string;
  ivaPct: string;
  componentes: ComponenteSerial[];
};

export function serializarArticulos(articulos: ArticuloConReceta[]): ArticuloSerial[] {
  return articulos.map((a) => ({
    id: a.id,
    nombre: a.nombre,
    precioVenta: a.precioVenta.toString(),
    ivaPct: a.ivaPct.toString(),
    componentes: a.componentes.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      materialId: c.materialId,
      cantidad: c.cantidad.toString(),
      costoUnitarioOverride: c.costoUnitarioOverride?.toString() ?? null,
      notas: c.notas,
      material: c.material
        ? { nombre: c.material.nombre, costoUnitario: c.material.costoUnitario.toString(), unidad: c.material.unidad }
        : null,
      maquina: c.maquina ? { nombre: c.maquina.nombre, costoHora: c.maquina.costoHora.toString() } : null,
    })),
  }));
}

export function deserializarArticulos(articulos: ArticuloSerial[]): ArticuloConReceta[] {
  return articulos.map((a) => ({
    id: a.id,
    nombre: a.nombre,
    precioVenta: d(a.precioVenta),
    ivaPct: d(a.ivaPct),
    componentes: a.componentes.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      materialId: c.materialId,
      cantidad: d(c.cantidad),
      costoUnitarioOverride: c.costoUnitarioOverride === null ? null : d(c.costoUnitarioOverride),
      notas: c.notas,
      material: c.material ? { ...c.material, costoUnitario: d(c.material.costoUnitario) } : null,
      maquina: c.maquina ? { nombre: c.maquina.nombre, costoHora: d(c.maquina.costoHora) } : null,
    })),
  }));
}

// ─── Unidades ─────────────────────────────────────────────────────────────────

/** Valores del enum `UnidadMedida`, en el orden en que se ofrecen. */
export const UNIDADES = ["M2", "M", "KG", "L", "U", "HOJA", "ROLLO"] as const;

// ─── Nombres ──────────────────────────────────────────────────────────────────

/**
 * Clave para detectar nombres repetidos: sin mayusculas, sin tildes y con los
 * espacios colapsados. "MDF  3mm" y "mdf 3MM" son el mismo material.
 */
export function claveDeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El costo tipeado es distinto del que se cargo en el formulario. */
export function costoCambio(costoOriginal: Dinero, costoNuevo: Dinero): boolean {
  return !costoOriginal.eq(costoNuevo);
}
