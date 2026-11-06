import Link from "next/link";
import { fmtNumero } from "@/lib/money";
import { getListasPrecios, type ListaListado } from "@/lib/queries/listas-precios";
import { dbDisponible } from "@/lib/prisma";
import { requierePermisoPagina } from "@/lib/permisos";
import { Seccion, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Listas de precios: un descuento general y/o precios especificos que se asignan a clientes. */
export default async function ListasPreciosPage() {
  await requierePermisoPagina("gestionarListasPrecios");
  const [listas, hayBase] = await Promise.all([getListasPrecios(), dbDisponible()]);
  const activas = listas.filter((l) => l.activo);
  const deBaja = listas.filter((l) => !l.activo);

  return (
    <>
      <Seccion
        titulo="Listas de precios"
        descripcion="Precios distintos para ciertos clientes"
        accion={
          <Link
            href="/listas-precios/nueva"
            className="inline-flex min-h-11 items-center rounded-lg bg-tinta px-3 text-sm font-semibold text-white"
          >
            + Nueva lista
          </Link>
        }
      />

      {!hayBase ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Modo demostración: sin base de datos conectada no hay listas de precios.
        </p>
      ) : null}

      {activas.length === 0 ? (
        <Vacio
          mensaje="No hay listas de precios"
          hint="Creá una (por ejemplo «Mayoristas» con 15% de descuento) y asignala a un cliente desde su ficha."
        />
      ) : (
        <ul className="space-y-2">
          {activas.map((l) => (
            <FilaLista key={l.id} lista={l} />
          ))}
        </ul>
      )}

      {deBaja.length > 0 ? (
        <details className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-700">
            Dadas de baja ({deBaja.length})
          </summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {deBaja.map((l) => (
              <li key={l.id}>
                <Link href={`/listas-precios/${l.id}`} className="block py-3 text-sm text-slate-600 hover:underline">
                  {l.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function FilaLista({ lista }: { lista: ListaListado }) {
  return (
    <li>
      <Link
        href={`/listas-precios/${lista.id}`}
        className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words font-medium text-slate-900">{lista.nombre}</p>
          <span className="shrink-0 rounded-md bg-marca-claro px-2 py-0.5 text-xs font-semibold tabular-nums text-marca-texto">
            {lista.descuentoPct.gt(0) ? `−${fmtNumero(lista.descuentoPct)}%` : "sin descuento"}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {lista.preciosEspecificos} {lista.preciosEspecificos === 1 ? "precio específico" : "precios específicos"} ·{" "}
          {lista.clientes} {lista.clientes === 1 ? "cliente" : "clientes"}
        </p>
      </Link>
    </li>
  );
}
