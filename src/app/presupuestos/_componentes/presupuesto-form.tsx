"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { d, fmtMoneda, fmtNumero, type Dinero } from "@/lib/money";
import { decimalOCero } from "@/lib/acciones";
import { totalizarPresupuesto, subtotalLinea, VALIDEZ_POR_DEFECTO } from "@/lib/presupuestos";
import { BloqueError, BotonEnviar, CampoDecimal, CampoNotas, CampoSelect, useAccion } from "@/components/form";
import { preciosParaCliente, type PreciosCliente } from "@/app/ventas/nueva/actions";
import { crearPresupuesto, editarPresupuesto } from "../actions";

/**
 * Formulario de presupuesto (alta y edicion). Solo maneja PRECIOS, nunca costos
 * ni margenes.
 *
 * Los precios que se ven son informativos: al guardar, el servidor los resuelve
 * de nuevo (`resolverPrecio`) y no confia en nada que venga de aca. Al elegir
 * cliente se piden con `preciosParaCliente`. Al editar, las lineas que ya
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

  // Precios del cliente elegido (solo precios de venta, ver `preciosParaCliente`).
  useEffect(() => {
    if (!clienteId) return;
    let vigente = true;
    preciosParaCliente({ clienteId, articuloIds: articulos.map((a) => a.id) })
      .then((r) => vigente && setCargados({ ...r, clienteId }))
      .catch(() => vigente && setCargados({ ok: false, error: "No se pudo conectar con el servidor.", clienteId }));
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
          <p className="text-xs text-amber-800">Al cambiar de cliente se recalculan todos los precios con su lista.</p>
        ) : null}
        {cargando ? (
          <p role="status" className="text-xs text-slate-500">
            Actualizando precios…
          </p>
        ) : null}
        {errorPrecios ? (
          <p role="alert" className="text-sm text-red-700">
            {errorPrecios}{" "}
            <button type="button" onClick={() => setReintento((n) => n + 1)} className="font-semibold underline">
              Reintentar
            </button>
          </p>
        ) : null}
        {lista ? (
          <p className="text-xs text-marca-texto">
            Lista de precios: {lista.nombre}
            {d(lista.descuentoPct).gt(0) ? ` (−${fmtNumero(lista.descuentoPct)}%)` : ""}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">Agregar artículo</h2>
        <input
          type="search"
          aria-label="Buscar artículo en el catálogo"
          placeholder="Buscar en el catálogo"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="mb-2"
        />
        <ul className="flex flex-wrap gap-2">
          {filtrados.map((a) => {
            const cargado = yaCargados.has(a.id);
            const mostrado = (actuales?.ok ? actuales.precios[a.id]?.precio : undefined) ?? a.precioVenta;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => agregar(a.id)}
                  className={`flex cursor-pointer touch-manipulation items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm font-medium transition-transform active:scale-95 ${
                    cargado ? "border-marca bg-marca-claro text-marca-texto" : "border-slate-300 bg-white text-slate-800"
                  }`}
                >
                  <span>{a.nombre}</span>
                  <span className="text-slate-500">{fmtMoneda(mostrado)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {filtrados.length === 0 ? <p className="mt-2 text-sm text-slate-600">Ningún artículo coincide con la búsqueda.</p> : null}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase">Detalle</h2>
          <span className="text-sm text-slate-600">
            {lineas.length} {lineas.length === 1 ? "línea" : "líneas"}
          </span>
        </div>
        {lineas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
            Todavía no agregaste nada.
          </p>
        ) : (
          <ul className="space-y-2">
            {calculadas.map(({ linea, articulo, p, subtotal }) => (
              <li key={linea.clave} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-900">{guardadas.get(linea.articuloId)?.descripcion ?? articulo?.nombre}</p>
                  <button
                    type="button"
                    onClick={() => setLineas(lineas.filter((l) => l !== linea))}
                    aria-label={`Quitar ${articulo?.nombre ?? "artículo"}`}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-xs font-semibold text-red-600"
                  >
                    Quitar
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 items-end gap-3">
                  <CampoDecimal
                    etiqueta="Cantidad"
                    valor={linea.cantidad}
                    alCambiar={(v) => setLineas(lineas.map((l) => (l === linea ? { ...l, cantidad: v } : l)))}
                  />
                  <div className="text-right">
                    <p className="text-xs text-slate-500">
                      {p ? `${fmtMoneda(p.precio)} c/u${p.congelado ? " · precio acordado" : ""}` : "Cargando precio…"}
                    </p>
                    <p className="font-semibold tabular-nums text-slate-900">{subtotal ? fmtMoneda(subtotal) : "—"}</p>
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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Neto</dt>
            <dd className="tabular-nums">{fmtMoneda(totales.totalNeto)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>IVA</dt>
            <dd className="tabular-nums">{fmtMoneda(totales.totalIVA)}</dd>
          </div>
          <div className="flex justify-between text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd className="tabular-nums">{fmtMoneda(totales.totalBruto)}</dd>
          </div>
        </dl>
      </section>

      <BloqueError mensaje={error} />
      <div className="grid grid-cols-3 gap-2">
        <Link
          href={id ? `/presupuestos/${id}` : "/presupuestos"}
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700"
        >
          Cancelar
        </Link>
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
