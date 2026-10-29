import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requiereUsuario } from "@/lib/auth";
import { inicioDeRol } from "@/lib/auth-pura";
import { puede } from "@/lib/permisos-pura";
import { getUsuarios } from "@/lib/queries/usuarios";
import { AvisoDemo } from "@/components/form";
import { Seccion, Vacio } from "@/components/ui";
import { fechaArgentina, InsigniaRol, Pastilla } from "./_formato";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  // Solo el dueno. Un empleado va a su pantalla de inicio (no se le dice que esta pagina existe).
  const actual = await requiereUsuario();
  if (!puede(actual, "gestionarUsuarios")) redirect(inicioDeRol(actual.rol));

  const { usuarios, esDemo, duenosActivos } = await getUsuarios(actual);

  return (
    <>
      <Seccion
        titulo="Usuarios"
        descripcion={
          esDemo
            ? undefined
            : `${usuarios.filter((u) => u.activo).length} activos · ${duenosActivos} ${duenosActivos === 1 ? "dueño" : "dueños"}`
        }
        accion={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/usuarios/mi-clave"
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
            >
              Cambiar mi clave
            </Link>
            <Link
              href="/usuarios/nuevo"
              className="inline-flex min-h-11 items-center rounded-lg bg-marca px-3 text-sm font-semibold text-tinta"
            >
              Nuevo usuario
            </Link>
          </div>
        }
      />

      <AvisoDemo visible={esDemo} que="los usuarios" />

      {!esDemo && usuarios.length === 0 ? (
        <Vacio mensaje="No hay usuarios cargados" hint="Creá el primero con «Nuevo usuario»." />
      ) : (
        <ul className="space-y-2">
          {usuarios.map((u) => (
            <li key={u.id}>
              <Link
                href={u.id === actual.id ? "/usuarios/mi-clave" : `/usuarios/${u.id}`}
                className={`block min-h-11 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 ${
                  u.activo ? "" : "opacity-75"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`font-medium ${u.activo ? "text-slate-900" : "text-slate-500"}`}>{u.nombre}</p>
                    <p className="truncate text-sm text-slate-500">
                      {u.usuario} · desde el {fechaArgentina(u.creadoEn)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <InsigniaRol rol={u.rol} />
                    {u.id === actual.id ? <Pastilla tono="marca">Vos</Pastilla> : null}
                    {!u.activo ? <Pastilla tono="gris">Dado de baja</Pastilla> : null}
                    {u.enPausa ? <Pastilla tono="aviso">En pausa</Pastilla> : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
