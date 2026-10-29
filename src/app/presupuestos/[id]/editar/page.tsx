import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha } from "@/lib/money";
import { motivoNoAbierto, numeroPresupuesto, type EstadoGuardado } from "@/lib/presupuestos";
import { hoyArgentina } from "@/lib/acciones";
import { getArticulosParaPresupuesto, getClientesParaPresupuesto, getPresupuesto } from "@/lib/queries/presupuestos";
import { Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { PresupuestoForm } from "../../_componentes/presupuesto-form";
import { SinBase } from "../../_componentes/sin-base";

export const dynamic = "force-dynamic";

export default async function EditarPresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, clientes, articulos] = await Promise.all([
    getPresupuesto(id),
    getClientesParaPresupuesto(),
    getArticulosParaPresupuesto(),
  ]);
  if (!p) {
    if (estadoDemo().activo) {
      return (
        <>
          <Seccion titulo="Editar presupuesto" />
          <SinBase />
        </>
      );
    }
    notFound();
  }

  const volver = (
    <Link
      href={`/presupuestos/${p.id}`}
      className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
    >
      Volver
    </Link>
  );
  const titulo = `Editar N° ${numeroPresupuesto(p.numero, p.anio)}`;

  // Solo se edita un ABIERTO que no venció; si no, se explica por que (el servidor lo vuelve a verificar).
  const motivo = motivoNoAbierto(
    { estado: p.estadoGuardado as EstadoGuardado, fecha: p.fecha, validezDias: p.validezDias, ventaNumero: p.venta ? numeroPresupuesto(p.venta.numero, p.venta.anio) : null },
    hoyArgentina(),
    "editar",
  );
  if (motivo) {
    return (
      <>
        <Seccion titulo={titulo} accion={volver} />
        <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          {motivo}
        </p>
      </>
    );
  }

  // Si el cliente se dio de baja sigue en la lista, para no perder la seleccion; el servidor lo rechaza al guardar.
  const opciones = clientes.some((c) => c.id === p.cliente.id)
    ? clientes
    : [{ id: p.cliente.id, nombre: `${p.cliente.nombre} (dado de baja)`, cuit: null }, ...clientes];

  return (
    <>
      <Seccion titulo={titulo} descripcion={`Creado el ${fmtFecha(p.fecha)}. Las líneas que ya estaban mantienen su precio.`} accion={volver} />
      <PresupuestoForm
        id={p.id}
        clientes={opciones}
        articulos={articulos.map((a) => ({
          id: a.id,
          nombre: a.nombre,
          precioVenta: a.precioVenta.toString(),
          ivaPct: a.ivaPct.toString(),
        }))}
        inicial={{
          clienteId: p.cliente.id,
          validezDias: String(p.validezDias),
          observaciones: p.observaciones ?? "",
          lineas: p.items.map((i) => ({
            articuloId: i.articuloId,
            descripcion: i.descripcion,
            cantidad: i.cantidad.toString(),
            precioUnitario: i.precioUnitario.toString(),
            ivaPct: i.ivaPct.toString(),
          })),
        }}
      />
    </>
  );
}
