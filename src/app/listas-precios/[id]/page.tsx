import { notFound } from "next/navigation";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { getArticulosParaLista, getListaPrecio } from "@/lib/queries/listas-precios";
import { Aviso, Boton, Seccion } from "@/components/ui";
import { AdvertenciaBajoCosto } from "../_componentes/advertencia-bajo-costo";
import { BotonActivoLista } from "../_componentes/boton-activo";
import { ListaForm } from "../_componentes/lista-form";
import { PreciosEspecificos } from "../_componentes/precios-especificos";

export const dynamic = "force-dynamic";

export default async function ListaPrecioPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requierePermisoPagina("gestionarListasPrecios");
  const { id } = await params;
  const [lista, articulos] = await Promise.all([getListaPrecio(id), getArticulosParaLista()]);
  if (!lista) notFound();

  const conPrecio = new Set(lista.precios.map((p) => p.articuloId));

  return (
    <div className="space-y-4">
      <Seccion
        epigrafe="Lista de precios"
        titulo={lista.nombre}
        descripcion={`${lista.clientes} ${lista.clientes === 1 ? "cliente la tiene" : "clientes la tienen"} asignada · Creada por ${lista.creadaPor ?? "—"}`}
        accion={
          <Boton href="/listas-precios" variante="secundario">
            Volver
          </Boton>
        }
      />

      {!lista.activo ? (
        <Aviso tono="aviso" titulo="Esta lista está dada de baja.">
          No se aplica en las ventas: los clientes que la tienen pagan precio de catálogo hasta que la reactives.
        </Aviso>
      ) : null}

      <ListaForm id={lista.id} inicial={{ nombre: lista.nombre, descuentoPct: lista.descuentoPct.toString().replace(".", ",") }} />

      {/* Usa costos de receta: solo con `verCostos`, y ni se consultan sin ese permiso. */}
      {puede(usuario, "verCostos") ? <AdvertenciaBajoCosto listaId={lista.id} /> : null}

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
