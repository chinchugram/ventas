import Link from "next/link";
import { fmtMoneda } from "@/lib/money";
import { estadoDemo } from "@/lib/respaldo";
import { getArticulosConManoObra, getConfiguracion, getMaquinas } from "@/lib/queries/configuracion";
import { Seccion, Vacio } from "@/components/ui";
import { ConfiguracionForm } from "./_componentes/configuracion-form";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const [config, maquinas, articulosConManoObra] = await Promise.all([
    getConfiguracion(),
    getMaquinas(),
    getArticulosConManoObra(),
  ]);

  return (
    <>
      <Seccion titulo="Configuración" descripcion="Datos del negocio, costos por hora y máquinas" />

      <div className="mb-6">
        <ConfiguracionForm
          inicial={{
            nombreNegocio: config.nombreNegocio,
            costoHoraManoObra: config.costoHoraManoObra.toString(),
            ivaPorDefecto: config.ivaPorDefecto.toString(),
            margenObjetivo: config.margenObjetivo.toString(),
          }}
          articulosConManoObra={articulosConManoObra}
          esModoDemo={estadoDemo().activo}
        />
      </div>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Máquinas</h2>
          <p className="text-sm text-slate-500">Su costo por hora entra en las recetas que las usan</p>
        </div>
        <Link
          href="/configuracion/maquinas/nueva"
          className="shrink-0 rounded-lg bg-marca px-3 py-2 text-sm font-semibold text-tinta"
        >
          Agregar máquina
        </Link>
      </div>

      {maquinas.length === 0 ? (
        <Vacio mensaje="No hay máquinas cargadas" hint="Agregá el láser, el plotter y las demás para costear las recetas." />
      ) : (
        <ul className="space-y-2">
          {maquinas.map((m) => (
            <li key={m.id} className={`rounded-xl border border-slate-200 p-4 ${m.activo ? "bg-white" : "bg-slate-50"}`}>
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/configuracion/maquinas/${m.id}`}
                  className={`min-w-0 font-medium underline-offset-2 hover:underline ${m.activo ? "text-slate-900" : "text-slate-500"}`}
                >
                  {m.nombre}
                </Link>
                {m.activo ? null : (
                  <span className="shrink-0 rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    De baja
                  </span>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-xs text-slate-500">Costo por hora</dt>
                  <dd className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoneda(m.costoHora)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Usada en</dt>
                  <dd className="text-sm font-semibold tabular-nums text-slate-900">
                    {m.recetas} {m.recetas === 1 ? "receta" : "recetas"}
                  </dd>
                </div>
              </dl>
              {!m.activo && m.recetas > 0 ? (
                <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  Está de baja pero sigue en recetas: esos artículos la siguen costeando.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
