"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearCliente, editarCliente, type DatosCliente } from "@/app/clientes/actions";
import { AvisoDemo, BloqueError, BotonEnviar, CampoNotas, CampoSelect, CampoTexto, useAccion, type Opcion } from "@/components/form";
import { normalizarCuit, validarCuit } from "@/lib/cuit";
import { normalizarDni } from "@/lib/comprobantes";
import { ETIQUETA_CONDICION_IVA } from "@/lib/datos-fiscales";
import { CONDICIONES_IVA_CLIENTE, type CondicionIvaCliente } from "@/lib/dominio/clientes";

export type ValoresCliente = {
  nombre: string;
  condicionIva: CondicionIvaCliente;
  cuit: string;
  /** Tal como se tipea (puede tener puntos). */
  dni: string;
  telefono: string;
  email: string;
  direccion: string;
  notas: string;
  /** Id de la lista de precios, o "" si no tiene. */
  listaPrecioId: string;
};

export const CLIENTE_VACIO: ValoresCliente = {
  nombre: "",
  condicionIva: "CONSUMIDOR_FINAL",
  cuit: "",
  dni: "",
  telefono: "",
  email: "",
  direccion: "",
  notas: "",
  listaPrecioId: "",
};

const OPCIONES_CONDICION_IVA: Opcion[] = CONDICIONES_IVA_CLIENTE.map((valor) => ({
  valor,
  etiqueta: ETIQUETA_CONDICION_IVA[valor] ?? valor,
}));

/**
 * Alta y edicion de cliente. Sin `id` crea; con `id` edita. El CUIT se revisa
 * en vivo (forma y digito verificador) para avisar antes de enviar, pero quien
 * decide es el servidor.
 */
export function ClienteForm({
  id,
  inicial = CLIENTE_VACIO,
  listas,
  esModoDemo = false,
}: {
  id?: string;
  inicial?: ValoresCliente;
  /**
   * Listas de precios que se pueden elegir. Sin esto (quien no puede gestionar
   * listas de precios) el selector no se muestra y el formulario no envia la lista.
   */
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

  // DNI opcional: si se tipea, tiene que ser de 7 u 8 digitos (puntos aparte).
  const errorDni = valores.dni.trim() && normalizarDni(valores.dni) === null
    ? "El DNI tiene 7 u 8 dígitos, sin puntos."
    : null;
  // Factura A exige CUIT del receptor: se avisa, no se bloquea (quien decide al emitir es el sistema).
  const avisoFacturaA =
    valores.condicionIva === "RESPONSABLE_INSCRIPTO" && !valores.cuit.trim()
      ? "Para facturarle como Factura A hace falta su CUIT."
      : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const datos = listas ? { ...valores, listaPrecioId: valores.listaPrecioId || null } : { ...valores, listaPrecioId: undefined };
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
      <CampoSelect
        etiqueta="Condición frente al IVA"
        valor={valores.condicionIva}
        alCambiar={(v) => setValores((x) => ({ ...x, condicionIva: v as CondicionIvaCliente }))}
        opciones={OPCIONES_CONDICION_IVA}
        ayuda="Consumidor final si no se indica otra cosa. Decide la letra de la factura."
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
      {avisoFacturaA ? (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {avisoFacturaA}
        </p>
      ) : null}
      <CampoTexto
        etiqueta="DNI (opcional)"
        valor={valores.dni}
        alCambiar={cambiar("dni")}
        inputMode="numeric"
        autoComplete="off"
        placeholder="12.345.678"
        maxLength={12}
        error={errorDni}
        ayuda={errorDni ? undefined : "Para consumidores finales. Sin CUIT ni DNI, la factura sale a consumidor final sin identificar."}
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
      {listas ? (
        <CampoSelect
          etiqueta="Lista de precios"
          valor={valores.listaPrecioId}
          alCambiar={cambiar("listaPrecioId")}
          opciones={listas}
          placeholder="Sin lista (precio de catálogo)"
          ayuda="Las ventas nuevas de este cliente usan los precios de la lista."
        />
      ) : null}
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
