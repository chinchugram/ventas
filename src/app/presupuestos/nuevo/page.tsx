import Link from "next/link";
import { getArticulosParaPresupuesto, getClientesParaPresupuesto } from "@/lib/queries/presupuestos";
import { Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { PresupuestoForm } from "../_componentes/presupuesto-form";
import { SinBase } from "../_componentes/sin-base";

export const dynamic = "force-dynamic";

export default async function NuevoPresupuestoPage() {
  const [clientes, articulos] = await Promise.all([getClientesParaPresupuesto(), getArticulosParaPresupuesto()]);

  return (
    <>
      <Seccion
        titulo="Nuevo presupuesto"
        descripcion="Los precios se congelan al guardar"
        accion={
          <Link
            href="/presupuestos"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      {estadoDemo().activo ? (
        <SinBase />
      ) : clientes.length === 0 || articulos.length === 0 ? (
        <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          Para armar un presupuesto hace falta al menos un cliente y un artículo activos.
        </p>
      ) : (
        <PresupuestoForm
          clientes={clientes}
          articulos={articulos.map((a) => ({
            id: a.id,
            nombre: a.nombre,
            precioVenta: a.precioVenta.toString(),
            ivaPct: a.ivaPct.toString(),
          }))}
        />
      )}
    </>
  );
}
