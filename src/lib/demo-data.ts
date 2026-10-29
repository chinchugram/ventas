import { aMoneda, CERO, d, type Dinero, sumar } from "@/lib/money";
import {
  calcularMargen,
  costearLineaVenta,
  costearReceta,
  estadoPago,
  totalizarVenta,
  type ComponenteResuelto,
} from "@/lib/costing";
import type { ArticuloConMargen } from "@/lib/queries/catalogo";
import type { ClienteListado } from "@/lib/queries/clientes";
import type { DeudaCliente, ResumenMes, TopProducto, VentaListada } from "@/lib/queries/dashboard";
import type { MaterialListado } from "@/lib/queries/materiales";
import type { CompraListada, MovimientoListado } from "@/lib/queries/compras";
import { subtotalCompra } from "@/lib/stock";
import type { VentaRow } from "@/lib/queries/ventas";

/**
 * Datos de demostracion para cuando no hay base de datos.
 *
 * No son numeros escritos a mano: todo (costos, margenes, saldos, totales) sale
 * de las mismas funciones de `costing.ts` que usa la version con base. Asi las
 * pantallas son coherentes entre si y el mockup muestra el comportamiento real.
 */

export const DEMO_CONFIG: Record<string, string> = {
  nombreNegocio: "HL Laser",
  costoHoraManoObra: "3500",
  ivaPorDefecto: "21",
  margenObjetivo: "40",
};

const COSTO_HORA_MANO_OBRA = d(DEMO_CONFIG.costoHoraManoObra);
const IVA_PCT = d(21);

// ─── Clientes ─────────────────────────────────────────────────────────────────

const CLIENTES = [
  { id: "c1", nombre: "Ferretería El Tornillo", cuit: "30-71234567-1", telefono: "351 455-6677" },
  { id: "c2", nombre: "Café La Esquina", cuit: "20-34567890-6", telefono: "351 411-2233" },
  { id: "c3", nombre: "Estudio Weber", cuit: null, telefono: "351 622-0981" },
  { id: "c4", nombre: "Gimnasio Fuerza Total", cuit: "30-55555555-1", telefono: "351 733-4410" },
  { id: "c5", nombre: "Cervecería Patagonia", cuit: "30-68991234-2", telefono: "351 590-8812" },
] as const;

// ─── Materiales y maquinas ────────────────────────────────────────────────────

const MATERIALES = [
  { id: "m1", nombre: "Vinil adhesivo brillante", unidad: "m2", stock: "38", minimo: "10", costo: "4200", venta: "9800" },
  { id: "m2", nombre: "Transportador (vinil transfer)", unidad: "m2", stock: "6", minimo: "10", costo: "1400", venta: null },
  { id: "m3", nombre: "MDF 3mm", unidad: "m2", stock: "14", minimo: "8", costo: "8500", venta: null },
  { id: "m4", nombre: "Acrílico opalino 3mm", unidad: "m2", stock: "2.4", minimo: "3", costo: "24000", venta: "39000" },
  { id: "m5", nombre: "Cinta doble faz", unidad: "rollo", stock: "0", minimo: "2", costo: "3200", venta: null },
] as const;

const COSTO = {
  vinil: d("4200"),
  transportador: d("1400"),
  mdf: d("8500"),
  acrilico: d("24000"),
  laser: d("8000"),
  plotter: d("2500"),
  viniladora: d("1500"),
};

// ─── Articulos con receta ─────────────────────────────────────────────────────

type DefComponente = readonly [
  tipo: ComponenteResuelto["tipo"],
  etiqueta: string,
  cantidad: string,
  costoUnitario: Dinero,
];

const ARTICULOS: readonly {
  id: string;
  nombre: string;
  descripcion: string;
  precio: string;
  esServicio: boolean;
  receta: readonly DefComponente[];
}[] = [
  {
    id: "art-1",
    nombre: "Cartel en MDF 40x60 cm",
    descripcion: "Placa grabada a láser, para exhibidores y vidrieras.",
    precio: "28000",
    esServicio: false,
    receta: [
      ["MATERIAL", "MDF 3mm", "0.24", COSTO.mdf],
      ["MAQUINA", "Láser CO2", "0.3", COSTO.laser],
      ["MANO_OBRA", "Mano de obra", "0.4", COSTO_HORA_MANO_OBRA],
    ],
  },
  {
    id: "art-2",
    nombre: "Sticker en vinil 10x15 cm",
    descripcion: "Vinil adhesivo + corte + aplicación. Precio por unidad.",
    precio: "3500",
    esServicio: false,
    receta: [
      ["MATERIAL", "Vinil adhesivo brillante", "0.02", COSTO.vinil],
      ["MATERIAL", "Transportador (vinil transfer)", "0.02", COSTO.transportador],
      ["MAQUINA", "Plotter de impresión", "0.1", COSTO.plotter],
      ["MAQUINA", "Viniladora", "0.17", COSTO.viniladora],
      ["MANO_OBRA", "Mano de obra", "0.25", COSTO_HORA_MANO_OBRA],
    ],
  },
  {
    id: "art-3",
    nombre: "Rótulo luminoso en acrílico",
    descripcion: "Acrílico opalino + vinil. Para frentes de local.",
    precio: "65000",
    esServicio: false,
    receta: [
      ["MATERIAL", "Acrílico opalino 3mm", "0.15", COSTO.acrilico],
      ["MATERIAL", "Vinil adhesivo brillante", "0.1", COSTO.vinil],
      ["MAQUINA", "Láser CO2", "0.2", COSTO.laser],
      ["MAQUINA", "Plotter de impresión", "0.1", COSTO.plotter],
      ["MANO_OBRA", "Mano de obra", "0.5", COSTO_HORA_MANO_OBRA],
    ],
  },
  {
    id: "art-4",
    nombre: "Vinil rotulado por m²",
    descripcion: "Incluye impresión, corte y aplicación. Precio por m².",
    precio: "18000",
    esServicio: false,
    receta: [
      ["MATERIAL", "Vinil adhesivo brillante", "1", COSTO.vinil],
      ["MATERIAL", "Transportador (vinil transfer)", "1", COSTO.transportador],
      ["MAQUINA", "Plotter de impresión", "0.2", COSTO.plotter],
      ["MAQUINA", "Viniladora", "0.3", COSTO.viniladora],
      ["MANO_OBRA", "Mano de obra", "0.5", COSTO_HORA_MANO_OBRA],
    ],
  },
  {
    id: "art-5",
    nombre: "Diseño de arte (por hora)",
    descripcion: "Diseño vectorial para plotter o láser.",
    precio: "12000",
    esServicio: true,
    receta: [],
  },
  {
    id: "art-6",
    nombre: "Placa de acrílico 20x30 cm",
    descripcion: "Placa cortada y pulida, con vinil de frente.",
    precio: "7500",
    esServicio: false,
    receta: [
      ["MATERIAL", "Acrílico opalino 3mm", "0.06", COSTO.acrilico],
      ["MAQUINA", "Láser CO2", "0.25", COSTO.laser],
      ["MANO_OBRA", "Mano de obra", "0.5", COSTO_HORA_MANO_OBRA],
    ],
  },
];

function construirArticulos(): ArticuloConMargen[] {
  return ARTICULOS.map((a) => {
    const receta = costearReceta(
      a.receta.map(([tipo, etiqueta, cantidad, costoUnitario], i) => ({
        id: `${a.id}-c${i + 1}`,
        tipo,
        etiqueta,
        cantidad: d(cantidad),
        costoUnitario,
        costoUnitarioOverride: false,
        notas: null,
      })),
      COSTO_HORA_MANO_OBRA,
    );
    const precioVenta = d(a.precio);
    return {
      id: a.id,
      nombre: a.nombre,
      descripcion: a.descripcion,
      precioVenta,
      ivaPct: IVA_PCT,
      esServicio: a.esServicio,
      receta,
      margen: calcularMargen({
        precioBruto: precioVenta,
        costo: receta.costoTotal,
        ivaPct: IVA_PCT,
        costoConfiable: receta.confiable,
      }),
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// ─── Ventas ───────────────────────────────────────────────────────────────────

type DefVenta = {
  numero: number;
  clienteId: string;
  /** Dias hacia atras desde hoy (mes actual) o fecha fija del mes anterior. */
  hace?: number;
  mesAnterior?: number;
  items: readonly (readonly [articuloId: string, cantidad: number])[];
  /** Fraccion cobrada: 1 = pagada, 0 = sin cobrar. */
  cobrado: number | string;
};

const VENTAS: readonly DefVenta[] = [
  { numero: 99, clienteId: "c1", mesAnterior: 8, items: [["art-1", 3]], cobrado: 1 },
  { numero: 100, clienteId: "c4", mesAnterior: 21, items: [["art-4", 5]], cobrado: "50000" },
  { numero: 101, clienteId: "c4", hace: 9, items: [["art-3", 1], ["art-1", 2], ["art-6", 2]], cobrado: 1 },
  { numero: 102, clienteId: "c5", hace: 6, items: [["art-4", 4], ["art-1", 1]], cobrado: 0 },
  { numero: 103, clienteId: "c2", hace: 4, items: [["art-3", 1]], cobrado: "30000" },
  { numero: 104, clienteId: "c1", hace: 2, items: [["art-1", 2]], cobrado: 1 },
  { numero: 105, clienteId: "c3", hace: 1, items: [["art-2", 40], ["art-5", 2]], cobrado: 1 },
];

type VentaDemo = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  estado: "PENDIENTE" | "ENTREGADA";
  clienteId: string;
  clienteNombre: string;
  clienteTelefono: string;
  items: { articuloId: string; cantidad: Dinero; subtotalBruto: Dinero; costoTotal: Dinero }[];
  totalNeto: Dinero;
  totalIVA: Dinero;
  totalBruto: Dinero;
  costoTotal: Dinero;
  pagado: Dinero;
};

function construirVentas(): VentaDemo[] {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth();
  const articulos = new Map(construirArticulos().map((a) => [a.id, a]));

  return VENTAS.map((def) => {
    const cliente = CLIENTES.find((c) => c.id === def.clienteId)!;

    // El mes actual se ancla a hoy; si hoy es dia 1-2, las ventas se juntan
    // en el dia 1 en vez de caer en el mes anterior y dejar el tablero vacio.
    const fecha = def.mesAnterior
      ? new Date(Date.UTC(anio, mes - 1, def.mesAnterior))
      : new Date(Date.UTC(anio, mes, Math.max(1, hoy.getDate() - (def.hace ?? 0))));

    const lineas = def.items.map(([articuloId, cantidad]) => {
      const a = articulos.get(articuloId)!;
      const linea = costearLineaVenta({
        cantidad: d(cantidad),
        precioUnitario: a.precioVenta,
        ivaPct: a.ivaPct,
        costoUnitario: a.receta.costoTotal,
      });
      return { articuloId, cantidad: d(cantidad), ...linea };
    });
    const totales = totalizarVenta(lineas);

    const pagado =
      typeof def.cobrado === "string"
        ? d(def.cobrado)
        : aMoneda(totales.totalBruto.times(def.cobrado));

    return {
      id: `v-${def.numero}`,
      numero: def.numero,
      anio: fecha.getUTCFullYear(),
      fecha,
      estado: pagado.gte(totales.totalBruto) ? ("ENTREGADA" as const) : ("PENDIENTE" as const),
      clienteId: cliente.id,
      clienteNombre: cliente.nombre,
      clienteTelefono: cliente.telefono,
      items: lineas.map((l) => ({
        articuloId: l.articuloId,
        cantidad: l.cantidad,
        subtotalBruto: l.subtotalBruto,
        costoTotal: l.costoTotalSnapshot,
      })),
      totalNeto: totales.totalNeto,
      totalIVA: totales.totalIVA,
      totalBruto: totales.totalBruto,
      costoTotal: totales.costoTotal,
      pagado,
    };
  }).sort((a, b) => b.fecha.getTime() - a.fecha.getTime() || b.numero - a.numero);
}

function saldoDe(v: VentaDemo): Dinero {
  const saldo = aMoneda(v.totalBruto.minus(v.pagado));
  return saldo.isNegative() ? CERO : saldo;
}

// ─── Consultas de demostracion (misma forma que las reales) ───────────────────

export function demoArticulos(): ArticuloConMargen[] {
  return construirArticulos();
}

export function demoMateriales(): MaterialListado[] {
  return MATERIALES.map((m) => {
    const stockActual = d(m.stock);
    const stockMinimo = d(m.minimo);
    return {
      id: m.id,
      nombre: m.nombre,
      unidad: m.unidad,
      stockActual,
      stockMinimo,
      costoUnitario: d(m.costo),
      precioVenta: m.venta ? d(m.venta) : null,
      valorInventario: aMoneda(stockActual.times(m.costo)),
      estado:
        stockActual.cmp(0) <= 0
          ? ("SIN_STOCK" as const)
          : stockActual.cmp(stockMinimo) <= 0
            ? ("BAJO" as const)
            : ("OK" as const),
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

const COMPRAS = [
  { id: "k1", haceDias: 3, proveedor: "Vinilos del Plata", comprobante: "0003-00014521", items: [{ m: "m1", cantidad: "20", costo: "4200" }, { m: "m2", cantidad: "6", costo: "1400" }] },
  { id: "k2", haceDias: 12, proveedor: "Acrílicos Córdoba", comprobante: null, items: [{ m: "m4", cantidad: "3", costo: "24000" }] },
  { id: "k3", haceDias: 25, proveedor: "Maderas Sur", comprobante: "0001-00008890", items: [{ m: "m3", cantidad: "10", costo: "8500" }] },
] as const;

function fechaHace(dias: number): Date {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dias));
}

export function demoCompras(): CompraListada[] {
  return COMPRAS.map((c) => {
    const items = c.items.map((i) => {
      const material = MATERIALES.find((m) => m.id === i.m)!;
      return {
        material: material.nombre,
        unidad: material.unidad,
        cantidad: d(i.cantidad),
        costoUnitario: d(i.costo),
      };
    });
    return {
      id: c.id,
      fecha: fechaHace(c.haceDias),
      proveedor: c.proveedor,
      comprobante: c.comprobante,
      total: sumar(...items.map((i) => subtotalCompra(i.cantidad, i.costoUnitario))),
      registradoPor: null,
      items,
    };
  });
}

/**
 * Movimientos de demostracion de un material: las compras demo que lo incluyen.
 * El saldo se reconstruye hacia atras desde el stock actual, para que el ultimo
 * movimiento cierre con lo que muestra la pantalla de materiales.
 */
export function demoMovimientos(materialId: string): MovimientoListado[] {
  const material = MATERIALES.find((m) => m.id === materialId);
  if (!material) return [];

  const entradas = COMPRAS.filter((c) => c.items.some((i) => i.m === materialId))
    .sort((a, b) => a.haceDias - b.haceDias)
    .map((c) => ({
      id: `${c.id}-${materialId}`,
      fecha: fechaHace(c.haceDias),
      cantidad: d(c.items.find((i) => i.m === materialId)!.cantidad),
      motivo: `Compra a ${c.proveedor}`,
    }));

  let saldo = d(material.stock);
  return entradas.map((e) => {
    const resultante = saldo;
    saldo = saldo.minus(e.cantidad);
    return { ...e, tipo: "COMPRA" as const, stockResultante: resultante, registradoPor: null };
  });
}

export function demoClientes(): ClienteListado[] {
  const ventas = construirVentas();
  return CLIENTES.map((c) => {
    const propias = ventas.filter((v) => v.clienteId === c.id);
    const facturado = sumar(...propias.map((v) => v.totalBruto));
    const saldo = sumar(...propias.map(saldoDe));
    return {
      id: c.id,
      nombre: c.nombre,
      cuit: c.cuit,
      telefono: c.telefono,
      ventas: propias.length,
      facturado: aMoneda(facturado),
      saldo,
      ultimaVenta: propias[0]?.fecha ?? null,
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function demoVentas(limite = 50): VentaRow[] {
  return construirVentas()
    .slice(0, limite)
    .map((v) => ({
      id: v.id,
      numero: v.numero,
      anio: v.anio,
      fecha: v.fecha,
      estado: v.estado,
      clienteId: v.clienteId,
      clienteNombre: v.clienteNombre,
      items: v.items.length,
      totalBruto: v.totalBruto,
      costoTotal: v.costoTotal,
      ganancia: aMoneda(v.totalBruto.minus(v.costoTotal)),
      pagado: v.pagado,
      saldo: saldoDe(v),
      estadoPago: estadoPago(v.totalBruto, v.pagado),
    }));
}

export function demoUltimasVentas(limite = 8): VentaListada[] {
  return demoVentas(limite).map((v) => ({
    id: v.id,
    numero: v.numero,
    anio: v.anio,
    fecha: v.fecha,
    estado: v.estado,
    cliente: { id: v.clienteId, nombre: v.clienteNombre },
    totalBruto: v.totalBruto,
    costoTotal: v.costoTotal,
    ganancia: v.ganancia,
    pagado: v.pagado,
    saldo: v.saldo,
    estadoPago: v.estadoPago,
  }));
}

export function demoDeudas(): DeudaCliente[] {
  const porCliente = new Map<string, DeudaCliente>();

  // Orden ascendente por fecha: la primera venta con saldo es la mas antigua.
  for (const v of [...construirVentas()].reverse()) {
    const saldo = saldoDe(v);
    if (saldo.lte(d("0.01"))) continue;

    const actual = porCliente.get(v.clienteId);
    if (actual) {
      actual.saldo = aMoneda(actual.saldo.plus(saldo));
      actual.ventasPendientes += 1;
    } else {
      porCliente.set(v.clienteId, {
        clienteId: v.clienteId,
        nombre: v.clienteNombre,
        telefono: v.clienteTelefono,
        saldo,
        ventasPendientes: 1,
        masAntigua: v.fecha,
      });
    }
  }

  return [...porCliente.values()].sort((a, b) => b.saldo.cmp(a.saldo));
}

export function demoPendienteTotal(): Dinero {
  return aMoneda(sumar(...construirVentas().map(saldoDe)));
}

function enMes(fecha: Date, anio: number, mes: number): boolean {
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() + 1 === mes;
}

export function demoResumenMes(fechaReferencia: Date): ResumenMes {
  const anio = fechaReferencia.getFullYear();
  const mes = fechaReferencia.getMonth() + 1;
  const ventas = construirVentas().filter((v) => enMes(v.fecha, anio, mes));

  const facturadoBruto = sumar(...ventas.map((v) => v.totalBruto));
  const costoTotal = sumar(...ventas.map((v) => v.costoTotal));
  const ganancia = aMoneda(facturadoBruto.minus(costoTotal));

  return {
    anio,
    mes,
    cantidadVentas: ventas.length,
    facturadoBruto: aMoneda(facturadoBruto),
    facturadoNeto: aMoneda(sumar(...ventas.map((v) => v.totalNeto))),
    iva: aMoneda(sumar(...ventas.map((v) => v.totalIVA))),
    costoTotal: aMoneda(costoTotal),
    ganancia,
    margenPct: facturadoBruto.isZero() ? CERO : d(ganancia.div(facturadoBruto).times(100)),
    cobrado: aMoneda(sumar(...ventas.map((v) => v.pagado))),
    pendienteCobro: demoPendienteTotal(),
    metaMargenPct: d(DEMO_CONFIG.margenObjetivo),
  };
}

export function demoGananciaPorProducto(desde: Date, hasta: Date): TopProducto[] {
  const nombres = new Map(ARTICULOS.map((a) => [a.id, a.nombre]));
  const acumulado = new Map<string, { unidades: Dinero; facturado: Dinero; costo: Dinero }>();

  for (const v of construirVentas()) {
    if (v.fecha < desde || v.fecha >= hasta) continue;
    for (const item of v.items) {
      const previo = acumulado.get(item.articuloId) ?? { unidades: CERO, facturado: CERO, costo: CERO };
      acumulado.set(item.articuloId, {
        unidades: previo.unidades.plus(item.cantidad),
        facturado: previo.facturado.plus(item.subtotalBruto),
        costo: previo.costo.plus(item.costoTotal),
      });
    }
  }

  return [...acumulado.entries()]
    .map(([articuloId, a]) => {
      const facturado = aMoneda(a.facturado);
      const costo = aMoneda(a.costo);
      const ganancia = aMoneda(facturado.minus(costo));
      return {
        articuloId,
        nombre: nombres.get(articuloId) ?? "Articulo eliminado",
        unidades: a.unidades,
        facturado,
        costo,
        ganancia,
        margenPct: facturado.isZero() ? CERO : d(ganancia.div(facturado).times(100)),
      };
    })
    .sort((a, b) => b.ganancia.cmp(a.ganancia));
}
