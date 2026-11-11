import { getArticulosParaPresupuesto, getClientesParaPresupuesto } from "@/lib/queries/presupuestos";
import { Aviso, Boton, Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { requierePermisoPagina } from "@/lib/permisos";
import { PresupuestoForm } from "../_componentes/presupuesto-form";
import { SinBase } from "../_componentes/sin-base";

export const dynamic = "force-dynamic";

export default async function NuevoPresupuestoPage() {
  await requierePermisoPagina("cargarPresupuesto");
  const [clientes, articulos] = await Promise.all([getClientesParaPresupuesto(), getArticulosParaPresupuesto()]);

  return (
    <>
      <Seccion
        titulo="Nuevo presupuesto"
        descripcion="Los precios se congelan al guardar"
        accion={
          <Boton href="/presupuestos" variante="secundario">
            Volver
          </Boton>
        }
      />
      {estadoDemo().activo ? (
        <SinBase />
      ) : clientes.length === 0 || articulos.length === 0 ? (
        <Aviso tono="aviso" titulo="Falta cargar datos" role="status">
          Para armar un presupuesto hace falta al menos un cliente y un artículo activos.
        </Aviso>
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
