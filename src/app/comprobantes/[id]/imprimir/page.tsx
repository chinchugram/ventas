import Link from "next/link";
import { notFound } from "next/navigation";
import { requierePermisoPagina } from "@/lib/permisos";
import { getComprobante } from "@/lib/queries/comprobante";
import { BotonImprimir } from "../_componentes/boton-imprimir";
import { DocumentoComprobante } from "../_componentes/documento";
import { FranjaSinValidez } from "../_componentes/marca-sin-validez";

export const dynamic = "force-dynamic";

// Al imprimir (o "Guardar como PDF") solo queda el comprobante: sin navegación,
// sin botones, en A4, con colores exactos (la marca "SIN VALIDEZ FISCAL" no se
// puede perder) y con el sello repetido en cada hoja (position: fixed se repite
// en cada página impresa).
const CSS_IMPRESION = `
@page { size: A4; margin: 10mm; }
@media print {
  html, body { background: #fff !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body > header, body > nav, body > dialog, body > a, .no-imprimir { display: none !important; }
  main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
  .documento { border: 0 !important; max-width: none !important; }
  .documento section, .documento header { break-inside: avoid; }
  .sello-sin-validez { position: fixed !important; inset: 0 !important; height: 100vh; }
}
`;

export default async function ImprimirComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  await requierePermisoPagina("verComprobantes");
  const { id } = await params;
  const comprobante = await getComprobante(id);
  if (!comprobante) notFound();

  return (
    <>
      <style>{CSS_IMPRESION}</style>
      <div className="no-imprimir mb-4 flex flex-wrap items-center gap-2">
        <BotonImprimir />
        <Link
          href={`/comprobantes/${comprobante.id}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
        >
          Volver al detalle
        </Link>
        <p className="w-full text-xs text-slate-600">Para el PDF: Imprimir y elegir “Guardar como PDF” como destino.</p>
      </div>
      {/* En pantalla la marca también va fuera del papel, bien arriba (no se imprime: el documento ya la lleva). */}
      <FranjaSinValidez ambiente={comprobante.ambiente} className="no-imprimir mb-3 rounded-lg" />
      <DocumentoComprobante c={comprobante} />
    </>
  );
}
