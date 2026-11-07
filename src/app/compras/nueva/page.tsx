import { getMateriales } from "@/lib/queries/materiales";
import { NuevaCompraForm } from "@/components/nueva-compra-form";
import { Boton, Seccion } from "@/components/ui";
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
        epigrafe="Lo que entra al taller"
        titulo="Nueva compra"
        descripcion={
          lineasIniciales.length > 0
            ? "Cargada desde Reposición: revisá cantidades y precios antes de guardar"
            : "Suma stock y actualiza el costo de cada material"
        }
        accion={
          <Boton href="/compras" variante="secundario">
            Volver
          </Boton>
        }
      />
      <NuevaCompraForm materiales={opciones} lineasIniciales={lineasIniciales} esModoDemo={estadoDemo().activo} />
    </>
  );
}
