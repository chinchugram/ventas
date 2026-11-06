import { CERO, d, type Dinero } from "@/lib/money";
import { costearReceta, type ComponenteResuelto, type ResultadoReceta } from "@/lib/costing";

// Piezas puras del costeo de recetas contra datos de la base. Viven aca (y no en
// queries/) para poder usarlas desde scripts y transacciones sin cargar React ni Next.

export function configNumero(config: Record<string, string>, clave: string, porDefecto: string): Dinero {
  return d(config[clave] ?? porDefecto);
}

export type ComponenteDb = {
  id: string;
  tipo: "MATERIAL" | "MAQUINA" | "MANO_OBRA";
  cantidad: Dinero;
  costoUnitarioOverride: Dinero | null;
  notas: string | null;
  material: { nombre: string; costoUnitario: Dinero; unidad: string } | null;
  maquina: { nombre: string; costoHora: Dinero } | null;
};

/**
 * Traduce componentes de la base a valores planos para el motor de costeo.
 *
 * El orden de resolucion del costo unitario, en palabras:
 *   1. override explicito en la receta (gana sobre todo)
 *   2. costo/hora de la maquina
 *   3. costo unitario del material
 *   4. costo/hora de mano de obra general
 */
export function recetaResuelta(
  componentes: ComponenteDb[],
  costoHoraManoObra: Dinero,
): ResultadoReceta {
  const resueltos: ComponenteResuelto[] = componentes.map((c) => {
    const conOverride = c.costoUnitarioOverride !== null;

    switch (c.tipo) {
      case "MATERIAL": {
        const material = c.material;
        return {
          id: c.id,
          tipo: c.tipo,
          etiqueta: material?.nombre ?? "Material eliminado",
          cantidad: c.cantidad,
          costoUnitario: conOverride ? c.costoUnitarioOverride! : (material?.costoUnitario ?? CERO),
          costoUnitarioOverride: conOverride,
          notas: c.notas,
        };
      }
      case "MAQUINA": {
        const maquina = c.maquina;
        return {
          id: c.id,
          tipo: c.tipo,
          etiqueta: maquina?.nombre ?? "Maquina eliminada",
          cantidad: c.cantidad,
          costoUnitario: conOverride ? c.costoUnitarioOverride! : (maquina?.costoHora ?? CERO),
          costoUnitarioOverride: conOverride,
          notas: c.notas,
        };
      }
      case "MANO_OBRA":
        return {
          id: c.id,
          tipo: c.tipo,
          etiqueta: "Mano de obra",
          cantidad: c.cantidad,
          costoUnitario: conOverride ? c.costoUnitarioOverride! : costoHoraManoObra,
          costoUnitarioOverride: conOverride,
          notas: c.notas,
        };
    }
  });

  return costearReceta(resueltos, costoHoraManoObra);
}
