import Link from "next/link";
import { getMateriales } from "@/lib/queries/materiales";
import { NuevaCompraForm } from "@/components/nueva-compra-form";
import { Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { leerPrecarga } from "@/lib/reposicion";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

export default async function NuevaCompraPage({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  await requierePermisoPagina("registrarCompra", "verCostos");
  const [materiales, { m: precarga }] = await Promise.all([getMateriales(), searchParams]);
  const opciones = materiales.map((m) => ({
    id: m.id,
    nombre: m.nombre,
    unidad: m.unidad,
    costoUnitario: m.costoUnitario.toString(),
  }));

  // Precarga desde la lista de reposicion (`?m=<id>:<cantidad>,...`): solo una
  // sugerencia editable. Los materiales que no existen o estan de baja se
  // ignoran, y el costo es siempre el vigente.
  const activos = new Set(opciones.map((o) => o.id));
  const lineasIniciales = leerPrecarga(precarga).filter((l) => activos.has(l.materialId));

  return (
    <>
      <Seccion
        titulo="Nueva compra"
        descripcion={
          lineasIniciales.length > 0
            ? "Cargada desde Reposición: revisá cantidades y precios antes de guardar"
            : "Suma stock y actualiza el costo de cada material"
        }
        accion={
          <Link
            href="/compras"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <NuevaCompraForm materiales={opciones} lineasIniciales={lineasIniciales} esModoDemo={estadoDemo().activo} />
    </>
  );
}
