import type { Metadata } from "next";
import Link from "next/link";
import { requiereUsuario } from "@/lib/auth";
import { puede } from "@/lib/permisos-pura";
import { dbDisponible } from "@/lib/prisma";
import { Seccion } from "@/components/ui";
import { MiClaveForm } from "../_componentes/mi-clave-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cambiar mi clave" };

/**
 * Cambiar la clave propia: la unica pagina de /usuarios que ve cualquier rol
 * (solo exige sesion; la lista y la administracion son del dueno).
 */
export default async function MiClavePage() {
  const actual = await requiereUsuario();
  const esModoDemo = !(await dbDisponible());

  return (
    <>
      <Seccion
        titulo="Cambiar mi clave"
        descripcion={`Entraste como ${actual.nombre} (${actual.usuario})`}
        accion={
          puede(actual, "gestionarUsuarios") ? (
            <Link
              href="/usuarios"
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
            >
              Volver
            </Link>
          ) : null
        }
      />
      <div className="max-w-md">
        <MiClaveForm esModoDemo={esModoDemo} />
      </div>
    </>
  );
}
