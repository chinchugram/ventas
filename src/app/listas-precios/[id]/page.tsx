import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticulosParaLista, getListaPrecio } from "@/lib/queries/listas-precios";
import { Seccion } from "@/components/ui";
import { AdvertenciaBajoCosto } from "../_componentes/advertencia-bajo-costo";
import { BotonActivoLista } from "../_componentes/boton-activo";
import { ListaForm } from "../_componentes/lista-form";
import { PreciosEspecificos } from "../_componentes/precios-especificos";

export const dynamic = "force-dynamic";

export default async function ListaPrecioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lista, articulos] = await Promise.all([getListaPrecio(id), getArticulosParaLista()]);
  if (!lista) notFound();

  const conPrecio = new Set(lista.precios.map((p) => p.articuloId));

  return (
    <div className="space-y-4">
      <Seccion
        titulo={lista.nombre}
        descripcion={`${lista.clientes} ${lista.clientes === 1 ? "cliente la tiene" : "clientes la tienen"} asignada`}
        accion={
          <Link
            href="/listas-precios"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />

      {!lista.activo ? (
        <p className="rounded-lg bg-slate-200 p-3 text-sm text-slate-700">
          Lista dada de baja: no se aplica en las ventas. Los clientes que la tienen pagan precio de catálogo hasta que
          la reactives.
        </p>
      ) : null}

      <ListaForm id={lista.id} inicial={{ nombre: lista.nombre, descuentoPct: lista.descuentoPct.toString().replace(".", ",") }} />

      {/* SOLO DUEÑO (ola 4): usa costos de receta; se calcula en el servidor. */}
      <AdvertenciaBajoCosto listaId={lista.id} />

      <PreciosEspecificos
        listaId={lista.id}
        precios={lista.precios.map((p) => ({
          articuloId: p.articuloId,
          nombre: p.nombre,
          precioCatalogo: p.precioCatalogo.toString(),
          precio: p.precio.toString(),
        }))}
        disponibles={articulos
          .filter((a) => !conPrecio.has(a.id))
          .map((a) => ({ id: a.id, nombre: a.nombre, precioCatalogo: a.precioCatalogo.toString() }))}
      />

      <BotonActivoLista id={lista.id} activo={lista.activo} clientes={lista.clientes} />
    </div>
  );
}
