"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarDatosFiscales, type DatosFiscalesFormulario } from "@/app/configuracion/actions";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, CampoSelect, CampoTexto, NotaObligatorio, useAccion, type Opcion } from "@/components/form";
import { Aviso, TituloBloque } from "@/components/ui";
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
      className="tarjeta space-y-4 p-4 sm:p-6"
    >
      <NotaObligatorio />
      <div>
        <TituloBloque className="mb-0">Datos fiscales</TituloBloque>
        <p className="text-body-sm text-ink-muted">Quién figura como emisor en cada factura o nota de crédito.</p>
      </div>

      <Aviso tono="info" titulo="Los comprobantes que emite la app son internos: no tienen validez fiscal." />

      {faltantes.length > 0 ? (
        <Aviso tono="aviso" titulo="Según lo guardado, falta para poder emitir:">
          <ul className="list-disc space-y-0.5 pl-5">
            {faltantes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Aviso>
      ) : (
        <Aviso tono="ok" titulo="Lo guardado alcanza para emitir." />
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
