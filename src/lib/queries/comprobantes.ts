import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { conRespaldo } from "@/lib/respaldo";
import { hoyArgentina } from "@/lib/acciones";
import { d, type Dinero } from "@/lib/money";
import type { TipoComprobante } from "@/lib/comprobantes";
import { entornoDelProceso, seleccionarEmisor } from "@/lib/fiscal";
import {
  avisosParaEmitir,
  derivarFacturacion,
  paginar,
  whereDeFiltros,
  type AmbienteComprobante,
  type AvisosFacturacion,
  type ComprobanteDeVenta,
  type EstadoComprobante,
  type FiltrosComprobantes,
  type ResumenFacturacion,
} from "@/lib/facturacion";

// Lecturas de comprobantes (listado y estado de facturacion de una venta).
// NUNCA traen costos ni margenes: un comprobante solo tiene precios e impuestos.
// Sin base (modo demo) no hay comprobantes: el listado viene vacio y la venta
// no ofrece facturar.

// ─── Listado ──────────────────────────────────────────────────────────────────

export type ComprobanteListado = {
  id: string;
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  fecha: Date;
  receptorNombre: string;
  importeTotal: Dinero;
  estado: EstadoComprobante;
  ambiente: AmbienteComprobante;
  creadoEn: Date;
  ventaId: string;
};

export type PaginaComprobantes = {
  filas: ComprobanteListado[];
  /** Cuantos comprobantes cumplen los filtros (todas las paginas). */
  total: number;
  pagina: number;
  totalPaginas: number;
};

const VACIA: PaginaComprobantes = { filas: [], total: 0, pagina: 1, totalPaginas: 1 };

/** Mas nuevos primero (fecha, despues numero). Una pagina por vez. */
export function getComprobantes(filtros: FiltrosComprobantes): Promise<PaginaComprobantes> {
  return conRespaldo(
    async () => {
      const where = whereDeFiltros(filtros);
      const total = await prisma.comprobante.count({ where });
      const pag = paginar(total, filtros.pagina);
      const filas = await prisma.comprobante.findMany({
        where,
        orderBy: [{ fecha: "desc" }, { numero: "desc" }, { creadoEn: "desc" }],
        skip: pag.skip,
        take: pag.take,
        select: {
          id: true,
          tipo: true,
          puntoVenta: true,
          numero: true,
          fecha: true,
          receptorNombre: true,
          importeTotal: true,
          estado: true,
          ambiente: true,
          creadoEn: true,
          ventaId: true,
        },
      });
      return {
        filas: filas.map((c) => ({ ...c, importeTotal: d(c.importeTotal.toString()) })),
        total,
        pagina: pag.pagina,
        totalPaginas: pag.totalPaginas,
      };
      },
    () => VACIA,
  );
}

// ─── Estado de facturacion de una venta ───────────────────────────────────────

export type FacturacionDeVenta = {
  ventaId: string;
  ventaAnulada: boolean;
  resumen: ResumenFacturacion;
  avisos: AvisosFacturacion;
  /** Para el enlace "corregir cliente" cuando el receptor no sirve. */
  clienteId: string;
};

/**
 * Todo lo que necesita la pantalla de la venta para mostrar y ofrecer la
 * facturacion: el estado (derivado de los comprobantes de la venta) y los avisos
 * previos a emitir. `null` si no hay base o la venta no existe.
 */
export const estadoFacturacionDeVenta = cache(
  (ventaId: string): Promise<FacturacionDeVenta | null> =>
    conRespaldo(
      async () => {
        const venta = await prisma.venta.findUnique({
          where: { id: ventaId },
          select: {
            estado: true,
            totalBruto: true,
            totalIVA: true,
            cliente: { select: { id: true, nombre: true, cuit: true, dni: true, condicionIva: true, direccion: true } },
          },
        });
        if (!venta) return null;
        const [comprobantes, configuracion] = await Promise.all([
          prisma.comprobante.findMany({
            where: { ventaId },
            orderBy: { creadoEn: "desc" },
            select: {
              id: true,
              tipo: true,
              estado: true,
              ambiente: true,
              puntoVenta: true,
              numero: true,
              fecha: true,
              importeTotal: true,
              observaciones: true,
              comprobanteAsociadoId: true,
              creadoEn: true,
            },
          }),
          prisma.configuracion.findMany(),
        ]);
        const deVenta: ComprobanteDeVenta[] = comprobantes.map((c) => ({ ...c, importeTotal: d(c.importeTotal.toString()) }));
        const ventaAnulada = venta.estado === "ANULADA";
        const seleccion = seleccionarEmisor(entornoDelProceso());
        return {
          ventaId,
          ventaAnulada,
          clienteId: venta.cliente.id,
          resumen: derivarFacturacion(deVenta, ventaAnulada),
          avisos: avisosParaEmitir({
            emisor: seleccion.ok ? { ok: true } : seleccion,
            config: Object.fromEntries(configuracion.map((c) => [c.clave, c.valor])),
            hoy: hoyArgentina(),
            cliente: venta.cliente,
            ventaTotal: d(venta.totalBruto.toString()),
            ventaIva: d(venta.totalIVA.toString()),
          }),
        };
      },
      () => null,
    ),
);
