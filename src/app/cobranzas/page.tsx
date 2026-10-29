import { Seccion, Vacio } from "@/components/ui";

// Pagina provisoria: la arma la tarea 2.1 de docs/04-checklist-olas.md.
export default function CobranzasPage() {
  return (
    <>
      <Seccion titulo="Cobranzas" descripcion="Pagos sobre ventas existentes y saldo por cliente" />
      <Vacio
        mensaje="Esta pantalla está en construcción"
        hint="Mientras tanto, el saldo de cada venta se ve en su detalle y el de cada cliente en Clientes."
      />
    </>
  );
}
