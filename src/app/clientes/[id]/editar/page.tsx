import Link from "next/link";
import { notFound } from "next/navigation";
import { getCliente } from "@/lib/queries/clientes";
import { formatearCuit } from "@/lib/cuit";
import { getListaDeCliente, getListasParaElegir } from "@/lib/queries/listas-precios";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { Seccion } from "@/components/ui";
import { ClienteForm } from "../../_componentes/cliente-form";

export const dynamic = "force-dynamic";

export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requierePermisoPagina("editarClientes");
  const { id } = await params;
  const cliente = await getCliente(id);
  if (!cliente) notFound();
  // La lista de precios es una decision de precios: sin `gestionarListasPrecios` ni se consultan las listas.
  const actual = puede(usuario, "gestionarListasPrecios") ? await getListaDeCliente(cliente.id) : null;
  const listas = puede(usuario, "gestionarListasPrecios") ? await getListasParaElegir(actual?.id ?? null) : undefined;

  return (
    <>
      <Seccion
        titulo="Editar cliente"
        descripcion={cliente.nombre}
        accion={
          <Link
            href={`/clientes/${cliente.id}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <ClienteForm
        id={cliente.id}
        esModoDemo={cliente.esDemo}
        listas={listas?.map((l) => ({ valor: l.id, etiqueta: l.activo ? l.nombre : `${l.nombre} (de baja)` }))}
        inicial={{
          nombre: cliente.nombre,
          condicionIva: cliente.condicionIva,
          cuit: formatearCuit(cliente.cuit),
          dni: cliente.dni ?? "",
          telefono: cliente.telefono ?? "",
          email: cliente.email ?? "",
          direccion: cliente.direccion ?? "",
          notas: cliente.notas ?? "",
          listaPrecioId: actual?.id ?? "",
        }}
      />
    </>
  );
}
