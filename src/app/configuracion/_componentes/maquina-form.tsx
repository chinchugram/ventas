"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearMaquina, editarMaquina } from "@/app/configuracion/actions";
import { AvisoDemo, BloqueError, BotonEnviar, CampoDecimal, CampoNotas, CampoTexto, useAccion } from "@/components/form";
import { canonico, validarCostoHora, type DatosMaquina } from "@/lib/configuracion";

type Valores = { nombre: string; costoHora: string; notas: string };

/** Alta (sin `id`) o edicion de una maquina. Al guardar vuelve a Configuracion. */
export function MaquinaForm({
  id,
  inicial = { nombre: "", costoHora: "", notas: "" },
  recetas = 0,
  esModoDemo,
}: {
  id?: string;
  inicial?: Valores;
  /** Recetas que usan la maquina: cambiar el costo/hora las recalcula. */
  recetas?: number;
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const accion = (datos: DatosMaquina) => (id ? editarMaquina({ ...datos, id }) : crearMaquina(datos));
  const { pendiente, error, enviar } = useAccion(accion);
  const [valores, setValores] = useState(inicial);

  const cambiar = (campo: keyof Valores) => (valor: string) => setValores((v) => ({ ...v, [campo]: valor }));
  const errorCosto = valores.costoHora.trim() ? validarCostoHora(valores.costoHora) : null;
  const cambiaCosto = id !== undefined && errorCosto === null && valores.costoHora.trim() !== "" && canonico(valores.costoHora) !== inicial.costoHora;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar(valores, () => {
          router.push("/configuracion");
          router.refresh();
        });
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <CampoTexto
        etiqueta="Nombre"
        valor={valores.nombre}
        alCambiar={cambiar("nombre")}
        placeholder="Láser CO2, plotter de corte…"
        maxLength={80}
        required
      />
      <CampoDecimal
        etiqueta="Costo por hora"
        sufijo="$/h"
        valor={valores.costoHora}
        alCambiar={cambiar("costoHora")}
        error={errorCosto}
        ayuda="Incluí amortización, energía y consumibles propios de la máquina."
        required
      />
      {cambiaCosto && recetas > 0 ? (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Cambia el costo de {recetas} {recetas === 1 ? "receta" : "recetas"}. Las ventas ya hechas conservan su costo.
        </p>
      ) : null}
      <CampoNotas etiqueta="Notas" valor={valores.notas} alCambiar={cambiar("notas")} maxLength={500} />

      <AvisoDemo visible={esModoDemo} />
      <BloqueError mensaje={error} />
      <BotonEnviar pendiente={pendiente} texto={id ? "Guardar cambios" : "Agregar máquina"} />
    </form>
  );
}
