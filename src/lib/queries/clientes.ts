import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoClientes } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { aMoneda, d, type Dinero, sumar } from "@/lib/money";

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
          pagos: { select: { monto: true } },
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
