"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarActivoUsuario, cambiarRolUsuario, resetearClaveUsuario } from "@/app/usuarios/actions";
import { BloqueError, BloqueExito, BotonEnviar, CampoSelect, CampoTexto, useAccion } from "@/components/form";
import { MostrarClaves } from "./mostrar-claves";
import { CLAVE_MIN } from "./reglas";

type Rol = "DUENO" | "EMPLEADO";

const OPCIONES_ROL = [
  { valor: "EMPLEADO", etiqueta: "Empleado" },
  { valor: "DUENO", etiqueta: "Dueño" },
];

const TARJETA = "space-y-3 rounded-xl border border-slate-200 bg-white p-4";

/**
 * Controles de administracion de OTRO usuario (la pagina no los muestra para uno
 * mismo). Que un boton este deshabilitado es solo ayuda: las reglas (ultimo
 * dueno, uno mismo, permisos) las hace cumplir el servidor.
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
    <form
      className={TARJETA}
      onSubmit={(e) => {
        e.preventDefault();
        setHecho(false);
        if (
          !window.confirm(
            `¿Cambiar el rol de ${nombre}?\n\nSe le cierran las sesiones abiertas y tiene que volver a entrar con los permisos nuevos.`,
          )
        ) {
          return;
        }
        enviar({ id, rol: nuevo }, () => {
          setHecho(true);
          router.refresh();
        });
      }}
    >
      <h2 className="text-base font-semibold text-slate-900">Rol</h2>
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
      <BloqueError mensaje={error} />
      {hecho && sinCambio ? <BloqueExito mensaje="Rol actualizado." /> : null}
      <BotonEnviar pendiente={pendiente} texto="Cambiar rol" disabled={sinCambio || protegido} className="min-h-11" />
    </form>
  );
}

function ResetearClave({ id, nombre }: { id: string; nombre: string }) {
  const [clave, setClave] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [hecho, setHecho] = useState(false);
  const { pendiente, error, enviar } = useAccion(resetearClaveUsuario);

  return (
    <form
      className={TARJETA}
      onSubmit={(e) => {
        e.preventDefault();
        setHecho(false);
        if (
          !window.confirm(
            `¿Cambiar la clave de ${nombre}?\n\nSe le cierran las sesiones abiertas y se limpia la pausa por intentos fallidos.`,
          )
        ) {
          return;
        }
        enviar({ id, clave }, () => {
          setClave("");
          setMostrar(false);
          setHecho(true);
        });
      }}
    >
      <h2 className="text-base font-semibold text-slate-900">Cambiar su clave</h2>
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
      <BloqueError mensaje={error} />
      {hecho ? <BloqueExito mensaje="Clave cambiada. Se cerraron sus sesiones abiertas." /> : null}
      <BotonEnviar pendiente={pendiente} texto="Cambiar clave" disabled={clave.length === 0} className="min-h-11" />
    </form>
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

  return (
    <div className={TARJETA}>
      <h2 className="text-base font-semibold text-slate-900">{activo ? "Dar de baja" : "Reactivar"}</h2>
      <p className="text-sm text-slate-600">
        {activo
          ? "No se borra nada: queda su historial, pero no puede entrar y se le cierran las sesiones abiertas. Se puede reactivar cuando quieras."
          : "Vuelve a poder entrar con su usuario y su clave."}
      </p>
      {activo && protegido ? (
        <p className="text-sm text-amber-800">Es el único dueño activo: no se lo puede dar de baja.</p>
      ) : null}
      <BloqueError mensaje={error} />
      <button
        type="button"
        disabled={pendiente || (activo && protegido)}
        onClick={() => {
          if (activo && !window.confirm(`¿Dar de baja a ${nombre}?\n\nNo va a poder entrar y se le cierran las sesiones abiertas.`)) {
            return;
          }
          enviar({ id, activo: !activo }, () => router.refresh());
        }}
        className={`min-h-11 w-full rounded-lg border bg-white py-3 text-sm font-semibold disabled:opacity-60 ${
          activo ? "border-red-300 text-red-700" : "border-emerald-300 text-emerald-700"
        }`}
      >
        {pendiente ? "Guardando…" : activo ? "Dar de baja" : "Reactivar usuario"}
      </button>
    </div>
  );
}
