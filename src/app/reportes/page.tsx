import { fmtFecha, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPorcentaje, sumar } from "@/lib/money";
import {
  getConsumoMateriales,
  getDeudas,
  getGananciaPorProducto,
  getResumenPeriodo,
  negocioDeLaSesion,
  type TopProducto,
} from "@/lib/queries/dashboard";
import { getMateriales } from "@/lib/queries/materiales";
import { conRango, parseRangoFechas, rangoDeMes, type ParamsFecha } from "@/lib/rango-fechas";
import { Boton, Seccion, Tabla, Tarjeta, Vacio } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";
import { AvisosFiltro, FiltroFechas, Reporte } from "./_componentes/comunes";

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
  const usuario = await requierePermisoPagina("verReportes", "verCostos", "verMargenes");
  // El negocio sale de la sesion, nunca de la URL: `searchParams` solo trae el rango de fechas.
  const negocioId = await negocioDeLaSesion(usuario);
  const rango = parseRangoFechas(await searchParams);

  const [resumen, productos, deudas, consumo, materiales] = await Promise.all([
    getResumenPeriodo(negocioId, rango),
    getGananciaPorProducto(negocioId, rango),
    getDeudas(negocioId),
    getConsumoMateriales(negocioId, rango),
    getMateriales(),
  ]);

  const unidades = sumar(...productos.map((p) => p.unidades));
  const totalDeuda = sumar(...deudas.map((x) => x.saldo));
  const valorMateriales = sumar(...materiales.map((m) => m.valorInventario));
  const costoConsumo = sumar(...consumo.map((c) => c.costoEstimado));

  return (
    <>
      <Seccion
        epigrafe="Cómo viene el negocio"
        titulo="Reportes"
        descripcion={`Período: ${rango.etiqueta}`}
        accion={
          <div className="flex flex-wrap gap-3">
            <Boton href="/reportes/stock" variante="secundario">
              Reporte de stock
            </Boton>
            <Boton href="/reportes/margen-real" variante="secundario">
              Margen real
            </Boton>
          </div>
        }
      />

      <FiltroFechas rango={rango} ruta="/reportes" />

      <AvisosFiltro avisos={rango.avisos} />

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
          <Vacio mensaje="Ni una venta en el período." hint="Probá con otro mes o con un rango más largo." />
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
        titulo="3. Productos más rentables"
        descripcion="Ordenados por ganancia, no por unidades"
        badge="Por período"
        exportar={conRango("/reportes/export/productos-rentables", rango)}
      >
        {productos.length === 0 ? (
          <Vacio mensaje="Ni una venta en el período." hint="Probá con otro mes o con un rango más largo." />
        ) : (
          <ol className="space-y-2">
            {productos.slice(0, 5).map((p, i) => (
              <TopItem key={p.articuloId} posicion={i + 1} producto={p} />
            ))}
          </ol>
        )}
      </Reporte>

      <Reporte
        titulo="4. Deuda por cliente"
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
          <Vacio mensaje="Nadie te debe nada." hint="Todas las ventas están cobradas. Buen momento para un mate." />
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
        titulo="5. Consumo de materiales"
        descripcion="Lo que salió del stock por las ventas del período. El costo se estima con el costo actual de cada material."
        badge="Por período"
        exportar={conRango("/reportes/export/consumo-materiales", rango)}
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta titulo="Costo consumido" valor={fmtMonedaCorta(costoConsumo)} detalle="estimado" />
          <Tarjeta titulo="Valor en stock hoy" valor={fmtMonedaCorta(valorMateriales)} detalle="a hoy, no cambia con el período" />
        </div>
        {consumo.length === 0 ? (
          <Vacio mensaje="No salió ningún material en el período." hint="Cuando haya ventas con recetas, el consumo aparece acá." />
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
    <li className="tarjeta flex items-center gap-3 p-3">
      <span className="w-6 text-center font-mono text-mono font-semibold text-ink-muted">{posicion}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-ink">{p.nombre}</p>
        <p className="text-body-sm text-ink-muted">
          {fmtNumero(p.unidades)} unidades · margen {fmtPorcentaje(p.margenPct)}
        </p>
      </div>
      <p className="monto-fila text-ok-text">{fmtMoneda(p.ganancia)}</p>
    </li>
  );
}
