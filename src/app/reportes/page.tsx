import { fmtFecha, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPorcentaje, sumar } from "@/lib/money";
import {
  getConsumoMateriales,
  getDeudas,
  getGananciaPorProducto,
  getResumenPeriodo,
  type TopProducto,
} from "@/lib/queries/dashboard";
import { getMateriales } from "@/lib/queries/materiales";
import { conRango, parseRangoFechas, rangoDeMes, type ParamsFecha } from "@/lib/rango-fechas";
import { Seccion, Tabla, Tarjeta, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Reportes. Los 5 que definio el alcance:
 *   1. Resumen del período        (por período)
 *   2. Ganancia por producto      (por período)
 *   3. Deuda por cliente          (A HOY: saldo vivo, no se filtra)
 *   4. Consumo de materiales      (por período)
 *   5. Productos más rentables    (por período, top por ganancia)
 *
 * El filtro vive en la URL (`?mes=AAAA-MM` o `?desde=..&hasta=..`, ver
 * `lib/rango-fechas.ts`), no en estado de cliente: asi el dueño puede mandar el
 * link del reporte de enero por WhatsApp y funciona. Los formularios son GET.
 */
export default async function ReportesPage({ searchParams }: { searchParams: Promise<ParamsFecha> }) {
  const rango = parseRangoFechas(await searchParams);

  const [resumen, productos, deudas, consumo, materiales] = await Promise.all([
    getResumenPeriodo(rango),
    getGananciaPorProducto(rango),
    getDeudas(),
    getConsumoMateriales(rango),
    getMateriales(),
  ]);

  const unidades = sumar(...productos.map((p) => p.unidades));
  const totalDeuda = sumar(...deudas.map((x) => x.saldo));
  const valorMateriales = sumar(...materiales.map((m) => m.valorInventario));
  const costoConsumo = sumar(...consumo.map((c) => c.costoEstimado));

  return (
    <>
      <Seccion titulo="Reportes" descripcion={`Período: ${rango.etiqueta}`} />

      <FiltroFechas rango={rango} />

      {rango.avisos.length > 0 ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <ul className="space-y-1">
            {rango.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Reporte
        titulo="1. Resumen del período"
        descripcion={rango.etiqueta}
        badge="Por período"
        exportar={conRango("/reportes/export/resumen", rango)}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta
            titulo="Facturado"
            valor={fmtMonedaCorta(resumen.facturadoBruto)}
            detalle={`${fmtNumero(resumen.cantidadVentas)} ${resumen.cantidadVentas === 1 ? "venta" : "ventas"} · ${fmtNumero(unidades)} unidades`}
          />
          <Tarjeta titulo="Costo" valor={fmtMonedaCorta(resumen.costoTotal)} />
          <Tarjeta
            titulo="Ganancia"
            valor={fmtMonedaCorta(resumen.ganancia)}
            tono={resumen.ganancia.cmp(0) >= 0 ? "ok" : "critico"}
            detalle={`margen ${resumen.facturadoBruto.isZero() ? "-" : fmtPorcentaje(resumen.margenPct)}`}
          />
          <Tarjeta titulo="Cobrado en el período" valor={fmtMonedaCorta(resumen.cobrado)} />
        </div>
      </Reporte>

      <Reporte
        titulo="2. Ganancia por producto"
        descripcion="Cuánto le sale, a cuánto lo vende y cuánto gana"
        badge="Por período"
        exportar={conRango("/reportes/export/ganancia-por-producto", rango)}
      >
        {productos.length === 0 ? (
          <Vacio mensaje="Sin ventas en el período" />
        ) : (
          <Tabla
            columnas={["Artículo", "Unidades", "Facturado", "Costo", "Ganancia", "Margen"]}
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

      <Reporte
        titulo="5. Productos más rentables"
        descripcion="Ordenados por ganancia, no por unidades"
        badge="Por período"
        exportar={conRango("/reportes/export/productos-rentables", rango)}
      >
        {productos.length === 0 ? (
          <Vacio mensaje="Sin ventas en el período" />
        ) : (
          <ol className="space-y-2">
            {productos.slice(0, 5).map((p, i) => (
              <TopItem key={p.articuloId} posicion={i + 1} producto={p} />
            ))}
          </ol>
        )}
      </Reporte>

      <Reporte
        titulo="3. Deuda por cliente"
        descripcion="Quién debe, cuánto y desde cuándo. Es el saldo de hoy de todas las ventas, sin importar la fecha: no cambia con el período."
        badge="A hoy"
        exportar="/reportes/export/deuda-por-cliente"
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta
            titulo="Deuda total"
            valor={fmtMonedaCorta(totalDeuda)}
            tono={totalDeuda.cmp(0) > 0 ? "aviso" : "ok"}
            detalle={`${deudas.length} ${deudas.length === 1 ? "cliente" : "clientes"}`}
          />
        </div>
        {deudas.length === 0 ? (
          <Vacio mensaje="Nadie debe nada" hint="Todas las ventas están cobradas." />
        ) : (
          <Tabla
            columnas={["Cliente", "Ventas", "Desde", "Debe"]}
            filas={deudas.map((x) => [
              x.nombre,
              fmtNumero(x.ventasPendientes),
              fmtFecha(x.masAntigua),
              fmtMoneda(x.saldo),
            ])}
          />
        )}
      </Reporte>

      <Reporte
        titulo="4. Consumo de materiales"
        descripcion="Lo que salió del stock por las ventas del período. El costo se estima con el costo actual de cada material."
        badge="Por período"
        exportar={conRango("/reportes/export/consumo-materiales", rango)}
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta titulo="Costo consumido" valor={fmtMonedaCorta(costoConsumo)} detalle="estimado" />
          <Tarjeta titulo="Valor en stock hoy" valor={fmtMonedaCorta(valorMateriales)} detalle="a hoy, no cambia con el período" />
        </div>
        {consumo.length === 0 ? (
          <Vacio mensaje="Sin consumo de materiales en el período" />
        ) : (
          <Tabla
            columnas={["Material", "Consumido", "Costo estimado", "Stock hoy"]}
            filas={consumo.map((c) => [
              c.nombre,
              `${fmtNumero(c.cantidad)} ${c.unidad}`,
              fmtMoneda(c.costoEstimado),
              `${fmtNumero(c.stockActual)} ${c.unidad}`,
            ])}
          />
        )}
      </Reporte>
    </>
  );
}

function TopItem({ posicion, producto: p }: { posicion: number; producto: TopProducto }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <span className="w-6 text-center text-sm font-bold text-slate-400">{posicion}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{p.nombre}</p>
        <p className="text-xs text-slate-500">
          {fmtNumero(p.unidades)} unidades · margen {fmtPorcentaje(p.margenPct)}
        </p>
      </div>
      <p className="text-sm font-semibold tabular-nums text-emerald-700">{fmtMoneda(p.ganancia)}</p>
    </li>
  );
}

function Reporte({
  titulo,
  descripcion,
  badge,
  exportar,
  children,
}: {
  titulo: string;
  descripcion?: string;
  badge: "Por período" | "A hoy";
  /** Ruta del CSV de este reporte (ya con el filtro activo, si depende del período). */
  exportar?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            badge === "A hoy" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {badge}
        </span>
        {exportar ? (
          <a
            href={exportar}
            aria-label={`Exportar CSV: ${titulo}`}
            className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Exportar CSV
          </a>
        ) : null}
      </div>
      {descripcion ? <p className="mb-3 text-sm text-slate-500">{descripcion}</p> : null}
      {children}
    </section>
  );
}

const CLASE_INPUT = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const CLASE_BOTON =
  "min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700";

/**
 * Filtro de fechas: dos formularios GET independientes (mes, o desde/hasta). Van
 * separados a proposito: el parser da prioridad al rango, asi que un formulario
 * unico con los dos valores precargados haria imposible volver a elegir un mes.
 * Sin JavaScript: el navegador arma la URL.
 */
function FiltroFechas({ rango }: { rango: ReturnType<typeof parseRangoFechas> }) {
  const mesActual = rango.tipo === "mes" ? rango : null;
  const valorMes = mesActual ? rango.query.replace("mes=", "") : rango.desdeISO.slice(0, 7);

  // Flechas de mes anterior / siguiente: solo en modo mes.
  const anterior = mesActual ? (mesActual.mes === 1 ? rangoDeMes(mesActual.anio! - 1, 12) : rangoDeMes(mesActual.anio!, mesActual.mes! - 1)) : null;
  const siguiente = mesActual ? (mesActual.mes === 12 ? rangoDeMes(mesActual.anio! + 1, 1) : rangoDeMes(mesActual.anio!, mesActual.mes! + 1)) : null;

  return (
    <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <form method="get" action="/reportes" className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-40 text-xs font-medium text-slate-600">
          Mes
          <input type="month" name="mes" defaultValue={valorMes} min="2000-01" max="2100-12" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <button type="submit" className={CLASE_BOTON}>
          Ver mes
        </button>
        {anterior && siguiente ? (
          <span className="flex items-center gap-1">
            <a
              href={`/reportes?${anterior.query}`}
              aria-label={`Mes anterior: ${anterior.etiqueta}`}
              className="flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
            >
              &larr;
            </a>
            <a
              href={`/reportes?${siguiente.query}`}
              aria-label={`Mes siguiente: ${siguiente.etiqueta}`}
              className="flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
            >
              &rarr;
            </a>
          </span>
        ) : null}
      </form>

      <form method="get" action="/reportes" className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className="min-w-0 flex-1 basis-36 text-xs font-medium text-slate-600">
          Desde
          <input type="date" name="desde" defaultValue={rango.desdeISO} min="2000-01-01" max="2100-12-31" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <label className="min-w-0 flex-1 basis-36 text-xs font-medium text-slate-600">
          Hasta (incluido)
          <input type="date" name="hasta" defaultValue={rango.hastaISO} min="2000-01-01" max="2100-12-31" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <button type="submit" className={CLASE_BOTON}>
          Ver rango
        </button>
      </form>

      {rango.tipo === "rango" || !rango.porDefecto ? (
        <a href="/reportes" className="inline-block text-sm font-medium text-slate-600 underline">
          Volver al mes actual
        </a>
      ) : null}
    </div>
  );
}
