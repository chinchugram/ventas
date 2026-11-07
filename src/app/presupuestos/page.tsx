import Link from "next/link";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import { ETIQUETA_ESTADO, numeroPresupuesto, TONO_ESTADO } from "@/lib/presupuestos";
import { filtroValido, getPresupuestos, type FiltroPresupuesto } from "@/lib/queries/presupuestos";
import { Boton, Etiqueta, Seccion, Vacio } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { puede, requierePermisoPagina } from "@/lib/permisos";
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
  const usuario = await requierePermisoPagina("verPresupuestos");
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

  const puedeCargar = puede(usuario, "cargarPresupuesto");

  return (
    <>
      <Seccion
        epigrafe="Precios acordados"
        titulo="Presupuestos"
        descripcion="Precios acordados con el cliente, listos para convertir en venta"
        accion={
          // El boton de lo que el usuario no puede hacer ni se pinta (la pagina y la accion lo vuelven a exigir).
          puedeCargar ? <Boton href="/presupuestos/nuevo">Nuevo presupuesto</Boton> : undefined
        }
      />

      <nav aria-label="Filtrar por estado" className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.clave}
            href={f.clave === "todos" ? "/presupuestos" : `/presupuestos?estado=${f.clave}`}
            aria-current={filtro === f.clave ? "page" : undefined}
            className="chip"
          >
            {f.etiqueta}
          </Link>
        ))}
      </nav>

      {presupuestos.length === 0 ? (
        <Vacio
          mensaje={filtro === "todos" ? "Todavía no hay presupuestos." : "Ningún presupuesto con ese estado."}
          hint={
            filtro === "todos"
              ? puedeCargar
                ? "Armá el primero con el botón de arriba."
                : undefined
              : "Probá con otro filtro."
          }
        />
      ) : (
        <ul className="space-y-2">
          {presupuestos.map((p) => (
            <li key={p.id}>
              <Link href={`/presupuestos/${p.id}`} className="tarjeta block min-h-11 p-4 transition-colors duration-(--dur-rutina) hover:bg-surface-sunken">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-ink">
                      <span className="font-mono text-mono">N° {numeroPresupuesto(p.numero, p.anio)}</span> · {p.clienteNombre}
                    </p>
                    <p className="text-body-sm text-ink-muted">
                      {fmtFecha(p.fecha)} · válido hasta {fmtFecha(p.validoHasta)} · {p.lineas} {p.lineas === 1 ? "línea" : "líneas"}
                    </p>
                  </div>
                  <Etiqueta tono={TONO_ESTADO[p.estado]} className="shrink-0">
                    {ETIQUETA_ESTADO[p.estado]}
                  </Etiqueta>
                </div>
                <p className="monto mt-2 text-ink">{fmtMoneda(p.total)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
