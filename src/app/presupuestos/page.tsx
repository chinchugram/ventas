import Link from "next/link";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import { ESTILO_ESTADO, ETIQUETA_ESTADO, numeroPresupuesto } from "@/lib/presupuestos";
import { filtroValido, getPresupuestos, type FiltroPresupuesto } from "@/lib/queries/presupuestos";
import { Seccion, Vacio } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { SinBase } from "./_componentes/sin-base";

export const dynamic = "force-dynamic";

const FILTROS: { clave: FiltroPresupuesto; etiqueta: string }[] = [
  { clave: "todos", etiqueta: "Todos" },
  { clave: "abierto", etiqueta: "Abiertos" },
  { clave: "vencido", etiqueta: "Vencidos" },
  { clave: "convertido", etiqueta: "Convertidos" },
  { clave: "anulado", etiqueta: "Anulados" },
];

export default async function PresupuestosPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const filtro = filtroValido((await searchParams).estado);
  const presupuestos = await getPresupuestos(filtro);

  if (estadoDemo().activo) {
    return (
      <>
        <Seccion titulo="Presupuestos" />
        <SinBase />
      </>
    );
  }

  return (
    <>
      <Seccion
        titulo="Presupuestos"
        descripcion="Precios acordados con el cliente, listos para convertir en venta"
        accion={
          <Link
            href="/presupuestos/nuevo"
            className="inline-flex min-h-11 items-center rounded-lg bg-marca px-4 text-sm font-semibold text-tinta"
          >
            Nuevo presupuesto
          </Link>
        }
      />

      <nav aria-label="Filtrar por estado" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <Link
            key={f.clave}
            href={f.clave === "todos" ? "/presupuestos" : `/presupuestos?estado=${f.clave}`}
            aria-current={filtro === f.clave ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium ${
              filtro === f.clave ? "border-tinta bg-tinta text-white" : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {f.etiqueta}
          </Link>
        ))}
      </nav>

      {presupuestos.length === 0 ? (
        <Vacio
          mensaje={filtro === "todos" ? "Todavía no hay presupuestos" : "No hay presupuestos con ese estado"}
          hint={filtro === "todos" ? "Armá el primero con el botón de arriba." : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {presupuestos.map((p) => (
            <li key={p.id}>
              <Link
                href={`/presupuestos/${p.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      N° {numeroPresupuesto(p.numero, p.anio)} · {p.clienteNombre}
                    </p>
                    <p className="text-sm text-slate-500">
                      {fmtFecha(p.fecha)} · válido hasta {fmtFecha(p.validoHasta)} · {p.lineas}{" "}
                      {p.lineas === 1 ? "línea" : "líneas"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[p.estado]}`}>
                    {ETIQUETA_ESTADO[p.estado]}
                  </span>
                </div>
                <p className="mt-2 text-lg font-semibold tabular-nums text-slate-900">{fmtMoneda(p.total)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
