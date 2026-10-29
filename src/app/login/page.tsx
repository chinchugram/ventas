import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth";
import { destinoSeguro, inicioDeRol } from "@/lib/auth-pura";
import { getMarca } from "@/lib/marca";
import { FormularioLogin } from "./formulario-login";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar" };

/** Unica pantalla sin sesion. El layout no muestra la navegacion si no hay usuario. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string | string[] }>;
}) {
  const { siguiente: crudo } = await searchParams;
  const siguiente = destinoSeguro(typeof crudo === "string" ? crudo : null);

  const usuario = await usuarioActual();
  if (usuario) redirect(siguiente ?? inicioDeRol(usuario.rol));

  const marca = await getMarca();

  return (
    <div className="mx-auto w-full max-w-sm pt-6 sm:pt-12">
      <div className="mb-6 flex justify-center">
        <div className="rounded-2xl bg-tinta px-5 py-3 shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={marca.logo} alt={marca.nombre} className="h-12 w-auto" />
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Entrar</h1>
        <p className="mb-5 text-sm text-slate-600">Con el usuario y la clave que te dieron.</p>
        <FormularioLogin siguiente={siguiente} />
      </div>
    </div>
  );
}
