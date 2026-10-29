import { CalculadoraCortes } from "@/components/calculadora-cortes";
import { Seccion } from "@/components/ui";

export default function CortesPage() {
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
