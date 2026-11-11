import { Aviso } from "@/components/ui";

/** Los presupuestos solo existen con base de datos: en modo demostracion se avisa en vez de mostrar vacio. */
export function SinBase() {
  return (
    <Aviso tono="aviso" titulo="Modo demostración" role="status">
      No hay base de datos conectada, así que los presupuestos no están disponibles (ni se pueden crear). Conectá la base y
      vas a poder usarlos.
    </Aviso>
  );
}
