import { fmtMoneda, fmtMonedaCorta, fmtNumero, sumar } from "@/lib/money";
import { getMateriales } from "@/lib/queries/materiales";
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

export default async function MaterialesPage() {
  const materiales = await getMateriales();

  if (materiales.length === 0) {
    return (
      <>
        <Seccion titulo="Materiales" />
        <Vacio
          mensaje="No hay materiales cargados"
          hint="Los materiales son la base del costeo: sin ellos, las recetas no tienen costo."
        />
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
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Valor en stock" valor={fmtMonedaCorta(valorTotal)} detalle="a costo de compra" />
        <Tarjeta
          titulo="Necesitan reposición"
          valor={fmtNumero(alertas.length)}
          tono={alertas.length > 0 ? "aviso" : "ok"}
        />
      </div>

      <ul className="space-y-2">
        {materiales.map((m) => (
          <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-slate-900">{m.nombre}</p>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[m.estado]}`}
              >
                {TEXTO_ESTADO[m.estado]}
              </span>
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
          </li>
        ))}
      </ul>
    </>
  );
}
