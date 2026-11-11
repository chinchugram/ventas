import Link from "next/link";
import { fmtNumero } from "@/lib/money";
import { getListasPrecios, type ListaListado } from "@/lib/queries/listas-precios";
import { dbDisponible } from "@/lib/prisma";
import { requierePermisoPagina } from "@/lib/permisos";
import { Aviso, Boton, Etiqueta, Plegable, Seccion, Vacio } from "@/components/ui";

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
        epigrafe="Precios por cliente"
        titulo="Listas de precios"
        descripcion="Precios distintos para ciertos clientes"
        accion={<Boton href="/listas-precios/nueva">Nueva lista</Boton>}
      />

      {!hayBase ? (
        <Aviso tono="aviso" titulo="Modo demostración" className="mb-4">
          Sin base de datos conectada no hay listas de precios.
        </Aviso>
      ) : null}

      {activas.length === 0 ? (
        <Vacio
          mensaje="Todavía no hay listas de precios."
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
        <Plegable titulo={`Dadas de baja (${deBaja.length})`} className="mt-6">
          <ul className="divide-y-(length:--border-width) divide-line">
            {deBaja.map((l) => (
              <li key={l.id}>
                <Link href={`/listas-precios/${l.id}`} className="flex min-h-11 items-center px-4 text-body text-ink-muted hover:underline">
                  {l.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </Plegable>
      ) : null}
    </>
  );
}

function FilaLista({ lista }: { lista: ListaListado }) {
  return (
    <li>
      <Link href={`/listas-precios/${lista.id}`} className="tarjeta block p-4 hover:bg-surface-sunken">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-body font-semibold break-words text-ink">{lista.nombre}</p>
          <Etiqueta tono={lista.descuentoPct.gt(0) ? "marca" : "neutro"} className="shrink-0 tabular-nums">
            {lista.descuentoPct.gt(0) ? `−${fmtNumero(lista.descuentoPct)}%` : "sin descuento"}
          </Etiqueta>
        </div>
        <p className="mt-1 text-body-sm text-ink-muted">
          {lista.preciosEspecificos} {lista.preciosEspecificos === 1 ? "precio específico" : "precios específicos"} ·{" "}
          {lista.clientes} {lista.clientes === 1 ? "cliente" : "clientes"}
        </p>
      </Link>
    </li>
  );
}
