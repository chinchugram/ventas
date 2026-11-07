"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BloqueError } from "@/components/form";
import { claseBoton } from "@/components/ui";

/**
 * Acción delicada con confirmación en el lugar, sin `confirm()` del navegador (en el celular es feo y
 * se descarta solo). Cerrado es un botón; abierto es un panel con la pregunta, un detalle opcional y
 * dos botones. El foco pasa a "Cancelar" al abrir, Escape cancela y el foco vuelve al botón.
 * La acción la pone quien lo usa: `onConfirmar` recibe `cerrar` para plegar el panel si la pantalla
 * sigue en pie después de la acción (si hace `router.refresh()` y el botón desaparece, no hace falta).
 *
 *   <ConfirmarAccion texto="Anular venta" pregunta="¿Anular esta venta?" textoConfirmar="Sí, anular"
 *     textoPendiente="Anulando…" pendiente={pendiente} error={error} onConfirmar={() => anular()}>
 *     El stock descontado vuelve a los materiales.
 *   </ConfirmarAccion>
 */
export function ConfirmarAccion({
  texto,
  pregunta,
  children,
  textoConfirmar,
  textoPendiente = "Un momento…",
  variante = "peligro",
  varianteBoton,
  pendiente,
  error,
  deshabilitado = false,
  ancho = true,
  onConfirmar,
}: {
  /** Texto del botón que abre el panel. */
  texto: string;
  /** Pregunta del panel, con el dato real ("¿Dar de baja a Laura?"). */
  pregunta: string;
  /** Qué pasa si confirma (consecuencias). */
  children?: ReactNode;
  textoConfirmar: string;
  textoPendiente?: string;
  /** `peligro` (por defecto, panel rojo suave) para anular y dar de baja; `primario` (panel ámbar suave) para cambios que se pueden revertir. */
  variante?: "peligro" | "primario";
  /** Aspecto del botón que abre el panel, si no es el de `variante` (p. ej. `secundario`, para no sumar otro primario a la pantalla). */
  varianteBoton?: "peligro" | "primario" | "secundario";
  pendiente: boolean;
  error: string | null;
  deshabilitado?: boolean;
  ancho?: boolean;
  onConfirmar: (cerrar: () => void) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const idPregunta = useId();
  const abrirRef = useRef<HTMLButtonElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  // Solo se devuelve el foco al botón si el usuario canceló (no cuando la acción se concreta y el botón cambia).
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (abierto) cancelarRef.current?.focus();
    else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      abrirRef.current?.focus();
    }
  }, [abierto]);

  const cancelar = () => {
    volverAlBoton.current = true;
    setAbierto(false);
  };

  if (!abierto) {
    return (
      <div className="space-y-2">
        <button
          ref={abrirRef}
          type="button"
          disabled={deshabilitado}
          onClick={() => setAbierto(true)}
          className={claseBoton({ variante: varianteBoton ?? variante, ancho })}
        >
          {texto}
        </button>
        <BloqueError mensaje={error} />
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={idPregunta}
      className={`borde space-y-3 rounded-md p-4 ${variante === "peligro" ? "border-critico-line bg-critico-soft" : "border-aviso-line bg-aviso-soft"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pendiente) cancelar();
      }}
    >
      <p id={idPregunta} className={`text-body font-bold ${variante === "peligro" ? "text-critico-text" : "text-aviso-text"}`}>
        {pregunta}
      </p>
      {children ? <div className="text-body-sm text-ink">{children}</div> : null}
      <BloqueError mensaje={error} />
      <div className="grid grid-cols-2 gap-3">
        <button
          ref={cancelarRef}
          type="button"
          onClick={cancelar}
          disabled={pendiente}
          className={claseBoton({ variante: "secundario" })}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onConfirmar(() => setAbierto(false))}
          disabled={pendiente}
          aria-busy={pendiente || undefined}
          className={claseBoton({ variante })}
        >
          {pendiente ? textoPendiente : textoConfirmar}
        </button>
      </div>
    </div>
  );
}
