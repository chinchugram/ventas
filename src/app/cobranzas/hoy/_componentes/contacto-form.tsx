"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registrarContacto } from "@/app/cobranzas/hoy/actions";
import { BloqueError, BloqueExito, BotonEnviar, CampoNotas, CampoTexto, useAccion } from "@/components/form";

const MAX_NOTA = 500;

/**
 * Registrar un contacto de cobranza. Solo recibe el id del cliente y la fecha de
 * hoy (en Argentina, la calcula el servidor). Al guardar, refresca la pagina: el
 * cliente ya tuvo contacto hoy y sale de la lista.
 */
export function ContactoForm({ clienteId, hoyISO }: { clienteId: string; hoyISO: string }) {
  const router = useRouter();
  const [nota, setNota] = useState("");
  const [proximo, setProximo] = useState("");
  const [guardado, setGuardado] = useState(false);
  const { pendiente, error, enviar } = useAccion(registrarContacto);

  return (
    <form
      aria-label="Registrar contacto"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ clienteId, nota, proximoContacto: proximo || null }, () => {
          setGuardado(true);
          router.refresh();
        });
      }}
      className="space-y-3"
    >
      <CampoNotas
        etiqueta="Nota del contacto"
        valor={nota}
        alCambiar={setNota}
        filas={3}
        maxLength={MAX_NOTA}
        placeholder="Qué se habló, qué respondió…"
        ayuda={`${nota.length} de ${MAX_NOTA} caracteres`}
      />
      <CampoTexto
        etiqueta="Próximo contacto (opcional)"
        tipo="date"
        valor={proximo}
        alCambiar={setProximo}
        min={hoyISO}
        ayuda="Si prometió volver a llamar, elegí el día. No puede ser una fecha pasada."
      />
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={guardado && !error ? "Contacto guardado. Sale de la lista de hoy." : null} />
      <BotonEnviar pendiente={pendiente} texto="Guardar contacto" variante="marca" />
    </form>
  );
}
