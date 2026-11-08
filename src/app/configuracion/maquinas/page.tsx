import type { Metadata } from "next";
import Link from "next/link";
import { fmtMoneda } from "@/lib/money";
import { getMaquinas } from "@/lib/queries/configuracion";
import { requierePermisoPagina } from "@/lib/permisos";
import { Aviso, Boton, Dato, Etiqueta, Seccion, TituloBloque, Vacio } from "@/components/ui";
import { SubnavConfiguracion } from "../_componentes/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Máquinas" };

/** Configuración → Máquinas: recursos de producción con su costo por hora (entran en las recetas). */
export default async function MaquinasPage() {
  await requierePermisoPagina("configuracion");
  const maquinas = await getMaquinas();

  return (
    <>
      <Seccion epigrafe="Tu negocio" titulo="Configuración" />
      <SubnavConfiguracion />

      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <TituloBloque className="mb-0">Máquinas</TituloBloque>
          <p className="text-body-sm text-ink-muted">Su costo por hora entra en las recetas que las usan.</p>
        </div>
        <Boton href="/configuracion/maquinas/nueva" className="shrink-0">
          Agregar máquina
        </Boton>
      </div>

      {maquinas.length === 0 ? (
        <Vacio mensaje="Ninguna máquina cargada." hint="Agregá el láser, el plotter y las demás para costear las recetas." />
      ) : (
        <ul className="space-y-2">
          {maquinas.map((m) => (
            <li key={m.id} className={`tarjeta p-4 ${m.activo ? "" : "bg-surface-sunken"}`}>
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/configuracion/maquinas/${m.id}`}
                  className={`inline-flex min-h-11 min-w-0 items-center text-body font-semibold underline-offset-2 hover:underline ${m.activo ? "text-ink" : "text-ink-muted"}`}
                >
                  {m.nombre}
                </Link>
                {m.activo ? null : <Etiqueta className="shrink-0">De baja</Etiqueta>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <Dato etiqueta="Costo por hora">{fmtMoneda(m.costoHora)}</Dato>
                <Dato etiqueta="Usada en">
                  {m.recetas} {m.recetas === 1 ? "receta" : "recetas"}
                </Dato>
              </dl>
              {!m.activo && m.recetas > 0 ? (
                <Aviso tono="aviso" className="mt-3">
                  Está de baja pero sigue en recetas: esos artículos la siguen costeando.
                </Aviso>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
