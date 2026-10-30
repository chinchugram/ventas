import { Seccion } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

// Pagina provisoria (tarea 5.0): ya protegida; el listado llega con la facturacion.
export default async function ComprobantesPage() {
  await requierePermisoPagina("verComprobantes");
  return (
    <>
      <Seccion titulo="Comprobantes" />
      <p className="text-sm text-slate-600">Próximamente.</p>
    </>
  );
}
