import Link from "next/link";
import { getArticulosConMargen } from "@/lib/queries/catalogo";
import { getClientes } from "@/lib/queries/clientes";
import { NuevaVentaForm } from "@/components/nueva-venta-form";
import { Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";

export const dynamic = "force-dynamic";

/**
 * Pantalla de carga de venta.
 *
 * MOCKUP: esta pantalla calcula costos, IVA y márgenes con el motor real
 * (`lib/costing.ts`). Con base de datos usa sus artículos y clientes; sin base
 * (o sin datos cargados) usa el juego de demostración, para que el flujo
 * completo se pueda mostrar siempre.
 */
export default async function NuevaVentaPage() {
  const [articulos, clientes] = await Promise.all([getArticulosConMargen(), getClientes()]);

  const hayDatos = articulos.length > 0 && clientes.length > 0;
  const esModoDemo = estadoDemo().activo || !hayDatos;

  const articulosDTO = articulos.map((a) => ({
    id: a.id,
    nombre: a.nombre,
    descripcion: a.descripcion,
    precioVenta: a.precioVenta.toString(),
    ivaPct: a.ivaPct.toString(),
    esServicio: a.esServicio,
    costoUnitario: a.receta.costoTotal.toString(),
    recetaConfiable: a.receta.confiable,
    receta: a.receta.componentes.map((c) => ({
      tipo: c.tipo,
      etiqueta: c.etiqueta,
      cantidad: c.cantidad.toString(),
      costoUnitario: c.costoUnitario.toString(),
      costoTotal: c.costoTotal.toString(),
    })),
  }));

  const clientesDTO = clientes.map((c) => ({ id: c.id, nombre: c.nombre, cuit: c.cuit }));

  return (
    <>
      <Seccion
        titulo="Nueva venta"
        descripcion="Costo, IVA y margen se calculan en vivo"
        accion={
          <Link
            href="/ventas"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <NuevaVentaForm
        articulos={articulosDTO}
        clientes={clientesDTO}
        esModoDemo={esModoDemo}
      />
    </>
  );
}
