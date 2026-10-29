"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarMiClave } from "@/app/usuarios/actions";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, CampoTexto, useAccion } from "@/components/form";
import { MostrarClaves } from "./mostrar-claves";
import { CLAVE_MIN } from "./reglas";

/**
 * Cambiar la clave propia (cualquier rol). Pide la actual y la nueva dos veces.
 * El servidor repite todas las revisiones; aca solo se avisa lo evidente.
 */
export function MiClaveForm({ esModoDemo = false }: { esModoDemo?: boolean }) {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [hecho, setHecho] = useState(false);
  const { pendiente, error, setError, enviar } = useAccion(cambiarMiClave);

  const tipo = mostrar ? "text" : "password";
  const noCoinciden = repetir.length > 0 && nueva !== repetir ? "Las dos claves nuevas no coinciden." : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setHecho(false);
        if (nueva !== repetir) {
          setError("Las dos claves nuevas no coinciden.");
          return;
        }
        enviar({ actual, nueva, repetir }, () => {
          setActual("");
          setNueva("");
          setRepetir("");
          setMostrar(false);
          setHecho(true);
          router.refresh();
        });
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <AvisoDemo visible={esModoDemo} que="la clave" />
      <CampoTexto
        etiqueta="Clave actual"
        name="clave-actual"
        tipo={tipo}
        valor={actual}
        alCambiar={setActual}
        maxLength={400}
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <CampoTexto
        etiqueta="Clave nueva"
        name="clave-nueva"
        tipo={tipo}
        valor={nueva}
        alCambiar={setNueva}
        maxLength={400}
        autoComplete="new-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        ayuda={`Mínimo ${CLAVE_MIN} caracteres y distinta de la actual.`}
        required
      />
      <CampoTexto
        etiqueta="Repetí la clave nueva"
        name="clave-repetida"
        tipo={tipo}
        valor={repetir}
        alCambiar={setRepetir}
        maxLength={400}
        autoComplete="new-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={noCoinciden}
        required
      />
      <MostrarClaves marcado={mostrar} alCambiar={setMostrar} />
      <BloqueError mensaje={error} />
      {hecho ? (
        <BloqueExito mensaje="Listo: cambiaste tu clave. Se cerraron las sesiones que tenías abiertas en otros dispositivos." />
      ) : null}
      <BotonEnviar pendiente={pendiente} texto="Cambiar mi clave" className="min-h-11" />
    </form>
  );
}
