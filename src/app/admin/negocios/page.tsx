import type { Metadata } from "next";
import { requierePermisoPagina } from "@/lib/permisos";
import { getNegocios } from "@/lib/queries/negocios";
import { AvisoDemo } from "@/components/form";
import { Etiqueta, Seccion, Vacio } from "@/components/ui";
import { AccionesNegocio } from "./_componentes/acciones-negocio";
import { NegocioForm } from "./_componentes/negocio-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Negocios" };

function fecha(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(d);
}

/** Lista de negocios para el SUPERADMIN: nombre, estado y cantidad de usuarios, nada mas. */
export default async function NegociosPage() {
  const actual = await requierePermisoPagina("administrarNegocios");
  const { negocios, esDemo } = await getNegocios(actual);

  return (
    <>
      <Seccion
        epigrafe="Administración"
        titulo="Negocios"
        descripcion={esDemo ? undefined : `${negocios.filter((n) => n.activo).length} activos de ${negocios.length}`}
      />
      <AvisoDemo visible={esDemo} que="los negocios" />

      <div className="mb-6">
        <NegocioForm esModoDemo={esDemo} />
      </div>

      {!esDemo && negocios.length === 0 ? (
        <Vacio mensaje="Ni un negocio a la vista." hint="Creá el primero con el formulario de arriba." />
      ) : (
        <ul className="space-y-2">
          {negocios.map((n) => (
            <li key={n.id} className={`tarjeta p-4 ${n.activo ? "" : "bg-surface-sunken"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-body font-semibold ${n.activo ? "text-ink" : "text-ink-muted"}`}>{n.nombre}</p>
                  <p className="truncate text-body-sm text-ink-muted">
                    {n.slug} · desde el {fecha(n.creadoEn)} · {n.usuarios === 0 ? "sin usuarios" : `${n.usuarios} ${n.usuarios === 1 ? "usuario" : "usuarios"} (${n.usuariosActivos} ${n.usuariosActivos === 1 ? "activo" : "activos"})`}
                  </p>
                </div>
                <Etiqueta tono={n.activo ? "ok" : "neutro"}>{n.activo ? "Activo" : "Dado de baja"}</Etiqueta>
              </div>
              <AccionesNegocio id={n.id} nombre={n.nombre} activo={n.activo} sinUsuarios={n.usuarios === 0} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
