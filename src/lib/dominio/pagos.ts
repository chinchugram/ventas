import { d, type Dinero } from "@/lib/money";
import { ErrorDeNegocio } from "@/lib/acciones";
import { saldoDeVenta, validarMontoContraSaldo, type MetodoPago } from "@/lib/cobranzas";
import type { Tx } from "./tx";

type VentaBloqueada = {
  id: string;
  estado: "PENDIENTE" | "ENTREGADA" | "ANULADA";
  clienteId: string;
  numero: number;
  anio: number;
  totalBruto: string;
};

/**
 * Lee la venta con `FOR UPDATE`: hasta que termine la transaccion nadie mas
 * puede cobrarla, anularla ni entregarla. Asi dos cobros simultaneos no pueden
 * pasar juntos el saldo (el segundo espera y ve el pago del primero).
 */
async function bloquearVenta(tx: Tx, ventaId: string): Promise<VentaBloqueada> {
  const filas = await tx.$queryRaw<VentaBloqueada[]>`
    SELECT id::text AS id, estado::text AS estado, "clienteId"::text AS "clienteId", numero, anio,
           "totalBruto"::text AS "totalBruto"
    FROM "ventas" WHERE id = ${ventaId}::uuid FOR UPDATE`;
  const venta = filas[0];
  if (!venta) throw new ErrorDeNegocio("La venta no existe.");
  return venta;
}

/** Saldo actual de una venta ya bloqueada (pagos no anulados). */
async function saldoActual(tx: Tx, venta: VentaBloqueada): Promise<Dinero> {
  const pagado = await tx.pago.aggregate({ where: { ventaId: venta.id, anuladoEn: null }, _sum: { monto: true } });
  return saldoDeVenta(d(venta.totalBruto), d(pagado._sum.monto));
}

export type PagoNuevo = {
  ventaId: string;
  fecha: Date;
  monto: Dinero;
  metodo: MetodoPago;
  notas: string | null;
};

/**
 * Registra un cobro sobre una venta existente. El cliente sale de la venta
 * (nunca de afuera) y el monto no puede pasar el saldo que queda.
 */
export async function registrarPagoEnTx(tx: Tx, pago: PagoNuevo): Promise<{ id: string; saldo: Dinero }> {
  const venta = await bloquearVenta(tx, pago.ventaId);
  if (venta.estado === "ANULADA") throw new ErrorDeNegocio("La venta está anulada: no admite pagos.");

  const saldo = await saldoActual(tx, venta);
  const problema = validarMontoContraSaldo(pago.monto, saldo);
  if (problema) throw new ErrorDeNegocio(problema);

  const creado = await tx.pago.create({
    data: {
      ventaId: venta.id,
      clienteId: venta.clienteId,
      fecha: pago.fecha,
      monto: pago.monto,
      metodo: pago.metodo,
      notas: pago.notas,
    },
    select: { id: true },
  });
  return { id: creado.id, saldo: saldoDeVenta(saldo, pago.monto) };
}

/**
 * Anula un pago: queda guardado con fecha y motivo, y deja de contar en el
 * saldo (la venta vuelve a deber ese monto). Nunca se borra.
 *
 * Se admite anular un pago de una venta ANULADA (por ejemplo, para dejar
 * constancia de que se devolvio la plata); en esa venta ya no contaba igual.
 */
export async function anularPagoEnTx(tx: Tx, pagoId: string, motivo: string): Promise<{ ventaId: string }> {
  const motivoLimpio = motivo.trim();
  if (!motivoLimpio) throw new ErrorDeNegocio("Indicá el motivo de la anulación.");

  const pago = await tx.pago.findUnique({ where: { id: pagoId }, select: { ventaId: true } });
  if (!pago) throw new ErrorDeNegocio("El pago no existe.");
  // Mismo orden de bloqueo que al cobrar (primero la venta): no hay abrazo mortal.
  await bloquearVenta(tx, pago.ventaId);

  const { count } = await tx.pago.updateMany({
    where: { id: pagoId, anuladoEn: null },
    data: { anuladoEn: new Date(), motivoAnulacion: motivoLimpio },
  });
  if (count === 0) throw new ErrorDeNegocio("El pago ya estaba anulado.");
  return { ventaId: pago.ventaId };
}

/**
 * Pasa una venta de PENDIENTE a ENTREGADA. Entregar no depende de cobrar: una
 * venta entregada puede seguir debiendo. No hay vuelta atras desde la pantalla.
 */
export async function marcarEntregadaEnTx(tx: Tx, ventaId: string): Promise<void> {
  const venta = await bloquearVenta(tx, ventaId);
  if (venta.estado === "ANULADA") throw new ErrorDeNegocio("La venta está anulada: no se puede entregar.");
  if (venta.estado === "ENTREGADA") throw new ErrorDeNegocio("La venta ya estaba entregada.");
  await tx.venta.update({ where: { id: ventaId }, data: { estado: "ENTREGADA" } });
}
