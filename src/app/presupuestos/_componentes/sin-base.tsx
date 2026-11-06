/** Los presupuestos solo existen con base de datos: en modo demostracion se avisa en vez de mostrar vacio. */
export function SinBase() {
  return (
    <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
      Modo demostración: no hay base de datos conectada, así que los presupuestos no están disponibles (ni se pueden
      crear). Conectá la base para usarlos.
    </p>
  );
}
