import { estadoDemo } from "@/lib/respaldo";
import { getArticulosConManoObra, getConfiguracion } from "@/lib/queries/configuracion";
import { Seccion } from "@/components/ui";
import { ConfiguracionForm } from "./_componentes/configuracion-form";
import { requierePermisoPagina } from "@/lib/permisos";
import { getMarca } from "@/lib/marca";
import { LogoForm } from "./_componentes/logo-form";
import { SubnavConfiguracion } from "./_componentes/subnav";

export const dynamic = "force-dynamic";

/** Configuración → Negocio: nombre, costo por hora, IVA, margen objetivo y logo. */
export default async function ConfiguracionPage() {
  await requierePermisoPagina("configuracion");
  const [config, articulosConManoObra, marca] = await Promise.all([getConfiguracion(), getArticulosConManoObra(), getMarca()]);

  return (
    <>
      <Seccion epigrafe="Tu negocio" titulo="Configuración" />
      <SubnavConfiguracion />

      <div className="mb-6">
        <ConfiguracionForm
          inicial={{
            // El nombre que ve el negocio (el de su configuracion o, si nunca lo guardo, `Negocio.nombre`):
            // asi guardar este formulario sin tocarlo no le cambia la marca por un valor por defecto.
            nombreNegocio: marca.nombre,
            costoHoraManoObra: config.costoHoraManoObra.toString(),
            ivaPorDefecto: config.ivaPorDefecto.toString(),
            margenObjetivo: config.margenObjetivo.toString(),
          }}
          articulosConManoObra={articulosConManoObra}
          esModoDemo={estadoDemo().activo}
        />
      </div>

      <LogoForm nombre={marca.nombre} logo={marca.logo} logoPropio={marca.logoPropio} esModoDemo={estadoDemo().activo} />
    </>
  );
}
