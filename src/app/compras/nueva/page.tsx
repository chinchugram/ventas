import Link from "next/link";
import { getMateriales } from "@/lib/queries/materiales";
import { NuevaCompraForm } from "@/components/nueva-compra-form";
import { Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";

export const dynamic = "force-dynamic";

export default async function NuevaCompraPage() {
  const materiales = await getMateriales();
  const opciones = materiales.map((m) => ({
    id: m.id,
    nombre: m.nombre,
    unidad: m.unidad,
    costoUnitario: m.costoUnitario.toString(),
  }));

  return (
    <>
      <Seccion
        titulo="Nueva compra"
        descripcion="Suma stock y actualiza el costo de cada material"
        accion={
          <Link
            href="/compras"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <NuevaCompraForm materiales={opciones} esModoDemo={estadoDemo().activo} />
    </>
  );
}
