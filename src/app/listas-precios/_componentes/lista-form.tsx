"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearLista, editarLista, type DatosLista } from "@/app/listas-precios/actions";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, CampoDecimal, CampoTexto, useAccion } from "@/components/form";

/**
 * Alta y edicion de una lista de precios. Sin `id` crea; con `id` edita. Los
 * precios especificos por articulo se cargan aparte, en la pantalla de edicion.
 */
export function ListaForm({
  id,
  inicial = { nombre: "", descuentoPct: "0" },
  esModoDemo = false,
}: {
  id?: string;
  inicial?: DatosLista;
  esModoDemo?: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState(inicial);
  const [guardado, setGuardado] = useState(false);
  const crear = useAccion(crearLista);
  const editar = useAccion((datos: DatosLista) => editarLista({ ...datos, id: id ?? "" }));
  const { pendiente, error } = id ? editar : crear;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setGuardado(false);
        if (id) {
          editar.enviar(valores, () => {
            setGuardado(true);
            router.refresh();
          });
        } else {
          crear.enviar(valores, (r) => router.push(`/listas-precios/${r.id}`));
        }
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <AvisoDemo visible={esModoDemo} que="las listas de precios" />
      <CampoTexto
        etiqueta="Nombre de la lista"
        valor={valores.nombre}
        alCambiar={(v) => setValores((x) => ({ ...x, nombre: v }))}
        maxLength={80}
        autoComplete="off"
        placeholder="Mayoristas, Gremio, Amigos…"
        required
      />
      <CampoDecimal
        etiqueta="Descuento general"
        valor={valores.descuentoPct}
        alCambiar={(v) => setValores((x) => ({ ...x, descuentoPct: v }))}
        sufijo="%"
        ayuda="Se resta del precio de catálogo de todo lo que no tenga un precio específico. 0 = sin descuento."
      />
      <BloqueError mensaje={error} />
      {guardado && !error ? <BloqueExito mensaje="Cambios guardados." /> : null}
      <BotonEnviar pendiente={pendiente} texto={id ? "Guardar cambios" : "Crear lista"} />
    </form>
  );
}
