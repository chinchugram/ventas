import Link from "next/link";
import { faltanteParaMinimo } from "@/lib/stock";
import { fmtMoneda, fmtMonedaCorta, fmtNumero, sumar } from "@/lib/money";
import { getMateriales, getMaterialesDeBaja, type MaterialDeBaja } from "@/lib/queries/materiales";
import { Seccion, Tarjeta, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

const ESTILO_ESTADO = {
  SIN_STOCK: "bg-red-50 text-red-700",
  BAJO: "bg-amber-50 text-amber-700",
  OK: "bg-slate-100 text-slate-600",
} as const;

const TEXTO_ESTADO = {
  SIN_STOCK: "Sin stock",
  BAJO: "Bajo mínimo",
  OK: "OK",
} as const;

const BOTON_SECUNDARIO = "inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700";

export default async function MaterialesPage({ searchParams }: { searchParams: Promise<{ bajas?: string }> }) {
  const verBajas = (await searchParams).bajas === "1";
  const [materiales, deBaja] = await Promise.all([getMateriales(), getMaterialesDeBaja()]);

  const acciones = (
    <div className="flex flex-wrap gap-2">
      <Link href="/reposicion" className={BOTON_SECUNDARIO}>
        Reposición
      </Link>
      <Link href="/compras/nueva" className={BOTON_SECUNDARIO}>
        Registrar compra
      </Link>
      <Link href="/materiales/nuevo" className="inline-flex min-h-11 items-center rounded-lg bg-marca px-3 text-sm font-semibold text-tinta">
        Nuevo material
      </Link>
    </div>
  );

  if (verBajas) {
    return (
      <>
        <Seccion
          titulo="Materiales dados de baja"
          descripcion="No se ofrecen en compras nuevas; conservan su historial"
          accion={
            <Link href="/materiales" className={BOTON_SECUNDARIO}>
              Volver
            </Link>
          }
        />
        <ListaDeBajas materiales={deBaja} />
      </>
    );
  }

  if (materiales.length === 0) {
    return (
      <>
        <Seccion titulo="Materiales" accion={acciones} />
        <Vacio
          mensaje="No hay materiales cargados"
          hint="Los materiales son la base del costeo: sin ellos, las recetas no tienen costo."
        />
        <LinkBajas cantidad={deBaja.length} />
      </>
    );
  }

  const valorTotal = sumar(...materiales.map((m) => m.valorInventario));
  const alertas = materiales.filter((m) => m.estado !== "OK");

  return (
    <>
      <Seccion
        titulo="Materiales"
        descripcion="Lo que se consume para producir, y lo que se vende suelto"
        accion={acciones}
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Valor en stock" valor={fmtMonedaCorta(valorTotal)} detalle="a costo de compra" />
        <Tarjeta
          titulo="Necesitan reposición"
          valor={fmtNumero(alertas.length)}
          tono={alertas.length > 0 ? "aviso" : "ok"}
          detalle={
            alertas.length > 0 ? (
              <Link href="/reposicion" className="inline-flex min-h-11 items-center underline underline-offset-2">
                Ver qué comprar
              </Link>
            ) : undefined
          }
        />
      </div>

      <ul className="space-y-2">
        {materiales.map((m) => (
          <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/materiales/${m.id}`} className="inline-flex min-h-11 items-center font-medium text-slate-900 underline-offset-2 hover:underline">
                {m.nombre}
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[m.estado]}`}>
                  {TEXTO_ESTADO[m.estado]}
                </span>
                <Link
                  href={`/materiales/${m.id}/editar`}
                  aria-label={`Editar ${m.nombre}`}
                  className="-my-3 rounded-md px-2 py-3 text-sm font-medium text-marca-texto underline-offset-2 hover:underline"
                >
                  Editar
                </Link>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Stock</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">
                  {fmtNumero(m.stockActual)}{" "}
                  <span className="font-normal text-slate-500">{m.unidad}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Mínimo</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-500">
                  {m.stockMinimo.cmp(0) > 0 ? `${fmtNumero(m.stockMinimo)} ${m.unidad}` : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Costo unitario</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">
                  {fmtMoneda(m.costoUnitario)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Precio de venta</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">
                  {m.precioVenta ? fmtMoneda(m.precioVenta) : "solo insumo"}
                </dd>
              </div>
            </dl>

            {m.estado !== "OK" ? (
              <p className="mt-3 text-sm text-amber-700">
                Faltan {fmtNumero(faltanteParaMinimo(m.stockActual, m.stockMinimo))} {m.unidad} para llegar al mínimo.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <LinkBajas cantidad={deBaja.length} />
    </>
  );
}

function LinkBajas({ cantidad }: { cantidad: number }) {
  if (cantidad === 0) return null;
  return (
    <p className="mt-4 text-center text-sm">
      <Link href="/materiales?bajas=1" className="inline-flex min-h-11 items-center text-slate-600 underline underline-offset-2">
        Ver {cantidad === 1 ? "1 material dado de baja" : `${cantidad} materiales dados de baja`}
      </Link>
    </p>
  );
}

function ListaDeBajas({ materiales }: { materiales: MaterialDeBaja[] }) {
  if (materiales.length === 0) {
    return <Vacio mensaje="No hay materiales dados de baja" />;
  }
  return (
    <ul className="space-y-2">
      {materiales.map((m) => (
        <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 font-medium text-slate-700">{m.nombre}</p>
            <Link
              href={`/materiales/${m.id}/editar`}
              className="-my-3 shrink-0 rounded-md px-2 py-3 text-sm font-medium text-marca-texto underline-offset-2 hover:underline"
            >
              Ver / reactivar
            </Link>
          </div>
          <p className="mt-1 text-sm text-slate-500 tabular-nums">
            Stock {fmtNumero(m.stockActual)} {m.unidad} · costo {fmtMoneda(m.costoUnitario)}
          </p>
          {m.articulosQueLoUsan > 0 ? (
            <p className="mt-2 text-sm text-amber-700">
              {m.articulosQueLoUsan === 1
                ? "1 artículo activo todavía lo usa en la receta."
                : `${m.articulosQueLoUsan} artículos activos todavía lo usan en la receta.`}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
