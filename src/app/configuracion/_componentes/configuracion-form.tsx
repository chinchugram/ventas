"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarConfiguracion } from "@/app/configuracion/actions";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, CampoDecimal, CampoSelect, CampoTexto, NotaObligatorio, useAccion } from "@/components/form";
import { Aviso, TituloBloque } from "@/components/ui";
import { canonico, IVAS_VALIDOS, validarCostoHora, validarMargen } from "@/lib/configuracion";

export type ValoresConfiguracion = {
  nombreNegocio: string;
  costoHoraManoObra: string;
  ivaPorDefecto: string;
  margenObjetivo: string;
};

const OPCIONES_IVA = IVAS_VALIDOS.map((iva) => ({ valor: iva, etiqueta: `${iva.replace(".", ",")}%` }));

/** "3500" y "3500,00" son el mismo costo: el aviso solo sale si cambia de verdad. */
const costoNormal = (v: string) => (validarCostoHora(v) === null ? canonico(v) : v.trim());

export function ConfiguracionForm({
  inicial,
  articulosConManoObra,
  esModoDemo,
}: {
  inicial: ValoresConfiguracion;
  /** Articulos activos que se costean con el costo/hora general. */
  articulosConManoObra: number;
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(guardarConfiguracion);
  const [valores, setValores] = useState(inicial);
  const [guardado, setGuardado] = useState(inicial);
  const [exito, setExito] = useState<string | null>(null);

  const cambiar = (campo: keyof ValoresConfiguracion) => (valor: string) => {
    setExito(null);
    setValores((v) => ({ ...v, [campo]: valor }));
  };

  // Errores en vivo: el servidor vuelve a validar todo al guardar.
  const errorCosto = valores.costoHoraManoObra.trim() ? validarCostoHora(valores.costoHoraManoObra) : null;
  const errorMargen = valores.margenObjetivo.trim() ? validarMargen(valores.margenObjetivo) : null;
  const cambiaCosto = costoNormal(valores.costoHoraManoObra) !== costoNormal(guardado.costoHoraManoObra);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar(valores, () => {
          setGuardado(valores);
          setExito(
            cambiaCosto
              ? "Configuración guardada. Los costos y márgenes del catálogo ya usan el nuevo costo/hora."
              : "Configuración guardada.",
          );
          router.refresh();
        });
      }}
      className="tarjeta space-y-4 p-4 sm:p-6"
    >
      <NotaObligatorio />
      <TituloBloque className="mb-0">Datos del negocio</TituloBloque>

      <CampoTexto
        etiqueta="Nombre del negocio"
        ayuda="Se muestra en el encabezado de todas las pantallas."
        valor={valores.nombreNegocio}
        alCambiar={cambiar("nombreNegocio")}
        maxLength={80}
        required
      />

      <CampoDecimal
        etiqueta="Costo por hora de mano de obra"
        sufijo="$/h"
        valor={valores.costoHoraManoObra}
        alCambiar={cambiar("costoHoraManoObra")}
        error={errorCosto}
        ayuda="Lo que cuesta una hora de trabajo. Se usa en las recetas con mano de obra."
        required
      />

      {cambiaCosto ? (
        <Aviso tono="aviso" role="status">
          Cambiar el costo/hora cambia el costo y el margen de todas las recetas con mano de obra
          {articulosConManoObra > 0
            ? ` (${articulosConManoObra} ${articulosConManoObra === 1 ? "artículo" : "artículos"})`
            : ""}
          . Las ventas ya hechas conservan el costo con el que se registraron.
        </Aviso>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <CampoSelect
          etiqueta="IVA por defecto"
          valor={valores.ivaPorDefecto}
          alCambiar={cambiar("ivaPorDefecto")}
          opciones={OPCIONES_IVA}
          ayuda="Para artículos nuevos."
        />
        <CampoDecimal
          etiqueta="Margen objetivo"
          sufijo="%"
          valor={valores.margenObjetivo}
          alCambiar={cambiar("margenObjetivo")}
          error={errorMargen}
          ayuda="De 0 a menos de 100."
          required
        />
      </div>

      <AvisoDemo visible={esModoDemo} />
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={exito} />
      <BotonEnviar pendiente={pendiente} texto="Guardar configuración" />
    </form>
  );
}
