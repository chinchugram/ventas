import Link from "next/link";
import { fmtMoneda, fmtMonedaCorta, fmtNumero } from "@/lib/money";
import { urlNuevaCompra } from "@/lib/reposicion";
import { DIAS_CONSUMO, getReposicion, type MaterialReposicion } from "@/lib/queries/reposicion";
import type { LineaReposicion } from "@/lib/reposicion";
import { estadoDemo } from "@/lib/respaldo";
import { Seccion, Tarjeta, Vacio } from "@/components/ui";
import { FactorForm } from "./_componentes/factor-form";

export const dynamic = "force-dynamic";

export default async function ReposicionPage() {
  const { lineas, total, factor, conMinimo } = await getReposicion();
  const esModoDemo = estadoDemo().activo;

  return (
    <>
      <Seccion
        titulo="Reposición"
        descripcion="Materiales bajo el mínimo: cuánto comprar y cuánto va a salir"
        accion={
          <Link
            href="/materiales"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            Materiales
          </Link>
        }
      />

      <div className="mb-4">
        <FactorForm inicial={factor.toString()} esModoDemo={esModoDemo} />
      </div>

      {lineas.length === 0 ? (
        <Vacio
          mensaje="Nada para reponer"
          hint={
            conMinimo === 0
              ? "Ningún material tiene stock mínimo cargado. Cargalo al editar cada material para recibir sugerencias."
              : "Todos los materiales con mínimo cargado están en el mínimo o por encima."
          }
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Tarjeta titulo="A reponer" valor={fmtNumero(lineas.length)} tono="aviso" detalle={lineas.length === 1 ? "material" : "materiales"} />
            <Tarjeta titulo="Compra estimada" valor={fmtMonedaCorta(total)} detalle="a costo actual" />
          </div>

          <ul className="space-y-2">
            {lineas.map((l) => (
              <LineaTarjeta key={l.id} linea={l} />
            ))}
          </ul>

          <div className="sticky bottom-20 mt-4 flex items-center justify-between gap-3 rounded-xl bg-tinta p-4 text-white md:bottom-4">
            <div className="min-w-0">
              <p className="text-xs text-slate-300 uppercase">Compra sugerida</p>
              <p className="text-xl font-semibold tabular-nums">{fmtMoneda(total)}</p>
            </div>
            <Link
              href={urlNuevaCompra(lineas)}
              className="shrink-0 rounded-lg bg-marca px-4 py-3 text-center font-semibold text-tinta"
            >
              Armar compra
            </Link>
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">
            Abre Nueva compra con estas cantidades y el costo actual; podés cambiarlas antes de guardar.
          </p>
        </>
      )}
    </>
  );
}

function LineaTarjeta({ linea: l }: { linea: LineaReposicion<MaterialReposicion> }) {
  const agotado = l.stockActual.lte(0);
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/materiales/${l.id}`}
          className="min-w-0 font-medium text-slate-900 underline-offset-2 hover:underline"
        >
          {l.nombre}
        </Link>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
            agotado ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {agotado ? "Sin stock" : "Bajo mínimo"}
        </span>
      </div>

      <p className="mt-2 text-lg font-semibold tabular-nums text-slate-900">
        Comprar {fmtNumero(l.cantidad)} <span className="text-base font-normal text-slate-500">{l.etiquetaUnidad}</span>
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Stock / mínimo</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">
            {fmtNumero(l.stockActual)} / {fmtNumero(l.stockMinimo)}{" "}
            <span className="font-normal text-slate-500">{l.etiquetaUnidad}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Vendido en {DIAS_CONSUMO} días</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-500">
            {l.consumo.gt(0) ? `${fmtNumero(l.consumo)} ${l.etiquetaUnidad}` : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Costo por {l.etiquetaUnidad}</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoneda(l.costoUnitario)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Costo estimado</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoneda(l.costoEstimado)}</dd>
        </div>
      </dl>
    </li>
  );
}
