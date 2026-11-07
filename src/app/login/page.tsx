import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth";
import { destinoSeguro, inicioDeRol, normalizarSlug, slugValido } from "@/lib/auth-pura";
import { LogoKiwitt } from "@/components/logo-kiwitt";
import { LogoMarca } from "@/components/logo-marca";
import { InterruptorSonido } from "@/components/sonido";
import { Panel } from "@/components/ui";
import { getMarcaPorSlug, MARCA_NEUTRA } from "@/lib/marca";
import { FormularioLogin } from "./formulario-login";

export const dynamic = "force-dynamic";

/** El titulo de la pestaña lleva el negocio elegido (`?negocio=`), no el de una sesion que no hay. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ negocio?: string | string[] }>;
}): Promise<Metadata> {
  const { negocio } = await searchParams;
  const marca = await getMarcaPorSlug(typeof negocio === "string" ? negocio : null);
  return { title: { absolute: marca === MARCA_NEUTRA ? "Entrar" : `Entrar · ${marca.nombre}` } };
}

/** Unica pantalla sin sesion. El layout no muestra la navegacion si no hay usuario. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string | string[]; negocio?: string | string[] }>;
}) {
  const { siguiente: crudo, negocio: negocioCrudo } = await searchParams;
  const siguiente = destinoSeguro(typeof crudo === "string" ? crudo : null);
  // `?negocio=hl-laser` solo rellena el campo (comodidad, p. ej. un enlace por negocio): no elige
  // nada ni da acceso, el servidor vuelve a resolver el negocio al entrar.
  const negocioInicial = typeof negocioCrudo === "string" && slugValido(negocioCrudo) ? normalizarSlug(negocioCrudo) : "";

  const usuario = await usuarioActual();
  if (usuario) redirect(siguiente ?? inicioDeRol(usuario.rol));

  // La marca sale del negocio elegido (`?negocio=slug`), no de una sesion que todavia no hay. Un
  // slug que no existe, esta inactivo o no se indico da la marca neutra (iniciales "V").
  const marca = await getMarcaPorSlug(negocioInicial);

  return (
    <div className="mx-auto w-full max-w-sm pt-6 sm:pt-12">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        {/* Sin negocio elegido, la marca de la app (Kiwitt); con negocio, su logo arriba y la firma de
            la app abajo (docs/brand/README.md, "Marca de la app vs. marca del negocio"). */}
        {marca === MARCA_NEUTRA ? (
          <LogoKiwitt tamano="lg" />
        ) : (
          <>
            <LogoMarca nombre={marca.nombre} logo={marca.logo} alto="h-16" className="rounded-md" />
            <p className="font-display text-body-lg font-bold text-ink">{marca.nombre}</p>
          </>
        )}
      </div>
      <Panel className="space-y-5">
        <div>
          <h1 className="font-display text-display-md text-ink">Hola de nuevo</h1>
          <p className="mt-1 text-body text-ink-muted">Entrá con el negocio, el usuario y la clave que te dieron.</p>
        </div>
        <FormularioLogin siguiente={siguiente} negocioInicial={negocioInicial} />
      </Panel>
      {/* Firma de la app (con negocio elegido) y el interruptor de sonido, que está en todas las pantallas. */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        {marca === MARCA_NEUTRA ? null : <LogoKiwitt tamano="sm" />}
        <InterruptorSonido />
      </div>
    </div>
  );
}
