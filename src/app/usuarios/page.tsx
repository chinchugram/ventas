import type { Metadata } from "next";
import Link from "next/link";
import { requierePermisoPagina } from "@/lib/permisos";
import { getUsuarios } from "@/lib/queries/usuarios";
import { AvisoDemo } from "@/components/form";
import { Boton, Seccion, Vacio } from "@/components/ui";
import { fechaArgentina, InsigniaRol, Pastilla } from "./_formato";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  // Solo el dueno. Un empleado va a su pantalla de inicio (no se le dice que esta pagina existe).
  const actual = await requierePermisoPagina("gestionarUsuarios");

  const { usuarios, esDemo, duenosActivos } = await getUsuarios(actual);

  return (
    <>
      <Seccion
        epigrafe="Quién entra"
        titulo="Usuarios"
        descripcion={
          esDemo
            ? undefined
            : `${usuarios.filter((u) => u.activo).length} activos · ${duenosActivos} ${duenosActivos === 1 ? "dueño" : "dueños"}`
        }
        accion={
          <div className="flex flex-wrap gap-3">
            <Boton href="/usuarios/mi-clave" variante="secundario">
              Cambiar mi clave
            </Boton>
            <Boton href="/usuarios/nuevo">Nuevo usuario</Boton>
          </div>
        }
      />

      <AvisoDemo visible={esDemo} que="los usuarios" />

      {!esDemo && usuarios.length === 0 ? (
        <Vacio mensaje="Ni un usuario a la vista." hint="Creá el primero con «Nuevo usuario»." />
      ) : (
        <ul className="space-y-2">
          {usuarios.map((u) => (
            <li key={u.id}>
              <Link
                href={u.id === actual.id ? "/usuarios/mi-clave" : `/usuarios/${u.id}`}
                className={`tarjeta block min-h-11 p-4 transition-colors duration-(--dur-rutina) hover:bg-surface-sunken ${
                  u.activo ? "" : "bg-surface-sunken"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-body font-semibold ${u.activo ? "text-ink" : "text-ink-muted"}`}>{u.nombre}</p>
                    <p className="truncate text-body-sm text-ink-muted">
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
