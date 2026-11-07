import type { Metadata } from "next";
import { requierePermisoPagina } from "@/lib/permisos";
import { dbDisponible } from "@/lib/prisma";
import { Boton, Seccion } from "@/components/ui";
import { UsuarioForm } from "../_componentes/usuario-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nuevo usuario" };

export default async function NuevoUsuarioPage() {
  const actual = await requierePermisoPagina("gestionarUsuarios");

  const esModoDemo = !(await dbDisponible());

  return (
    <>
      <Seccion
        epigrafe="Usuarios"
        titulo="Nuevo usuario"
        descripcion="Vos elegís su clave inicial y se la pasás."
        accion={
          <Boton href="/usuarios" variante="secundario">
            Volver
          </Boton>
        }
      />
      <UsuarioForm esModoDemo={esModoDemo} />
    </>
  );
}
