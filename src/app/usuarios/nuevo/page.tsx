import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requiereUsuario } from "@/lib/auth";
import { inicioDeRol } from "@/lib/auth-pura";
import { puede } from "@/lib/permisos-pura";
import { dbDisponible } from "@/lib/prisma";
import { Seccion } from "@/components/ui";
import { UsuarioForm } from "../_componentes/usuario-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nuevo usuario" };

export default async function NuevoUsuarioPage() {
  const actual = await requiereUsuario();
  if (!puede(actual, "gestionarUsuarios")) redirect(inicioDeRol(actual.rol));

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
