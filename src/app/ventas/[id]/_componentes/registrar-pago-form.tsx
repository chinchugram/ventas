"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registrarPago } from "@/app/ventas/[id]/actions";
import {
  BloqueError,
  BotonEnviar,
  CampoDecimal,
  CampoNotas,
  CampoSelect,
  CampoTexto,
  NotaObligatorio,
  useAccion,
} from "@/components/form";
import { decimalOCero, esDecimal } from "@/lib/acciones";
import { d, fmtMoneda } from "@/lib/money";
import { MontoQueCuenta } from "@/components/momentos";
import { TituloBloque } from "@/components/ui";
import { ETIQUETA_METODO, METODOS_PAGO, montoSugerido, validarMontoContraSaldo, type MetodoPago } from "@/lib/cobranzas";

const OPCIONES_METODO = METODOS_PAGO.map((m) => ({ valor: m, etiqueta: ETIQUETA_METODO[m]! }));

/** voz.md: los festejos rotan para no cansar (una exclamación, el monto real después). */
const FESTEJOS_COBRO = ["¡Cobrado!", "¡Listo, cobrado!", "¡Entró la plata!"];
let vueltaFestejo = 0;
function festejoDeCobro(): string {
  return FESTEJOS_COBRO[vueltaFestejo++ % FESTEJOS_COBRO.length]!;
}

/**
 * Cobro sobre una venta. El monto arranca con el saldo (el caso comun es
 * cobrar todo); el aviso de "supera el saldo" es solo una ayuda: el servidor
 * vuelve a calcular el saldo con la venta bloqueada.
 */
export function RegistrarPagoForm({ ventaId, saldo, hoy }: { ventaId: string; saldo: string; hoy: string }) {
  const router = useRouter();
  // Momento "cobro": caja registradora y aviso flotante (el formulario desaparece si se cobró todo).
  const { pendiente, error, enviar } = useAccion(registrarPago, {
    momento: "cobro",
    anuncio: (_r, datos) => (
      <>
        {festejoDeCobro()} <MontoQueCuenta valor={decimalOCero(datos.monto).toNumber()} formato={fmtMoneda} /> ya están en caja.
      </>
    ),
  });
  const [monto, setMonto] = useState(() => montoSugerido(d(saldo)));
  const [metodo, setMetodo] = useState<MetodoPago>("EFECTIVO");
  const [fecha, setFecha] = useState(hoy);
  const [notas, setNotas] = useState("");

  const aviso = monto.trim() && esDecimal(monto) ? validarMontoContraSaldo(decimalOCero(monto), d(saldo)) : null;
  const resto = decimalOCero(monto).gt(0) && !aviso ? d(saldo).minus(decimalOCero(monto)) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ ventaId, monto, metodo, fecha, notas }, () => {
          const cobrado = decimalOCero(monto);
          // Sugiere lo que queda para el proximo cobro.
          // Si se cobró todo, el formulario se va con el refresh: vacío, para no mostrar (ni sacudir)
          // un "tiene que ser mayor a 0" sobre un cobro que salió bien.
          const restante = d(saldo).minus(cobrado).abs();
          setMonto(restante.gt(0) ? montoSugerido(restante) : "");
          setNotas("");
          router.refresh();
        });
      }}
      className="tarjeta space-y-4 p-4 sm:p-6"
    >
      <TituloBloque className="">Registrar pago</TituloBloque>
      <NotaObligatorio />
      <CampoDecimal
        etiqueta="Monto"
        prefijo="$"
        valor={monto}
        alCambiar={setMonto}
        error={aviso}
        ayuda={
          aviso
            ? undefined
            : resto && resto.gt("0.01")
              ? `Queda debiendo ${fmtMoneda(resto)}`
              : `Saldo: ${fmtMoneda(saldo)}`
        }
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <CampoSelect
          etiqueta="Método"
          valor={metodo}
          alCambiar={(v) => setMetodo(v as MetodoPago)}
          opciones={OPCIONES_METODO}
          required
        />
        <CampoTexto etiqueta="Fecha" tipo="date" valor={fecha} alCambiar={setFecha} max={hoy} required />
      </div>
      <CampoNotas
        etiqueta="Notas (opcional)"
        valor={notas}
        alCambiar={setNotas}
        filas={2}
        maxLength={500}
        placeholder="N° de transferencia, quién pagó…"
      />
      <BloqueError mensaje={error} />
      <BotonEnviar pendiente={pendiente} texto="Registrar pago" disabled={!!aviso} variante="marca" />
    </form>
  );
}
