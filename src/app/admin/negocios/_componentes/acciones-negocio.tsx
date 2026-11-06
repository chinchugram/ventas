"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarActivoNegocio, crearPrimerDueno } from "@/app/admin/negocios/actions";
import { BloqueError, BloqueExito, BotonEnviar, CampoTexto, useAccion } from "@/components/form";

const CLAVE_MIN = 10;

/**
 * Controles de un negocio: baja logica / reactivacion y, mientras no tenga usuarios, crear su primer
 * dueno. Que un boton aparezca es solo ayuda: el servidor vuelve a comprobar todo.
 */
export function AccionesNegocio({
  id,
  nombre,
  activo,
  sinUsuarios,
}: {
  id: string;
  nombre: string;
  activo: boolean;
  sinUsuarios: boolean;
}) {
  return (
    <div className="mt-3 space-y-3">
      {sinUsuarios ? <PrimerDueno id={id} nombre={nombre} /> : null}
      <BajaOReactivacion id={id} nombre={nombre} activo={activo} />
    </div>
  );
}

function BajaOReactivacion({ id, nombre, activo }: { id: string; nombre: string; activo: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoNegocio);
  return (
    <div>
      <button
        type="button"
        disabled={pendiente}
        className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 disabled:opacity-60"
        onClick={() => {
          const pregunta = activo
            ? `¿Dar de baja «${nombre}»?\n\nNadie de ese negocio va a poder entrar hasta que lo reactives. Sus datos no se borran.`
            : `¿Reactivar «${nombre}»?`;
          if (!window.confirm(pregunta)) return;
          enviar({ id, activo: !activo }, () => router.refresh());
        }}
      >
        {activo ? "Dar de baja" : "Reactivar"}
      </button>
      <BloqueError mensaje={error} />
    </div>
  );
}

function PrimerDueno({ id, nombre }: { id: string; nombre: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [nombreDueno, setNombreDueno] = useState("");
  const [clave, setClave] = useState("");
  const [hecho, setHecho] = useState<string | null>(null);
  const { pendiente, error, enviar } = useAccion(crearPrimerDueno);

  if (!abierto) {
    return (
      <>
        <BloqueExito mensaje={hecho} />
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-lg bg-marca px-3 text-sm font-semibold text-tinta"
          onClick={() => setAbierto(true)}
        >
          Crear el primer dueño
        </button>
      </>
    );
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ negocioId: id, usuario, nombre: nombreDueno, clave }, () => {
          setHecho(`Dueño «${usuario.trim()}» creado. Tiene que cambiar la clave al entrar.`);
          setClave("");
          setAbierto(false);
          router.refresh();
        });
      }}
    >
      <h3 className="text-sm font-semibold text-slate-900">Primer dueño de {nombre}</h3>
      <CampoTexto etiqueta="Nombre" name="nombre" valor={nombreDueno} alCambiar={setNombreDueno} maxLength={80} autoComplete="off" required />
      <CampoTexto
        etiqueta="Usuario"
        name="usuario"
        valor={usuario}
        alCambiar={setUsuario}
        maxLength={60}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <CampoTexto
        etiqueta="Clave inicial"
        name="clave"
        tipo="password"
        valor={clave}
        alCambiar={setClave}
        maxLength={400}
        autoComplete="new-password"
        ayuda={`Mínimo ${CLAVE_MIN} caracteres. Se la pasás vos; al entrar por primera vez tiene que cambiarla.`}
        required
      />
      <BloqueError mensaje={error} />
      <div className="flex gap-2">
        <BotonEnviar pendiente={pendiente} texto="Crear dueño" className="min-h-11" />
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          onClick={() => setAbierto(false)}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
