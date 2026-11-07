"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarActivoUsuario, cambiarRolUsuario, resetearClaveUsuario } from "@/app/usuarios/actions";
import { BloqueError, BloqueExito, CampoSelect, CampoTexto, useAccion } from "@/components/form";
import { ConfirmarAccion } from "@/components/confirmar-accion";
import { Aviso, Boton, Panel, TituloBloque } from "@/components/ui";
import { MostrarClaves } from "./mostrar-claves";
import { CLAVE_MIN } from "./reglas";

type Rol = "DUENO" | "EMPLEADO";

const OPCIONES_ROL = [
  { valor: "EMPLEADO", etiqueta: "Empleado" },
  { valor: "DUENO", etiqueta: "Dueño" },
];

/**
 * Controles de administracion de OTRO usuario (la pagina no los muestra para uno
 * mismo). Que un boton este deshabilitado es solo ayuda: las reglas (ultimo
 * dueno, uno mismo, permisos) las hace cumplir el servidor. Cada cambio pide
 * confirmación en el lugar (`ConfirmarAccion`), sin `confirm()` del navegador.
 */
export function AccionesUsuario({
  id,
  nombre,
  rol,
  activo,
  esUltimoDuenoActivo,
}: {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  esUltimoDuenoActivo: boolean;
}) {
  return (
    <div className="space-y-4">
      <CambiarRol id={id} nombre={nombre} rol={rol} protegido={esUltimoDuenoActivo} />
      <ResetearClave id={id} nombre={nombre} />
      <BajaOReactivacion id={id} nombre={nombre} activo={activo} protegido={esUltimoDuenoActivo} />
    </div>
  );
}

function CambiarRol({ id, nombre, rol, protegido }: { id: string; nombre: string; rol: Rol; protegido: boolean }) {
  const router = useRouter();
  const [nuevo, setNuevo] = useState<string>(rol);
  const [hecho, setHecho] = useState(false);
  const { pendiente, error, enviar } = useAccion(cambiarRolUsuario);
  const sinCambio = nuevo === rol;

  return (
    <Panel como="section" className="space-y-3" aria-label="Rol">
      <TituloBloque className="mb-0">Rol</TituloBloque>
      <CampoSelect
        etiqueta="Rol de este usuario"
        valor={nuevo}
        alCambiar={(v) => {
          setNuevo(v);
          setHecho(false);
        }}
        opciones={OPCIONES_ROL}
        disabled={protegido}
        ayuda={
          protegido
            ? "Es el único dueño activo: antes de cambiarle el rol, dejá a otra persona como dueño."
            : "Al cambiarlo se le cierran las sesiones abiertas."
        }
      />
      {hecho && sinCambio ? <BloqueExito mensaje="Listo, el rol quedó actualizado." /> : null}
      <ConfirmarAccion
        texto="Cambiar rol"
        pregunta={`¿Cambiar el rol de ${nombre}?`}
        textoConfirmar="Sí, cambiar rol"
        textoPendiente="Cambiando…"
        variante="primario"
        pendiente={pendiente}
        error={error}
        deshabilitado={sinCambio || protegido}
        onConfirmar={(cerrar) => {
          setHecho(false);
          enviar({ id, rol: nuevo }, () => {
            setHecho(true);
            cerrar();
            router.refresh();
          });
        }}
      >
        Se le cierran las sesiones abiertas y tiene que volver a entrar con los permisos nuevos.
      </ConfirmarAccion>
    </Panel>
  );
}

function ResetearClave({ id, nombre }: { id: string; nombre: string }) {
  const [clave, setClave] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [hecho, setHecho] = useState(false);
  const { pendiente, error, enviar } = useAccion(resetearClaveUsuario);

  return (
    <Panel como="section" className="space-y-3" aria-label="Clave">
      <TituloBloque className="mb-0">Cambiar su clave</TituloBloque>
      <div>
        <CampoTexto
          etiqueta="Clave nueva"
          name="clave-nueva"
          tipo={mostrar ? "text" : "password"}
          valor={clave}
          alCambiar={(v) => {
            setClave(v);
            setHecho(false);
          }}
          maxLength={400}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          ayuda={`Mínimo ${CLAVE_MIN} caracteres. Se la pasás vos; después puede cambiarla desde «Cambiar mi clave».`}
        />
        <MostrarClaves marcado={mostrar} alCambiar={setMostrar} />
      </div>
      {hecho ? <BloqueExito mensaje="Listo, cambiaste la clave. Se cerraron sus sesiones abiertas." /> : null}
      <ConfirmarAccion
        texto="Cambiar clave"
        pregunta={`¿Cambiar la clave de ${nombre}?`}
        textoConfirmar="Sí, cambiar clave"
        textoPendiente="Cambiando…"
        variante="primario"
        pendiente={pendiente}
        error={error}
        deshabilitado={clave.length === 0}
        onConfirmar={(cerrar) => {
          setHecho(false);
          enviar({ id, clave }, () => {
            setClave("");
            setMostrar(false);
            setHecho(true);
            cerrar();
          });
        }}
      >
        Se le cierran las sesiones abiertas y se limpia la pausa por intentos fallidos.
      </ConfirmarAccion>
    </Panel>
  );
}

function BajaOReactivacion({
  id,
  nombre,
  activo,
  protegido,
}: {
  id: string;
  nombre: string;
  activo: boolean;
  protegido: boolean;
}) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoUsuario);
  const cambiar = (nuevo: boolean, alTerminar?: () => void) =>
    enviar({ id, activo: nuevo }, () => {
      alTerminar?.();
      router.refresh();
    });

  return (
    <Panel como="section" className="space-y-3" aria-label={activo ? "Dar de baja" : "Reactivar"}>
      <TituloBloque className="mb-0">{activo ? "Dar de baja" : "Reactivar"}</TituloBloque>
      <p className="text-body-sm text-ink-muted">
        {activo
          ? "No se borra nada: queda su historial, pero no puede entrar y se le cierran las sesiones abiertas. Se puede reactivar cuando quieras."
          : "Vuelve a poder entrar con su usuario y su clave."}
      </p>
      {activo && protegido ? <Aviso tono="aviso">Es el único dueño activo: no se lo puede dar de baja.</Aviso> : null}
      {activo ? (
        <ConfirmarAccion
          texto="Dar de baja"
          pregunta={`¿Dar de baja a ${nombre}?`}
          textoConfirmar="Sí, dar de baja"
          textoPendiente="Dando de baja…"
          pendiente={pendiente}
          error={error}
          deshabilitado={protegido}
          onConfirmar={(cerrar) => cambiar(false, cerrar)}
        >
          No va a poder entrar y se le cierran las sesiones abiertas.
        </ConfirmarAccion>
      ) : (
        <>
          <BloqueError mensaje={error} />
          <Boton ancho disabled={pendiente} aria-busy={pendiente || undefined} onClick={() => cambiar(true)}>
            {pendiente ? "Reactivando…" : "Reactivar usuario"}
          </Boton>
        </>
      )}
    </Panel>
  );
}
