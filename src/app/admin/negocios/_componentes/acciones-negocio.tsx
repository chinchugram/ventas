"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarActivoNegocio, crearPrimerDueno } from "@/app/admin/negocios/actions";
import { BloqueError, BloqueExito, BotonEnviar, CampoTexto, useAccion } from "@/components/form";
import { ConfirmarAccion } from "@/components/confirmar-accion";
import { Boton, TituloBloque } from "@/components/ui";

const CLAVE_MIN = 9;

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
  const { pendiente, error, enviar } = useAccion(cambiarActivoNegocio, { gravedad: "datos" });
  const cambiar = (nuevo: boolean, alTerminar?: () => void) =>
    enviar({ id, activo: nuevo }, () => {
      alTerminar?.();
      router.refresh();
    });

  if (!activo) {
    return (
      <div className="space-y-2">
        <Boton variante="secundario" ancho disabled={pendiente} aria-busy={pendiente || undefined} onClick={() => cambiar(true)}>
          {pendiente ? "Reactivando…" : "Reactivar negocio"}
        </Boton>
        <BloqueError mensaje={error} />
      </div>
    );
  }

  return (
    <ConfirmarAccion
      texto="Dar de baja"
      pregunta={`¿Dar de baja «${nombre}»?`}
      textoConfirmar="Sí, dar de baja"
      textoPendiente="Dando de baja…"
      pendiente={pendiente}
      error={error}
      onConfirmar={(cerrar) => cambiar(false, cerrar)}
    >
      Nadie de ese negocio va a poder entrar hasta que lo reactives. Sus datos no se borran.
    </ConfirmarAccion>
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
        <Boton ancho onClick={() => setAbierto(true)}>
          Crear el primer dueño
        </Boton>
      </>
    );
  }

  return (
    <form
      className="tarjeta space-y-3 bg-surface-sunken p-4"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ negocioId: id, usuario, nombre: nombreDueno, clave }, () => {
          setHecho(`Listo, «${usuario.trim()}» ya es dueño. Tiene que cambiar la clave al entrar.`);
          setClave("");
          setAbierto(false);
          router.refresh();
        });
      }}
    >
      <TituloBloque className="mb-0">Primer dueño de {nombre}</TituloBloque>
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
      <div className="grid grid-cols-2 gap-3">
        <Boton variante="secundario" onClick={() => setAbierto(false)} disabled={pendiente}>
          Cancelar
        </Boton>
        <BotonEnviar pendiente={pendiente} texto="Crear dueño" />
      </div>
    </form>
  );
}
