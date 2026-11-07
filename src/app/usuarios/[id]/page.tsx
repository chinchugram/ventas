import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requierePermisoPagina } from "@/lib/permisos";
import { getUsuario } from "@/lib/queries/usuarios";
import { Aviso, Boton, Panel, Seccion } from "@/components/ui";
import { fechaArgentina, InsigniaRol, Pastilla } from "../_formato";
import { AccionesUsuario } from "../_componentes/acciones-usuario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usuario" };

export default async function UsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const actual = await requierePermisoPagina("gestionarUsuarios");

  // El id de la URL tiene que ser un UUID: cualquier otra cosa ni llega a la base.
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const u = await getUsuario(actual, id);
  if (!u) notFound();

  const soyYo = u.id === actual.id;

  return (
    <>
      <Seccion
        epigrafe="Usuario"
        titulo={u.nombre}
        descripcion={`${u.usuario} · desde el ${fechaArgentina(u.creadoEn)}`}
        accion={
          <Boton href="/usuarios" variante="secundario">
            Volver
          </Boton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <InsigniaRol rol={u.rol} />
        {soyYo ? <Pastilla tono="marca">Vos</Pastilla> : null}
        {!u.activo ? <Pastilla tono="gris">Dado de baja</Pastilla> : null}
        {u.enPausa ? <Pastilla tono="aviso">En pausa por intentos fallidos</Pastilla> : null}
      </div>

      {!u.activo ? (
        <Aviso tono="aviso" titulo="Usuario dado de baja." className="mb-4">
          No puede entrar. Su historial se conserva.
        </Aviso>
      ) : null}

      {soyYo ? (
        <Panel className="space-y-3">
          <p className="text-body text-ink">
            Este es tu usuario. No podés darte de baja ni cambiarte el rol: si hace falta, lo hace otro dueño.
          </p>
          <Boton href="/usuarios/mi-clave">Cambiar mi clave</Boton>
        </Panel>
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
