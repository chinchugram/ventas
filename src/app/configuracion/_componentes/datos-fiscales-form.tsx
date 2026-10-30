"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarDatosFiscales, type DatosFiscalesFormulario } from "@/app/configuracion/actions";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, CampoSelect, CampoTexto, useAccion, type Opcion } from "@/components/form";
import { CONDICIONES_IVA_EMISOR, ETIQUETA_CONDICION_IVA, validarDatosFiscales, type CampoFiscal } from "@/lib/datos-fiscales";

/** Lo que tipea el dueño: todo texto, igual que en la base. */
export type ValoresDatosFiscales = DatosFiscalesFormulario;

const OPCIONES_CONDICION: Opcion[] = CONDICIONES_IVA_EMISOR.map((valor) => ({
  valor,
  etiqueta: ETIQUETA_CONDICION_IVA[valor] ?? valor,
}));

/**
 * Datos fiscales del negocio (el emisor de los comprobantes). Los errores por
 * campo salen de `validarDatosFiscales` en vivo; el servidor vuelve a validar
 * todo al guardar.
 */
export function DatosFiscalesForm({
  inicial,
  faltantes,
  esModoDemo,
}: {
  inicial: ValoresDatosFiscales;
  /** Lo que falta (o esta mal) para emitir, tal como lo dice `faltantesParaEmitir`. */
  faltantes: string[];
  esModoDemo: boolean;
}) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(guardarDatosFiscales);
  const [valores, setValores] = useState(inicial);
  const [intento, setIntento] = useState(false);
  const [exito, setExito] = useState<string | null>(null);

  const cambiar = (campo: keyof ValoresDatosFiscales) => (valor: string) => {
    setExito(null);
    setValores((v) => ({ ...v, [campo]: valor }));
  };

  const revision = validarDatosFiscales(valores);
  const errores: Partial<Record<CampoFiscal, string>> = revision.ok ? {} : revision.errores;
  // Un campo vacio no se marca hasta intentar guardar; lo que se tipea se revisa en vivo.
  const errorDe = (campo: keyof ValoresDatosFiscales) =>
    intento || valores[campo].trim() ? (errores[campo] ?? null) : null;

  return (
    // noValidate: los "requeridos" los dice este formulario, campo por campo, no el navegador.
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setIntento(true);
        if (!revision.ok) return;
        enviar(valores, () => {
          setExito("Datos fiscales guardados.");
          router.refresh();
        });
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">Datos fiscales</h2>
        <p className="text-sm text-slate-500">Quién figura como emisor en cada factura o nota de crédito.</p>
      </div>

      <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">
        Sin conexión con ARCA, todo comprobante sale SIN VALIDEZ FISCAL.
      </p>

      {faltantes.length > 0 ? (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-semibold">Según lo guardado, falta para poder emitir:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {faltantes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Lo guardado alcanza para emitir.
        </p>
      )}

      <CampoTexto
        etiqueta="Razón social"
        valor={valores.razonSocial}
        alCambiar={cambiar("razonSocial")}
        maxLength={200}
        autoComplete="off"
        error={errorDe("razonSocial")}
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          etiqueta="CUIT"
          valor={valores.cuit}
          alCambiar={cambiar("cuit")}
          inputMode="numeric"
          autoComplete="off"
          placeholder="30-71234567-1"
          maxLength={20}
          error={errorDe("cuit")}
          ayuda="Con o sin guiones. Se verifica el dígito verificador."
          required
        />
        <CampoSelect
          etiqueta="Condición frente al IVA"
          valor={valores.condicionIva}
          alCambiar={cambiar("condicionIva")}
          opciones={OPCIONES_CONDICION}
          error={errorDe("condicionIva")}
          required
        />
      </div>

      <CampoTexto
        etiqueta="Domicilio fiscal"
        valor={valores.domicilio}
        alCambiar={cambiar("domicilio")}
        maxLength={200}
        autoComplete="off"
        error={errorDe("domicilio")}
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Fecha de inicio de actividades"
          tipo="date"
          valor={valores.inicioActividades}
          alCambiar={cambiar("inicioActividades")}
          error={errorDe("inicioActividades")}
          required
        />
        <CampoTexto
          etiqueta="Punto de venta"
          valor={valores.puntoVenta}
          alCambiar={cambiar("puntoVenta")}
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          error={errorDe("puntoVenta")}
          ayuda="Número de 1 a 99999 dado de alta en ARCA para factura electrónica."
          required
        />
      </div>

      <CampoTexto
        etiqueta="Número de ingresos brutos (opcional)"
        valor={valores.iibb}
        alCambiar={cambiar("iibb")}
        maxLength={30}
        autoComplete="off"
        error={errorDe("iibb")}
      />

      <AvisoDemo visible={esModoDemo} que="los datos fiscales" />
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={exito} />
      <BotonEnviar pendiente={pendiente} texto="Guardar datos fiscales" />
    </form>
  );
}
