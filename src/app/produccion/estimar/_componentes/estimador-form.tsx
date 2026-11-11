"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BotonEnviar, CampoDecimal } from "@/components/form";
import { Boton, Chip, TituloBloque, Vacio } from "@/components/ui";
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
        <TituloBloque>Agregar artículo</TituloBloque>
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
              <Chip activo={yaCargados.has(a.id)} onClick={() => agregar(a.id)}>
                {a.nombre}
              </Chip>
            </li>
          ))}
        </ul>
        {filtrados.length === 0 ? <p className="mt-2 text-body-sm text-ink-muted">Ningún artículo coincide con la búsqueda.</p> : null}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <TituloBloque className="mb-0">Pedido</TituloBloque>
          <span className="text-body-sm text-ink-muted tabular-nums">
            {lineas.length} {lineas.length === 1 ? "línea" : "líneas"}
          </span>
        </div>
        {lineas.length === 0 ? (
          <Vacio mensaje="Todavía no agregaste nada." hint="Tocá un artículo de arriba para armar el pedido." />
        ) : (
          <ul className="space-y-2">
            {lineas.map((linea) => {
              const nombre = porId.get(linea.articuloId)?.nombre ?? "Artículo no disponible";
              return (
                <li key={linea.clave} className="tarjeta p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-body font-semibold text-ink">{nombre}</p>
                    <Boton
                      variante="fantasma-peligro"
                      onClick={() => setLineas(lineas.filter((l) => l !== linea))}
                      aria-label={`Quitar ${nombre}`}
                      className="-mt-2 -mr-2 shrink-0 px-4"
                    >
                      Quitar
                    </Boton>
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

      <div className="grid grid-cols-3 gap-3">
        <Boton href="/produccion/estimar" variante="secundario" onClick={() => setLineas([])}>
          Limpiar
        </Boton>
        <BotonEnviar
          className="col-span-2"
          pendiente={enviando}
          disabled={lineas.length === 0}
          texto="Estimar tiempos"
          textoPendiente="Estimando…"
        />
      </div>
    </form>
  );
}
