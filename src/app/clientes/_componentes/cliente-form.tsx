"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearCliente, editarCliente, type DatosCliente } from "@/app/clientes/actions";
import { AvisoDemo, BloqueError, BotonEnviar, CampoNotas, CampoSelect, CampoTexto, useAccion, type Opcion } from "@/components/form";
import { normalizarCuit, validarCuit } from "@/lib/cuit";

export type ValoresCliente = {
  nombre: string;
  cuit: string;
  telefono: string;
  email: string;
  direccion: string;
  notas: string;
  /** Id de la lista de precios, o "" si no tiene. */
  listaPrecioId: string;
};

export const CLIENTE_VACIO: ValoresCliente = {
  nombre: "",
  cuit: "",
  telefono: "",
  email: "",
  direccion: "",
  notas: "",
  listaPrecioId: "",
};

/**
 * Alta y edicion de cliente. Sin `id` crea; con `id` edita. El CUIT se revisa
 * en vivo (forma y digito verificador) para avisar antes de enviar, pero quien
 * decide es el servidor.
 */
export function ClienteForm({
  id,
  inicial = CLIENTE_VACIO,
  listas = [],
  esModoDemo = false,
}: {
  id?: string;
  inicial?: ValoresCliente;
  /** Listas de precios que se pueden elegir. */
  listas?: Opcion[];
  esModoDemo?: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState(inicial);
  const crear = useAccion(crearCliente);
  const editar = useAccion((d: DatosCliente) => editarCliente({ ...d, id: id ?? "" }));
  const { pendiente, error } = id ? editar : crear;

  const cambiar = (campo: keyof ValoresCliente) => (v: string) => setValores((x) => ({ ...x, [campo]: v }));

  // Un CUIT ya guardado que no se toca no se vuelve a validar (puede ser previo
  // a la validacion); el servidor aplica la misma regla.
  const cuitSinCambios =
    !!inicial.cuit && normalizarCuit(valores.cuit) === normalizarCuit(inicial.cuit);
  // Mientras se tipea no se marca error: recien con 11 digitos (o un caracter
  // que no corresponde) hay algo para decir.
  const terminoDeTipear = valores.cuit.replace(/\D/g, "").length >= 11 || /[^\d\s.\-/]/.test(valores.cuit);
  const revision = valores.cuit.trim() && !cuitSinCambios && terminoDeTipear ? validarCuit(valores.cuit) : null;
  const avisoCuit = revision && !revision.ok ? revision.error : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const datos = { ...valores, listaPrecioId: valores.listaPrecioId || null };
        if (id) editar.enviar(datos, () => router.push(`/clientes/${id}`));
        else crear.enviar(datos, (r) => router.push(`/clientes/${r.id}`));
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <AvisoDemo visible={esModoDemo} que="los clientes" />
      <CampoTexto
        etiqueta="Nombre o razón social"
        valor={valores.nombre}
        alCambiar={cambiar("nombre")}
        maxLength={120}
        autoComplete="off"
        required
      />
      <CampoTexto
        etiqueta="CUIT (opcional)"
        valor={valores.cuit}
        alCambiar={cambiar("cuit")}
        inputMode="numeric"
        autoComplete="off"
        placeholder="30-71234567-1"
        maxLength={20}
        error={avisoCuit}
        ayuda={avisoCuit ? undefined : "Con o sin guiones. Se verifica el dígito verificador."}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Teléfono"
          tipo="tel"
          valor={valores.telefono}
          alCambiar={cambiar("telefono")}
          maxLength={40}
          autoComplete="off"
        />
        <CampoTexto
          etiqueta="Email"
          tipo="email"
          valor={valores.email}
          alCambiar={cambiar("email")}
          maxLength={120}
          autoComplete="off"
        />
      </div>
      <CampoTexto
        etiqueta="Dirección"
        valor={valores.direccion}
        alCambiar={cambiar("direccion")}
        maxLength={200}
        autoComplete="off"
      />
      <CampoSelect
        etiqueta="Lista de precios"
        valor={valores.listaPrecioId}
        alCambiar={cambiar("listaPrecioId")}
        opciones={listas}
        placeholder="Sin lista (precio de catálogo)"
        ayuda="Las ventas nuevas de este cliente usan los precios de la lista."
      />
      <CampoNotas
        etiqueta="Notas"
        valor={valores.notas}
        alCambiar={cambiar("notas")}
        maxLength={500}
        placeholder="Horarios, contacto de compras, cómo factura…"
      />
      <BloqueError mensaje={error} />
      <BotonEnviar pendiente={pendiente} texto={id ? "Guardar cambios" : "Crear cliente"} />
    </form>
  );
}
