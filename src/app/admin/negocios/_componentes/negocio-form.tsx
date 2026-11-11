"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearNegocio } from "@/app/admin/negocios/actions";
import { TituloBloque } from "@/components/ui";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, CampoTexto, NotaObligatorio, useAccion } from "@/components/form";

/** Alta de un negocio (nombre + identificador unico). El servidor valida todo; el texto de ayuda es solo una guia. */
export function NegocioForm({ esModoDemo = false }: { esModoDemo?: boolean }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [hecho, setHecho] = useState<string | null>(null);
  const { pendiente, error, enviar } = useAccion(crearNegocio);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setHecho(null);
        enviar({ nombre, slug }, () => {
          setHecho(`Listo, «${nombre.trim()}» ya existe con su configuración por defecto. Ahora creale el dueño.`);
          setNombre("");
          setSlug("");
          router.refresh();
        });
      }}
      className="tarjeta space-y-4 p-4 sm:p-6"
    >
      <TituloBloque className="mb-0">Nuevo negocio</TituloBloque>
      <NotaObligatorio />
      <AvisoDemo visible={esModoDemo} que="los negocios" />
      <CampoTexto etiqueta="Nombre" name="nombre" valor={nombre} alCambiar={setNombre} maxLength={80} autoComplete="off" required />
      <CampoTexto
        etiqueta="Identificador"
        name="slug"
        valor={slug}
        alCambiar={setSlug}
        maxLength={60}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        ayuda="Lo escribe el negocio en /login para entrar. Minúsculas, números y guiones, de 3 a 30 caracteres. No se puede cambiar después."
        required
      />
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={hecho} />
      <BotonEnviar pendiente={pendiente} texto="Crear negocio" className="min-h-11" />
    </form>
  );
}
