import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoVentas } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { hoyArgentina } from "@/lib/acciones";
import { aMoneda, d, sumar, type Dinero } from "@/lib/money";
import { diasDesde, estadoDePago, pagadoDe, saldoDeVenta, tieneSaldo, type VentaConSaldo } from "@/lib/cobranzas";
import { rangoMes } from "@/lib/queries/ventas";

// Lecturas de /cobranzas. Como en el resto del sistema, el saldo se calcula
// (total menos pagos no anulados) y nunca se lee guardado.

/** Ventas no anuladas que todavia deben algo. */
export const getVentasConSaldo = cache(
  (): Promise<VentaConSaldo[]> => conRespaldo(ventasConSaldoDesdeBase, ventasConSaldoDemo),
);

async function ventasConSaldoDesdeBase(): Promise<VentaConSaldo[]> {
  const hoy = hoyArgentina();
  const ventas = await prisma.venta.findMany({
    where: { estado: { not: "ANULADA" } },
    orderBy: [{ fecha: "asc" }, { numero: "asc" }],
    select: {
      id: true,
      numero: true,
      anio: true,
      fecha: true,
      estado: true,
      totalBruto: true,
      cliente: { select: { id: true, nombre: true, telefono: true } },
      pagos: { select: { monto: true, anuladoEn: true } },
    },
  });

  const resultado: VentaConSaldo[] = [];
  for (const v of ventas) {
    if (v.estado === "ANULADA") continue;
    const pagado = pagadoDe(v.pagos);
    const saldo = saldoDeVenta(v.totalBruto, pagado);
    if (!tieneSaldo(saldo)) continue;
    resultado.push({
      id: v.id,
      numero: v.numero,
      anio: v.anio,
      fecha: v.fecha,
      estado: v.estado,
      clienteId: v.cliente.id,
      clienteNombre: v.cliente.nombre,
      clienteTelefono: v.cliente.telefono,
      totalBruto: v.totalBruto,
      pagado,
      saldo,
      estadoPago: estadoDePago(v.totalBruto, v.pagos),
      dias: diasDesde(v.fecha, hoy),
    });
  }
  return resultado;
}

function ventasConSaldoDemo(): VentaConSaldo[] {
  const hoy = hoyArgentina();
  return demoVentas(Number.MAX_SAFE_INTEGER)
    .filter((v) => v.estado !== "ANULADA" && tieneSaldo(v.saldo))
    .map((v) => ({
      id: v.id,
      numero: v.numero,
      anio: v.anio,
      fecha: v.fecha,
      estado: v.estado as "PENDIENTE" | "ENTREGADA",
      clienteId: v.clienteId,
      clienteNombre: v.clienteNombre,
      clienteTelefono: null,
      totalBruto: v.totalBruto,
      pagado: v.pagado,
      saldo: v.saldo,
      estadoPago: v.estadoPago,
      dias: diasDesde(v.fecha, hoy),
    }));
}

export type PagoReciente = {
  id: string;
  fecha: Date;
  monto: Dinero;
  metodo: string;
  notas: string | null;
  anulado: boolean;
  motivoAnulacion: string | null;
  ventaId: string;
  ventaNumero: number;
  ventaAnio: number;
  ventaAnulada: boolean;
  clienteId: string;
  clienteNombre: string;
};

/** Ultimos pagos registrados, tambien los anulados (se muestran tachados). Sin base no hay. */
export const getPagosRecientes = cache(
  (limite = 20): Promise<PagoReciente[]> =>
    conRespaldo(
      async () => {
        const pagos = await prisma.pago.findMany({
          orderBy: [{ fecha: "desc" }, { creadoEn: "desc" }],
          take: limite,
          include: {
            venta: { select: { numero: true, anio: true, estado: true } },
            cliente: { select: { id: true, nombre: true } },
          },
        });
        return pagos.map((p) => ({
          id: p.id,
          fecha: p.fecha,
          monto: p.monto,
          metodo: p.metodo,
          notas: p.notas,
          anulado: p.anuladoEn !== null,
          motivoAnulacion: p.motivoAnulacion,
          ventaId: p.ventaId,
          ventaNumero: p.venta.numero,
          ventaAnio: p.venta.anio,
          ventaAnulada: p.venta.estado === "ANULADA",
          clienteId: p.cliente.id,
          clienteNombre: p.cliente.nombre,
        }));
      },
      () => [],
    ),
);

/** Cobrado en el mes en curso (Argentina): pagos vigentes de ventas vigentes. */
export const getCobradoDelMes = cache(
  (): Promise<Dinero> =>
    conRespaldo(
      async () => {
        const hoy = hoyArgentina();
        const { desde, hasta } = rangoMes(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1);
        const r = await prisma.pago.aggregate({
          where: { fecha: { gte: desde, lt: hasta }, anuladoEn: null, venta: { estado: { not: "ANULADA" } } },
          _sum: { monto: true },
        });
        return aMoneda(d(r._sum.monto));
      },
      () => {
        const hoy = hoyArgentina();
        const { desde, hasta } = rangoMes(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1);
        // La demo no tiene pagos sueltos: lo cobrado de cada venta, en su fecha.
        return aMoneda(
          sumar(...demoVentas(Number.MAX_SAFE_INTEGER).filter((v) => v.fecha >= desde && v.fecha < hasta).map((v) => v.pagado)),
        );
      },
    ),
);
