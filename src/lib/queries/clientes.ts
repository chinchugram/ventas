import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoClientes, demoVentas } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { aMoneda, CERO, d, type Dinero, sumar } from "@/lib/money";
import { estadoPago, type EstadoPago } from "@/lib/costing";
import type { CondicionIvaCliente } from "@/lib/dominio/clientes";

export type ClienteListado = {
  id: string;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  ventas: number;
  facturado: Dinero;
  saldo: Dinero;
  ultimaVenta: Date | null;
};

/**
 * Clientes con su resumen de cuenta.
 *
 * El saldo se calcula: ventas facturadas menos pagos. Nunca se persiste,
 * asi que por construccion no puede quedar viejo.
 */
export const getClientes = cache(
  (): Promise<ClienteListado[]> => conRespaldo(clientesDesdeBase, demoClientes),
);

async function clientesDesdeBase(): Promise<ClienteListado[]> {
  const clientes = await prisma.cliente.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    include: {
      ventas: {
        where: { estado: { not: "ANULADA" } },
        select: {
          fecha: true,
          totalBruto: true,
          // Los pagos anulados no cuentan en el saldo.
          pagos: { where: { anuladoEn: null }, select: { monto: true } },
        },
      },
    },
  });

  return clientes.map((c) => {
    let facturado = d(0);
    let pagado = d(0);
    let ultimaVenta: Date | null = null;

    for (const v of c.ventas) {
      facturado = facturado.plus(v.totalBruto);
      pagado = pagado.plus(sumar(...v.pagos.map((p) => p.monto)));
      if (!ultimaVenta || v.fecha > ultimaVenta) ultimaVenta = v.fecha;
    }

    const saldo = aMoneda(facturado.minus(pagado));

    return {
      id: c.id,
      nombre: c.nombre,
      cuit: c.cuit,
      telefono: c.telefono,
      ventas: c.ventas.length,
      facturado: aMoneda(facturado),
      saldo: saldo.isNegative() ? d(0) : saldo,
      ultimaVenta,
    };
  });
}

// ─── Clientes dados de baja ──────────────────────────────────────────────────

export type ClienteDeBaja = {
  id: string;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
};

/**
 * Clientes con baja logica. Van aparte de `getClientes` porque esa lista es
 * tambien la que se ofrece al cargar una venta nueva, donde no deben aparecer.
 * El juego de demostracion no tiene bajas.
 */
export const getClientesDeBaja = cache(
  (): Promise<ClienteDeBaja[]> =>
    conRespaldo(
      () =>
        prisma.cliente.findMany({
          where: { activo: false },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true, cuit: true, telefono: true },
        }),
      () => [],
    ),
);

// ─── Ficha del cliente ───────────────────────────────────────────────────────

export type VentaDeCliente = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  estado: "PENDIENTE" | "ENTREGADA" | "ANULADA";
  totalBruto: Dinero;
  pagado: Dinero;
  saldo: Dinero;
  estadoPago: EstadoPago;
};

export type PagoDeCliente = {
  id: string;
  fecha: Date;
  monto: Dinero;
  metodo: string;
  notas: string | null;
  ventaId: string;
  ventaNumero: number;
  ventaAnio: number;
  /** El pago quedo sobre una venta anulada: se muestra, pero no descuenta saldo. */
  ventaAnulada: boolean;
  /** El pago se anulo: se muestra tachado, pero no descuenta saldo. */
  anulado: boolean;
  motivoAnulacion: string | null;
};

export type FichaCliente = {
  id: string;
  nombre: string;
  cuit: string | null;
  condicionIva: CondicionIvaCliente;
  dni: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  /** Ventas no anuladas. */
  facturado: Dinero;
  /** Pagos sobre ventas no anuladas. */
  pagado: Dinero;
  saldo: Dinero;
  /** Desde cuando debe: la venta con saldo mas antigua. */
  deudaDesde: Date | null;
  ventas: VentaDeCliente[];
  pagos: PagoDeCliente[];
  /** Datos del juego de demostracion: las ventas no se abren y nada se guarda. */
  esDemo: boolean;
};

/**
 * Un cliente con sus ventas, sus pagos y su saldo. Como en el listado, el
 * saldo se calcula (ventas no anuladas menos sus pagos), nunca se lee guardado.
 */
export const getCliente = cache(
  (id: string): Promise<FichaCliente | null> =>
    conRespaldo(
      () => fichaDesdeBase(id),
      () => fichaDemo(id),
    ),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fichaDesdeBase(id: string): Promise<FichaCliente | null> {
  // Un id que no es uuid haria fallar la consulta y caer en la demo: es un 404.
  if (!UUID.test(id)) return null;
  const c = await prisma.cliente.findUnique({
    where: { id },
    include: {
      ventas: {
        orderBy: [{ fecha: "desc" }, { numero: "desc" }],
        select: {
          id: true,
          numero: true,
          anio: true,
          fecha: true,
          estado: true,
          totalBruto: true,
          pagos: { where: { anuladoEn: null }, select: { monto: true } },
        },
      },
      pagos: {
        orderBy: [{ fecha: "desc" }, { creadoEn: "desc" }],
        include: { venta: { select: { numero: true, anio: true, estado: true } } },
      },
    },
  });
  if (!c) return null;

  const ventas: VentaDeCliente[] = c.ventas.map((v) => {
    const pagado = sumar(...v.pagos.map((p) => p.monto));
    const saldo = aMoneda(v.totalBruto.minus(pagado));
    return {
      id: v.id,
      numero: v.numero,
      anio: v.anio,
      fecha: v.fecha,
      estado: v.estado,
      totalBruto: v.totalBruto,
      pagado,
      saldo: saldo.isNegative() ? CERO : saldo,
      estadoPago: estadoPago(v.totalBruto, pagado),
    };
  });

  return {
    id: c.id,
    nombre: c.nombre,
    cuit: c.cuit,
    condicionIva: c.condicionIva,
    dni: c.dni,
    telefono: c.telefono,
    email: c.email,
    direccion: c.direccion,
    notas: c.notas,
    activo: c.activo,
    ...resumen(ventas),
    ventas,
    pagos: c.pagos.map((p) => ({
      id: p.id,
      fecha: p.fecha,
      monto: p.monto,
      metodo: p.metodo,
      notas: p.notas,
      ventaId: p.ventaId,
      ventaNumero: p.venta.numero,
      ventaAnio: p.venta.anio,
      ventaAnulada: p.venta.estado === "ANULADA",
      anulado: p.anuladoEn !== null,
      motivoAnulacion: p.motivoAnulacion,
    })),
    esDemo: false,
  };
}

/** Totales de la ficha a partir de sus ventas (las anuladas no cuentan). */
function resumen(ventas: VentaDeCliente[]) {
  const vigentes = ventas.filter((v) => v.estado !== "ANULADA");
  const facturado = aMoneda(sumar(...vigentes.map((v) => v.totalBruto)));
  const pagado = aMoneda(sumar(...vigentes.map((v) => v.pagado)));
  const saldo = aMoneda(facturado.minus(pagado));
  const conDeuda = vigentes.filter((v) => v.estadoPago === "PENDIENTE" || v.estadoPago === "PARCIAL");
  const deudaDesde = conDeuda.reduce<Date | null>((min, v) => (!min || v.fecha < min ? v.fecha : min), null);
  return { facturado, pagado, saldo: saldo.isNegative() ? CERO : saldo, deudaDesde };
}

function fichaDemo(id: string): FichaCliente | null {
  const c = demoClientes().find((x) => x.id === id);
  if (!c) return null;
  const ventas: VentaDeCliente[] = demoVentas(Number.MAX_SAFE_INTEGER)
    .filter((v) => v.clienteId === id)
    .map((v) => ({
      id: v.id,
      numero: v.numero,
      anio: v.anio,
      fecha: v.fecha,
      estado: v.estado,
      totalBruto: v.totalBruto,
      pagado: v.pagado,
      saldo: v.saldo,
      estadoPago: v.estadoPago,
    }));
  return {
    id: c.id,
    nombre: c.nombre,
    cuit: c.cuit,
    // La demo no guarda condicion ni DNI: consumidor final sin identificar.
    condicionIva: "CONSUMIDOR_FINAL",
    dni: null,
    telefono: c.telefono,
    email: null,
    direccion: null,
    notas: null,
    activo: true,
    ...resumen(ventas),
    ventas,
    // La demo solo sabe cuanto se cobro de cada venta: un pago por venta, ese dia.
    pagos: ventas
      .filter((v) => v.pagado.gt(0))
      .map((v) => ({
        id: `p-${v.id}`,
        fecha: v.fecha,
        monto: v.pagado,
        metodo: "EFECTIVO",
        notas: null,
        ventaId: v.id,
        ventaNumero: v.numero,
        ventaAnio: v.anio,
        ventaAnulada: false,
        anulado: false,
        motivoAnulacion: null,
      })),
    esDemo: true,
  };
}
