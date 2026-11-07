"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarPrecioLista, quitarPrecioLista } from "@/app/listas-precios/actions";
import { BloqueError, BotonEnviar, CampoDecimal, CampoSelect, useAccion } from "@/components/form";
import { Boton, ListaPanel, TituloBloque, Vacio } from "@/components/ui";
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
        <TituloBloque id="titulo-precios" className="mb-0.5">
          Precios específicos
        </TituloBloque>
        <p className="text-body-sm text-ink-muted">
          Un precio específico gana sobre el descuento general. Precio final, con IVA, igual que en el catálogo.
        </p>
      </div>

      {precios.length === 0 ? (
        <Vacio
          mensaje="Todavía no hay precios específicos."
          hint="Mientras tanto se aplica solo el descuento general."
        />
      ) : (
        <ListaPanel>
          {precios.map((p) => (
            <FilaPrecio key={`${p.articuloId}:${p.precio}`} listaId={listaId} fila={p} />
          ))}
        </ListaPanel>
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
        <p className="min-w-0 text-body font-semibold break-words text-ink">{fila.nombre}</p>
        <p className="shrink-0 text-body-sm text-ink-muted tabular-nums">catálogo {fmtMoneda(fila.precioCatalogo)}</p>
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
        <Boton type="submit" variante="secundario" disabled={ocupado || !cambio} aria-busy={guardar.pendiente || undefined} className="shrink-0 px-4">
          {guardar.pendiente ? "Guardando…" : "Guardar"}
        </Boton>
        <Boton
          variante="fantasma-peligro"
          disabled={ocupado}
          onClick={() => quitar.enviar({ listaId, articuloId: fila.articuloId }, () => router.refresh())}
          aria-label={`Quitar el precio específico de ${fila.nombre}`}
          className="shrink-0 px-3"
        >
          Quitar
        </Boton>
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
    return <p className="text-body-sm text-ink-muted">Todos los artículos activos ya tienen precio específico.</p>;
  }

  const elegido = disponibles.find((a) => a.id === articuloId);

  return (
    <form
      className="tarjeta space-y-3 p-4 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ listaId, articuloId, precio }, () => {
          setArticuloId("");
          setPrecio("");
          router.refresh();
        });
      }}
    >
      <h3 className="font-display text-body-lg font-bold text-ink">Agregar precio específico</h3>
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
      <BotonEnviar pendiente={pendiente} texto="Agregar" disabled={esModoDemo || !articuloId || !precio.trim()} />
    </form>
  );
}
