import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { conRespaldo } from "@/lib/respaldo";
import { d, type Dinero } from "@/lib/money";
import type { CondicionIva, TipoComprobante } from "@/lib/comprobantes";

/** Referencia corta a otro comprobante (la factura de una NC o las NC de una factura). */
export type ComprobanteRef = {
  id: string;
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  fecha: Date;
  estado: "PENDIENTE" | "EMITIDO" | "RECHAZADO";
  importeTotal: Dinero;
};

/**
 * Un comprobante completo: es la FOTO guardada (emisor, receptor, lineas,
 * alicuotas), nunca se completa con el cliente, la venta o la configuracion
 * actuales. No tiene costos ni margenes (el modelo no los guarda).
 */
export type ComprobanteCompleto = {
  id: string;
  ambiente: "SIMULADO" | "HOMOLOGACION" | "PRODUCCION";
  tipo: TipoComprobante;
  codigoArca: number;
  puntoVenta: number;
  numero: number;
  fecha: Date;
  estado: "PENDIENTE" | "EMITIDO" | "RECHAZADO";
  emisor: {
    razonSocial: string;
    cuit: string;
    condicionIva: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO";
    domicilio: string;
    inicioActividades: Date;
    iibb: string | null;
  };
  receptor: {
    nombre: string;
    docTipo: number;
    docNro: string;
    condicionIva: CondicionIva;
    domicilio: string | null;
  };
  importeNeto: Dinero;
  importeIva: Dinero;
  importeTotal: Dinero;
  cae: string | null;
  caeVencimiento: Date | null;
  observaciones: string | null;
  creadoEn: Date;
  items: {
    orden: number;
    descripcion: string;
    cantidad: Dinero;
    precioUnitario: Dinero;
    ivaPct: Dinero;
    subtotalNeto: Dinero;
    subtotalIva: Dinero;
    subtotalBruto: Dinero;
  }[];
  alicuotas: { alicuotaPct: Dinero; codigoArca: number; baseImponible: Dinero; importe: Dinero }[];
  /** Factura que anula esta nota de credito (null en las facturas). */
  comprobanteAsociado: ComprobanteRef | null;
  /** Notas de credito que anulan esta factura (vacio en las NC). */
  notasDeCredito: ComprobanteRef[];
  /** Venta de origen (para el enlace; verla exige `verVentas`). */
  venta: { id: string; numero: number; anio: number };
  /** Nombre para mostrar de quien lo emitio. */
  emitidoPor: string | null;
};

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refSelect = {
  id: true,
  tipo: true,
  puntoVenta: true,
  numero: true,
  fecha: true,
  estado: true,
  importeTotal: true,
} as const;

type RefFila = {
  id: string;
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  fecha: Date;
  estado: "PENDIENTE" | "EMITIDO" | "RECHAZADO";
  importeTotal: { toString(): string };
};

function aRef(c: RefFila): ComprobanteRef {
  return { ...c, importeTotal: d(c.importeTotal.toString()) };
}

/**
 * Un comprobante por id, con lineas, alicuotas, factura asociada y notas de
 * credito. `null` si no existe (o el id no es un uuid). Sin base de datos no hay
 * comprobantes de demostracion: devuelve `null`.
 */
export const getComprobante = cache(
  (id: string): Promise<ComprobanteCompleto | null> =>
    conRespaldo(
      () => comprobanteDesdeBase(id),
      () => null,
    ),
);

async function comprobanteDesdeBase(id: string): Promise<ComprobanteCompleto | null> {
  if (!ES_UUID.test(id)) return null;
  const c = await prisma.comprobante.findUnique({
    where: { id },
    select: {
      id: true,
      ambiente: true,
      tipo: true,
      codigoArca: true,
      puntoVenta: true,
      numero: true,
      fecha: true,
      estado: true,
      emisorRazonSocial: true,
      emisorCuit: true,
      emisorCondicionIva: true,
      emisorDomicilio: true,
      emisorInicioActividades: true,
      emisorIibb: true,
      receptorNombre: true,
      receptorDocTipo: true,
      receptorDocNro: true,
      receptorCondicionIva: true,
      receptorDomicilio: true,
      importeNeto: true,
      importeIva: true,
      importeTotal: true,
      cae: true,
      caeVencimiento: true,
      observaciones: true,
      creadoEn: true,
      items: {
        orderBy: { orden: "asc" },
        select: {
          orden: true,
          descripcion: true,
          cantidad: true,
          precioUnitario: true,
          ivaPct: true,
          subtotalNeto: true,
          subtotalIva: true,
          subtotalBruto: true,
        },
      },
      alicuotas: {
        orderBy: { alicuotaPct: "asc" },
        select: { alicuotaPct: true, codigoArca: true, baseImponible: true, importe: true },
      },
      comprobanteAsociado: { select: refSelect },
      notasDeCredito: { orderBy: [{ fecha: "asc" }, { creadoEn: "asc" }], select: refSelect },
      venta: { select: { id: true, numero: true, anio: true } },
      usuario: { select: { nombre: true } },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    ambiente: c.ambiente,
    tipo: c.tipo,
    codigoArca: c.codigoArca,
    puntoVenta: c.puntoVenta,
    numero: c.numero,
    fecha: c.fecha,
    estado: c.estado,
    emisor: {
      razonSocial: c.emisorRazonSocial,
      cuit: c.emisorCuit,
      condicionIva: c.emisorCondicionIva as "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO",
      domicilio: c.emisorDomicilio,
      inicioActividades: c.emisorInicioActividades,
      iibb: c.emisorIibb,
    },
    receptor: {
      nombre: c.receptorNombre,
      docTipo: c.receptorDocTipo,
      docNro: c.receptorDocNro,
      condicionIva: c.receptorCondicionIva,
      domicilio: c.receptorDomicilio,
    },
    importeNeto: d(c.importeNeto.toString()),
    importeIva: d(c.importeIva.toString()),
    importeTotal: d(c.importeTotal.toString()),
    cae: c.cae,
    caeVencimiento: c.caeVencimiento,
    observaciones: c.observaciones,
    creadoEn: c.creadoEn,
    items: c.items.map((i) => ({
      orden: i.orden,
      descripcion: i.descripcion,
      cantidad: d(i.cantidad.toString()),
      precioUnitario: d(i.precioUnitario.toString()),
      ivaPct: d(i.ivaPct.toString()),
      subtotalNeto: d(i.subtotalNeto.toString()),
      subtotalIva: d(i.subtotalIva.toString()),
      subtotalBruto: d(i.subtotalBruto.toString()),
    })),
    alicuotas: c.alicuotas.map((a) => ({
      alicuotaPct: d(a.alicuotaPct.toString()),
      codigoArca: a.codigoArca,
      baseImponible: d(a.baseImponible.toString()),
      importe: d(a.importe.toString()),
    })),
    comprobanteAsociado: c.comprobanteAsociado ? aRef(c.comprobanteAsociado) : null,
    notasDeCredito: c.notasDeCredito.map(aRef),
    venta: c.venta,
    emitidoPor: c.usuario?.nombre ?? null,
  };
}
