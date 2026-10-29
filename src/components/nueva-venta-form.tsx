"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { aMoneda, d, fmtMoneda, fmtNumero, fmtPorcentaje, type Dinero } from "@/lib/money";
import { registrarVenta } from "@/app/ventas/actions";
import {
  calcularMargen,
  costearLineaVenta,
  estadoPago,
  totalizarVenta,
  type Margen,
  type TotalesVenta,
} from "@/lib/costing";

/**
 * Carga de venta.
 *
 * Los numeros en pantalla salen del MISMO motor de costeo que usa el servidor
 * (`lib/costing.ts`), pero son informativos: al confirmar, el servidor recalcula
 * todo desde la base. Sin base de datos (modo demo) la venta se simula en
 * memoria y no se guarda nada.
 */

export type ComponenteDTO = {
  tipo: "MATERIAL" | "MAQUINA" | "MANO_OBRA";
  etiqueta: string;
  cantidad: string;
  costoUnitario: string;
  costoTotal: string;
};

/** Lo que viaja al navegador de cualquier usuario: nombre, precio e IVA. Sin costos. */
export type ArticuloDTO = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precioVenta: string;
  ivaPct: string;
  esServicio: boolean;
};

/** Solo para quien puede `verCostos`: el servidor no arma esto para nadie mas. */
export type ArticuloConCostosDTO = ArticuloDTO & {
  costoUnitario: string;
  recetaConfiable: boolean;
  receta: ComponenteDTO[];
};

export type ClienteDTO = {
  id: string;
  nombre: string;
  cuit: string | null;
};

type Linea = { id: string; articuloId: string; cantidad: string };

type LineaCalculada = {
  linea: Linea;
  articulo: ArticuloDTO;
  /** Costo y receta del articulo; `null` si el usuario no puede verlos. */
  costos: ArticuloConCostosDTO | null;
  cantidad: Dinero;
  /** Resultado crudo del motor de costeo: neto, IVA y total de la linea (el costo, solo con `costos`). */
  cal: ReturnType<typeof costearLineaVenta>;
  /** Margen de la linea; `null` si el usuario no puede verlo. */
  margen: Margen | null;
};

const METODOS = [
  { valor: "EFECTIVO", etiqueta: "Efectivo" },
  { valor: "TRANSFERENCIA", etiqueta: "Transferencia" },
  { valor: "TARJETA", etiqueta: "Tarjeta" },
  { valor: "OTRO", etiqueta: "Otro" },
] as const;

// Contador para los keys de React. No hace falta un UUID: las lineas de esta
// pantalla son efimeras, no se persisten.
let secuenciaLinea = 0;

function tieneCostos(a: ArticuloDTO | ArticuloConCostosDTO): a is ArticuloConCostosDTO {
  return "costoUnitario" in a;
}

type PropsNuevaVenta = {
  clientes: ClienteDTO[];
  esModoDemo?: boolean;
} & (
  | { verCostos: true; articulos: ArticuloConCostosDTO[] }
  // Sin permiso de ver costos el servidor ni arma los costos: solo precio, IVA y total.
  | { verCostos: false; articulos: ArticuloDTO[] }
);

export function NuevaVentaForm({ articulos, clientes, esModoDemo = false, verCostos }: PropsNuevaVenta) {
  const costosDe = (a: ArticuloDTO): ArticuloConCostosDTO | null =>
    verCostos && tieneCostos(a) ? a : null;
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [verReceta, setVerReceta] = useState<string | null>(null);
  const [modoCobro, setModoCobro] = useState<"TOTAL" | "PARCIAL">("TOTAL");
  const [montoParcial, setMontoParcial] = useState("");
  const [metodo, setMetodo] = useState<string>("EFECTIVO");
  const [observaciones, setObservaciones] = useState("");
  const [comprobante, setComprobante] = useState<Simulacion | null>(null);
  const [entregada, setEntregada] = useState(true);
  const [guardando, iniciarGuardado] = useTransition();
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);

  function cargarEjemploDemo() {
    // Solo artículos con receta: uno sin receta tiene costo 0 y mostraría un
    // margen inflado en la primera pantalla que ve el cliente.
    const costeados = articulos.filter((a) => costosDe(a)?.recetaConfiable);
    const a1 = costeados[0] ?? articulos[0];
    if (!a1) return;
    const a2 = costeados[1] ?? a1;
    if (clientes[0]) {
      setClienteId(clientes[0].id);
    }
    setLineas([
      { id: `l${++secuenciaLinea}`, articuloId: a1.id, cantidad: "2" },
      { id: `l${++secuenciaLinea}`, articuloId: a2.id, cantidad: "25" },
    ]);
    setObservaciones("Entrega coordinada para el viernes. Diseños aprobados.");
    setModoCobro("TOTAL");
  }

  function limpiarFormulario() {
    setLineas([]);
    setMontoParcial("");
    setObservaciones("");
    setModoCobro("TOTAL");
  }

  const porId = useMemo(() => new Map(articulos.map((a) => [a.id, a])), [articulos]);
  const cliente = clientes.find((c) => c.id === clienteId);

  const lineasCalculadas = useMemo<LineaCalculada[]>(() => {
    const salida: LineaCalculada[] = [];

    for (const linea of lineas) {
      const articulo = porId.get(linea.articuloId);
      if (!articulo) continue;

      const cantidad = d(linea.cantidad || "0");
      const costos = costosDe(articulo);
      const cal = costearLineaVenta({
        cantidad,
        precioUnitario: d(articulo.precioVenta),
        ivaPct: d(articulo.ivaPct),
        costoUnitario: d(costos?.costoUnitario ?? "0"),
      });

      salida.push({
        linea,
        articulo,
        costos,
        cantidad,
        cal,
        margen: costos
          ? calcularMargen({
              precioBruto: cal.subtotalBruto,
              costo: cal.costoTotalSnapshot,
              ivaPct: d(articulo.ivaPct),
              costoConfiable: costos.recetaConfiable,
            })
          : null,
      });
    }

    return salida;
    // `costosDe` solo depende de `verCostos`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, porId, verCostos]);

  // Los totales salen de `totalizarVenta`, el mismo helper que usa la version que
  // guarda. El IVA se acumula linea por linea a proposito: cada articulo tiene su
  // propia alicuota, y redondear la suma no siempre da lo mismo que sumar lo
  // redondeado.
  const totales: TotalesVenta = useMemo(
    () => totalizarVenta(lineasCalculadas.map((l) => l.cal)),
    [lineasCalculadas],
  );

  const cobrado =
    modoCobro === "TOTAL" ? totales.totalBruto : aMoneda(d(montoParcial || "0"));
  const saldo = aMoneda(totales.totalBruto.minus(cobrado));
  const hayLineas = lineasCalculadas.length > 0;

  const articulosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return articulos;
    return articulos.filter((a) => a.nombre.toLowerCase().includes(q));
  }, [articulos, busqueda]);

  const articulosYaCargados = useMemo(
    () => new Set(lineasCalculadas.map((l) => l.articulo.id)),
    [lineasCalculadas],
  );

  function agregar(articuloId: string) {
    // Tocar un articulo que ya esta en la venta suma 1 a la linea existente en
    // lugar de crear un renglon duplicado: es lo que uno espera en el mostrador.
    const existente = lineas.find((l) => l.articuloId === articuloId);
    if (existente) {
      setLineas(
        lineas.map((l) =>
          l.id === existente.id ? { ...l, cantidad: d(l.cantidad || "0").plus(1).toString() } : l,
        ),
      );
      return;
    }
    setLineas([...lineas, { id: `l${++secuenciaLinea}`, articuloId, cantidad: "1" }]);
  }

  function cambiarCantidad(id: string, valor: string) {
    // Se acepta cualquier texto: limpiar el campo a "" tiene que ser legal o el
    // input se traba en el celular en el momento de editar.
    setLineas(lineas.map((l) => (l.id === id ? { ...l, cantidad: valor } : l)));
  }

  function quitar(id: string) {
    setLineas(lineas.filter((l) => l.id !== id));
  }

  function confirmar() {
    const base = {
      cliente: cliente?.nombre ?? "",
      lineas: lineasCalculadas,
      totales,
      cobrado,
      metodo,
      estadoPago: estadoPago(totales.totalBruto, cobrado),
      observaciones,
      verCostos,
    };

    if (esModoDemo) {
      setComprobante({ ...base, numero: `${Math.floor(Math.random() * 900 + 100)}`, guardada: false, advertencias: [] });
      return;
    }

    setErrorGuardado(null);
    iniciarGuardado(async () => {
      const r = await registrarVenta({
        clienteId,
        observaciones,
        entregada,
        items: lineasCalculadas.map((l) => ({ articuloId: l.articulo.id, cantidad: l.linea.cantidad })),
        pago: cobrado.gt(0) ? { monto: cobrado.toString(), metodo: metodo as "EFECTIVO" } : null,
      });
      if (r.ok) {
        setComprobante({ ...base, numero: `${r.numero}/${r.anio}`, guardada: true, advertencias: r.advertencias, ventaId: r.id });
      } else {
        setErrorGuardado(r.error);
      }
    });
  }

  if (comprobante) {
    return (
      <ComprobanteSimulado
        sim={comprobante}
        onVolver={() => setComprobante(null)}
        onEmpezarDeNuevo={() => {
          setComprobante(null);
          setLineas([]);
          setMontoParcial("");
          setObservaciones("");
          setModoCobro("TOTAL");
        }}
      />
    );
  }

  return (
    <div className="space-y-6 pb-28">
      {esModoDemo ? (
        <BannerMockup
          onCargarEjemplo={cargarEjemploDemo}
          onLimpiar={limpiarFormulario}
          tieneLineas={lineas.length > 0}
          esModoDemo={esModoDemo}
        />
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
          Cliente
        </h2>
        <select aria-label="Cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {c.cuit ? ` · ${c.cuit}` : ""}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
          Agregar articulo
        </h2>
        <input
          type="search"
          aria-label="Buscar artículo en el catálogo"
          placeholder="Buscar en el catalogo"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="mb-2"
        />

        <ul className="flex flex-wrap gap-2">
          {articulosFiltrados.map((a) => {
            const yaCargado = articulosYaCargados.has(a.id);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => agregar(a.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm font-medium cursor-pointer touch-manipulation active:scale-95 transition-transform ${
                    yaCargado
                      ? "border-marca bg-marca-claro text-marca-texto"
                      : "border-slate-300 bg-white text-slate-800"
                  }`}
                >
                  <span>{a.nombre}</span>
                  <span className="text-slate-500">{fmtMoneda(a.precioVenta)}</span>
                  {costosDe(a) && !costosDe(a)?.recetaConfiable ? (
                    <span className="text-xs font-semibold text-amber-700">sin receta</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {articulosFiltrados.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Ningún artículo coincide con la búsqueda.</p>
        ) : null}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
            Detalle
          </h2>
          <span className="text-sm text-slate-600">
            {lineasCalculadas.length}{" "}
            {lineasCalculadas.length === 1 ? "linea" : "lineas"}
          </span>
        </div>

        {lineasCalculadas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
            Todavía no agregaste nada.
          </p>
        ) : (
          <ul className="space-y-2">
            {lineasCalculadas.map((l) => (
              <li key={l.linea.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-900">{l.articulo.nombre}</p>
                  <button
                    type="button"
                    onClick={() => quitar(l.linea.id)}
                    aria-label={`Quitar ${l.articulo.nombre}`}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-xs font-semibold text-red-600"
                  >
                    Quitar
                  </button>
                </div>

                <div className={`mt-3 grid grid-cols-2 gap-3 ${l.margen ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor={`cant-${l.linea.id}`} className="text-xs">
                      Cantidad
                    </label>
                    <input
                      id={`cant-${l.linea.id}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={l.linea.cantidad}
                      onChange={(e) => cambiarCantidad(l.linea.id, e.target.value)}
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-700">Unitario</span>
                    <p className="py-2.5 text-sm tabular-nums text-slate-600">
                      {fmtMoneda(l.articulo.precioVenta)}
                    </p>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-700">Total</span>
                    <p className="py-2.5 text-sm font-semibold tabular-nums text-slate-900">
                      {fmtMoneda(l.cal.subtotalBruto)}
                    </p>
                  </div>
                  {l.margen ? (
                    <div>
                      <span className="mb-1 block text-xs font-medium text-slate-700">Ganancia</span>
                      <p
                        className={`py-2.5 text-sm font-semibold tabular-nums ${
                          l.margen.costoConfiable ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        {l.margen.costoConfiable
                          ? fmtMoneda(l.margen.ganancia)
                          : "costo desconocido"}
                      </p>
                    </div>
                  ) : null}
                </div>

                {l.margen && l.costos ? (
                  l.costos.recetaConfiable ? (
                    <p className="mt-2 text-xs text-slate-600">
                      Costo {fmtMoneda(l.cal.costoTotalSnapshot)} · margen{" "}
                      {fmtPorcentaje(l.margen.margenPct)} · markup{" "}
                      {fmtPorcentaje(l.margen.markupPct)}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-amber-700">
                      Este artículo no tiene receta: el costo real se está suponiendo 0 y el margen
                      que se ve es optimista.
                    </p>
                  )
                ) : null}

                {l.costos && l.costos.receta.length > 0 ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() =>
                        setVerReceta(verReceta === l.linea.id ? null : l.linea.id)
                      }
                      className="inline-flex min-h-11 items-center text-sm font-medium text-marca-texto"
                    >
                      {verReceta === l.linea.id ? "Ocultar receta" : "Ver receta"}
                    </button>
                    {verReceta === l.linea.id ? (
                      <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
                        {l.costos.receta.map((c, i) => (
                          <li key={i} className="text-xs text-slate-600">
                            {c.etiqueta}: {fmtNumero(c.cantidad)} × {fmtMoneda(c.costoUnitario)} ={" "}
                            {fmtMoneda(c.costoTotal)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
          Cobro
        </h2>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <Boton toggle activo={modoCobro === "TOTAL"} onClick={() => setModoCobro("TOTAL")}>
            Cobro total
          </Boton>
          <Boton toggle activo={modoCobro === "PARCIAL"} onClick={() => setModoCobro("PARCIAL")}>
            Pago parcial
          </Boton>
        </div>

        {modoCobro === "PARCIAL" ? (
          <div className="mb-3">
            <label htmlFor="monto-parcial">Monto que recibe ahora</label>
            <input
              id="monto-parcial"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={montoParcial}
              onChange={(e) => setMontoParcial(e.target.value)}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METODOS.map((m) => (
            <Boton key={m.valor} toggle activo={metodo === m.valor} onClick={() => setMetodo(m.valor)}>
              {m.etiqueta}
            </Boton>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
          <Fila
            etiqueta="Total de la venta"
            valor={fmtMoneda(totales.totalBruto)}
            fuerte
          />
          <Fila etiqueta="Cobrado ahora" valor={fmtMoneda(cobrado)} />
          <Fila
            etiqueta="Queda pendiente"
            valor={fmtMoneda(saldo)}
            fuerte
            tono={saldo.cmp(0) > 0 ? "amber" : "slate"}
          />
        </div>
      </section>

      <section>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm font-normal text-slate-700">
          <input
            type="checkbox"
            checked={entregada}
            onChange={(e) => setEntregada(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>
            Ya se entregó
            <span className="block text-slate-500">Si no, queda como pedido pendiente (el stock se descuenta igual).</span>
          </span>
        </label>
      </section>

      <section>
        <label htmlFor="obs">Observaciones</label>
        <textarea
          id="obs"
          rows={2}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Cómo se entrega, plazos, medidas... lo que necesites recordar"
        />
      </section>

      <BarraInferior
        total={totales.totalBruto}
        ganancia={verCostos ? totales.ganancia : null}
        margenPct={verCostos ? totales.margenPct : null}
        habilitado={hayLineas && clienteId !== "" && !guardando}
        guardando={guardando}
        error={errorGuardado}
        onConfirmar={confirmar}
      />
    </div>
  );
}

type Simulacion = {
  numero: string;
  /** true = ya esta en la base; false = simulacion del modo demo. */
  guardada: boolean;
  advertencias: string[];
  ventaId?: string;
  cliente: string;
  lineas: LineaCalculada[];
  totales: TotalesVenta;
  cobrado: Dinero;
  metodo: string;
  estadoPago: ReturnType<typeof estadoPago>;
  observaciones: string;
  /** El usuario puede ver costo y ganancia en el comprobante. */
  verCostos: boolean;
};

function ComprobanteSimulado({
  sim,
  onVolver,
  onEmpezarDeNuevo,
}: {
  sim: Simulacion;
  onVolver: () => void;
  onEmpezarDeNuevo: () => void;
}) {
  const etiquetaPago = {
    AL_DIA: "Al día",
    PARCIAL: "Pago parcial",
    PENDIENTE: "Sin cobrar",
    PAGADA: "Pagada",
  }[sim.estadoPago];

  return (
    <div className="space-y-4">
      {sim.guardada ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Venta guardada.</p>
          <p className="mt-1 text-sm text-emerald-800">Se descontó el stock de los materiales.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Así quedaría el comprobante interno.</p>
          <p className="mt-1 text-sm text-amber-800">
            Esto se generó en memoria: no se guardó nada en la base ni se descontó stock.
          </p>
        </div>
      )}

      {sim.advertencias.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Revisá el stock</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
            {sim.advertencias.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
        <div className="border-b border-dashed border-slate-300 p-4 text-center">
          <p className="text-xs tracking-wide text-slate-600 uppercase">Comprobante interno</p>
          <p className="text-lg font-semibold text-slate-900">Nº {sim.numero}</p>
          <p className="text-sm text-slate-600">{sim.cliente}</p>
        </div>

        <ul className="divide-y divide-slate-100">
          {sim.lineas.map((l) => (
            <li key={l.linea.id} className="p-4">
              <div className="flex justify-between gap-3">
                <p className="font-medium text-slate-900">{l.articulo.nombre}</p>
                <p className="font-semibold tabular-nums text-slate-900">
                  {fmtMoneda(l.cal.subtotalBruto)}
                </p>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {fmtNumero(l.cantidad)} × {fmtMoneda(l.articulo.precioVenta)}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-1 border-t border-slate-200 p-4 text-sm">
          <Fila etiqueta="Neto" valor={fmtMoneda(sim.totales.totalNeto)} />
          <Fila etiqueta="IVA" valor={fmtMoneda(sim.totales.totalIVA)} />
          <Fila etiqueta="Total" valor={fmtMoneda(sim.totales.totalBruto)} fuerte />
          {sim.verCostos ? (
            <>
              <Fila etiqueta="Costo" valor={fmtMoneda(sim.totales.costoTotal)} />
              <Fila
                etiqueta="Ganancia"
                valor={`${fmtMoneda(sim.totales.ganancia)} (${fmtPorcentaje(sim.totales.margenPct)})`}
                fuerte
                tono="green"
              />
            </>
          ) : null}
        </div>

        <div className="border-t border-dashed border-slate-300 p-4 text-sm">
          <Fila
            etiqueta="Cobrado"
            valor={`${fmtMoneda(sim.cobrado)} · ${sim.metodo.toLowerCase()}`}
          />
          <Fila
            etiqueta="Estado"
            valor={etiquetaPago}
            fuerte
            tono={estadoPago(sim.totales.totalBruto, sim.cobrado) === "PAGADA" ? "green" : "amber"}
          />
        </div>

        {sim.observaciones ? (
          <p className="border-t border-slate-100 p-4 text-sm text-slate-600">
            {sim.observaciones}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={onEmpezarDeNuevo}
          className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cargar otra venta
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Imprimir comprobante
        </button>
        <Link
          href={sim.ventaId ? `/ventas/${sim.ventaId}` : "/ventas"}
          className="rounded-lg bg-marca px-4 py-3 text-center text-sm font-semibold text-tinta hover:opacity-90"
        >
          {sim.ventaId ? "Ver la venta" : "Volver a ventas"}
        </Link>
      </div>

      {sim.guardada ? null : (
        <button
          type="button"
          onClick={onVolver}
          className="min-h-11 w-full text-sm text-slate-600 hover:underline"
        >
          Volver a editar la venta
        </button>
      )}
    </div>
  );
}

function BannerMockup({
  onCargarEjemplo,
  onLimpiar,
  tieneLineas,
  esModoDemo = false,
}: {
  onCargarEjemplo: () => void;
  onLimpiar: () => void;
  tieneLineas: boolean;
  esModoDemo?: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">
              {esModoDemo ? "Mockup con catálogo demo" : "Mockup interactivo"}
            </span>
            <p className="text-sm font-semibold text-amber-900">Simulación en vivo (no guarda en base)</p>
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Los cálculos de costo, alícuotas de IVA y márgenes se computan en tiempo real según las recetas.
            Podés seleccionar artículos, modificar cantidades y simular la emisión del comprobante.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!tieneLineas ? (
            <button
              type="button"
              onClick={onCargarEjemplo}
              className="min-h-11 rounded-lg bg-amber-800 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-amber-900"
            >
              <span aria-hidden="true">⚡</span> Cargar ejemplo demo
            </button>
          ) : (
            <button
              type="button"
              onClick={onLimpiar}
              className="min-h-11 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              Limpiar líneas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BarraInferior({
  total,
  ganancia,
  margenPct,
  habilitado,
  guardando,
  error,
  onConfirmar,
}: {
  total: Dinero;
  /** `null` si el usuario no puede ver ganancia ni margen. */
  ganancia: Dinero | null;
  margenPct: Dinero | null;
  habilitado: boolean;
  guardando: boolean;
  error: string | null;
  onConfirmar: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:bottom-0">
      {error ? (
        <p role="alert" className="mx-auto max-w-5xl bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-lg leading-tight font-semibold tabular-nums text-slate-900">
            {fmtMoneda(total)}
          </p>
          {ganancia && margenPct ? (
            <p className="text-xs tabular-nums text-emerald-700">
              ganancia {fmtMoneda(ganancia)} · {fmtPorcentaje(margenPct)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={!habilitado}
          className="shrink-0 rounded-lg bg-marca px-5 py-3 text-sm font-semibold text-tinta disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {guardando ? "Guardando…" : "Guardar venta"}
        </button>
      </div>
    </div>
  );
}

function Boton({
  children,
  toggle,
  activo,
  onClick,
}: {
  children: React.ReactNode;
  toggle?: boolean;
  activo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={toggle ? !!activo : undefined}
      className={`rounded-lg border px-3 py-3 text-sm font-medium cursor-pointer touch-manipulation active:scale-95 transition-transform ${
        toggle
          ? activo
            ? "border-marca bg-marca text-tinta"
            : "border-slate-300 bg-white text-slate-700"
          : "border-slate-300 bg-white text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function Fila({
  etiqueta,
  valor,
  fuerte,
  tono = "slate",
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
  tono?: "slate" | "amber" | "green";
}) {
  const color = { slate: "text-slate-900", amber: "text-amber-700", green: "text-emerald-700" }[tono];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-500">{etiqueta}</span>
      <span className={`tabular-nums ${fuerte ? `font-semibold ${color}` : "text-slate-700"}`}>
        {valor}
      </span>
    </div>
  );
}
