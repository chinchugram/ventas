"use client";

import { useEffect, useMemo, useState } from "react";
import { aMoneda, d, fmtMoneda, fmtNumero, fmtPorcentaje, type Dinero } from "@/lib/money";
import { registrarVenta } from "@/app/ventas/actions";
import { Aviso, BarraInferior, Boton, Chip, Etiqueta, Sticker, TituloBloque, Vacio } from "@/components/ui";
import { CampoCheckbox, CampoNotas, CampoSelect, useAccion } from "@/components/form";
import { preciosParaCliente, type PreciosCliente } from "@/app/ventas/nueva/actions";
import type { OrigenPrecio } from "@/lib/precios";
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
 *
 * Precios por cliente: al elegir cliente se pide al servidor el precio de cada
 * articulo segun su lista (`preciosParaCliente`, solo precios, nunca costos).
 * Es informativo: `registrarVenta` recalcula el precio al confirmar. En modo
 * demo no hay listas y se usa el precio de catalogo.
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
  /** Precio unitario que se cobra a este cliente (catalogo o lista). */
  precioUnitario: Dinero;
  origenPrecio: OrigenPrecio;
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
  // Momento al guardar (momentos.md): si entró plata es un cobro (caja registradora); si no, es una
  // venta guardada, silenciosa (solo el comprobante, que aparece con un salto). Si la venta deja el
  // margen del mes arriba de la meta, `useAccion` festeja el logro en lugar del cobro.
  const {
    pendiente: guardando,
    error: errorGuardado,
    enviar: enviarVenta,
  } = useAccion(registrarVenta, { momento: (_r, datos) => (datos.pago ? "cobro" : "guardado") });
  const [preciosCargados, setPreciosCargados] = useState<(PreciosCliente & { clienteId: string }) | null>(null);
  const [reintento, setReintento] = useState(0);

  // Precios del cliente elegido. Mientras llegan (o si fallan) no se deja guardar:
  // el comprobante muestra estos precios y tienen que ser los que va a usar el servidor.
  useEffect(() => {
    if (esModoDemo || !clienteId) return;
    let vigente = true;
    preciosParaCliente({ clienteId, articuloIds: articulos.map((a) => a.id) })
      .then((r) => vigente && setPreciosCargados({ ...r, clienteId }))
      .catch(
        () =>
          vigente &&
          setPreciosCargados({ ok: false, error: "Se cortó la comunicación con el servidor.", clienteId }),
      );
    return () => {
      vigente = false;
    };
  }, [clienteId, articulos, esModoDemo, reintento]);

  const preciosActuales = preciosCargados?.clienteId === clienteId ? preciosCargados : null;
  const repreciando = !esModoDemo && clienteId !== "" && preciosActuales === null;
  const errorPrecios = preciosActuales && !preciosActuales.ok ? preciosActuales.error : null;
  const listaCliente = preciosActuales?.ok ? preciosActuales.lista : null;

  /** Precio unitario del articulo para el cliente elegido. */
  function precioDe(articulo: ArticuloDTO): { precio: string; origen: OrigenPrecio } {
    const resuelto = preciosActuales?.ok ? preciosActuales.precios[articulo.id] : undefined;
    return resuelto ?? { precio: articulo.precioVenta, origen: "CATALOGO" };
  }

  const porId = useMemo(() => new Map(articulos.map((a) => [a.id, a])), [articulos]);
  const cliente = clientes.find((c) => c.id === clienteId);

  const lineasCalculadas = useMemo<LineaCalculada[]>(() => {
    const salida: LineaCalculada[] = [];

    for (const linea of lineas) {
      const articulo = porId.get(linea.articuloId);
      if (!articulo) continue;

      const cantidad = d(linea.cantidad || "0");
      const { precio, origen } = precioDe(articulo);
      const costos = costosDe(articulo);
      const cal = costearLineaVenta({
        cantidad,
        precioUnitario: d(precio),
        ivaPct: d(articulo.ivaPct),
        costoUnitario: d(costos?.costoUnitario ?? "0"),
      });

      salida.push({
        linea,
        articulo,
        costos,
        cantidad,
        precioUnitario: d(precio),
        origenPrecio: origen,
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
    // `costosDe` solo depende de `verCostos` y `precioDe` de `preciosActuales`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, porId, preciosActuales, verCostos]);

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

    enviarVenta(
      {
        clienteId,
        observaciones,
        entregada,
        items: lineasCalculadas.map((l) => ({ articuloId: l.articulo.id, cantidad: l.linea.cantidad })),
        pago: cobrado.gt(0) ? { monto: cobrado.toString(), metodo: metodo as "EFECTIVO" } : null,
      },
      (r) => setComprobante({ ...base, numero: `${r.numero}/${r.anio}`, guardada: true, advertencias: r.advertencias, ventaId: r.id }),
    );
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
      <section>
        <CampoSelect
          etiqueta="Cliente"
          valor={clienteId}
          alCambiar={setClienteId}
          opciones={clientes.map((c) => ({ valor: c.id, etiqueta: c.cuit ? `${c.nombre} · ${c.cuit}` : c.nombre }))}
        />
        {repreciando ? (
          <p role="status" className="mt-1 text-body-sm text-ink-muted">
            Actualizando precios…
          </p>
        ) : null}
        {errorPrecios ? (
          <p role="alert" className="mt-1 text-body-sm font-semibold text-critico-text">
            {errorPrecios} No pudimos traer los precios de este cliente.{" "}
            <button type="button" onClick={() => setReintento((n) => n + 1)} className="enlace inline-flex min-h-11 items-center">
              Reintentar
            </button>
          </p>
        ) : null}
        {listaCliente ? (
          <p className="mt-1 text-body-sm font-semibold text-brand-text">
            Lista de precios: {listaCliente.nombre}
            {d(listaCliente.descuentoPct).gt(0) ? ` (−${fmtNumero(listaCliente.descuentoPct)}%)` : ""}
          </p>
        ) : null}
      </section>

      <section>
        <TituloBloque className="mb-2">Agregar artículo</TituloBloque>
        <input
          type="search"
          aria-label="Buscar artículo en el catálogo"
          placeholder="Buscar en el catálogo"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="mb-3"
        />

        <ul className="flex flex-wrap gap-2">
          {articulosFiltrados.map((a) => {
            const yaCargado = articulosYaCargados.has(a.id);
            return (
              <li key={a.id}>
                <Chip activo={yaCargado} onClick={() => agregar(a.id)} className="touch-manipulation">
                  <span>{a.nombre}</span>
                  <span className="font-mono text-mono font-medium tabular-nums">{fmtMoneda(precioDe(a).precio)}</span>
                  {costosDe(a) && !costosDe(a)?.recetaConfiable ? <Etiqueta tono="aviso">sin receta</Etiqueta> : null}
                </Chip>
              </li>
            );
          })}
        </ul>

        {articulosFiltrados.length === 0 ? (
          <p className="mt-2 text-body-sm text-ink-muted">Ningún artículo coincide con la búsqueda.</p>
        ) : null}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <TituloBloque className="">Detalle</TituloBloque>
          <span className="text-body-sm text-ink-muted">
            {lineasCalculadas.length} {lineasCalculadas.length === 1 ? "línea" : "líneas"}
          </span>
        </div>

        {lineasCalculadas.length === 0 ? (
          <Vacio mensaje="Todavía no agregaste nada." hint="Tocá un artículo del catálogo y se suma acá." />
        ) : (
          <ul className="space-y-2">
            {lineasCalculadas.map((l) => (
              <li key={l.linea.id} className="tarjeta p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-body font-semibold text-ink">{l.articulo.nombre}</p>
                  <Boton
                    variante="fantasma-peligro"
                    onClick={() => quitar(l.linea.id)}
                    aria-label={`Quitar ${l.articulo.nombre}`}
                    className="-mt-1 -mr-2 shrink-0 px-4"
                  >
                    Quitar
                  </Boton>
                </div>

                <div className={`mt-2 grid grid-cols-2 gap-3 ${l.margen ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor={`cant-${l.linea.id}`}>Cantidad</label>
                    <input
                      id={`cant-${l.linea.id}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={l.linea.cantidad}
                      onChange={(e) => cambiarCantidad(l.linea.id, e.target.value)}
                      className="tabular-nums"
                    />
                  </div>
                  <div>
                    <span className="eyebrow mb-1 block">Unitario</span>
                    <p className="text-body tabular-nums text-ink">{fmtMoneda(l.precioUnitario)}</p>
                    {l.origenPrecio !== "CATALOGO" ? (
                      <Etiqueta tono="marca" className="mt-1">
                        {l.origenPrecio === "ESPECIFICO" ? "precio de lista" : "con descuento"}
                      </Etiqueta>
                    ) : null}
                  </div>
                  <div>
                    <span className="eyebrow mb-1 block">Total</span>
                    <p className="monto-fila text-ink">{fmtMoneda(l.cal.subtotalBruto)}</p>
                  </div>
                  {l.margen ? (
                    <div>
                      <span className="eyebrow mb-1 block">Ganancia</span>
                      {l.margen.costoConfiable ? (
                        <p className="monto-fila text-ok-text">{fmtMoneda(l.margen.ganancia)}</p>
                      ) : (
                        <p className="text-body font-semibold text-aviso-text">costo desconocido</p>
                      )}
                    </div>
                  ) : null}
                </div>

                {l.margen && l.costos ? (
                  l.costos.recetaConfiable ? (
                    <p className="mt-3 text-body-sm text-ink-muted">
                      Costo {fmtMoneda(l.cal.costoTotalSnapshot)} · margen {fmtPorcentaje(l.margen.margenPct)} · markup{" "}
                      {fmtPorcentaje(l.margen.markupPct)}
                    </p>
                  ) : (
                    <Aviso tono="aviso" className="mt-3">
                      Este artículo no tiene receta, así que el costo figura en $0 y el margen se ve mejor de lo que es. Cargale la
                      receta para tener el número real.
                    </Aviso>
                  )
                ) : null}

                {l.costos && l.costos.receta.length > 0 ? (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => setVerReceta(verReceta === l.linea.id ? null : l.linea.id)}
                      aria-expanded={verReceta === l.linea.id}
                      className="enlace inline-flex min-h-11 items-center"
                    >
                      {verReceta === l.linea.id ? "Ocultar receta" : "Ver receta"}
                    </button>
                    {verReceta === l.linea.id ? (
                      <ul className="mt-1 space-y-1 border-l-(length:--border-width) border-line pl-3">
                        {l.costos.receta.map((c, i) => (
                          <li key={i} className="text-body-sm text-ink-muted tabular-nums">
                            {c.etiqueta}: {fmtNumero(c.cantidad)} × {fmtMoneda(c.costoUnitario)} = {fmtMoneda(c.costoTotal)}
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
        <TituloBloque className="mb-2">Cobro</TituloBloque>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <Chip activo={modoCobro === "TOTAL"} onClick={() => setModoCobro("TOTAL")}>
            Cobro total
          </Chip>
          <Chip activo={modoCobro === "PARCIAL"} onClick={() => setModoCobro("PARCIAL")}>
            Pago parcial
          </Chip>
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
              className="tabular-nums"
            />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METODOS.map((m) => (
            <Chip key={m.valor} activo={metodo === m.valor} onClick={() => setMetodo(m.valor)}>
              {m.etiqueta}
            </Chip>
          ))}
        </div>

        <div className="tarjeta mt-3 space-y-1 p-4">
          <Fila etiqueta="Total de la venta" valor={fmtMoneda(totales.totalBruto)} fuerte />
          <Fila etiqueta="Cobrado ahora" valor={fmtMoneda(cobrado)} />
          <Fila etiqueta="Queda pendiente" valor={fmtMoneda(saldo)} fuerte tono={saldo.cmp(0) > 0 ? "aviso" : "neutro"} />
        </div>
      </section>

      <section>
        <CampoCheckbox
          etiqueta="Ya se entregó"
          ayuda="Si no, queda como pedido pendiente (el stock se descuenta igual)."
          marcado={entregada}
          alCambiar={setEntregada}
        />
      </section>

      <section>
        <CampoNotas
          etiqueta="Observaciones"
          valor={observaciones}
          alCambiar={setObservaciones}
          filas={2}
          placeholder="Cómo se entrega, plazos, medidas… lo que necesites recordar"
        />
      </section>

      <BarraConfirmar
        total={totales.totalBruto}
        ganancia={verCostos ? totales.ganancia : null}
        margenPct={verCostos ? totales.margenPct : null}
        habilitado={hayLineas && clienteId !== "" && !guardando && !repreciando && !errorPrecios}
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
        <Aviso tono="ok" titulo={`Listo, la venta ${sim.numero} de ${sim.cliente} quedó guardada.`} role="status">
          Se descontó el stock de los materiales.
        </Aviso>
      ) : (
        <Aviso tono="aviso" titulo="Así quedaría el comprobante interno." role="status">
          Esto se armó en memoria: no se guardó nada en la base ni se descontó stock.
        </Aviso>
      )}

      {sim.advertencias.length > 0 ? (
        <Aviso tono="aviso" titulo="Revisá el stock" role="status">
          <ul className="list-disc pl-5">
            {sim.advertencias.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      <div className={`tarjeta overflow-hidden ${sim.guardada ? "animate-salto" : "animate-entrada"}`} data-momento={sim.guardada ? "turno" : undefined}>
        <div className="border-b-(length:--border-width) border-dashed border-line-strong p-4 text-center">
          <p className="eyebrow">Comprobante interno</p>
          <p className="font-display text-display-md text-ink">Nº {sim.numero}</p>
          <p className="text-body text-ink-muted">{sim.cliente}</p>
          <Sticker acento="cielo" girado className="mt-2">
            {sim.guardada ? "Guardada" : "Simulación"}
          </Sticker>
        </div>

        <ul className="divide-y-(length:--border-width) divide-line">
          {sim.lineas.map((l) => (
            <li key={l.linea.id} className="p-4">
              <div className="flex justify-between gap-3">
                <p className="text-body font-semibold text-ink">{l.articulo.nombre}</p>
                <p className="monto-fila text-ink">{fmtMoneda(l.cal.subtotalBruto)}</p>
              </div>
              <p className="mt-0.5 text-body-sm text-ink-muted tabular-nums">
                {fmtNumero(l.cantidad)} × {fmtMoneda(l.precioUnitario)}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-1 border-t-(length:--border-width) border-line p-4">
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
                tono="ok"
              />
            </>
          ) : null}
        </div>

        <div className="space-y-1 border-t-(length:--border-width) border-dashed border-line-strong p-4">
          <Fila etiqueta="Cobrado" valor={`${fmtMoneda(sim.cobrado)} · ${sim.metodo.toLowerCase()}`} />
          <Fila
            etiqueta="Estado"
            valor={etiquetaPago}
            fuerte
            tono={estadoPago(sim.totales.totalBruto, sim.cobrado) === "PAGADA" ? "ok" : "aviso"}
          />
        </div>

        {sim.observaciones ? (
          <p className="border-t-(length:--border-width) border-line p-4 text-body-sm text-ink-muted">{sim.observaciones}</p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Boton variante="secundario" onClick={onEmpezarDeNuevo}>
          Cargar otra venta
        </Boton>
        <Boton variante="secundario" onClick={() => window.print()}>
          Imprimir comprobante
        </Boton>
        <Boton href={sim.ventaId ? `/ventas/${sim.ventaId}` : "/ventas"}>{sim.ventaId ? "Ver la venta" : "Volver a ventas"}</Boton>
      </div>

      {sim.guardada ? null : (
        <Boton variante="fantasma" ancho onClick={onVolver}>
          Volver a editar la venta
        </Boton>
      )}
    </div>
  );
}

function BarraConfirmar({
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
    <BarraInferior error={error}>
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Total</p>
        <p className="monto leading-tight text-ink">{fmtMoneda(total)}</p>
        {ganancia && margenPct ? (
          <p className="text-body-sm tabular-nums text-ok-text">
            ganancia {fmtMoneda(ganancia)} · {fmtPorcentaje(margenPct)}
          </p>
        ) : null}
      </div>
      <Boton onClick={onConfirmar} disabled={!habilitado} aria-busy={guardando || undefined} className="shrink-0">
        {guardando ? "Guardando…" : "Guardar venta"}
      </Boton>
    </BarraInferior>
  );
}

function Fila({
  etiqueta,
  valor,
  fuerte,
  tono = "neutro",
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
  tono?: "neutro" | "aviso" | "ok";
}) {
  const color = { neutro: "text-ink", aviso: "text-aviso-text", ok: "text-ok-text" }[tono];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-body text-ink-muted">{etiqueta}</span>
      <span className={fuerte ? `monto-fila ${color}` : "text-body tabular-nums text-ink"}>{valor}</span>
    </div>
  );
}
