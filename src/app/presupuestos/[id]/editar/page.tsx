import { notFound } from "next/navigation";
import { fmtFecha } from "@/lib/money";
import { motivoNoAbierto, numeroPresupuesto, type EstadoGuardado } from "@/lib/presupuestos";
import { hoyArgentina } from "@/lib/acciones";
import { getArticulosParaPresupuesto, getClientesParaPresupuesto, getPresupuesto } from "@/lib/queries/presupuestos";
import { Aviso, Boton, Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { requierePermisoPagina } from "@/lib/permisos";
import { PresupuestoForm } from "../../_componentes/presupuesto-form";
import { SinBase } from "../../_componentes/sin-base";

export const dynamic = "force-dynamic";

export default async function EditarPresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  await requierePermisoPagina("cargarPresupuesto");
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
    <Boton href={`/presupuestos/${p.id}`} variante="secundario">
      Volver
    </Boton>
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
        <Aviso tono="aviso" role="status">
          {motivo}
        </Aviso>
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
