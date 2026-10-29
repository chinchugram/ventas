import { CalculadoraCortes } from "@/components/calculadora-cortes";
import { Seccion } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";

// La calculadora parte del precio de la plancha (un costo de compra) para fijar precios de venta:
// es una herramienta de costeo, solo para quien ve costos.
export default async function CortesPage() {
  await requierePermisoPagina("verCostos");
  return (
    <>
      <Seccion
        titulo="Cortes"
        descripcion="Precio de una medida a partir del precio de la plancha entera"
      />
      <CalculadoraCortes />
    </>
  );
}
