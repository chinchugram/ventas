"use client";

import { useActionState, useEffect, useState } from "react";
import { BloqueError, BotonEnviar, CampoTexto, NotaObligatorio } from "@/components/form";
import { entrar, type EstadoLogin } from "./actions";

const ID_CLAVE = "login-clave";

/**
 * Formulario de entrada. Es un `<form action>` comun: funciona aunque el JS de
 * la pagina todavia no haya cargado (celular con mala senal).
 */
export function FormularioLogin({ siguiente, negocioInicial }: { siguiente: string | null; negocioInicial: string }) {
  const [estado, enviar, pendiente] = useActionState(entrar, { error: null, negocio: negocioInicial, usuario: "" } satisfies EstadoLogin);
  const [negocio, setNegocio] = useState(negocioInicial);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  // Cada intento fallido vuelve a montar el aviso: así se sacude también si el mensaje se repite.
  const [intento, setIntento] = useState(0);

  // Tras un error: se borra la clave y el foco vuelve a ella; el usuario queda escrito.
  useEffect(() => {
    if (!estado.error) return;
    setClave("");
    setIntento((n) => n + 1);
    document.getElementById(ID_CLAVE)?.focus();
  }, [estado]);

  return (
    <form action={enviar} className="space-y-4">
      <NotaObligatorio />
      {siguiente ? <input type="hidden" name="siguiente" value={siguiente} /> : null}
      <CampoTexto
        etiqueta="Negocio"
        name="negocio"
        valor={negocio}
        alCambiar={setNegocio}
        autoComplete="organization"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={60}
        required
      />
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
      <BloqueError key={intento} mensaje={estado.error} />
      <BotonEnviar pendiente={pendiente} texto="Entrar" textoPendiente="Entrando…" variante="marca" />
    </form>
  );
}
