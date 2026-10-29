import { Seccion, Vacio } from "@/components/ui";

// Pagina provisoria: la arma la tarea 1.4 de docs/04-checklist-olas.md.
export default function ConfiguracionPage() {
  return (
    <>
      <Seccion titulo="Configuración" descripcion="Datos del negocio, costos por hora y máquinas" />
      <Vacio
        mensaje="Esta pantalla está en construcción"
        hint="Acá se van a poder cambiar el costo/hora de mano de obra, el IVA por defecto, el margen objetivo y las máquinas."
      />
    </>
  );
}
