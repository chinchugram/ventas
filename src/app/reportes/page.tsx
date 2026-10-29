import { fmtFecha, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPorcentaje, sumar } from "@/lib/money";
import { getGananciaPorProducto, type TopProducto } from "@/lib/queries/dashboard";
import { getMateriales } from "@/lib/queries/materiales";
import { getDeudas } from "@/lib/queries/dashboard";
import { MESES, rangoMes } from "@/lib/queries/ventas";
import { Seccion, Tabla, Tarjeta, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

const MES_ACTUAL = new Date().getMonth() + 1;
const ANIO_ACTUAL = new Date().getFullYear();

/**
 * Reportes. Los 5 que definio el alcance:
 *   1. Resumen del mes          (dashboard)
 *   2. Ganancia por producto    <- aca
 *   3. Deuda por cliente        <- aca
 *   4. Consumo de materiales    <- aca
 *   5. Productos mas vendidos  <- aca (top por ganancia)
 *
 * El selector de mes es un `searchParam`, no un estado de cliente: asi el dueño
 * puede mandar el link del reporte de enero por WhatsApp y funciona.
 */
export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; anio?: string }>;
}) {
  const params = await searchParams;

  const mes = clamp(parseInt(params.mes ?? "", 10) || MES_ACTUAL, 1, 12);
  const anio = clamp(parseInt(params.anio ?? "", 10) || ANIO_ACTUAL, 2000, 2100);

  const { desde, hasta } = rangoMes(anio, mes);

  const [productos, deudas, materiales] = await Promise.all([
    getGananciaPorProducto(desde, hasta),
    getDeudas(),
    getMateriales(),
  ]);

  const facturado = sumar(...productos.map((p) => p.facturado));
  const costo = sumar(...productos.map((p) => p.costo));
  const ganancia = facturado.minus(costo);
  const unidades = sumar(...productos.map((p) => p.unidades));
  const totalDeuda = sumar(...deudas.map((d) => d.saldo));
  const valorMateriales = sumar(...materiales.map((m) => m.valorInventario));

  return (
    <>
      <Seccion
        titulo="Reportes"
        descripcion={`${MESES[mes - 1]} ${anio}`}
        accion={<SelectorMes mes={mes} anio={anio} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta titulo="Facturado" valor={fmtMonedaCorta(facturado)} detalle={fmtNumero(unidades) + " unidades"} />
        <Tarjeta titulo="Costo" valor={fmtMonedaCorta(costo)} />
        <Tarjeta
          titulo="Ganancia"
          valor={fmtMonedaCorta(ganancia)}
          tono={ganancia.cmp(0) >= 0 ? "ok" : "critico"}
          detalle={`margen ${facturado.isZero() ? "-" : fmtPorcentaje(ganancia.div(facturado).times(100))}`}
        />
        <Tarjeta
          titulo="Deuda total"
          valor={fmtMonedaCorta(totalDeuda)}
          tono={totalDeuda.cmp(0) > 0 ? "aviso" : "ok"}
          detalle={`${deudas.length} clientes`}
        />
      </div>

      <Reporte titulo="2. Ganancia por producto" descripcion="Cuanto le sale, a cuanto lo vende y cuanto gana">
        {productos.length === 0 ? (
          <Vacio mensaje="Sin ventas en el periodo" />
        ) : (
          <Tabla
            columnas={["Articulo", "Unidades", "Facturado", "Costo", "Ganancia", "Margen"]}
            filas={productos.map((p) => [
              p.nombre,
              fmtNumero(p.unidades),
              fmtMoneda(p.facturado),
              fmtMoneda(p.costo),
              fmtMoneda(p.ganancia),
              fmtPorcentaje(p.margenPct),
            ])}
          />
        )}
      </Reporte>

      <Reporte titulo="5. Productos mas rentables" descripcion="Ordenados por ganancia, no por unidades">
        {productos.length === 0 ? (
          <Vacio mensaje="Sin datos" />
        ) : (
          <ol className="space-y-2">
            {productos.slice(0, 5).map((p, i) => (
              <li key={p.articuloId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <span className="w-6 text-center text-sm font-bold text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{p.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {fmtNumero(p.unidades)} unidades · margen {fmtPorcentaje(p.margenPct)}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-emerald-700">
                  {fmtMoneda(p.ganancia)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Reporte>

      <Reporte titulo="3. Deuda por cliente" descripcion="Quien debe, cuanto y desde cuando">
        {deudas.length === 0 ? (
          <Vacio mensaje="Nadie debe nada" hint="Todas las ventas estan cobradas." />
        ) : (
          <Tabla
            columnas={["Cliente", "Ventas", "Desde", "Debe"]}
            filas={deudas.map((d) => [
              d.nombre,
              fmtNumero(d.ventasPendientes),
              fmtFecha(d.masAntigua),
              fmtMoneda(d.saldo),
            ])}
          />
        )}
      </Reporte>

      <Reporte
        titulo="4. Materiales"
        descripcion="Cuanto hay parado en stock y que hay que reponer"
      >
        <div className="mb-3">
          <Tarjeta titulo="Valor total en materiales" valor={fmtMonedaCorta(valorMateriales)} />
        </div>
        {materiales.length === 0 ? (
          <Vacio mensaje="Sin materiales cargados" />
        ) : (
          <Tabla
            columnas={["Material", "Stock", "Costo unitario", "En stock", "Estado"]}
            filas={materiales.map((m) => [
              m.nombre,
              `${fmtNumero(m.stockActual)} ${m.unidad}`,
              fmtMoneda(m.costoUnitario),
              fmtMoneda(m.valorInventario),
              m.estado === "OK" ? "OK" : m.estado === "BAJO" ? "Bajo minimo" : "Sin stock",
            ])}
          />
        )}
      </Reporte>
    </>
  );
}

function Reporte({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-base font-semibold text-slate-900">{titulo}</h2>
      {descripcion ? <p className="mb-3 text-sm text-slate-500">{descripcion}</p> : null}
      {children}
    </section>
  );
}

/** Selector de mes: enlaces GET, sin JavaScript, funcionan sin conexion lenta. */
function SelectorMes({ mes, anio }: { mes: number; anio: number }) {
  const anterior = mes === 1 ? 12 : mes - 1;
  const anioAnterior = mes === 1 ? anio - 1 : anio;
  const siguiente = mes === 12 ? 1 : mes + 1;
  const anioSiguiente = mes === 12 ? anio + 1 : anio;

  const link = (m: number, a: number) => `/reportes?mes=${m}&anio=${a}`;

  return (
    <nav aria-label="Periodo" className="flex items-center gap-1">
      <a
        href={link(anterior, anioAnterior)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
      >
        &larr;
      </a>
      <span className="px-2 text-sm font-semibold text-slate-900">
        {MESES[mes - 1]} {anio}
      </span>
      <a
        href={link(siguiente, anioSiguiente)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
      >
        &rarr;
      </a>
    </nav>
  );
}

function clamp(valor: number, min: number, max: number): number {
  return Math.min(Math.max(valor, min), max);
}

export type { TopProducto };
