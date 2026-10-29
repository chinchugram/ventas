import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requiereUsuario } from "@/lib/auth";
import { inicioDeRol } from "@/lib/auth-pura";
import { puede } from "@/lib/permisos-pura";
import { getUsuario } from "@/lib/queries/usuarios";
import { Seccion } from "@/components/ui";
import { fechaArgentina, InsigniaRol, Pastilla } from "../_formato";
import { AccionesUsuario } from "../_componentes/acciones-usuario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usuario" };

export default async function UsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const actual = await requiereUsuario();
  if (!puede(actual, "gestionarUsuarios")) redirect(inicioDeRol(actual.rol));

  // El id de la URL tiene que ser un UUID: cualquier otra cosa ni llega a la base.
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const u = await getUsuario(actual, id);
  if (!u) notFound();

  const soyYo = u.id === actual.id;

  return (
    <>
      <Seccion
        titulo={u.nombre}
        descripcion={`${u.usuario} · desde el ${fechaArgentina(u.creadoEn)}`}
        accion={
          <Link
            href="/usuarios"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1">
        <InsigniaRol rol={u.rol} />
        {soyYo ? <Pastilla tono="marca">Vos</Pastilla> : null}
        {!u.activo ? <Pastilla tono="gris">Dado de baja</Pastilla> : null}
        {u.enPausa ? <Pastilla tono="aviso">En pausa por intentos fallidos</Pastilla> : null}
      </div>

      {!u.activo ? (
        <p className="mb-4 rounded-lg bg-slate-200 p-3 text-sm text-slate-700">
          Usuario dado de baja: no puede entrar. Su historial se conserva.
        </p>
      ) : null}

      {soyYo ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            Este es tu usuario. No podés darte de baja ni cambiarte el rol: si hace falta, lo hace otro dueño.
          </p>
          <Link
            href="/usuarios/mi-clave"
            className="inline-flex min-h-11 items-center rounded-lg bg-marca px-3 text-sm font-semibold text-tinta"
          >
            Cambiar mi clave
          </Link>
        </div>
      ) : (
        <AccionesUsuario
          id={u.id}
          nombre={u.nombre}
          rol={u.rol}
          activo={u.activo}
          esUltimoDuenoActivo={u.esUltimoDuenoActivo}
        />
      )}
    </>
  );
}
