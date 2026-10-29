import { construirCSV, type Celda } from "@/lib/csv";
import { sumar } from "@/lib/money";
import {
  getConsumoMateriales,
  getDeudas,
  getGananciaPorProducto,
  getResumenPeriodo,
} from "@/lib/queries/dashboard";
import {
  hoyEnArgentina,
  parseRangoFechas,
  type ParamsFecha,
  type RangoFechas,
} from "@/lib/rango-fechas";

export const dynamic = "force-dynamic";

/**
 * Export CSV de los reportes de /reportes (3.1c). Recibe los mismos parametros de
 * filtro que la pantalla (`?mes=AAAA-MM` o `?desde=..&hasta=..`) y los parsea con
 * `parseRangoFechas`, asi el archivo y la pantalla usan el mismo rango.
 *
 * Solo mapea lo que devuelven las consultas de `queries/dashboard.ts` a filas.
 * No hay calculo nuevo: lo unico que se suma es lo que la pantalla ya suma
 * (unidades del resumen), para que los totales coincidan.
 *
 * Las filas siguen el mismo orden y la misma seleccion que la pantalla: el
 * ranking de "productos rentables" son los 5 primeros, como en la pantalla.
 */

const TOP_RENTABLES = 5;

type Exportacion = {
  /** true: depende del rango del filtro. false: saldo a hoy (no recibe rango). */
  porPeriodo: boolean;
  generar: (rango: RangoFechas) => Promise<string>;
};

const EXPORTACIONES = new Map<string, Exportacion>([
  [
    "resumen",
    {
      porPeriodo: true,
      async generar(rango) {
        const [resumen, productos] = await Promise.all([
          getResumenPeriodo(rango),
          getGananciaPorProducto(rango),
        ]);
        const unidades = sumar(...productos.map((p) => p.unidades));
        return construirCSV(
          ["Concepto", "Valor"],
          [
            ["Período", rango.etiqueta],
            ["Ventas", String(resumen.cantidadVentas)],
            ["Unidades vendidas", { cantidad: unidades, decimales: 3 }],
            ["Facturado bruto", resumen.facturadoBruto],
            ["Facturado neto", resumen.facturadoNeto],
            ["IVA", resumen.iva],
            ["Costo total", resumen.costoTotal],
            ["Ganancia", resumen.ganancia],
            ["Margen %", resumen.facturadoBruto.isZero() ? null : { porcentaje: resumen.margenPct }],
            ["Cobrado en el período", resumen.cobrado],
            ["Pendiente de cobro (a hoy)", resumen.pendienteCobro],
          ],
        );
      },
    },
  ],
  [
    "ganancia-por-producto",
    {
      porPeriodo: true,
      async generar(rango) {
        const productos = await getGananciaPorProducto(rango);
        return construirCSV(
          ["Artículo", "Unidades", "Facturado", "Costo", "Ganancia", "Margen %"],
          productos.map((p) => [
            p.nombre,
            { cantidad: p.unidades, decimales: 3 },
            p.facturado,
            p.costo,
            p.ganancia,
            { porcentaje: p.margenPct },
          ]),
        );
      },
    },
  ],
  [
    "productos-rentables",
    {
      porPeriodo: true,
      async generar(rango) {
        const productos = await getGananciaPorProducto(rango);
        return construirCSV(
          ["Posición", "Artículo", "Unidades", "Ganancia", "Margen %"],
          productos.slice(0, TOP_RENTABLES).map((p, i) => [
            String(i + 1),
            p.nombre,
            { cantidad: p.unidades, decimales: 3 },
            p.ganancia,
            { porcentaje: p.margenPct },
          ]),
        );
      },
    },
  ],
  [
    "deuda-por-cliente",
    {
      porPeriodo: false,
      async generar() {
        const deudas = await getDeudas();
        return construirCSV(
          ["Cliente", "Teléfono", "Ventas pendientes", "Desde", "Debe"],
          deudas.map((x): Celda[] => [
            x.nombre,
            x.telefono,
            String(x.ventasPendientes),
            x.masAntigua,
            x.saldo,
          ]),
        );
      },
    },
  ],
  [
    "consumo-materiales",
    {
      porPeriodo: true,
      async generar(rango) {
        const consumo = await getConsumoMateriales(rango);
        return construirCSV(
          ["Material", "Unidad", "Consumido", "Costo estimado", "Stock hoy"],
          consumo.map((c) => [
            c.nombre,
            c.unidad,
            { cantidad: c.cantidad, decimales: 3 },
            c.costoEstimado,
            { cantidad: c.stockActual, decimales: 3 },
          ]),
        );
      },
    },
  ],
]);

/** searchParams de la URL → ParamsFecha, con la misma forma que entrega Next (array si se repite). */
function paramsDesde(url: URL): ParamsFecha {
  const params: ParamsFecha = {};
  for (const [clave, valor] of url.searchParams) {
    const previo = params[clave];
    params[clave] = previo === undefined ? valor : Array.isArray(previo) ? [...previo, valor] : [previo, valor];
  }
  return params;
}

/** "2026-10" para un mes, "2026-10-14_2026-10-23" para un rango. */
function periodoDe(rango: RangoFechas): string {
  return rango.tipo === "mes" ? rango.desdeISO.slice(0, 7) : `${rango.desdeISO}_${rango.hastaISO}`;
}

function texto404(): Response {
  return new Response("Reporte no encontrado", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ reporte: string }> }) {
  const { reporte } = await params;
  const exportacion = EXPORTACIONES.get(reporte);
  if (!exportacion) return texto404();

  const rango = parseRangoFechas(paramsDesde(new URL(request.url)));
  const csv = await exportacion.generar(rango);

  // Deuda no depende del periodo: el nombre lleva la fecha de hoy (Argentina).
  const periodo = exportacion.porPeriodo ? periodoDe(rango) : fechaHoy();

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reporte}-${periodo}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function fechaHoy(): string {
  const { anio, mes, dia } = hoyEnArgentina(new Date());
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
