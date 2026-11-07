"use client";

import { useRouter } from "next/navigation";
import { useAccion } from "@/components/form";
import { BajaReactivar } from "@/components/baja-reactivar";
import { cambiarEstadoMaterial } from "../actions";

/**
 * Baja logica o reactivacion, con un paso de confirmacion (en el celular un
 * toque de mas es barato; una baja por error, no tanto).
 */
export function EstadoMaterialBoton({ id, activo }: { id: string; activo: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarEstadoMaterial);

  const ejecutar = () =>
    enviar({ id, activo: !activo }, () => {
      router.push(activo ? "/materiales?bajas=1" : `/materiales/${id}/editar`);
      router.refresh();
    });

  return (
    <BajaReactivar
      activo={activo}
      pendiente={pendiente}
      error={error}
      textoReactivar="Reactivar material"
      onBaja={ejecutar}
      onReactivar={ejecutar}
    />
  );
}
