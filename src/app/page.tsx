import Link from "next/link";
import { fmtFecha, fmtMonedaCorta as fmtMoneda, fmtNumero, fmtPorcentaje, type Dinero } from "@/lib/money";
import {
  getDeudas,
  getFacturadoPorDia,
  getResumenMes,
  getUltimasVentas,
  negocioDeLaSesion,
  type Alerta,
  type FacturadoDia,
} from "@/lib/queries/dashboard";
import { getArticulosConMargen, type ArticuloConMargen } from "@/lib/queries/catalogo";
import { getMateriales } from "@/lib/queries/materiales";
import { Seccion, SemaforoMargen, Tarjeta, Vacio } from "@/components/ui";
import { GananciaDelMes, VentasPorDia, type DiaVentas } from "@/components/tablero";
import { requierePermisoPagina } from "@/lib/permisos";

// El dashboard lee datos que cambian con cada venta: nunca se cachea ni se
// prerenderiza. Sin esto, `next build` intenta generar la pagina en build time
// contra una base de datos que en el servidor de build no existe.
export const dynamic = "force-dynamic";

const NOMBRES_MES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const ETIQUETA_ESTADO_PAGO = {
  AL_DIA: "Al día",
  PARCIAL: "Parcial",
  PENDIENTE: "Sin cobrar",
  PAGADA: "Pagada",
} as const;

export default async function Dashboard() {
  const usuario = await requierePermisoPagina("verCostos", "verMargenes");
  // El negocio sale de la sesion; todas las lecturas del dashboard corren dentro de ese negocio.
  const negocioId = await negocioDeLaSesion(usuario);
  const DIAS_GRAFICO = 14;
  const [resumen, ultimas, deudas, facturadoPorDia, articulos, materiales] = await Promise.all([
    getResumenMes(negocioId),
    getUltimasVentas(negocioId, 8),
    getDeudas(negocioId),
    getFacturadoPorDia(negocioId, primerDiaDelGrafico(DIAS_GRAFICO)),
    getArticulosConMargen(),
    getMateriales(),
  ]);

  const stockBajo = materiales.filter((m) => m.stockMinimo.cmp(0) > 0);

  // La meta de margen ya viene en el resumen (misma lectura, mismo negocio).
  const metaMargenPct = resumen.metaMargenPct;
  const alertas = detectarAlertas(articulos, stockBajo, resumen.cantidadVentas, metaMargenPct);
  const dias = ventasPorDia(facturadoPorDia, DIAS_GRAFICO);

  return (
    <>
      <Seccion
        titulo={`${NOMBRES_MES[resumen.mes - 1]} ${resumen.anio}`}
        descripcion={
          resumen.cantidadVentas === 0
            ? "Todavía no hay ventas registradas este mes"
            : `${resumen.cantidadVentas} ${resumen.cantidadVentas === 1 ? "venta" : "ventas"}`
        }
      />

      <GananciaDelMes
        ganancia={resumen.ganancia}
        margenPct={resumen.margenPct}
        metaPct={metaMargenPct}
      />

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta
          titulo="Facturado"
          valor={fmtMoneda(resumen.facturadoBruto)}
          detalle={`neto ${fmtMoneda(resumen.facturadoNeto)}`}
        />
        <Tarjeta
          titulo="Cobrado"
          valor={fmtMoneda(resumen.cobrado)}
          tono={resumen.cobrado.gte(resumen.facturadoBruto) ? "ok" : "neutro"}
          detalle={`IVA ${fmtMoneda(resumen.iva)}`}
        />
        <Tarjeta
          titulo="Costo"
          valor={fmtMoneda(resumen.costoTotal)}
          detalle="materiales + horas"
        />
        <Tarjeta
          titulo="Por cobrar"
          valor={fmtMoneda(resumen.pendienteCobro)}
          tono={resumen.pendienteCobro.cmp(0) > 0 ? "aviso" : "ok"}
          detalle={
            deudas.length > 0
              ? `${fmtNumero(deudas.length)} ${deudas.length === 1 ? "cliente" : "clientes"} con deuda`
              : "nadie debe nada"
          }
        />
      </div>

      <div className="mt-3">
        <VentasPorDia dias={dias} />
      </div>

      {alertas.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
            Para mirar
          </h2>
          <ul className="space-y-2">
            {alertas.map((a) => (
              <li
                key={a.mensaje + a.detalle}
                className={`rounded-xl border p-3 text-sm ${
                  a.severidad === "critica"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <span className="font-semibold">{a.mensaje}</span>{" "}
                <span className="opacity-80">{a.detalle}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
          Últimas ventas
        </h2>
        {ultimas.length === 0 ? (
          <Vacio
            mensaje="Todavía no hay ventas"
            hint="Registra la primera para empezar a ver el margen real."
          />
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {ultimas.map((v) => (
              <li key={v.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    #{v.numero} · {v.cliente.nombre}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtFecha(v.fecha)} · {ETIQUETA_ESTADO_PAGO[v.estadoPago]}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                    {fmtMoneda(v.totalBruto)}
                  </p>
                  <p className="text-xs tabular-nums text-slate-500">
                    margen {fmtMoneda(v.ganancia)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {deudas.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
            Quién debe
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {deudas.slice(0, 5).map((d) => (
              <li key={d.clienteId} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{d.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {d.ventasPendientes} {d.ventasPendientes === 1 ? "venta" : "ventas"} · desde{" "}
                    {fmtFecha(d.masAntigua)}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-amber-700">
                  {fmtMoneda(d.saldo)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {articulos.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
            Margen del catálogo
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {articulos.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{a.nombre}</p>
                  <p className="text-xs text-slate-500">
                    costo {fmtMoneda(a.receta.costoTotal)} · vende{" "}
                    {fmtMoneda(a.margen.precioBruto)}
                  </p>
                </div>
                <SemaforoMargen margenPct={a.margen.margenPct} metaPct={metaMargenPct} />
              </li>
            ))}
          </ul>
          <Link
            href="/catalogo"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-marca-texto hover:underline"
          >
            Ver catálogo completo →
          </Link>
        </section>
      )}
    </>
  );
}

/** Primer día (UTC, como se guarda `ventas.fecha`) que dibuja el gráfico de `cantidad` días. */
function primerDiaDelGrafico(cantidad: number): Date {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (cantidad - 1)));
}

/** Facturado por día en los últimos `cantidad` días, terminando hoy. */
function ventasPorDia(facturado: FacturadoDia[], cantidad: number): DiaVentas[] {
  const clave = (f: Date) =>
    `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;

  // Las fechas de venta se guardan como dia calendario en UTC (`dia` = "AAAA-MM-DD").
  // `total` es solo para dibujar la barra; la plata de verdad sigue siendo Decimal.
  const porDia = new Map<string, number>(facturado.map((f) => [f.dia, f.total.toNumber()]));

  const hoy = new Date();
  return Array.from({ length: cantidad }, (_, i) => {
    const f = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (cantidad - 1 - i));
    const k = clave(f);
    return { clave: k, dia: String(f.getDate()), total: porDia.get(k) ?? 0, hoy: i === cantidad - 1 };
  });
}

type MaterialConUmbral = {
  id: string;
  nombre: string;
  stockActual: Dinero;
  stockMinimo: Dinero;
  unidad: string;
};

/**
 * Alertas del dashboard. El criterio: un dato que el dueño no ve es un dato que
 * no existe. Se prioriza avisar sobre lo que NO se puede recuperar despues.
 */
function detectarAlertas(
  articulos: ArticuloConMargen[],
  stockBajo: MaterialConUmbral[],
  ventasDelMes: number,
  metaMargenPct: Dinero,
): Alerta[] {
  const alertas: Alerta[] = [];

  if (ventasDelMes === 0) {
    alertas.push({
      tipo: "SIN_RECETA",
      severidad: "aviso",
      mensaje: "Sin ventas este mes.",
      detalle: "O no se registró ninguna, o el sistema se está usando recién.",
    });
  }

  const sinReceta = articulos.filter((a) => !a.receta.confiable);
  if (sinReceta.length > 0) {
    alertas.push({
      tipo: "SIN_RECETA",
      severidad: "critica",
      mensaje: `${sinReceta.length} ${sinReceta.length === 1 ? "artículo" : "artículos"} sin receta.`,
      detalle: `Su margen real es desconocido: se está suponiendo costo 0. Ej: ${sinReceta
        .slice(0, 3)
        .map((a) => a.nombre)
        .join(", ")}.`,
    });
  }

  const bajoMargen = articulos.filter(
    (a) =>
      a.receta.confiable &&
      a.margen.margenPct.cmp(0) > 0 &&
      a.margen.margenPct.cmp(metaMargenPct) < 0,
  );
  if (bajoMargen.length > 0) {
    alertas.push({
      tipo: "BAJO_MARGEN",
      severidad: "aviso",
      mensaje: `${bajoMargen.length} ${bajoMargen.length === 1 ? "artículo" : "artículos"} por debajo de la meta de margen.`,
      detalle: bajoMargen
        .slice(0, 3)
        .map((a) => `${a.nombre} (${fmtPorcentaje(a.margen.margenPct)})`)
        .join(", "),
    });
  }

  for (const m of stockBajo) {
    if (m.stockActual.cmp(m.stockMinimo) <= 0) {
      const sinStock = m.stockActual.cmp(0) <= 0;
      alertas.push({
        tipo: "STOCK_BAJO",
        severidad: sinStock ? "critica" : "aviso",
        mensaje: sinStock ? `${m.nombre}: sin stock.` : `${m.nombre}: stock bajo.`,
        detalle: `${fmtNumero(m.stockActual)} ${m.unidad} disponibles (mínimo ${fmtNumero(m.stockMinimo)}).`,
      });
    }
  }

  return alertas;
}
