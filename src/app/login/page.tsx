import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth";
import { destinoSeguro, inicioDeRol, normalizarSlug, slugValido } from "@/lib/auth-pura";
import { LogoKiwitt } from "@/components/logo-kiwitt";
import { LogoMarca } from "@/components/logo-marca";
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
      <div className="mb-6 flex flex-col items-center gap-2">
        {/* Sin negocio elegido, la marca de la app (Kiwitt); con negocio, su logo (docs/brand/README.md). */}
        {marca === MARCA_NEUTRA ? (
          <LogoKiwitt tamano="lg" />
        ) : (
          <div className="rounded-2xl bg-tinta px-5 py-3 shadow-md">
            <LogoMarca nombre={marca.nombre} logo={marca.logo} alto="h-12" />
          </div>
        )}
        {marca === MARCA_NEUTRA ? null : <p className="text-center text-base font-semibold text-slate-900">{marca.nombre}</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Entrar</h1>
        <p className="mb-5 text-sm text-slate-600">Con el negocio, el usuario y la clave que te dieron.</p>
        <FormularioLogin siguiente={siguiente} negocioInicial={negocioInicial} />
      </div>
    </div>
  );
}
