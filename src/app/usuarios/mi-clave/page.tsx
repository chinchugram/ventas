import type { Metadata } from "next";
import { requierePermisoPagina } from "@/lib/permisos";
import { puede } from "@/lib/permisos-pura";
import { dbDisponible } from "@/lib/prisma";
import { Boton, Seccion } from "@/components/ui";
import { MiClaveForm } from "../_componentes/mi-clave-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cambiar mi clave" };

/**
 * Cambiar la clave propia: la unica pagina de /usuarios que ve cualquier rol
 * (solo exige sesion; la lista y la administracion son del dueno).
 */
export default async function MiClavePage() {
  const actual = await requierePermisoPagina("cambiarClavePropia");
  const esModoDemo = !(await dbDisponible());

  return (
    <>
      <Seccion
        epigrafe="Tu usuario"
        titulo="Cambiar mi clave"
        descripcion={`Entraste como ${actual.nombre} (${actual.usuario})`}
        accion={
          puede(actual, "gestionarUsuarios") ? (
            <Boton href="/usuarios" variante="secundario">
              Volver
            </Boton>
          ) : null
        }
      />
      <div className="max-w-md">
        <MiClaveForm esModoDemo={esModoDemo} />
      </div>
    </>
  );
}
