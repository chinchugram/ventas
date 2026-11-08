"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { Resultado } from "@/lib/acciones";
import type { Momento } from "@/lib/sonido";
import { claseBoton } from "@/components/ui";
import { Tilde, mensajeDeLogro, useMomento, type MomentoAnunciable } from "@/components/momentos";
import type { Logro } from "@/lib/logros";

/**
 * Error general del formulario (el que devuelve la server action). Momento "error" (momentos.md):
 * el bloque se sacude al aparecer; el sonido lo pone `useAccion`.
 */
export function BloqueError({ mensaje }: { mensaje: string | null | undefined }) {
  if (!mensaje) return null;
  return (
    <p role="alert" className="borde animate-sacudir rounded-md border-critico-line bg-critico-soft p-3 text-body-sm font-semibold text-critico-text">
      {mensaje}
    </p>
  );
}

/**
 * Confirmacion breve despues de guardar. Momento "guardado" (momentos.md): entra y se dibuja un
 * tilde, sin sonido. Con `momento="turno"` (acción completada) salta como un sticker.
 */
export function BloqueExito({
  mensaje,
  momento = "guardado",
}: {
  mensaje: ReactNode;
  momento?: "guardado" | "turno";
}) {
  if (!mensaje) return null;
  return (
    <p
      role="status"
      data-momento={momento}
      className={`borde flex items-start gap-2 rounded-md border-ok-line bg-ok-soft p-3 text-body-sm font-semibold text-ok-text ${momento === "turno" ? "animate-salto" : "animate-entrada"}`}
    >
      <Tilde />
      <span>{mensaje}</span>
    </p>
  );
}

/** Aviso de modo demostracion: sin base, el formulario no guarda. */
export function AvisoDemo({ visible, que = "los cambios" }: { visible: boolean; que?: string }) {
  if (!visible) return null;
  return (
    <p className="borde rounded-md border-aviso-line bg-aviso-soft p-3 text-body-sm text-ink">
      <span className="font-bold text-aviso-text">Modo demostración.</span> Sin base de datos conectada, {que} no se guardan.
    </p>
  );
}

/**
 * Botón de envío (botón sticker, ancho completo): se deshabilita, queda apretado y cambia el texto
 * mientras guarda. Variantes: `principal` y `marca` son el primario de la marca (mandarina; el
 * primario es uno solo en todos los productos), `peligro` es el de anular o borrar.
 */
export function BotonEnviar({
  pendiente,
  texto,
  textoPendiente = "Guardando…",
  variante = "principal",
  ancho = true,
  disabled,
  className,
}: {
  pendiente: boolean;
  texto: string;
  textoPendiente?: string;
  variante?: "principal" | "marca" | "peligro";
  /** Ancho completo (por defecto). `false` para un botón al lado de un campo o de un total. */
  ancho?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pendiente || disabled}
      aria-busy={pendiente || undefined}
      className={claseBoton({ variante: variante === "peligro" ? "peligro" : "primario", ancho }) + ` ${className ?? ""}`}
    >
      {pendiente ? textoPendiente : texto}
    </button>
  );
}

/** Qué momento dispara una acción que salió bien: uno fijo, o uno según la respuesta y los datos. */
type ElegirMomento<D, R> = Momento | ((r: R, datos: D) => Momento);

/** Mensaje de error cuando la server action ni siquiera respondió (red caída, servidor reiniciando). */
export const ERROR_SIN_RESPUESTA =
  "Se cortó la comunicación con el servidor y no sabemos si llegó a guardarse. Lo que cargaste sigue acá: revisá la conexión y fijate antes de mandarlo de nuevo.";

/**
 * Corre una server action que devuelve `{ ok, error }` dentro de una
 * transicion, y guarda el error para mostrarlo con `BloqueError`.
 *
 *   const { pendiente, error, enviar } = useAccion(guardarCliente);
 *   <form onSubmit={(e) => { e.preventDefault(); enviar(datos, () => router.push("/clientes")); }}>
 *
 * Momentos (momentos.md), sin repetir código por pantalla:
 *  - Bien: suena `momento` (por defecto `guardado`, que es silencioso). Con `anuncio`, además
 *    muestra el aviso flotante del momento, que sobrevive a la navegación (`router.push`).
 *  - Bien y el resultado trae `logro` (lib/logros.ts: meta del mes, primer cliente): si corresponde
 *    festejarlo (`mensajeDeLogro`), suena `logro` EN LUGAR del momento de siempre (nunca dos
 *    sonidos) y sale el aviso con el estallido y el mensaje de marca.
 *  - La acción respondió con un error: suena `error` (dos notas que bajan); `BloqueError` sacude.
 *  - No hubo respuesta: suena `offline` (el aviso grave: no es un error del usuario).
 *  - Con `gravedad` ("dinero" | "datos": anular, nota de crédito, facturar, bajas, ajustes de stock)
 *    ningún error suena (momentos.md: un error grave no lleva sonido simpático; decisión de ventas:
 *    nada). Siguen el texto y la sacudida de `BloqueError`.
 *
 *   useAccion(registrarPago, { momento: "cobro", anuncio: (_r, d) => `¡Cobrado! ${d.monto}…` });
 *   useAccion(anularVenta, { gravedad: "dinero" });
 */
export function useAccion<D, R extends Resultado | { ok: true } | { ok: false; error: string }>(
  accion: (datos: D) => Promise<R>,
  opciones: {
    momento?: ElegirMomento<D, Extract<R, { ok: true }>>;
    anuncio?: (r: Extract<R, { ok: true }>, datos: D) => ReactNode;
    /** Acción que toca plata o datos delicados: sus errores no suenan (ni `error` ni `offline`). */
    gravedad?: "dinero" | "datos";
  } = {},
) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { reproducir, anunciar } = useMomento();

  const enviar = (datos: D, alTerminarBien?: (r: Extract<R, { ok: true }>) => void) => {
    setError(null);
    iniciar(async () => {
      let r: R;
      try {
        r = await accion(datos);
      } catch {
        if (!opciones.gravedad) reproducir("offline");
        setError(ERROR_SIN_RESPUESTA);
        return;
      }
      if (r.ok) {
        const bien = r as Extract<R, { ok: true }>;
        const { momento: elegir = "guardado", anuncio } = opciones;
        const logro = (bien as { logro?: Logro }).logro;
        const festejo = logro ? mensajeDeLogro(logro) : null;
        if (festejo) {
          // Un solo sonido: el logro reemplaza al del momento (p. ej. el `cobro` de una venta pagada).
          anunciar({ momento: "logro", mensaje: festejo });
        } else {
          const momento = typeof elegir === "function" ? elegir(bien, datos) : elegir;
          if (anuncio) anunciar({ momento: momento as MomentoAnunciable, mensaje: anuncio(bien, datos) });
          else reproducir(momento);
        }
        alTerminarBien?.(bien);
      } else {
        if (!opciones.gravedad) reproducir("error");
        setError((r as { ok: false; error: string }).error);
      }
    });
  };

  return { pendiente, error, setError, enviar };
}
