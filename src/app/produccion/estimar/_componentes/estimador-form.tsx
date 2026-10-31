"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BotonEnviar, CampoDecimal } from "@/components/form";
import { decimalOCero } from "@/lib/acciones";
import { MAX_LINEAS } from "@/lib/estimacion-tiempos";

/**
 * Selector de articulos y cantidades de `/produccion/estimar`. No calcula nada: al
 * enviar arma la URL (`?l=<articulo>~<cantidad>`, una por linea) y la pagina
 * (servidor) valida y estima. Asi el resultado se puede recargar o compartir.
 * Mismo estilo que el selector de `/presupuestos/nuevo`.
 */

export type ArticuloDTO = { id: string; nombre: string };
export type LineaDTO = { articuloId: string; cantidad: string };

type Linea = { clave: string; articuloId: string; cantidad: string };

let secuencia = 0;
const nuevaClave = () => `l${++secuencia}`;

export function EstimadorForm({ articulos, inicial }: { articulos: ArticuloDTO[]; inicial: LineaDTO[] }) {
  const router = useRouter();
  const [lineas, setLineas] = useState<Linea[]>(() => inicial.map((l) => ({ clave: nuevaClave(), ...l })));
  const [busqueda, setBusqueda] = useState("");
  const [enviando, iniciarEnvio] = useTransition();

  const porId = useMemo(() => new Map(articulos.map((a) => [a.id, a])), [articulos]);
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
    if (lineas.length >= MAX_LINEAS) return;
    setLineas([...lineas, { clave: nuevaClave(), articuloId, cantidad: "1" }]);
  }

  function estimar(e: React.FormEvent) {
    e.preventDefault();
    if (lineas.length === 0) return;
    const params = lineas.map((l) => `l=${encodeURIComponent(`${l.articuloId}~${l.cantidad.trim()}`)}`).join("&");
    // El boton queda "estimando" hasta que llega la pagina renderizada con el resultado.
    iniciarEnvio(() => router.push(`/produccion/estimar?${params}`));
  }

  return (
    <form onSubmit={estimar} className="space-y-6">
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
          {filtrados.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => agregar(a.id)}
                className={`flex cursor-pointer touch-manipulation items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm font-medium transition-transform active:scale-95 ${
                  yaCargados.has(a.id) ? "border-marca bg-marca-claro text-marca-texto" : "border-slate-300 bg-white text-slate-800"
                }`}
              >
                {a.nombre}
              </button>
            </li>
          ))}
        </ul>
        {filtrados.length === 0 ? <p className="mt-2 text-sm text-slate-600">Ningún artículo coincide con la búsqueda.</p> : null}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase">Pedido</h2>
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
            {lineas.map((linea) => {
              const nombre = porId.get(linea.articuloId)?.nombre ?? "Artículo no disponible";
              return (
                <li key={linea.clave} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-slate-900">{nombre}</p>
                    <button
                      type="button"
                      onClick={() => setLineas(lineas.filter((l) => l !== linea))}
                      aria-label={`Quitar ${nombre}`}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-xs font-semibold text-red-600"
                    >
                      Quitar
                    </button>
                  </div>
                  <CampoDecimal
                    className="mt-2 max-w-40"
                    etiqueta="Cantidad"
                    valor={linea.cantidad}
                    alCambiar={(v) => setLineas(lineas.map((l) => (l === linea ? { ...l, cantidad: v } : l)))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-3 gap-2">
        <Link
          href="/produccion/estimar"
          onClick={() => setLineas([])}
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700"
        >
          Limpiar
        </Link>
        <BotonEnviar
          className="col-span-2"
          variante="marca"
          pendiente={enviando}
          disabled={lineas.length === 0}
          texto="Estimar tiempos"
          textoPendiente="Estimando…"
        />
      </div>
    </form>
  );
}
