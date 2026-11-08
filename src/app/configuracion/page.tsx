import Link from "next/link";
import { fmtMoneda } from "@/lib/money";
import { estadoDemo } from "@/lib/respaldo";
import { getArticulosConManoObra, getConfiguracion, getMaquinas } from "@/lib/queries/configuracion";
import { getConfig } from "@/lib/queries/catalogo";
import { entradaDesdeConfiguracion, faltantesParaEmitir } from "@/lib/datos-fiscales";
import { formatearCuit } from "@/lib/cuit";
import { Aviso, Boton, Dato, Etiqueta, Seccion, TituloBloque, Vacio } from "@/components/ui";
import { ConfiguracionForm } from "./_componentes/configuracion-form";
import { DatosFiscalesForm, type ValoresDatosFiscales } from "./_componentes/datos-fiscales-form";
import { requierePermisoPagina } from "@/lib/permisos";
import { getMarca } from "@/lib/marca";
import { LogoForm } from "./_componentes/logo-form";
import { SwitchSonido } from "@/components/sonido";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  await requierePermisoPagina("configuracion");
  const [config, maquinas, articulosConManoObra, configCruda, marca] = await Promise.all([
    getConfiguracion(),
    getMaquinas(),
    getArticulosConManoObra(),
    getConfig(),
    getMarca(),
  ]);

  const fiscal = entradaDesdeConfiguracion(configCruda);
  const datosFiscales: ValoresDatosFiscales = {
    razonSocial: fiscal.razonSocial ?? "",
    cuit: formatearCuit(fiscal.cuit),
    condicionIva: fiscal.condicionIva || "RESPONSABLE_INSCRIPTO",
    domicilio: fiscal.domicilio ?? "",
    inicioActividades: fiscal.inicioActividades ?? "",
    iibb: fiscal.iibb ?? "",
    puntoVenta: fiscal.puntoVenta ?? "",
  };

  return (
    <>
      <Seccion epigrafe="Tu negocio" titulo="Configuración" descripcion="Datos del negocio, costos por hora y máquinas." />

      <div className="mb-6">
        <ConfiguracionForm
          inicial={{
            // El nombre que ve el negocio (el de su configuracion o, si nunca lo guardo, `Negocio.nombre`):
            // asi guardar este formulario sin tocarlo no le cambia la marca por un valor por defecto.
            nombreNegocio: marca.nombre,
            costoHoraManoObra: config.costoHoraManoObra.toString(),
            ivaPorDefecto: config.ivaPorDefecto.toString(),
            margenObjetivo: config.margenObjetivo.toString(),
          }}
          articulosConManoObra={articulosConManoObra}
          esModoDemo={estadoDemo().activo}
        />
      </div>

      <div className="mb-6">
        <LogoForm nombre={marca.nombre} logo={marca.logo} logoPropio={marca.logoPropio} esModoDemo={estadoDemo().activo} />
      </div>

      <div className="mb-6">
        <DatosFiscalesForm
          inicial={datosFiscales}
          faltantes={faltantesParaEmitir(configCruda)}
          esModoDemo={estadoDemo().activo}
        />
      </div>

      {/* Sonido (momentos.md): la misma preferencia que el interruptor del encabezado. */}
      <section aria-labelledby="titulo-sonido" className="tarjeta mb-6 space-y-3 p-4 sm:p-6">
        <TituloBloque id="titulo-sonido" className="mb-0">
          Sonido
        </TituloBloque>
        <SwitchSonido />
      </section>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <TituloBloque className="mb-0">Máquinas</TituloBloque>
          <p className="text-body-sm text-ink-muted">Su costo por hora entra en las recetas que las usan.</p>
        </div>
        <Boton href="/configuracion/maquinas/nueva" className="shrink-0">
          Agregar máquina
        </Boton>
      </div>

      {maquinas.length === 0 ? (
        <Vacio mensaje="Ninguna máquina cargada." hint="Agregá el láser, el plotter y las demás para costear las recetas." />
      ) : (
        <ul className="space-y-2">
          {maquinas.map((m) => (
            <li key={m.id} className={`tarjeta p-4 ${m.activo ? "" : "bg-surface-sunken"}`}>
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/configuracion/maquinas/${m.id}`}
                  className={`inline-flex min-h-11 min-w-0 items-center text-body font-semibold underline-offset-2 hover:underline ${m.activo ? "text-ink" : "text-ink-muted"}`}
                >
                  {m.nombre}
                </Link>
                {m.activo ? null : <Etiqueta className="shrink-0">De baja</Etiqueta>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <Dato etiqueta="Costo por hora">{fmtMoneda(m.costoHora)}</Dato>
                <Dato etiqueta="Usada en">
                  {m.recetas} {m.recetas === 1 ? "receta" : "recetas"}
                </Dato>
              </dl>
              {!m.activo && m.recetas > 0 ? (
                <Aviso tono="aviso" className="mt-3">
                  Está de baja pero sigue en recetas: esos artículos la siguen costeando.
                </Aviso>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
