import type { Metadata } from "next";
import { estadoDemo } from "@/lib/respaldo";
import { getConfig } from "@/lib/queries/catalogo";
import { entradaDesdeConfiguracion, faltantesParaEmitir } from "@/lib/datos-fiscales";
import { formatearCuit } from "@/lib/cuit";
import { requierePermisoPagina } from "@/lib/permisos";
import { Seccion } from "@/components/ui";
import { DatosFiscalesForm, type ValoresDatosFiscales } from "../_componentes/datos-fiscales-form";
import { SubnavConfiguracion } from "../_componentes/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Datos fiscales" };

/** Configuración → Datos fiscales: quién figura como emisor en los comprobantes. */
export default async function DatosFiscalesPage() {
  await requierePermisoPagina("configuracion");
  const configCruda = await getConfig();
  const fiscal = entradaDesdeConfiguracion(configCruda);
  const datosFiscales: ValoresDatosFiscales = {
    razonSocial: fiscal.razonSocial ?? "",
    cuit: formatearCuit(fiscal.cuit),
    condicionIva: fiscal.condicionIva || "RESPONSABLE_INSCRIPTO",
    domicilio: fiscal.domicilio ?? "",
    inicioActividades: fiscal.inicioActividades ?? "",
    iibb: fiscal.iibb ?? "",
    puntoVenta: fiscal.puntoVenta ?? "",
  };

  return (
    <>
      <Seccion epigrafe="Tu negocio" titulo="Configuración" />
      <SubnavConfiguracion />
      <DatosFiscalesForm inicial={datosFiscales} faltantes={faltantesParaEmitir(configCruda)} esModoDemo={estadoDemo().activo} />
    </>
  );
}
