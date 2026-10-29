import type { Metadata } from "next";
import Link from "next/link";
import { requierePermisoPagina } from "@/lib/permisos";
import { dbDisponible } from "@/lib/prisma";
import { Seccion } from "@/components/ui";
import { UsuarioForm } from "../_componentes/usuario-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nuevo usuario" };

export default async function NuevoUsuarioPage() {
  const actual = await requierePermisoPagina("gestionarUsuarios");

  const esModoDemo = !(await dbDisponible());

  return (
    <>
      <Seccion
        titulo="Nuevo usuario"
        descripcion="Vos elegís su clave inicial y se la pasás"
        accion={
          <Link
            href="/usuarios"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <UsuarioForm esModoDemo={esModoDemo} />
    </>
  );
}
