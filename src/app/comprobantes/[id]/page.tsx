import { Seccion } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

// Pagina provisoria (tarea 5.0): ya protegida; el detalle llega con la facturacion.
export default async function ComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  await requierePermisoPagina("verComprobantes");
  await params;
  return (
    <>
      <Seccion titulo="Comprobante" />
      <p className="text-sm text-slate-600">Próximamente.</p>
    </>
  );
}
