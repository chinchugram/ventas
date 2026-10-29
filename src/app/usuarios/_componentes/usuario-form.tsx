"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearUsuario } from "@/app/usuarios/actions";
import { AvisoDemo, BloqueError, BotonEnviar, CampoSelect, CampoTexto, useAccion } from "@/components/form";
import { MostrarClaves } from "./mostrar-claves";
import { AVISO_USUARIO, CLAVE_MIN, normalizarUsuario, usuarioValido } from "./reglas";

const OPCIONES_ROL = [
  { valor: "EMPLEADO", etiqueta: "Empleado: carga ventas y cobros, ve clientes y stock" },
  { valor: "DUENO", etiqueta: "Dueño: ve y puede todo, también administrar usuarios" },
];

/** Alta de usuario. El servidor decide todo; el aviso del usuario en vivo es solo una ayuda. */
export function UsuarioForm({ esModoDemo = false }: { esModoDemo?: boolean }) {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState("EMPLEADO");
  const [clave, setClave] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const { pendiente, error, enviar } = useAccion(crearUsuario);

  // Solo se marca el formato cuando se sale del campo (mientras se tipea todo parece mal).
  const [usuarioTocado, setUsuarioTocado] = useState(false);
  const avisoUsuario = usuarioTocado && usuario.trim() && !usuarioValido(usuario) ? AVISO_USUARIO : null;
  const ayudaUsuario =
    !avisoUsuario && usuario.trim() && normalizarUsuario(usuario) !== usuario
      ? `Se va a guardar como «${normalizarUsuario(usuario)}».`
      : "Es con lo que entra. Letras sin acentos, números, punto, guion o guion bajo; se guarda en minúsculas.";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ usuario, nombre, rol, clave }, (r) => router.push(`/usuarios/${r.id}`));
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <AvisoDemo visible={esModoDemo} que="los usuarios" />
      <CampoTexto
        etiqueta="Nombre"
        name="nombre"
        valor={nombre}
        alCambiar={setNombre}
        maxLength={80}
        autoComplete="off"
        ayuda="Como se muestra en pantalla: «Laura», «Mostrador»."
        required
      />
      <CampoTexto
        etiqueta="Usuario"
        name="usuario"
        valor={usuario}
        alCambiar={setUsuario}
        onBlur={() => setUsuarioTocado(true)}
        maxLength={60}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={avisoUsuario}
        ayuda={avisoUsuario ? undefined : ayudaUsuario}
        required
      />
      <CampoSelect etiqueta="Rol" valor={rol} alCambiar={setRol} opciones={OPCIONES_ROL} required />
      <div>
        <CampoTexto
          etiqueta="Clave inicial"
          name="clave"
          tipo={mostrar ? "text" : "password"}
          valor={clave}
          alCambiar={setClave}
          maxLength={400}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          ayuda={`Mínimo ${CLAVE_MIN} caracteres. Se la pasás vos a la persona; después puede cambiarla desde «Cambiar mi clave».`}
          required
        />
        <MostrarClaves marcado={mostrar} alCambiar={setMostrar} />
      </div>
      <BloqueError mensaje={error} />
      <BotonEnviar pendiente={pendiente} texto="Crear usuario" className="min-h-11" />
    </form>
  );
}
