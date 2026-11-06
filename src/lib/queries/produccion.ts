import { cache } from "react";
import { conNegocioActual } from "./stock";
import type { TxNegocio } from "@/lib/negocio";
import { conRespaldo } from "@/lib/respaldo";
import type { Dinero } from "@/lib/money";
import {
  calcularAjusteDeStock,
  consumoDeRecetaEnStock,
  marcaDeLinea,
  numeroDeVentaEnBusqueda,
  sugerirDesdeReceta,
  type ComponenteReceta,
  type FilaAjuste,
  type FiltroProduccion,
} from "@/lib/produccion";

// Lecturas de la produccion. Las ve el empleado: NINGUNA consulta de este archivo
// lee costos (ni de materiales, ni de maquinas, ni los snapshots del trabajo), asi un
// costo no puede llegar a una pagina ni al navegador. Los `select` son explicitos.

const LIMITE_LISTADO = 100;

// ─── Listado ──────────────────────────────────────────────────────────────────

export type LineaDeProduccion = {
  ventaItemId: string;
  ventaId: string;
  numero: number;
  anio: number;
  fecha: Date;
  cliente: string;
  descripcion: string;
  cantidad: Dinero;
  /** Trabajo vigente de la linea, o null si todavia no se cargo. */
  trabajo: { id: string; fecha: Date; cargadoPor: string | null } | null;
};

export type ListadoProduccion = {
  lineas: LineaDeProduccion[];
  /** Cuantas lineas hay en cada estado (sin contar la busqueda). */
  cuenta: { pendientes: number; cargadas: number };
  /** Hay mas lineas que las que se muestran. */
  hayMas: boolean;
};

const VACIO: ListadoProduccion = { lineas: [], cuenta: { pendientes: 0, cargadas: 0 }, hayMas: false };

const LINEA_DE_VENTA_VIGENTE = { venta: { estado: { not: "ANULADA" as const } } };

/**
 * Lineas de ventas no anuladas, con o sin trabajo vigente segun el filtro, y una
 * busqueda simple por cliente, articulo o numero de venta.
 */
export const getListadoProduccion = cache(
  (filtro: FiltroProduccion, busqueda: string): Promise<ListadoProduccion> =>
    conRespaldo(
      () => conNegocioActual((tx) => listadoDesdeBase(tx, filtro, busqueda)),
      () => VACIO,
    ),
);

async function listadoDesdeBase(tx: TxNegocio, filtro: FiltroProduccion, busqueda: string): Promise<ListadoProduccion> {
  const numero = numeroDeVentaEnBusqueda(busqueda);
  const texto = busqueda
    ? {
        OR: [
          { descripcion: { contains: busqueda, mode: "insensitive" as const } },
          { venta: { cliente: { nombre: { contains: busqueda, mode: "insensitive" as const } } } },
          ...(numero !== null ? [{ venta: { numero } }] : []),
        ],
      }
    : {};
  const sinTrabajo = { trabajos: { none: { anuladoEn: null } } };
  const conTrabajo = { trabajos: { some: { anuladoEn: null } } };

  const filas = await tx.ventaItem.findMany({
    where: { ...LINEA_DE_VENTA_VIGENTE, ...(filtro === "pendientes" ? sinTrabajo : filtro === "cargadas" ? conTrabajo : {}), ...texto },
    // Lo sin cargar, lo mas viejo primero (es lo que hay que hacer); el resto, lo mas nuevo primero.
    orderBy: [
      { venta: { fecha: filtro === "pendientes" ? "asc" : "desc" } },
      { venta: { numero: filtro === "pendientes" ? "asc" : "desc" } },
      { id: "asc" },
    ],
    take: LIMITE_LISTADO + 1,
    select: {
      id: true,
      descripcion: true,
      cantidad: true,
      venta: { select: { id: true, numero: true, anio: true, fecha: true, cliente: { select: { nombre: true } } } },
      trabajos: { where: { anuladoEn: null }, select: { id: true, fecha: true, usuario: { select: { nombre: true } } } },
    },
  });
  const pendientes = await tx.ventaItem.count({ where: { ...LINEA_DE_VENTA_VIGENTE, ...sinTrabajo } });
  const cargadas = await tx.ventaItem.count({ where: { ...LINEA_DE_VENTA_VIGENTE, ...conTrabajo } });

  return {
    hayMas: filas.length > LIMITE_LISTADO,
    cuenta: { pendientes, cargadas },
    lineas: filas.slice(0, LIMITE_LISTADO).map((l) => {
      const t = l.trabajos[0];
      return {
        ventaItemId: l.id,
        ventaId: l.venta.id,
        numero: l.venta.numero,
        anio: l.venta.anio,
        fecha: l.venta.fecha,
        cliente: l.venta.cliente.nombre,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        trabajo: t ? { id: t.id, fecha: t.fecha, cargadoPor: t.usuario?.nombre ?? null } : null,
      };
    }),
  };
}

// ─── Estado por venta (bloque del detalle de la venta) ────────────────────────

export type ProduccionDeLinea = {
  ventaItemId: string;
  descripcion: string;
  cantidad: Dinero;
  trabajoId: string | null;
};

/** Estado de produccion de cada linea de una venta; null si la venta no existe o esta anulada. */
export const getProduccionDeVenta = cache(
  (ventaId: string): Promise<ProduccionDeLinea[] | null> =>
    conRespaldo(
      () =>
        conNegocioActual(async (tx) => {
          const venta = await tx.venta.findUnique({
            where: { id: ventaId },
            select: {
              estado: true,
              items: {
                orderBy: { id: "asc" },
                select: { id: true, descripcion: true, cantidad: true, trabajos: { where: { anuladoEn: null }, select: { id: true } } },
              },
            },
          });
          if (!venta || venta.estado === "ANULADA") return null;
          return venta.items.map((i) => ({
            ventaItemId: i.id,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            trabajoId: i.trabajos[0]?.id ?? null,
          }));
        }),
      () => null,
    ),
);

// ─── Pantalla de carga ────────────────────────────────────────────────────────

/** Dato para elegir una maquina o un material: nombre y unidad, nunca costos. */
export type OpcionMaquina = { id: string; nombre: string };
export type OpcionMaterial = { id: string; nombre: string; unidad: string };

/** Todo lo que viaja al formulario de carga, con numeros como texto (serializable y sin costos). */
export type LineaParaCarga = {
  ventaItemId: string;
  ventaId: string;
  numero: number;
  anio: number;
  cliente: string;
  descripcion: string;
  cantidad: string;
  /** Si la venta esta anulada no se puede cargar. */
  ventaAnulada: boolean;
  /** Trabajo vigente (la linea ya esta cargada), si hay. */
  trabajoVigenteId: string | null;
  maquinas: OpcionMaquina[];
  materiales: OpcionMaterial[];
  sugerencia: {
    maquinas: { maquinaId: string; minutos: string }[];
    minutosManoObra: string;
    materiales: { materialId: string; cantidad: string }[];
  };
  /** Lo que la venta descontó por receta, por material (para ver la diferencia en vivo). */
  recetaEnStock: { materialId: string; cantidad: string }[];
  /** Lo ya ajustado por esta linea (movimientos AJUSTE), por material, con signo de stock. */
  yaAjustado: { materialId: string; cantidad: string }[];
};

const aTexto = (v: Dinero) => v.toString();

/** Datos para cargar el trabajo de una linea; null si la linea no existe (o no hay base). */
export const getLineaParaCarga = cache(
  (ventaItemId: string): Promise<LineaParaCarga | null> =>
    conRespaldo(
      () =>
        conNegocioActual(async (tx) => {
          const l = await tx.ventaItem.findUnique({
            where: { id: ventaItemId },
            select: {
              id: true,
              descripcion: true,
              cantidad: true,
              venta: { select: { id: true, numero: true, anio: true, estado: true, cliente: { select: { nombre: true } } } },
              trabajos: { where: { anuladoEn: null }, select: { id: true } },
              articulo: {
                select: {
                  esServicio: true,
                  receta: {
                    select: {
                      componentes: { select: { tipo: true, materialId: true, maquinaId: true, cantidad: true }, orderBy: { id: "asc" } },
                    },
                  },
                },
              },
            },
          });
          if (!l) return null;

          const componentes: ComponenteReceta[] = (l.articulo.receta?.componentes ?? []).map((c) => ({
            tipo: c.tipo,
            materialId: c.materialId,
            maquinaId: c.maquinaId,
            cantidad: c.cantidad,
          }));
          const sugerencia = sugerirDesdeReceta(componentes, l.cantidad);
          const recetaEnStock = consumoDeRecetaEnStock(componentes, l.cantidad, l.articulo.esServicio);

          const maquinas = await tx.maquina.findMany({
            where: { activo: true },
            orderBy: { nombre: "asc" },
            select: { id: true, nombre: true },
          });
          const materiales = await tx.material.findMany({
            where: { activo: true },
            orderBy: { nombre: "asc" },
            select: { id: true, nombre: true, unidad: true },
          });
          const ajustes = await tx.movimientoStock.findMany({
            where: { tipo: "AJUSTE", motivo: { contains: marcaDeLinea(l.id) } },
            select: { materialId: true, cantidad: true },
          });

          return {
            ventaItemId: l.id,
            ventaId: l.venta.id,
            numero: l.venta.numero,
            anio: l.venta.anio,
            cliente: l.venta.cliente.nombre,
            descripcion: l.descripcion,
            cantidad: aTexto(l.cantidad),
            ventaAnulada: l.venta.estado === "ANULADA",
            trabajoVigenteId: l.trabajos[0]?.id ?? null,
            maquinas,
            materiales,
            sugerencia: {
              maquinas: sugerencia.maquinas.map((m) => ({ maquinaId: m.maquinaId, minutos: aTexto(m.minutos) })),
              minutosManoObra: aTexto(sugerencia.minutosManoObra),
              materiales: sugerencia.materiales.map((m) => ({ materialId: m.materialId, cantidad: aTexto(m.cantidad) })),
            },
            recetaEnStock: recetaEnStock.map((m) => ({ materialId: m.materialId, cantidad: aTexto(m.cantidad) })),
            yaAjustado: ajustes.map((a) => ({ materialId: a.materialId, cantidad: aTexto(a.cantidad) })),
          };
        }),
      () => null,
    ),
);

// ─── Detalle de un trabajo ────────────────────────────────────────────────────

export type TrabajoDetalle = {
  id: string;
  ventaItemId: string;
  ventaId: string;
  numero: number;
  anio: number;
  ventaAnulada: boolean;
  cliente: string;
  descripcion: string;
  cantidad: Dinero;
  fecha: Date;
  minutosManoObra: Dinero;
  notas: string | null;
  cargadoPor: string | null;
  creadoEn: Date;
  anuladoEn: Date | null;
  motivoAnulacion: string | null;
  tiempos: { maquina: string; minutos: Dinero }[];
  /** Consumo real y lo que preveia la receta (la venta ya lo descontó). */
  consumos: { materialId: string; material: string; unidad: string; real: Dinero; receta: Dinero | null }[];
  /** Diferencia contra la receta y lo que falta ajustar de stock, por material. */
  ajuste: (FilaAjuste & { material: string; unidad: string })[];
  /** Hay un trabajo vigente en la linea (puede ser este u otro). */
  lineaTieneVigente: boolean;
  /** Trabajos anulados anteriores de la misma linea (historial), del mas nuevo al mas viejo. */
  anulados: { id: string; fecha: Date; anuladoEn: Date; motivoAnulacion: string | null }[];
};

/** Detalle de un trabajo de produccion; null si no existe. Sin costos. */
export const getTrabajoDetalle = cache(
  (id: string): Promise<TrabajoDetalle | null> =>
    conRespaldo(
      () =>
        conNegocioActual(async (tx) => {
          const t = await tx.trabajoProduccion.findUnique({
            where: { id },
            select: {
              id: true,
              ventaItemId: true,
              fecha: true,
              minutosManoObra: true,
              notas: true,
              creadoEn: true,
              anuladoEn: true,
              motivoAnulacion: true,
              usuario: { select: { nombre: true } },
              tiempos: { select: { minutos: true, maquina: { select: { nombre: true } } }, orderBy: { maquina: { nombre: "asc" } } },
              consumos: {
                select: { materialId: true, cantidad: true, material: { select: { nombre: true, unidad: true } } },
                orderBy: { material: { nombre: "asc" } },
              },
              ventaItem: {
                select: {
                  descripcion: true,
                  cantidad: true,
                  venta: { select: { id: true, numero: true, anio: true, estado: true, cliente: { select: { nombre: true } } } },
                  articulo: {
                    select: {
                      esServicio: true,
                      receta: { select: { componentes: { select: { tipo: true, materialId: true, maquinaId: true, cantidad: true } } } },
                    },
                  },
                  trabajos: { select: { id: true, fecha: true, anuladoEn: true, motivoAnulacion: true }, orderBy: { creadoEn: "desc" } },
                },
              },
            },
          });
          if (!t) return null;

          const linea = t.ventaItem;
          const componentes: ComponenteReceta[] = (linea.articulo.receta?.componentes ?? []).map((c) => ({
            tipo: c.tipo,
            materialId: c.materialId,
            maquinaId: c.maquinaId,
            cantidad: c.cantidad,
          }));
          const receta = consumoDeRecetaEnStock(componentes, linea.cantidad, linea.articulo.esServicio);
          const ajustes = await tx.movimientoStock.findMany({
            where: { tipo: "AJUSTE", motivo: { contains: marcaDeLinea(t.ventaItemId) } },
            select: { materialId: true, cantidad: true },
          });
          const filas = calcularAjusteDeStock({
            receta,
            real: t.consumos.map((c) => ({ materialId: c.materialId, cantidad: c.cantidad })),
            yaAjustado: ajustes.map((a) => ({ materialId: a.materialId, cantidad: a.cantidad })),
          });
          const dato = new Map(t.consumos.map((c) => [c.materialId, c.material]));
          const recetaPorMaterial = new Map(receta.map((r) => [r.materialId, r.cantidad]));

          return {
            id: t.id,
            ventaItemId: t.ventaItemId,
            ventaId: linea.venta.id,
            numero: linea.venta.numero,
            anio: linea.venta.anio,
            ventaAnulada: linea.venta.estado === "ANULADA",
            cliente: linea.venta.cliente.nombre,
            descripcion: linea.descripcion,
            cantidad: linea.cantidad,
            fecha: t.fecha,
            minutosManoObra: t.minutosManoObra,
            notas: t.notas,
            cargadoPor: t.usuario?.nombre ?? null,
            creadoEn: t.creadoEn,
            anuladoEn: t.anuladoEn,
            motivoAnulacion: t.motivoAnulacion,
            tiempos: t.tiempos.map((x) => ({ maquina: x.maquina.nombre, minutos: x.minutos })),
            consumos: t.consumos.map((c) => ({
              materialId: c.materialId,
              material: c.material.nombre,
              unidad: c.material.unidad,
              real: c.cantidad,
              receta: recetaPorMaterial.get(c.materialId) ?? null,
            })),
            ajuste: filas.map((f) => ({
              ...f,
              material: dato.get(f.materialId)?.nombre ?? "—",
              unidad: dato.get(f.materialId)?.unidad ?? "",
            })),
            lineaTieneVigente: linea.trabajos.some((x) => x.anuladoEn === null),
            anulados: linea.trabajos
              .filter((x) => x.anuladoEn !== null && x.id !== t.id)
              .map((x) => ({ id: x.id, fecha: x.fecha, anuladoEn: x.anuladoEn!, motivoAnulacion: x.motivoAnulacion })),
          };
        }),
      () => null,
    ),
);
