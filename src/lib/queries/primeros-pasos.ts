import { conNegocio } from "@/lib/negocio";
import { dbDisponible } from "@/lib/prisma";
import { faltantesParaEmitir } from "@/lib/datos-fiscales";
import { configNumero } from "@/lib/receta";
import { ARRANQUE, ARRANQUE_SIMPLE } from "@/lib/ayuda/guia";
import type { Modo } from "@/lib/modo";

export type PasoEstado = {
  titulo: string;
  texto: string;
  ruta: string;
  opcional: boolean;
  hecho: boolean;
};

/**
 * Estado de la puesta en marcha del negocio, paso por paso (mismo orden y textos
 * que la guia). Se calcula con lo que ya hay cargado: no se guarda nada.
 * Devuelve `null` sin base (modo demostracion): ahi no hay nada que configurar.
 */
export async function getPrimerosPasos(negocioId: string, modo: Modo): Promise<PasoEstado[] | null> {
  if (!(await dbDisponible())) return null;
  try {
    const r = await conNegocio(negocioId, async (tx) => {
      const [config, maquinas, materiales, conReceta, clientes, ventas, empleados, articulos] = await Promise.all([
        tx.configuracion.findMany({ where: { clave: { notIn: ["logoDatos"] } }, select: { clave: true, valor: true } }),
        tx.maquina.count({ where: { activo: true } }),
        tx.material.count({ where: { activo: true } }),
        tx.articulo.count({ where: { activo: true, receta: { componentes: { some: {} } } } }),
        tx.cliente.count({ where: { activo: true } }),
        tx.venta.count(),
        tx.usuario.count({ where: { rol: "EMPLEADO", activo: true } }),
        tx.articulo.count({ where: { activo: true } }),
      ]);
      const cfg = Object.fromEntries(config.map((c) => [c.clave, c.valor]));
      return { config: cfg, maquinas, materiales, conReceta, clientes, ventas, empleados, articulos, logo: Boolean(cfg.logoMime) };
    });

    if (modo === "simple") {
      // Mismo orden que ARRANQUE_SIMPLE (guia.ts).
      const hechosSimple = [r.articulos > 0, r.clientes > 0, r.ventas > 0, r.logo];
      return ARRANQUE_SIMPLE.map((p, i) => ({ ...p, opcional: p.opcional ?? false, hecho: hechosSimple[i] ?? false }));
    }
    // Mismo orden que ARRANQUE (guia.ts).
    const hechos = [
      configNumero(r.config, "costoHoraManoObra", "0").cmp(0) > 0,
      r.maquinas > 0,
      r.materiales > 0,
      r.conReceta > 0,
      r.clientes > 0,
      r.ventas > 0,
      r.empleados > 0,
      faltantesParaEmitir(r.config).length === 0,
    ];
    return ARRANQUE.map((p, i) => ({ ...p, opcional: p.opcional ?? false, hecho: hechos[i] ?? false }));
  } catch (error) {
    // Es una ayuda: si falla, el tablero se muestra igual sin ella.
    console.warn("[primeros-pasos] No se pudo calcular:", error);
    return null;
  }
}
