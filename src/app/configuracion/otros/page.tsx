import type { Metadata } from "next";
import { requierePermisoPagina } from "@/lib/permisos";
import { modoActual, temaActual } from "@/lib/modo-servidor";
import { MODOS } from "@/lib/ayuda/guia";
import { Seccion, TituloBloque } from "@/components/ui";
import { SwitchSonido } from "@/components/sonido";
import { SelectorTema } from "@/components/selector-tema";
import { InterruptorModo } from "@/components/interruptor-modo";
import { SubnavConfiguracion } from "../_componentes/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Otros ajustes" };

/** Configuración → Otros: preferencias de este navegador (sonido, tema y modo). */
export default async function OtrosPage() {
  await requierePermisoPagina("configuracion");
  const [modo, tema] = await Promise.all([modoActual(), temaActual()]);

  return (
    <>
      <Seccion epigrafe="Tu negocio" titulo="Configuración" />
      <SubnavConfiguracion />

      <p className="mb-4 text-body-sm text-ink-muted">Estos ajustes valen para este dispositivo.</p>

      <section aria-labelledby="titulo-modo" className="tarjeta mb-4 space-y-3 p-4 sm:p-6">
        <TituloBloque id="titulo-modo" className="mb-0">
          Modo de la app
        </TituloBloque>
        <p className="text-body-sm text-ink-muted">{MODOS}</p>
        <InterruptorModo modo={modo} />
      </section>

      <section aria-labelledby="titulo-tema" className="tarjeta mb-4 space-y-3 p-4 sm:p-6">
        <TituloBloque id="titulo-tema" className="mb-0">
          Tema
        </TituloBloque>
        <SelectorTema inicial={tema} />
      </section>

      <section aria-labelledby="titulo-sonido" className="tarjeta mb-4 space-y-3 p-4 sm:p-6">
        <TituloBloque id="titulo-sonido" className="mb-0">
          Sonido
        </TituloBloque>
        <SwitchSonido />
      </section>
    </>
  );
}
