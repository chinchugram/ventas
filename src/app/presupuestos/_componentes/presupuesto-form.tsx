"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { d, fmtMoneda, fmtNumero, type Dinero } from "@/lib/money";
import { decimalOCero } from "@/lib/acciones";
import { totalizarPresupuesto, subtotalLinea, VALIDEZ_POR_DEFECTO } from "@/lib/presupuestos";
import { Boton, Chip, Etiqueta, TituloBloque, Vacio } from "@/components/ui";
import { BloqueError, BotonEnviar, CampoDecimal, CampoNotas, CampoSelect, NotaObligatorio, useAccion } from "@/components/form";
import { preciosParaPresupuesto, type PreciosCliente } from "@/app/ventas/nueva/actions";
import { crearPresupuesto, editarPresupuesto } from "../actions";

/**
 * Formulario de presupuesto (alta y edicion). Solo maneja PRECIOS, nunca costos
 * ni margenes.
 *
 * Los precios que se ven son informativos: al guardar, el servidor los resuelve
 * de nuevo (`resolverPrecio`) y no confia en nada que venga de aca. Al elegir
 * cliente se piden con `preciosParaPresupuesto`. Al editar, las lineas que ya
 * estaban conservan su precio congelado mientras el cliente no cambie.
 */

export type ClienteDTO = { id: string; nombre: string; cuit: string | null };
export type ArticuloDTO = { id: string; nombre: string; precioVenta: string; ivaPct: string };
export type LineaGuardadaDTO = {
  articuloId: string;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  ivaPct: string;
};
export type InicialDTO = {
  clienteId: string;
  validezDias: string;
  observaciones: string;
  lineas: LineaGuardadaDTO[];
};

type Linea = { clave: string; articuloId: string; cantidad: string };

let secuencia = 0;
const nuevaClave = () => `l${++secuencia}`;

export function PresupuestoForm({
  id,
  clientes,
  articulos,
  inicial,
}: {
  /** Presente al editar. */
  id?: string;
  clientes: ClienteDTO[];
  articulos: ArticuloDTO[];
  inicial?: InicialDTO;
}) {
  const router = useRouter();
  const alta = useAccion(crearPresupuesto);
  const edicion = useAccion(editarPresupuesto);
  const { pendiente, error } = id ? edicion : alta;

  const [clienteId, setClienteId] = useState(inicial?.clienteId ?? "");
  const [validez, setValidez] = useState(inicial?.validezDias ?? String(VALIDEZ_POR_DEFECTO));
  const [observaciones, setObservaciones] = useState(inicial?.observaciones ?? "");
  const [lineas, setLineas] = useState<Linea[]>(
    () => inicial?.lineas.map((l) => ({ clave: nuevaClave(), articuloId: l.articuloId, cantidad: l.cantidad })) ?? [],
  );
  const [busqueda, setBusqueda] = useState("");
  const [cargados, setCargados] = useState<(PreciosCliente & { clienteId: string }) | null>(null);
  const [reintento, setReintento] = useState(0);

  const porId = useMemo(() => new Map(articulos.map((a) => [a.id, a])), [articulos]);
  const guardadas = useMemo(() => new Map((inicial?.lineas ?? []).map((l) => [l.articuloId, l])), [inicial]);

  // Precios del cliente elegido (solo precios de venta, ver `preciosParaPresupuesto`).
  useEffect(() => {
    if (!clienteId) return;
    let vigente = true;
    preciosParaPresupuesto({ clienteId, articuloIds: articulos.map((a) => a.id) })
      .then((r) => vigente && setCargados({ ...r, clienteId }))
      .catch(() => vigente && setCargados({ ok: false, error: "Se cortó la comunicación con el servidor.", clienteId }));
    return () => {
      vigente = false;
    };
  }, [clienteId, articulos, reintento]);

  const actuales = cargados?.clienteId === clienteId ? cargados : null;
  const cargando = clienteId !== "" && actuales === null;
  const errorPrecios = actuales && !actuales.ok ? actuales.error : null;
  const lista = actuales?.ok ? actuales.lista : null;
  // Mientras el cliente sea el que ya tenia el presupuesto, sus lineas guardadas mantienen el precio.
  const mismoCliente = inicial !== undefined && clienteId === inicial.clienteId;

  /** Precio e IVA con los que se muestra una linea, o null si todavia no llegaron los precios. */
  function precioDe(articuloId: string): { precio: Dinero; iva: Dinero; congelado: boolean } | null {
    const previa = mismoCliente ? guardadas.get(articuloId) : undefined;
    if (previa) return { precio: d(previa.precioUnitario), iva: d(previa.ivaPct), congelado: true };
    const a = porId.get(articuloId);
    if (!a) return null;
    const resuelto = actuales?.ok ? actuales.precios[articuloId] : undefined;
    if (!resuelto) return null;
    return { precio: d(resuelto.precio), iva: d(a.ivaPct), congelado: false };
  }

  const calculadas = lineas.map((l) => {
    const articulo = porId.get(l.articuloId);
    const p = precioDe(l.articuloId);
    const cantidad = decimalOCero(l.cantidad);
    return { linea: l, articulo, p, cantidad, subtotal: p ? subtotalLinea({ cantidad, precioUnitario: p.precio, ivaPct: p.iva }) : null };
  });
  const sinPrecio = calculadas.some((c) => c.p === null);
  const totales = totalizarPresupuesto(
    calculadas.flatMap((c) => (c.p ? [{ cantidad: c.cantidad, precioUnitario: c.p.precio, ivaPct: c.p.iva }] : [])),
  );

  const yaCargados = new Set(lineas.map((l) => l.articuloId));
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? articulos.filter((a) => a.nombre.toLowerCase().includes(q)) : articulos;
  }, [articulos, busqueda]);

  function agregar(articuloId: string) {
    // Tocar uno que ya esta suma 1 en vez de duplicar el renglon.
    const existente = lineas.find((l) => l.articuloId === articuloId);
    if (existente) {
      setLineas(lineas.map((l) => (l === existente ? { ...l, cantidad: decimalOCero(l.cantidad).plus(1).toString() } : l)));
      return;
    }
    setLineas([...lineas, { clave: nuevaClave(), articuloId, cantidad: "1" }]);
  }

  const puedeGuardar = clienteId !== "" && lineas.length > 0 && !cargando && !errorPrecios && !sinPrecio;

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos = {
      clienteId,
      validezDias: validez,
      observaciones,
      items: lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.cantidad })),
    };
    if (id) {
      edicion.enviar({ id, ...datos }, () => {
        router.push(`/presupuestos/${id}`);
        router.refresh();
      });
    } else {
      alta.enviar(datos, (r) => router.push(`/presupuestos/${r.id}`));
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-6 pb-8">
      <NotaObligatorio />
      <section className="space-y-2">
        <CampoSelect
          etiqueta="Cliente"
          valor={clienteId}
          alCambiar={setClienteId}
          placeholder="Elegí un cliente…"
          required
          opciones={clientes.map((c) => ({ valor: c.id, etiqueta: c.cuit ? `${c.nombre} · ${c.cuit}` : c.nombre }))}
        />
        {id && inicial && clienteId !== inicial.clienteId ? (
          <p className="text-body-sm font-semibold text-aviso-text">Al cambiar de cliente se recalculan todos los precios con su lista.</p>
        ) : null}
        {cargando ? (
          <p role="status" className="text-body-sm text-ink-muted">
            Actualizando precios…
          </p>
        ) : null}
        {errorPrecios ? (
          <p role="alert" className="text-body-sm font-semibold text-critico-text">
            {errorPrecios} No pudimos traer los precios de este cliente.{" "}
            <button type="button" onClick={() => setReintento((n) => n + 1)} className="enlace inline-flex min-h-11 items-center">
              Reintentar
            </button>
          </p>
        ) : null}
        {lista ? (
          <p className="text-body-sm font-semibold text-brand-text">
            Lista de precios: {lista.nombre}
            {d(lista.descuentoPct).gt(0) ? ` (−${fmtNumero(lista.descuentoPct)}%)` : ""}
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
          {filtrados.map((a) => {
            const cargado = yaCargados.has(a.id);
            const mostrado = (actuales?.ok ? actuales.precios[a.id]?.precio : undefined) ?? a.precioVenta;
            return (
              <li key={a.id}>
                <Chip activo={cargado} onClick={() => agregar(a.id)} className="touch-manipulation">
                  <span>{a.nombre}</span>
                  <span className="font-mono text-mono font-medium tabular-nums">{fmtMoneda(mostrado)}</span>
                </Chip>
              </li>
            );
          })}
        </ul>
        {filtrados.length === 0 ? <p className="mt-2 text-body-sm text-ink-muted">Ningún artículo coincide con la búsqueda.</p> : null}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <TituloBloque className="">Detalle</TituloBloque>
          <span className="text-body-sm text-ink-muted">
            {lineas.length} {lineas.length === 1 ? "línea" : "líneas"}
          </span>
        </div>
        {lineas.length === 0 ? (
          <Vacio mensaje="Todavía no agregaste nada." hint="Tocá un artículo del catálogo y se suma acá." />
        ) : (
          <ul className="space-y-2">
            {calculadas.map(({ linea, articulo, p, subtotal }) => (
              <li key={linea.clave} className="tarjeta p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-body font-semibold text-ink">{guardadas.get(linea.articuloId)?.descripcion ?? articulo?.nombre}</p>
                  <Boton
                    variante="fantasma-peligro"
                    onClick={() => setLineas(lineas.filter((l) => l !== linea))}
                    aria-label={`Quitar ${articulo?.nombre ?? "artículo"}`}
                    className="-mt-1 -mr-2 shrink-0 px-4"
                  >
                    Quitar
                  </Boton>
                </div>
                <div className="mt-2 grid grid-cols-2 items-end gap-3">
                  <CampoDecimal
                    etiqueta="Cantidad"
                    valor={linea.cantidad}
                    alCambiar={(v) => setLineas(lineas.map((l) => (l === linea ? { ...l, cantidad: v } : l)))}
                  />
                  <div className="text-right">
                    <p className="text-body-sm text-ink-muted tabular-nums">
                      {p ? `${fmtMoneda(p.precio)} c/u` : "Cargando precio…"}
                    </p>
                    {p?.congelado ? <Etiqueta tono="info">precio acordado</Etiqueta> : null}
                    <p className="monto-fila text-ink">{subtotal ? fmtMoneda(subtotal) : "—"}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CampoDecimal
          etiqueta="Validez"
          sufijo="días"
          valor={validez}
          alCambiar={setValidez}
          ayuda={id ? "Se cuentan desde la fecha del presupuesto." : "Se cuentan desde hoy."}
        />
        <CampoNotas
          className="sm:col-span-2"
          etiqueta="Observaciones (se imprimen en el presupuesto)"
          valor={observaciones}
          alCambiar={setObservaciones}
          maxLength={500}
          filas={3}
        />
      </section>

      <section className="tarjeta p-4">
        <dl className="space-y-1">
          <div className="flex justify-between text-body text-ink-muted">
            <dt>Neto</dt>
            <dd className="tabular-nums">{fmtMoneda(totales.totalNeto)}</dd>
          </div>
          <div className="flex justify-between text-body text-ink-muted">
            <dt>IVA</dt>
            <dd className="tabular-nums">{fmtMoneda(totales.totalIVA)}</dd>
          </div>
          <div className="flex items-baseline justify-between text-ink">
            <dt className="text-body font-semibold">Total</dt>
            <dd className="monto">{fmtMoneda(totales.totalBruto)}</dd>
          </div>
        </dl>
      </section>

      <BloqueError mensaje={error} />
      <div className="grid grid-cols-3 gap-3">
        <Boton href={id ? `/presupuestos/${id}` : "/presupuestos"} variante="secundario">
          Cancelar
        </Boton>
        <BotonEnviar
          className="col-span-2"
          variante="marca"
          pendiente={pendiente}
          disabled={!puedeGuardar}
          texto={id ? "Guardar cambios" : "Crear presupuesto"}
        />
      </div>
    </form>
  );
}
