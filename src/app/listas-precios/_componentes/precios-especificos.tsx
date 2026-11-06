"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarPrecioLista, quitarPrecioLista } from "@/app/listas-precios/actions";
import { BloqueError, CampoDecimal, CampoSelect, useAccion } from "@/components/form";
import { fmtMoneda } from "@/lib/money";

export type PrecioFila = { articuloId: string; nombre: string; precioCatalogo: string; precio: string };
export type ArticuloOpcion = { id: string; nombre: string; precioCatalogo: string };

const conComa = (v: string) => v.replace(".", ",");

/**
 * Precios especificos de la lista: alta, edicion y baja de una linea por
 * articulo. Solo maneja precios de venta y de catalogo (nunca costos).
 */
export function PreciosEspecificos({
  listaId,
  precios,
  disponibles,
  esModoDemo = false,
}: {
  listaId: string;
  precios: PrecioFila[];
  /** Articulos activos que todavia no tienen precio en esta lista. */
  disponibles: ArticuloOpcion[];
  esModoDemo?: boolean;
}) {
  return (
    <section aria-labelledby="titulo-precios" className="space-y-3">
      <div>
        <h2 id="titulo-precios" className="text-sm font-semibold text-slate-900">
          Precios específicos
        </h2>
        <p className="text-sm text-slate-500">
          Un precio específico gana sobre el descuento general. Precio final, con IVA, igual que en el catálogo.
        </p>
      </div>

      {precios.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-600">
          Todavía no hay precios específicos: se aplica solo el descuento general.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {precios.map((p) => (
            <FilaPrecio key={`${p.articuloId}:${p.precio}`} listaId={listaId} fila={p} />
          ))}
        </ul>
      )}

      <AltaPrecio listaId={listaId} disponibles={disponibles} esModoDemo={esModoDemo} />
    </section>
  );
}

function FilaPrecio({ listaId, fila }: { listaId: string; fila: PrecioFila }) {
  const router = useRouter();
  const [precio, setPrecio] = useState(conComa(fila.precio));
  const guardar = useAccion(guardarPrecioLista);
  const quitar = useAccion(quitarPrecioLista);
  const error = guardar.error ?? quitar.error;
  const ocupado = guardar.pendiente || quitar.pendiente;
  const cambio = precio.trim() !== conComa(fila.precio);

  return (
    <li className="space-y-2 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 font-medium text-slate-900">{fila.nombre}</p>
        <p className="shrink-0 text-xs text-slate-500">catálogo {fmtMoneda(fila.precioCatalogo)}</p>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          guardar.enviar({ listaId, articuloId: fila.articuloId, precio }, () => router.refresh());
        }}
      >
        <CampoDecimal
          className="min-w-0 flex-1"
          etiqueta="Precio en esta lista"
          valor={precio}
          alCambiar={setPrecio}
          prefijo="$"
        />
        <button
          type="submit"
          disabled={ocupado || !cambio}
          className="min-h-11 shrink-0 rounded-lg bg-tinta px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {guardar.pendiente ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => quitar.enviar({ listaId, articuloId: fila.articuloId }, () => router.refresh())}
          aria-label={`Quitar el precio específico de ${fila.nombre}`}
          className="min-h-11 shrink-0 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-700 disabled:opacity-40"
        >
          Quitar
        </button>
      </form>
      <BloqueError mensaje={error} />
    </li>
  );
}

function AltaPrecio({
  listaId,
  disponibles,
  esModoDemo,
}: {
  listaId: string;
  disponibles: ArticuloOpcion[];
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const [articuloId, setArticuloId] = useState("");
  const [precio, setPrecio] = useState("");
  const { pendiente, error, enviar } = useAccion(guardarPrecioLista);

  if (disponibles.length === 0) {
    return <p className="text-sm text-slate-500">Todos los artículos activos ya tienen precio específico.</p>;
  }

  const elegido = disponibles.find((a) => a.id === articuloId);

  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ listaId, articuloId, precio }, () => {
          setArticuloId("");
          setPrecio("");
          router.refresh();
        });
      }}
    >
      <h3 className="text-sm font-semibold text-slate-900">Agregar precio específico</h3>
      <CampoSelect
        etiqueta="Artículo"
        valor={articuloId}
        alCambiar={setArticuloId}
        placeholder="Elegí un artículo…"
        required
        opciones={disponibles.map((a) => ({ valor: a.id, etiqueta: `${a.nombre} · ${fmtMoneda(a.precioCatalogo)}` }))}
      />
      <CampoDecimal
        etiqueta="Precio en esta lista"
        valor={precio}
        alCambiar={setPrecio}
        prefijo="$"
        ayuda={elegido ? `Catálogo: ${fmtMoneda(elegido.precioCatalogo)}` : undefined}
        required
      />
      <BloqueError mensaje={error} />
      <button
        type="submit"
        disabled={pendiente || esModoDemo || !articuloId || !precio.trim()}
        className="w-full rounded-lg bg-tinta py-3 font-semibold text-white disabled:opacity-40"
      >
        {pendiente ? "Guardando…" : "Agregar"}
      </button>
    </form>
  );
}
