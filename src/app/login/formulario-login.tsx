"use client";

import { useActionState, useEffect, useState } from "react";
import { BloqueError, BotonEnviar, CampoTexto } from "@/components/form";
import { entrar, type EstadoLogin } from "./actions";

const INICIAL: EstadoLogin = { error: null, usuario: "" };
const ID_CLAVE = "login-clave";

/**
 * Formulario de entrada. Es un `<form action>` comun: funciona aunque el JS de
 * la pagina todavia no haya cargado (celular con mala senal).
 */
export function FormularioLogin({ siguiente }: { siguiente: string | null }) {
  const [estado, enviar, pendiente] = useActionState(entrar, INICIAL);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");

  // Tras un error: se borra la clave y el foco vuelve a ella; el usuario queda escrito.
  useEffect(() => {
    if (!estado.error) return;
    setClave("");
    document.getElementById(ID_CLAVE)?.focus();
  }, [estado]);

  return (
    <form action={enviar} className="space-y-4">
      {siguiente ? <input type="hidden" name="siguiente" value={siguiente} /> : null}
      <CampoTexto
        etiqueta="Usuario"
        name="usuario"
        valor={usuario}
        alCambiar={setUsuario}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={100}
        required
      />
      <CampoTexto
        etiqueta="Clave"
        tipo="password"
        name="clave"
        id={ID_CLAVE}
        valor={clave}
        alCambiar={setClave}
        autoComplete="current-password"
        maxLength={400}
        required
      />
      <BloqueError mensaje={estado.error} />
      <BotonEnviar pendiente={pendiente} texto="Entrar" textoPendiente="Entrando…" variante="marca" className="min-h-11" />
    </form>
  );
}
